# SRS Review Session (S-05) — Plan Brief

> Full plan: `context/changes/srs-review-session/plan.md`
> Research: `context/changes/srs-review-session/research.md`

## What & Why

Wire the finished FSRS contract from F-01 into a working review loop so a user can start a study session and grade cards, with the grade feeding the spaced-repetition schedule (FR-009). The PRD guardrail is the hard edge: the review mechanism must not fail regardless of card source — AI or manual.

## Starting Point

F-01 and F-02 did the preparatory work so thoroughly that the data layer is complete: every flashcard already carries valid schedule state (nine `not null` columns), the `(user_id, due)` queue index exists, and RLS/triggers are in place. The SRS module (`src/lib/srs`) is built and tested but called from nowhere except card creation. `preview()` — the function that yields per-grade outcomes — has never been invoked. `/review` and `/api/reviews` are reserved names, not code.

## Desired End State

A logged-in user opens `/review` from the persistent nav, sees cards due now one at a time (question, then answer + four grade buttons labelled with the resulting interval), grades with `1`–`4` or clicks, and the next card appears. Progress reads "Karta 3 z 12". When the queue empties it re-fetches; when that comes back empty the session ends. Nothing due at all → empty state with a deck link. AI and manual cards run the identical path. The whole loop works by keyboard and is announced to screen readers.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| No migration / backfill | Confirmed none needed | Every card already has valid schedule state; a card without it cannot exist | Research |
| Read-side type seam | `scheduleStateRowSchema.safeParse` every DB row, never `as ScheduleStateRow` | S-05 is the first reader of schedule state and the cast would compile but explode at runtime | Research |
| Grade validation | At the API boundary only (`z.literal(1..4)`) | `grade` of `0`/`5` throws uncatchably in ts-fsrs (`FSRSValidationError` not exported in 5.4.1) | Research |
| Queue source | `GET /api/reviews` (island fetches on mount + on refill) | One code path for load and refill; testable; keeps the session in island state as F-01 requires | Plan |
| Nothing due | Empty state only, no study-ahead | Matches PRD scope exactly; study-ahead is new logic with no PRD basis and works against FSRS | Plan |
| Session size / refill | `REVIEW_BATCH_SIZE = 50`; re-query on exhaustion; end when re-query is empty | FSRS-faithful — cards graded "Again" (due in 1 min) correctly reappear; natural termination | Plan |
| Grade button labels | Show intervals via `preview()` + a Polish formatter | `preview()` exists precisely for this; helps the user grade honestly | Plan |
| Double-grade defense | UI button-lock + server guard: `UPDATE … .eq("reps", previousReps)` → 409 | Cheap, no new column, catches double-click and two-tab; 409 absorbed by the island as "advance" | Plan |
| Keyboard / a11y scope | Core: keyboard (Space + 1–4) + focus management + `aria-live`; no animation | The floor for a review loop to be usable at all; card-flip animation deferred to S-08 | Plan |
| Helper reuse | Copy `readJson`/`readError`/`json`/`error` a third time | Matches the codebase's explicit copy-don't-abstract convention | Plan |

## Scope

**In scope:** `src/lib/reviews/` service (queue query, schema-validated read, guarded write) + interval formatter; `/api/reviews` GET+POST; `review.astro` + `ReviewSession` island (status machine, keyboard, focus, live region); Supabase-stub extension (`lte`/`order`/`limit`/`range`); nav + middleware + contract-registry wiring; both-sources guardrail test + deployed-instance verification.

**Out of scope:** any migration; `ReviewLog` / grade undo; daily new-card limits, interleaving, session-length settings, stats/streaks/history; study-ahead; card-flip animation and `prefers-reduced-motion`; per-user FSRS parameters; shared HTTP-helper module; E2E/Playwright/MSW; sending schedule state to the client.

## Architecture / Approach

`ReviewSession` island (client) ⟷ `GET/POST /api/reviews` (route) ⟶ `src/lib/reviews/service.ts` ⟶ `src/lib/srs` + Supabase. The island holds the whole session in local state and never imports server code; the POST body is `{ flashcardId, grade }` only — the server re-reads the row, applies the grade, and writes it back under a `reps`-conditional UPDATE. The service is the only place schedule state is read or written for a session, and every row it reads passes through the Zod schema first.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Session service + SRS read layer | `getReviewQueue` / `applyReviewGrade` + interval formatter + unit tests | Getting the schema-validated read and the `reps`-guarded write right |
| 2. `/api/reviews` endpoint | GET+POST route, grade validation at boundary, extended Supabase stub, route tests | Stub extension must not break existing route tests |
| 3. Review island + page | `ReviewSession.tsx` status machine, keyboard/focus/live-region, empty/finished/error states | First `useEffect` + `document` listener in the codebase; genuinely new UI territory |
| 4. Shell wiring + contract registry | nav (+ tripwire test), middleware, registry rows flipped to `istnieje` | `navigation.test.ts` `toEqual` breaks until updated in the same commit |
| 5. Guardrail verification | Both-sources automated test + `manual-verification.md` incl. deployed run | Closes F-01's inherited "ts-fsrs parity on deployed instance" question |

**Prerequisites:** F-02 and S-02 (both done). Working deployed instance (exists). No new access or infra.
**Estimated effort:** ~3–4 sessions across 5 phases; Phase 3 is the largest.

## Open Risks & Assumptions

- Phase 3 UI has no precedent in the codebase (keyboard, focus, live regions) — the research names it the top candidate to trim if the 2026-09-07 deadline tightens; the plan already cuts animation.
- The `reps`-guarded UPDATE assumes ts-fsrs increments `reps` on every `next()` call (it does) — if that changed in a future bump the guard would silently weaken.
- Deployed ts-fsrs behaviour is assumed to match local; Phase 5 verifies this rather than assuming it.
- Session "total" for the progress counter is a running denominator (seen + remaining), so it grows when a re-fetch adds cards — acceptable, but not a fixed "N of M".

## Success Criteria (Summary)

- A user completes a full review session by keyboard and by mouse; grades persist and move `due`/`state`/`reps` in the database.
- A manually-created card and an AI-accepted card are graded through the identical path (guardrail).
- One full session runs on the deployed Worker with sane interval labels and persisted grades (F-01 parity question closed).
