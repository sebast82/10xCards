# SRS Review Session (S-05) Implementation Plan

## Overview

Wire the finished FSRS contract from F-01 (`src/lib/srs`) into a working review loop. Per the research this change requires **no migration and no backfill** — every flashcard already carries valid schedule state, the `(user_id, due)` index exists, and RLS/grants/triggers are in place. The build is exactly: one endpoint (`/api/reviews` GET + POST), one session service, one `review.astro` page, one React island, four shell-wiring steps, and tests. The guardrail — "the review mechanism must not fail, regardless of card source (AI or manual)" — is satisfied structurally but F-01 explicitly delegated the *test* of both sources to this change.

## Current State Analysis

- **SRS module is complete and unused outside `flashcards/service.ts`.** Public surface ([src/lib/srs/index.ts:1-5](src/lib/srs/index.ts#L1-L5)): `scheduleStateRowSchema`, `scheduleStateRowToCard`, `cardToScheduleStateRow`, `createScheduler`, and types `ScheduleStateRow`, `ScheduleOperations`, `SchedulePreview`, `Grade`. Three operations, none mutating input, none reading the system clock — `now` is always an explicit argument ([scheduler.ts:8-12](src/lib/srs/scheduler.ts#L8-L12)).
- **`preview()` is built, tested, and called from nowhere** ([scheduler.ts:21-31](src/lib/srs/scheduler.ts#L21-L31)). It returns four full `ScheduleStateRow` states keyed by `Grade`, not intervals.
- **Every flashcard has valid schedule state.** Both insert sites call `createScheduler().createNewCard(new Date())` ([service.ts:81](src/lib/flashcards/service.ts#L81), [service.ts:122](src/lib/flashcards/service.ts#L122)); the nine columns are `not null` with no defaults ([schema:43-51](supabase/migrations/20260824202259_flashcards_schema.sql#L43-L51)). A card with no schedule state cannot exist.
- **The read-side type seam.** `ScheduleStateRow.state` is `0 | 1 | 2 | 3`; the generated DB type is `number` ([schema-contract.test.ts:10](src/db/schema-contract.test.ts#L10) asserts only the write direction). A row from Supabase is **not** assignable to `ScheduleStateRow`. S-05 is the first consumer that *reads* schedule state.
- **`FSRSValidationError` is not exported in ts-fsrs 5.4.1** — cannot be caught by `instanceof`. A `grade` of `0` or `5` passes through the SRS module and throws uncatchably inside ts-fsrs. Zod does not guard the grade.
- **No optimistic-concurrency protection on the flashcards path** — no version column, no `for update`. Grading is `SELECT` → `applyGrade` → `UPDATE`.
- **The island cannot import from `@/lib/srs`** — it pulls Zod and ts-fsrs. `applyGrade` runs server-side only (F6 class from the S-02 review).
- **Zero keyboard/focus/live-region precedent.** Grep of `src/` for `useEffect|useRef|onKeyDown|addEventListener|autoFocus|tabIndex|\.focus\(` returns nothing. `aria-live` appears nowhere in islands.
- **`navigation.test.ts` asserts the whole array by `toEqual`** ([navigation.test.ts:6-11](src/lib/navigation.test.ts#L6-L11)) — a deliberate tripwire. Adding `/review` breaks the test until updated in the same commit.
- **`supabase-stub.ts` implements only `select/insert/update/delete/eq/gte/single/maybeSingle/then`** ([supabase-stub.ts:23-72](src/lib/test-support/supabase-stub.ts#L23-L72)) — no `lte`, `order`, `limit`, or `range`. The queue query cannot be stubbed today.
- **PRD gives S-05 one requirement (FR-009) and one guardrail** — no session length, daily limits, stats, streaks, or undo. `ReviewLog` is not persisted (F-01 decision #1), so grade undo is structurally impossible and out of scope.

## Desired End State

A logged-in user opens `/review` from the persistent navigation. The page loads the cards due now (`due <= now()`), shows one at a time: question first, then — after pressing Space or clicking "Pokaż odpowiedź" — the answer plus four grade buttons labelled with the resulting interval ("Dobrze · za 3 dni"). Pressing `1`–`4` or clicking a button records the grade; the schedule advances server-side and the next card appears. A progress indicator reads "Karta 3 z 12", where the denominator is a running total — cards already seen this session plus the cards left in the in-memory queue — so it grows if a re-fetch adds more due cards. It is deliberately not a fixed "N of M". When the queue empties the island re-fetches; when the re-fetch is empty the session ends with a "to na dziś wszystko" screen. If nothing was due at all, the user sees the empty state with a link back to the deck. AI-sourced and manually-created cards are graded through the identical path. The whole loop is operable by keyboard and announced to screen readers.

Verify: `npm test` green (new service, route, island, stub, navigation tests), `npm run lint` and `astro check` clean, `npm run build` succeeds, and the manual guardrail checklist in `manual-verification.md` is complete including a deployed-instance run.

### Key Discoveries:

- SRS read path: every DB row must go through `scheduleStateRowSchema.safeParse` before `preview`/`applyGrade` — never `as ScheduleStateRow` ([schedule-state.ts:21-22](src/lib/srs/schedule-state.ts#L21-L22)).
- Grade must be validated at the API boundary (`z.union([z.literal(1)..z.literal(4)])`), not deeper.
- Endpoint anatomy to copy: frozen Polish `MESSAGES`, module-level Zod schemas in the route file, local `json()`/`error()` helpers, `getRequestContext` for multi-method routes ([\[id\].ts:33-51](src/pages/api/flashcards/[id].ts#L33-L51)), body parse in `try/catch`, service call in `try/catch` with `instanceof` dispatch ([flashcards.ts](src/pages/api/flashcards.ts)).
- Response envelope: success is the bare service object (no `{ data }`) — POST returns `{ id }`; the one exception is `GET`, where the route wraps the service's `ReviewCard[]` in `{ cards }` so the island parses a named key, not a bare array. Error is exactly `{ "error": "<polski komunikat>" }`. Status ladder: 401 → 503 → 400 → 404 → 500 (+ 409 here).
- Island status-machine precedent: `GenerateView.tsx` `ViewStatus` union + `updateProposal` patch helper ([GenerateView.tsx:13](src/components/generate/GenerateView.tsx#L13), [:90-92](src/components/generate/GenerateView.tsx#L90-L92)).
- Queue query idiom: `.select("<explicit columns>").eq("user_id", userId).lte("due", nowIso).order("due", { ascending: true }).range(0, BATCH - 1)` — `.range` with a module constant, not `.limit()` ([deck.astro:8-17](src/pages/deck.astro#L8-L17)).
- `reps` increments on every ts-fsrs `next()` call — a reliable monotonic guard for the conditional UPDATE.
- `eslint.config.js` server-path list (`no-console: "error"`) does not yet include a reviews directory — must be added.
- Empty-state precedent: bordered box + one sentence + `Button asChild` link ([FlashcardCollection.tsx:281-288](src/components/deck/FlashcardCollection.tsx#L281-L288)). Error precedent: `Alert variant="destructive"` + retry button ([GenerateView.tsx:223-241](src/components/generate/GenerateView.tsx#L223-L241)). Loading: `<Loader2 className="animate-spin" />` in a disabled button.

## What We're NOT Doing

- No migration, no new column, no `ReviewLog` table — grade undo stays impossible (F-01 decision #1).
- No daily new-card limit, no interleaving by `state`, no session-length setting, no stats/streaks/history — none are in the PRD.
- No study-ahead when nothing is due (empty state only).
- No card-flip animation, no `prefers-reduced-motion` handling — deferred to S-08.
- No per-user FSRS parameters — `createScheduler()` is called with no arguments, matching both existing production call sites (F-01 decision #6). Passing different parameters would silently diverge from stored state.
- No extraction of `readJson`/`readError`/`json`/`error` into a shared module — the third copy follows the codebase's copy-don't-abstract convention.
- No `export const prerender` — `astro.config.mjs` sets `output: "server"` globally and no route in `src/` declares it.
- No E2E/Playwright, no MSW (every plan since S-02 excludes E2E explicitly).
- No client possession of schedule state — the POST body is `{ flashcardId, grade }` only; the server re-reads the row.
- No re-computation of interval labels after the queue fetch. `intervals` are built once in the GET response with the request-time `now` and shown as-is; in a long session a late card's label is computed against a slightly stale `now`. Acceptable — labels are a "grade honestly" aid, not a commitment, and learning-step offsets are fixed minutes while review intervals are in days. Not worth a per-card refetch.

## Implementation Approach

Five phases, bottom-up: (1) a `src/lib/reviews` service that owns the queue query, the schema-validated read, the grade application, and the guarded write, plus a Polish interval formatter — and the Supabase-stub extension its own tests need; (2) the `/api/reviews` route that validates the grade at the boundary and maps typed service errors to the status ladder; (3) the `review.astro` page and `ReviewSession` island — a status machine driving the question→answer→grade loop with keyboard control, focus management, and live-region announcements; (4) shell wiring — navigation (with its tripwire test), middleware, and the contract registry; (5) guardrail verification — an automated both-sources test plus a manual checklist run against the deployed Worker, captured in an evidence file.

## Critical Implementation Details

**Read-modify-write ordering (Phase 1).** `applyReviewGrade` must: `select` the row (nine schedule columns + `reps`) filtered by `id` and `user_id`; `safeParse` it; compute the next row with `applyGrade`; then `update` filtered by `id`, `user_id`, **and `.eq("reps", previousReps)`**, selecting the id back via `.maybeSingle()`. A null result *after* a successful pre-read means `reps` moved under us — throw `grade_conflict` (→ 409), which the island treats as "already graded, advance" rather than an error. Do not set `updated_at` from code (DB trigger owns it).

**Grade validation lives only at the API boundary (Phase 2).** The service receives an already-narrowed `Grade`. If a raw number reaches `applyGrade` it throws uncatchably in ts-fsrs.

**Keyboard listener is the first `useEffect` + `document` listener in the codebase (Phase 3).** Attach `keydown` on `document` in a `useEffect` **keyed on `status` + current card id** — the effect re-subscribes on every transition, so the handler always closes over fresh `status`/`queue`; each run removes its own listener in the cleanup. Do **not** attach once with `[]` deps and read state inside — that captures the mount-time card and `react-compiler`/`react-hooks/exhaustive-deps` (both `error` in `eslint.config.js`) would flag it. Gate handlers by current status (`Space`/`Enter` only in `question`, `1`–`4` only in `answer`, nothing during `grading`). Focus moves to the primary action control on every card/phase transition via a `useRef` + effect keyed on the same card id + phase. A visually-hidden `role="status"` region announces card position and phase changes.

## Phase 1: Session service + SRS read layer

### Overview

A new `src/lib/reviews/` module owning every interaction with schedule state: the queue query, the schema-validated hydration, `preview()` for interval labels, `applyGrade`, and the guarded write. No HTTP concerns here.

### Changes Required:

#### 1. Review service

**File**: `src/lib/reviews/service.ts`

**Intent**: Provide `getReviewQueue` and `applyReviewGrade` as the only code paths that read or write flashcard schedule state for a session. Mirror the `flashcards/service.ts` conventions: destructured single input object with `supabase` as a field, typed thrown error class with a string-union `code`, never a raw Supabase error, never a result object.

**Contract**:
- `ReviewServiceError` with `code: "schedule_state_invalid" | "flashcard_not_found" | "grade_conflict" | "persist_failed"` and a Polish `message` per code, following [service.ts:6-22](src/lib/flashcards/service.ts#L6-L22).
- `getReviewQueue({ supabase, userId, now })` → `Promise<ReviewCard[]>` where `ReviewCard = { id: string; front: string; back: string; intervals: Record<1|2|3|4, string> }`. Query per the idiom in Key Discoveries with an explicit column list including the nine schedule columns; `safeParse` each row with `scheduleStateRowSchema`; on failure throw `schedule_state_invalid` after a single `console.error` carrying only the flashcard id (needs an `eslint-disable-next-line no-console` comment with a reason, matching [service.ts:109](src/lib/flashcards/service.ts#L109)); build `intervals` from `createScheduler().preview(row, now)` passed through the formatter.
- `applyReviewGrade({ supabase, userId, flashcardId, grade, now })` → `Promise<{ id: string }>`. Read → `safeParse` (→ `schedule_state_invalid`) → null pre-read (→ `flashcard_not_found`) → `applyGrade` → guarded `update` (→ null means `grade_conflict`; Supabase error means `persist_failed`).
- `REVIEW_BATCH_SIZE` module constant (start at `50`, mirroring `PAGE_SIZE`).
- Import `Rating`/`State` and `Grade` directly from `ts-fsrs` where needed (the SRS module does not re-export them), as the SRS tests do.

#### 2. Interval formatter

**File**: `src/lib/reviews/interval.ts`

**Intent**: Turn a `preview()` result's `due` timestamp into a short human-readable Polish label for a grade button ("za 8 min", "jutro", "za 3 dni", "za 2 mies.").

**Contract**: `formatInterval(dueIso: string, now: Date): string`. Buckets: `< 60 min` → "za N min"; `< 24 h` → "za N godz."; `< 48 h` → "jutro"; `< 30 dni` → "za N dni"; else → "za N mies." (round to nearest). Pure function, no locale library.

#### 3. ESLint server-path registration

**File**: `eslint.config.js`

**Intent**: Bring `src/lib/reviews/**` under the same `no-console: "error"` block that already covers the other server paths, so a stray console call fails lint.

**Contract**: Add the glob to the existing server-paths array around [eslint.config.js:71-82](eslint.config.js#L71-L82). No other rule changes.

#### 4. Extend the Supabase stub

**File**: `src/lib/test-support/supabase-stub.ts`

**Intent**: Add the query-builder methods the queue query needs so the service (and, in Phase 2, the route) become testable. Same work S-03 did for `delete()`. This lands in Phase 1 because Phase 1's own tests are the first consumer — deferring it would make Phase 1's automated gate unreachable in isolation.

**Contract**: Add `lte(column, value)` (push to `filters`, like `gte`), `order(column, options)` (record ordering, return `this`), `limit(n)` and `range(from, to)` (record, return `this`). `range`/`order` must also be awaitable via the existing `then` terminator so a `select…order…range` chain resolves. Keep the recorded shape backward-compatible — existing tests (`flashcards`, `generations`, `[id]`) must stay green.

#### 5. Service unit tests

**File**: `src/lib/reviews/service.test.ts`, `src/lib/reviews/interval.test.ts`

**Intent**: Cover the queue query shape, the schema-invalid path, the happy grade path, the conflict path, and the not-found path; cover every formatter bucket boundary.

**Contract**: `environment: "node"`, explicit `describe`/`it`/`expect` imports (no globals). Use `SupabaseStub` (extended in item 4 above) with v4-shaped UUID constants. Assert `supabase.queries[n].filters` includes `["reps", <previous value>]` on the update. Deterministic `now` passed explicitly — no `vi.useFakeTimers()`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- Reading `service.ts` confirms no `as ScheduleStateRow` cast and no path that sends schedule columns back to a caller.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: `/api/reviews` endpoint (GET + POST)

### Overview

The HTTP surface: GET returns the due-card queue, POST records a grade. Multi-method route following the `flashcards/[id].ts` structure. Grade validation at the boundary.

### Changes Required:

#### 1. Route handler

**File**: `src/pages/api/reviews.ts`

**Intent**: Expose `getReviewQueue` and `applyReviewGrade` over HTTP with the codebase's standard gate sequence and error envelope. Construct `now` as `new Date()` in the handler — never from the request body.

**Contract**:
- Frozen `MESSAGES` object (Polish, constant — never interpolate `error.issues`), covering: unauthorized, unavailable, invalidBody, notFound, conflict, unexpected.
- Module-level Zod: `gradeSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])`; `postBodySchema = z.object({ flashcardId: z.uuid(), grade: gradeSchema }).strict()`.
- Local `json()` / `error()` helpers copied verbatim from [flashcards.ts:33-42](src/pages/api/flashcards.ts#L33-L42).
- `getRequestContext(locals)` returning `{ userId, supabase } | Response` per [\[id\].ts:33-51](src/pages/api/flashcards/[id].ts#L33-L51) (no id param for GET; POST parses `flashcardId` from the body).
- `GET`: context gate → `json({ cards: await getReviewQueue({ supabase, userId, now }) }, 200)`. The service returns `ReviewCard[]`; the **route** wraps it in `{ cards }` — the response body is `{ cards: ReviewCard[] }`, never a bare array. Service throw → 500 `unexpected`; `schedule_state_invalid` also → 500.
- `POST`: context gate → body parse in `try/catch` (parse failure → same message as validation failure, 400) → `safeParse` → 400 on failure → `json(await applyReviewGrade({ ... }), 200)`. Error dispatch: `flashcard_not_found` → 404, `grade_conflict` → 409, else → 500.
- No `export const prerender`.

#### 2. Route tests

**File**: `src/pages/api/reviews.test.ts`

**Intent**: Cover both methods across the full status ladder using the established route-test pattern.

**Contract**: Local `context()` factory casting `as never` ([flashcards.test.ts:12-27](src/pages/api/flashcards.test.ts#L12-L27)); real `Request`/`Response`; `SupabaseStub` sequences (stub already carries `lte`/`order`/`limit`/`range` from Phase 1). Cases: GET 401/503/200-with-cards/500-on-invalid-state; POST 401/503/400-bad-body/400-bad-grade(`0`,`5`)/404/409/200. Assert the 409 path returns `{ error: MESSAGES.conflict }` and the update carried the `reps` filter.

### Success Criteria:

#### Automated Verification:

- Route + service tests pass: `npm test`
- Type checking passes: `npm run astro check`
- Linting passes: `npm run lint`
- Existing `flashcards`/`generations` route tests still green (Phase 1 stub change is additive)

#### Manual Verification:

- `curl` GET `/api/reviews` while logged out returns 401 with the Polish message.
- `curl` POST with `grade: 5` returns 400, not 500.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Review island + `review.astro`

### Overview

The user-facing loop: an empty `client:load` island (the `generate.astro` shape, since the island owns the whole session and must re-fetch) plus a status machine driving question → answer → grade → next, with keyboard control, focus management, and live-region announcements.

### Changes Required:

#### 1. Page shell

**File**: `src/pages/review.astro`

**Intent**: Mount the island inside `AppLayout` with a Polish title. No frontmatter data fetch — the island calls `GET /api/reviews`.

**Contract**: Mirror [generate.astro](src/pages/generate.astro) exactly — `AppLayout title="Sesja powtórkowa"` wrapping `<ReviewSession client:load />`.

#### 2. Review island

**File**: `src/components/review/ReviewSession.tsx`

**Intent**: Own the session state machine and all interaction. Fetch the queue on mount, present cards one at a time, record grades, re-fetch when the in-memory queue empties, finish when a re-fetch returns no cards. Pessimistic updates only — never advance before the server confirms the grade (except a 409, which advances by dropping the card).

**Contract**:
- Status union: `"loading" | "question" | "answer" | "grading" | "finished" | "empty" | "error"`.
- State: `queue: ReviewCard[]`, `reviewedCount: number`, `sessionTotal: number` (running denominator for "karta N z M" — the count of cards seen this session plus remaining queue), `error: string | null`.
- Local `readJson` / `readError` copied verbatim from [GenerateView.tsx:37-53](src/components/generate/GenerateView.tsx#L37-L53); a hand-written `parseQueue` type-guard for `{ cards: [...] }` (no Zod — server-only).
- Raw `fetch` inline, no API client. Grade POST body: `{ flashcardId, grade }`. On `!response.ok`: 409 → drop current card, advance, no error surfaced; other → status `error` with `readError`.
- Keyboard: a `useEffect` attaching `keydown` on `document`, **keyed on `status` + `currentCard.id`** so it re-subscribes each transition and never closes over a stale card; cleanup removes the listener on every re-run and on unmount. `Space`/`Enter` → reveal (only in `question`); `1`–`4` → grade (only in `answer`); ignored in `grading`. Do not intercept when a modifier key is held. Do not use `[]` deps with state read inside the handler — `react-compiler` and `exhaustive-deps` are both `error`.
- Focus: `useRef` on the primary control; `useEffect` keyed on `currentCard.id + status` calls `.focus()`.
- Live region: visually-hidden `role="status" aria-live="polite"` announcing "Karta {n} z {m}" on each new card and "Odpowiedź odsłonięta" on reveal.
- Progress: plain `<span>` "Karta {n} z {m}" (no `progress` primitive — matches the `GenerateView` counter [:247-249](src/components/generate/GenerateView.tsx#L247-L249)).
- Grade buttons: four `Button`s with real Polish accessible names including the interval ("Znowu · za 1 min", "Trudno · …", "Dobrze · …", "Łatwo · …") so tests can query by role + name. Disabled during `grading`, showing `<Loader2 className="animate-spin" />` on the pressed one.
- `empty` state: bordered box, "Nie masz dziś nic do powtórki.", `Button asChild` link to `/deck` — per [FlashcardCollection.tsx:281-288](src/components/deck/FlashcardCollection.tsx#L281-L288).
- `finished` state: same box style, "To na dziś wszystko — powtórzono {n} fiszek.", link to `/deck`.
- `error` state: `Alert variant="destructive"` + "Spróbuj ponownie" button re-running the last action — per [GenerateView.tsx:223-241](src/components/generate/GenerateView.tsx#L223-L241).
- No import from `@/lib/srs` or any server module. `ReviewCard` is a local interface (like `Flashcard` in `FlashcardCollection.tsx`), not imported from the service.

#### 3. Island tests

**File**: `src/components/review/ReviewSession.test.tsx`

**Intent**: Cover the multi-request session flow, keyboard control, the empty and finished states, and the 409 advance.

**Contract**: `// @vitest-environment jsdom` docblock; Testing Library + `user-event`; `vi.stubGlobal("fetch", …)` with `mockResolvedValueOnce` **chaining** (queue fetch → grade POST → re-fetch empty). No `@testing-library/jest-dom` — assert with `.toBeTruthy()`, `.disabled`, `.textContent`. Query grade buttons by role + Polish accessible name. One test drives the whole loop by keyboard (`{Space}` then `{3}`).

### Success Criteria:

#### Automated Verification:

- Island tests pass: `npm test`
- Type checking passes: `npm run astro check`
- Linting passes: `npm run lint` (including `jsx-a11y`)
- Build succeeds: `npm run build`

#### Manual Verification:

- Full session in the browser: question shows, Space reveals, `1`–`4` grades, next card appears, progress increments.
- Grading the last card shows the "to na dziś wszystko" screen (re-fetch returned empty).
- With no due cards, `/review` shows the empty state.
- Keyboard-only run start to finish; screen reader announces card position and reveal (VoiceOver or NVDA).
- Double-clicking a grade button does not double-count (button disables; a second submit that races gets a 409 and is absorbed).

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Shell wiring + contract registry

### Overview

Make `/review` reachable and mark its names binding. Four mechanical steps that S-07 explicitly handed to S-05.

### Changes Required:

#### 1. Navigation entry + tripwire test

**File**: `src/lib/navigation.ts`, `src/lib/navigation.test.ts`

**Intent**: Add the review section to the nav array and update its whole-array assertion in the same change (the `toEqual` is a deliberate tripwire).

**Contract**: Append `{ id: "review", label: "Powtórki", href: "/review" }` to `navigationItems` ([navigation.ts:1-5](src/lib/navigation.ts#L1-L5)). Update the `toEqual` literal in [navigation.test.ts:6-11](src/lib/navigation.test.ts#L6-L11) to match.

#### 2. Route protection

**File**: `src/middleware.ts`

**Intent**: Guard `/review` behind auth like the other app routes.

**Contract**: Add `"/review"` to `PROTECTED_ROUTES` ([middleware.ts:4](src/middleware.ts#L4)).

#### 3. Contract registry

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Flip the two reserved rows from `proponowane` to `istnieje` now that the route and endpoint exist.

**Contract**: `/review` row in `## Trasy` and the `/api/reviews` row in `## Endpointy API` → `Stan: istnieje`. If any name was changed during implementation, reconcile it here in the same change (it was not — names kept as reserved).

### Success Criteria:

#### Automated Verification:

- Navigation test passes with the new entry: `npm test`
- Full suite green: `npm test`
- Type checking passes: `npm run astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- "Powtórki" appears in the nav on every screen and is marked current on `/review`.
- Visiting `/review` logged out redirects to `/auth/signin`.
- `contract-surfaces.md` matches `PROTECTED_ROUTES` (registry rule 4).

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Guardrail verification

### Overview

The PRD guardrail is a behavioural claim ("must work regardless of card source"), and F-01's inherited question ("does ts-fsrs behave the same on the deployed instance?") closes only on the first S-05 deploy. This phase produces the evidence.

### Changes Required:

#### 1. Both-sources automated test

**File**: `src/lib/reviews/service.test.ts` (addition) or `src/pages/api/reviews.test.ts`

**Intent**: Prove a manually-created card and an AI card are graded through the identical path — the named debt F-01 delegated here.

**Contract**: Two cases feeding `applyReviewGrade` a stubbed row that would have `source: "manual"` and one `source: "ai"`; assert identical update payload shape and no branch on `source` (the service never selects or reads `source`). This is a regression guard, not a behavioural difference — document that in a comment.

#### 2. `preview()` / `applyGrade()` parity test

**File**: `src/lib/reviews/service.test.ts` (addition) or `src/lib/srs/scheduler.test.ts`

**Intent**: The GET response labels a grade button with `preview(row, now)[grade].due`, but the actual write uses `applyGrade(row, now, grade)`. These call `scheduler.repeat()` and `scheduler.next()` respectively — assert they land on the same schedule state so a button's label never lies about what grading it does.

**Contract**: For a fixed `(row, now)` and each `grade` in `1..4`, assert `preview(row, now)[grade]` deep-equals `applyGrade(row, now, grade)` (ignoring fields the service does not persist). One card in learning state, one in review state. Pure, deterministic — explicit `now`, no fake timers.

#### 3. Manual verification evidence file

**File**: `context/changes/srs-review-session/manual-verification.md`

**Intent**: Capture the manual guardrail run with evidence, not just checked boxes (the S-03/S-04 lesson — F2 OBSERVATION in `2026-09-01-manual-card-edit-delete`).

**Contract**: A checklist with a result line per item: (a) create a manual card, review and grade it, confirm `due`/`state` moved in the DB; (b) same for an AI-accepted card; (c) deploy to the Worker (`git push` to `master` → Cloudflare auto-deploy) and run one full session on `https://10x-cards.sebger82.workers.dev` — confirm a grade persists and the interval labels are sane (closes the F-01 parity question); (d) note the deployed commit SHA and date.

### Success Criteria:

#### Automated Verification:

- Both-sources test passes: `npm test`
- `preview()` / `applyGrade()` parity test passes: `npm test`
- Full suite green, lint clean, build succeeds

#### Manual Verification:

- `manual-verification.md` complete with a DB-state observation for both a manual and an AI card.
- One full review session run on the deployed instance; grade persisted; commit SHA recorded.
- ts-fsrs interval labels on the deployed instance match a local run for the same card state (F-01 parity question closed).

**Implementation Note**: This is the final phase. After manual confirmation, the change is ready for `/10x-impl-review` and `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- `reviews/service.ts`: queue query column list + filters (`user_id`, `lte due`, `order due`, `range`); `schedule_state_invalid` on a malformed row; happy grade path; `grade_conflict` when the `reps` guard matches zero rows; `flashcard_not_found` on null pre-read.
- `reviews/interval.ts`: each bucket boundary (59 min / 60 min, 23 h / 25 h, 47 h / 49 h, 29 d / 31 d).
- `preview()` / `applyGrade()` parity: for a fixed `(row, now)` and each grade `1..4`, the previewed state equals the applied state (learning-state card + review-state card).
- `supabase-stub.ts`: existing tests stay green; new `lte`/`order`/`range` recorded correctly.

### Integration Tests:

- `api/reviews.ts`: full status ladder for GET and POST, including `grade: 0` and `grade: 5` → 400, and the 409 conflict envelope.
- `ReviewSession.tsx`: mount → grade → re-fetch-empty → finished; empty-on-mount; keyboard-only loop; 409 absorbed silently.

### Manual Testing Steps:

1. Log in, open `/review` from the nav. Confirm a due card shows question-only.
2. Press Space — answer + four interval-labelled buttons appear. Press `3` — next card, progress increments.
3. Grade through to the end — "to na dziś wszystko" screen with deck link.
4. Open a second tab on the same card, grade in tab 1, then tab 2 — tab 2's grade is absorbed (409), no double-count.
5. With an empty queue, `/review` shows the empty state.
6. Keyboard + screen-reader pass: whole session without a mouse; card position and reveal announced.
7. Create one manual card and accept one AI card; review and grade both; check `due`/`state`/`reps` moved in the Supabase dashboard.
8. Deploy; repeat step 2 on `https://10x-cards.sebger82.workers.dev`; confirm persistence and sane intervals.

## Performance Considerations

Not a concern. F-01 measured ~1.25 µs per card on real `workerd`; a 50-card batch is ~0.06 ms against a 10 ms CPU budget. The queue query rides the existing `(user_id, due)` index. `preview()` adds four `next()` computations per card in the GET response — still sub-millisecond for a batch.

## Migration Notes

None. No schema change. Existing rows are already valid schedule state.

## References

- Internal research: `context/changes/srs-review-session/research.md`
- SRS contract: `context/archive/2026-08-23-srs-algorithm-contract/plan.md` (8 binding decisions), `.../research.md` (workerd perf, session-in-island-state requirement)
- RMW race precedent: `context/archive/2026-08-25-first-gated-generation/reviews/impl-review.md` (F1, F2)
- Navigation tripwire: `context/archive/2026-08-26-app-shell-navigation/plan.md`
- Manual-evidence lesson: `context/archive/2026-09-01-manual-card-edit-delete/` (F2)
- Endpoint pattern: `src/pages/api/flashcards/[id].ts`, `src/pages/api/flashcards.ts`
- Island pattern: `src/components/generate/GenerateView.tsx`
- Contract registry: `docs/reference/contract-surfaces.md` (rows `/review`, `/api/reviews`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Session service + SRS read layer

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — a8d0d5e
- [x] 1.2 Type checking passes: `npm run astro check` — a8d0d5e
- [x] 1.3 Linting passes: `npm run lint` — a8d0d5e

#### Manual

- [x] 1.4 `service.ts` reviewed: no `as ScheduleStateRow` cast, no schedule columns returned to callers — a8d0d5e

### Phase 2: `/api/reviews` endpoint (GET + POST)

#### Automated

- [x] 2.1 Route + service tests pass: `npm test` — be0257b
- [x] 2.2 Type checking passes: `npm run astro check` — be0257b
- [x] 2.3 Linting passes: `npm run lint` — be0257b
- [x] 2.4 Existing `flashcards`/`generations` route tests still green (Phase 1 stub change is additive) — be0257b

#### Manual

- [x] 2.5 GET `/api/reviews` logged out returns 401 with the Polish message — be0257b
- [x] 2.6 POST with `grade: 5` returns 400, not 500 — be0257b

### Phase 3: Review island + `review.astro`

#### Automated

- [x] 3.1 Island tests pass: `npm test` — f7e1731
- [x] 3.2 Type checking passes: `npm run astro check` — f7e1731
- [x] 3.3 Linting passes: `npm run lint` (including `jsx-a11y`) — f7e1731
- [x] 3.4 Build succeeds: `npm run build` — f7e1731

#### Manual

- [x] 3.5 Full browser session: reveal, grade, next card, progress increments — f7e1731
- [x] 3.6 Grading the last card shows the "to na dziś wszystko" screen — f7e1731
- [x] 3.7 No due cards → empty state shown — f7e1731
- [x] 3.8 Keyboard-only run start to finish; screen reader announces card position and reveal — f7e1731
- [x] 3.9 Double-click / racing grade does not double-count (button disables; race gets 409, absorbed) — f7e1731

### Phase 4: Shell wiring + contract registry

#### Automated

- [x] 4.1 Navigation test passes with the new entry: `npm test` — ff0937d
- [x] 4.2 Full suite green: `npm test` — ff0937d
- [x] 4.3 Type checking passes: `npm run astro check` — ff0937d
- [x] 4.4 Linting passes: `npm run lint` — ff0937d
- [x] 4.5 Build succeeds: `npm run build` — ff0937d

#### Manual

- [x] 4.6 "Powtórki" in the nav on every screen, marked current on `/review` — ff0937d
- [x] 4.7 `/review` logged out redirects to `/auth/signin` — ff0937d
- [x] 4.8 `contract-surfaces.md` matches `PROTECTED_ROUTES` — ff0937d

### Phase 5: Guardrail verification

#### Automated

- [x] 5.1 Both-sources test passes: `npm test` — 7eb0e97
- [x] 5.2 `preview()` / `applyGrade()` parity test passes: `npm test` — 7eb0e97
- [x] 5.3 Full suite green, lint clean, build succeeds — 7eb0e97

#### Manual

- [x] 5.4 `manual-verification.md` complete with DB-state observation for a manual and an AI card — a106813
- [x] 5.5 One full review session on the deployed instance; grade persisted; commit SHA recorded — 878977c
- [ ] 5.6 Deployed ts-fsrs interval labels match a local run for the same card state (F-01 parity question closed)
