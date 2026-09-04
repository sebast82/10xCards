# Test Rollout Phase 3 — Schedule & Counter Integrity Implementation Plan

## Overview

Rollout Phase 3 of `context/foundation/test-plan.md` ("Integralność harmonogramu i liczników")
closes the coverage gaps for two risks:

- **Risk #3** — a review session loses or corrupts schedule state: a grade doesn't persist, or
  sets a nonsensical due date, and the user silently loses study progress.
- **Risk #6** — generation acceptance counters drift from collection state after a flashcard is
  edited or deleted: the "75%" success criterion reports a number that can't be reconstructed from
  data.

This is a **test-only change**. No production code changes. The oracle for every new assertion
comes from sources (PRD, F-01/S-05 decisions, the pinned `ts-fsrs@5.4.1` contract, the `recount`
migration rationale) — never from re-reading the implementation and copying its output.

## Current State Analysis

**Risk #3 — schedule state** (`src/lib/reviews/service.ts`):

- `applyReviewGrade` reads the row → `scheduleStateRowSchema.safeParse` → `createScheduler().applyGrade`
  → a `reps`-guarded `UPDATE` of 9 schedule fields → `grade_conflict` on 0 rows.
- `getReviewQueue` selects `.eq("user_id").lte("due", now).order("due").range(0, 49)` against the
  `flashcards_user_id_due_idx` index; isolation is RLS.
- **The load-bearing gap**: the write payload carries 9 fields but `reviews/service.test.ts:95-96`
  asserts only `toMatchObject({ reps: prev+1 })` and `not.toHaveProperty("updated_at")`. The named
  failure in the risk map — *"ocena nie zapisuje się"* — passes every current test.
- `SupabaseStub` pushes `.eq` / `.gte` / `.lte` into one undistinguished `filters` array and applies
  no filtering (`src/lib/test-support/supabase-stub.ts:53-66`). Changing `.lte("due")` → `.gte` /
  `.eq` in the service keeps every test green. There is **no pgTAP for the review queue** at all
  (`supabase/tests/` has `recount_generation_acceptance`, `rls_flashcards`, `rls_generations`,
  `generations_error_contract` — no reviews file).
- All `applyReviewGrade` fixtures use `REVIEW_ROW` (`state:2`, `reps:2`). No Learning (`state:1`),
  Relearning (`state:3`), or brand-new (`reps:0`) fixture through the service.
- `postBodySchema` is `.strict()` (`src/pages/api/reviews.ts:20`) but no test sends an extra field
  to prove a client cannot smuggle a `now`.

**Risk #6 — generation counters** (`src/lib/flashcards/service.ts`):

- Counters are **recomputed from `flashcards`, not incremented**:
  `recount_generation_acceptance` (`security invoker`, `for update` lock, `least()` clamp — live
  version `supabase/migrations/20260826141500_clamp_generation_acceptance.sql`).
- `createAiFlashcard` and `deleteFlashcard` call `recount` best-effort (`.error` logged as a
  Postgres code, never rethrown). `updateFlashcard` writes only `{ front, back }` and **does not**
  call `recount` — correct by design (`source` is immutable, counters key off `source`).
- **Gap (edit half)**: `flashcards/service.test.ts` asserts the update payload key-set is
  `["front","back"]` but never asserts `supabase.rpcCalls` is `[]`. `api/flashcards/[id].test.ts`
  PATCH cases don't check `rpcCalls` either. The "reconstructable after edit" claim rests on an
  unlocked argument.
- **Gap (clamp)**: `recount_generation_acceptance.test.sql` `plan(9)` tests only the **equality**
  boundary (`generated_count=2`, one `ai` + one `ai_edited`). Reverting to the pre-clamp body keeps
  every test green — the entire reason the third migration exists has no regression test.
- **Gap (delete edges)**: delete of the **last** AI card in a generation (→ `(0,0)`) is untested;
  `recount` on an already-deleted `p_generation_id` (parent generation removed, `generation_id`
  nulled by `on delete set null`) is untested.

**Infrastructure** (carried from Phases 1–2, `test-plan.md` §6):

- `npm test` = `vitest run` (node env, `SupabaseStub`, no `setupFiles`, no `test:integration`).
  There is **no Vitest harness against real Postgres**.
- The only real-Postgres layer is **pgTAP** — `npm run db:test` (→ `supabase test db` against
  `supabase start`). CI job `db-tests` is `pull_request`-only and is in `master`'s **required
  status checks**.
- `SupabaseStub` models no filters, RLS, `SECURITY INVOKER`, triggers, CHECK constraints, or
  transactions. It is a call recorder.
- Route handlers are imported as plain functions; the `context()` helper is **copied per file**.
- SRS fixtures are **derived from the real module**, never hand-authored.
- pgTAP skeleton: `begin; select plan(N); … select * from finish(); rollback;` with `plan(N)`
  written **last**. Role switch = `set local role authenticated;` then `set local request.jwt.claims`.
  Seed `auth.users` as superuser first. No `seed.sql`.
- **O2-13**: a cross-account *write* assertion must run with the SELECT policy neutralised
  (`alter policy … using (true)`, undone by `rollback`), paired with a byte-unchanged check and a
  positive "owner writes own row" assertion. (Does not apply to a SELECT-only queue-visibility test,
  where the SELECT policy *is* the subject.)
- Stryker is selective + ad hoc — no devDependency, ephemeral gitignored config,
  `npx --yes -p @stryker-mutator/core -p @stryker-mutator/vitest-runner stryker run`, Windows needs
  the three workarounds in `test-plan.md` §6.7 Faza 1.

## Desired End State

- `applyReviewGrade`'s write payload is pinned field-by-field against the wrapper's own `applyGrade`
  output — a row→card→row plumbing bug, a dropped field, or "the grade doesn't persist" all go red.
- A real-Postgres `supabase/tests/review_queue.test.sql` proves `due <= now()` selection, `due`
  ordering, the 50-row cap, cross-account queue isolation, and the `reps`-guarded optimistic-lock
  semantics against a real row + index + RLS.
- Learning / Relearning / brand-new (`reps:0`) cards traverse the grade path under test.
- The reviews POST body `.strict()` is proven to reject a smuggled clock field.
- `updateFlashcard` / PATCH is asserted to make **zero** `recount` calls — the "reconstructable
  after edit" half of Risk #6 is locked.
- `recount_generation_acceptance.test.sql` covers the `least()` clamp (more AI cards than
  `generated_count`), delete-of-last-card (→ `(0,0)`), and `recount` on a deleted generation.
- `test-plan.md` §3 row 3 is `complete`; §6.5 cookbook is filled; §7 has the three new
  deliberately-not-tested entries; the change folder carries a deferred-item register.

### Key Discoveries

- `applyReviewGrade` write payload — `src/lib/reviews/service.ts:132-149` — 9 fields, `reps`-guarded,
  `updated_at` left to the DB trigger.
- `getReviewQueue` — `src/lib/reviews/service.ts:62-96` — `.eq("user_id").lte("due", now.toISOString()).order("due",{ascending:true}).range(0, 49)`.
- `flashcards_user_id_due_idx on public.flashcards (user_id, due)` — `20260824202259_flashcards_schema.sql:69`.
- `SupabaseStub.filters` conflates `eq`/`gte`/`lte` — `src/lib/test-support/supabase-stub.ts:53-66`.
- Live `recount` with `least()` clamp + `for update` — `20260826141500_clamp_generation_acceptance.sql`.
- `updateFlashcard` has no `.rpc` — `src/lib/flashcards/service.ts:147-171`.
- `source` immutability trigger already covered — `supabase/tests/rls_flashcards.test.sql:152`
  (`'%flashcard source is immutable%'`).
- Cross-account SRS-column tamper block (O2-13 worked example) — `rls_flashcards.test.sql:191-224`.
- `scheduleStateRowSchema` — `src/lib/srs/schedule-state.ts:7-17` — `difficulty` domain is
  `min(0).max(10)`; `state` is `0|1|2|3`.
- `lessons.md` "Metryka deklarowana przez klienta nie jest metryką" — scopes Risk #6's oracle to
  `flashcards.source`, itself a client assertion frozen at save.

## What We're NOT Doing

- **Not testing the interior of `ts-fsrs`.** The numeric output of `applyGrade` is treated as given
  (`test-plan.md` §7: "wnętrze biblioteki powtórek"). Phase 3 pins *our* contract — the row↔card
  mapping, the persist, the `reps` guard, the queue.
- **Not adding a Vitest integration layer against real Postgres.** No harness exists. The real-DB
  half of Risk #3 is pgTAP.
- **Not asserting an absolute numeric bound on `due`.** No source states one (the only DB constraint
  is `not null`; an "Again" grade legitimately yields `due ≈ now + 1 min`). The payload-equals-`applyGrade`
  comparison sidesteps needing a bound. This also moots the `difficulty` 0-vs-1 lower-bound
  ambiguity — the existing schema domain test (`schedule-state.test.ts`) already pins rejection.
- **Not adding a server-side evidence assertion for the `edited` flag.** Explicitly out of scope
  (`lessons.md` rule; the user chose not to expand). "Reconstructable from data" = "reconstructable
  from `flashcards.source`".
- **Not adding a service/route test that an edit cannot change `source` / `generation_id`, and not
  testing whether an edit should promote `ai` → `ai_edited`.** `source` is frozen at first save —
  the marker measures the moment of acceptance, not later curation (PRD L120, F-01 Phase 3), so a
  later typo fix legitimately stays `accepted_unedited`. Coverage already exists: the DB trigger
  (`rls_flashcards.test.sql:152`, `'%flashcard source is immutable%'`) plus the `updateFlashcard`
  key-set assertion (`["front","back"]`). Phase 2 adds only the `rpcCalls == []` guard on top.
  (research Open Question 9 / gap B.5.2.)
- **Not testing undo / "reconstruct schedule from history".** Structurally impossible — no
  `review_logs` table, `scheduler.next()` drops `.log` (F-01 decision).
- **Not changing the review queue to exclude just-graded cards.** Whether an "Again" card should
  re-enter the same session is a product question no source resolves; Phase 3 only proves that a
  legitimate second grade produces a consistent, re-parseable row.
- **Not testing `recount` concurrency (the `for update` lock).** Single-session pgTAP cannot
  reproduce the race; a `pg_get_functiondef` string-match is brittle and low-signal. → §7 entry.
- **Not defining the aggregate "75%" query population.** No such query exists in code yet. → §7 note.
- **Not authoring or modifying CI pipeline YAML.** `db-tests` already runs `supabase/tests/*.test.sql`;
  the new file is picked up automatically.

## Implementation Approach

Two phases, ordered by risk. Each phase mixes a Vitest layer (write-payload contracts, side-effect
presence — cheap, fast, runs on every commit) and a pgTAP layer (real `due <= now()`, RLS,
constraints, the `least()` clamp — the load-bearing signal, PR-only).

Phase 1 is Risk #3 end to end. Phase 2 is Risk #6 plus the rollout close-out (cookbook §6.5, §7
entries, `test-plan.md` §3 status, deferred register) — the close-out lands with the last risk so
§6.5 reflects what both phases actually did.

## Critical Implementation Details

**Oracle-safe form for the Risk #3 primary assertion.** `reviews/service.test.ts` already seeds
`REVIEW_ROW` via `scheduler.applyGrade(...)`. Using that *same call inline* to compute the expected
value in the new assertion is a mirror test (`test-plan.md` §1, §7). The oracle-safe form: inside the
test, call `createScheduler().applyGrade(parsedRow, NOW, grade)` **once** into a single `expected`
object, then assert the service's captured write payload deep-equals the 9-key projection of
`expected`. This pins "we persist exactly what we computed and the row→card→row plumbing is lossless"
while leaving the library arithmetic itself untested — which is the intended boundary.

**pgTAP cannot call `applyReviewGrade`** (it's TypeScript). `review_queue.test.sql` exercises the SQL
the service emits — the `select … where user_id = ? and due <= now() order by due limit 50` shape and
the `update … where id = ? and user_id = ? and reps = ?` guarded-write idiom — against a real row,
the real `(user_id, due)` index, and real RLS. A comment anchors the guarded-`UPDATE` block to
`src/lib/reviews/service.ts` so drift is visible in review.

**`plan(N)` is written last** in both the new and the extended pgTAP file — count the assertions
after they're all written; a mismatch fails `pg_prove` loudly.

## Phase 1: Risk #3 — Schedule-State Integrity

### Overview

Pin the write payload against the wrapper's own output; add the missing state fixtures and the
`.strict()` body guard at the Vitest layer; add the first-ever review-queue pgTAP for the real
`due <= now()` selection, ordering, batch cap, isolation, and `reps`-guard semantics.

### Changes Required

#### 1. Schedule-state write-payload contract

**File**: `src/lib/reviews/service.test.ts`

**Intent**: Prove `applyReviewGrade` persists **every** schedule field it computed, not just `reps`.
Add tests inside `describe("applyReviewGrade")`.

**Contract**: The `.update({...})` payload in `applyReviewGrade` (`service.ts:134-144`) — keys
`due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, state, last_review`,
and **no** `updated_at`.

- New test "persists every schedule field the scheduler computed": seed the pre-read with a parsed
  row, capture `supabase.queries[1].payload`, build `expected = createScheduler().applyGrade(row, NOW, Rating.Good)`
  once, assert the payload deep-equals `{ due: expected.due, stability: expected.stability, … , last_review: expected.last_review }` (all 9 keys) and `Object.keys(payload)` has exactly those 9 entries.
- New test "sets last_review to the review instant": assert `payload.last_review === NOW.toISOString()`
  (grounded in the scheduler contract that `now` is the review time — an independent invariant, not
  a re-read of `applyGrade`).
- New tests "advances a Learning-state card" / "advances a Relearning-state card": fixtures derived
  from the real module — Learning: `scheduler.applyGrade(scheduler.createNewCard(SEED_NOW), SEED_NOW, Rating.Again)`
  (lands `state:1`); Relearning: apply `Again` to a Review-state card (lands `state:3`). Assert the
  same payload-equals-`applyGrade` property. Catches a row→card mapping that only survives `state:2`.
- New test "guards a brand-new card on reps 0": fixture `scheduler.createNewCard(SEED_NOW)`
  (`reps:0`); assert `supabase.queries[1].filters` contains `["reps", 0]` and `payload.reps === 1`.

#### 2. POST body `.strict()` guard

**File**: `src/pages/api/reviews.test.ts`

**Intent**: Prove a client cannot smuggle a `now` / `date` field past the body schema — the server
owns the clock.

**Contract**: `postBodySchema = z.object({ flashcardId, grade }).strict()` (`reviews.ts:20`).

- New test in `describe("reviews POST")`: body `{ flashcardId: FLASHCARD_ID, grade: 3, now: "2020-01-01T00:00:00.000Z" }`
  → `status` 400 with `{ error: "Nieprawidłowe dane oceny." }`; `Object.keys(body)` is `["error"]`;
  `supabase.queries` and `supabase.rpcCalls` are empty (rejected before the service).

#### 3. Review-queue pgTAP

**File**: `supabase/tests/review_queue.test.sql` (new)

**Intent**: The first real-Postgres test of the review queue. Cover what `SupabaseStub` structurally
cannot: `WHERE due <= now()` selection, `ORDER BY due`, the 50-row cap, cross-account queue
isolation, and the `reps`-guarded optimistic-lock semantics.

**Contract**: `select id, … from public.flashcards where user_id = <A> and due <= now() order by due asc limit 50`
and `update public.flashcards set <9 fields> where id = ? and user_id = ? and reps = ?` — mirrored
by comment to `src/lib/reviews/service.ts:62-96` and `:132-149`.

- Skeleton: `begin; … select plan(N); … select * from finish(); rollback;` (`plan(N)` last).
- Seed: 2 users in `auth.users` (superuser, `on conflict do nothing`). For user A: 51 flashcards
  with `due` in the past at distinct timestamps + at least 1 with `due` in the future. For user B:
  1 flashcard with `due` in the past. All schedule columns within CHECK domains.
- As `authenticated` A (`set local role` + `request.jwt.claims`):
  - queue query returns exactly 50 rows (cap), all with `due <= now()`, none in the future
    (`results_eq` on count; `ok` that `max(due) <= now()`).
  - rows come back in ascending `due` order (`is` on `array_agg(due order by …)` vs the raw select).
  - the 51st past-due row (latest `due`) is absent from the 50-row page.
  - user B's past-due card is **not** in A's queue (`results_eq` count of B's id in A's result = 0);
    positive control: A's own earliest card **is** in the result.
- `reps`-guard sequence, as A: pick one due card at `reps = r`; run the guarded `update … where id = <c> and user_id = <A> and reps = r` → `is` affected-rows `1`; re-`select` the row and assert it parses as a valid schedule row with `reps = r + 1`; a second `update … reps = r` (stale) → affected-rows `0`; an `update … reps = r + 1` → affected-rows `1`. Proves the guard blocks the stale write and a legitimate second grade succeeds without contradictory state.
- Run: `npm run db:test` against `supabase start`.

### Success Criteria

#### Automated Verification

- Unit + integration pass: `npm test`
- pgTAP passes locally: `npm run db:test` (with `supabase start` running)
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- `supabase/tests/review_queue.test.sql` exists and its `plan(N)` matches its assertion count

#### Manual Verification

- Ad-hoc Stryker on `src/lib/reviews/service.ts` (narrowed `include`, Windows workarounds per
  `test-plan.md` §6.7): survived mutants on the write payload reviewed — kill any that would let a
  schedule field silently not persist; ignore cosmetic mutants consciously. Do not chase 100%.
- `review_queue.test.sql` reviewed for the pgTAP conventions (`plan(N)` last, two-statement role
  switch, superuser seed first) and the comment-anchor to `service.ts`.
- The new schedule-field assertion is confirmed **not** to recompute the expected value inline per
  field — it compares against a single `expected` object.

**Implementation Note**: After automated verification passes, pause for manual confirmation before
Phase 2.

---

## Phase 2: Risk #6 — Counter Integrity + Rollout Close-Out

### Overview

Lock the "edit does not touch counters" half of Risk #6 with `rpcCalls` assertions; add the
`least()` clamp regression and the delete-edge cases to the `recount` pgTAP; then close out the
rollout phase — cookbook §6.5, §7 entries, `test-plan.md` §3 status, deferred register.

### Changes Required

#### 1. Edit does not recount (service layer)

**File**: `src/lib/flashcards/service.test.ts`

**Intent**: Assert `updateFlashcard` makes zero `recount` calls — the "reconstructable after edit"
half of Risk #6.

**Contract**: `updateFlashcard` (`service.ts:147-171`) issues one `update` and no `.rpc`.

- In `describe("updateFlashcard")`, add `expect(supabase.rpcCalls).toEqual([])` to the existing
  "writes only trimmed content to the owner-visible card" test (and assert `supabase.queries` has
  length 1 — no second call).

#### 2. Edit does not recount (route layer)

**File**: `src/pages/api/flashcards/[id].test.ts`

**Intent**: Same guarantee at the handler boundary.

**Contract**: `PATCH` on `/api/flashcards/[id]` — successful edit, no `recount`.

- In the existing "updates valid trimmed card content" test, add `expect(supabase.rpcCalls).toHaveLength(0)`.

#### 3. `recount` clamp + delete-edge pgTAP

**File**: `supabase/tests/recount_generation_acceptance.test.sql`

**Intent**: Regression-test the `least()` clamp (the reason `20260826141500` exists) and the two
untested delete edges. Extend `plan(9)` → `plan(9 + k)`.

**Contract**: `public.recount_generation_acceptance(p_generation_id uuid)` — `accepted_unedited = least(count('ai'), generated_count)`,
`accepted_edited = least(count('ai_edited'), generated_count - accepted_unedited)`; the
`generations_accepted_total_leq_generated` CHECK must hold; a call for a non-existent generation is
a safe no-op.

**Placement & role**: insert all three cases **before** the existing isolation block (currently
`recount_generation_acceptance.test.sql:120` — the "liczniki gen1 stają się nieaktualne" comment,
the user-B `set local request.jwt.claims`, and the `set local role postgres` that follows). At that
point the session is still `set local role authenticated` as user A
(`sub = aaaaaaaa-…-aaaaaaaaaaaa`), so `recount` runs `security invoker` under RLS the same way the
service calls it — a future grant/RLS regression on `recount` then turns a case red. Do **not**
append after the isolation assertions: that region runs as `postgres` (superuser) and would mask the
loss of `security invoker` scoping. Use **fresh generation UUIDs** (e.g. `…-000000000003`,
`…-000000000004`) and fresh flashcard UUIDs — never reuse gen1/gen2, whose card sets the existing
cases mutate.

- **Clamp regression**: new generation, `generated_count = 2`. Insert 3 `ai` + 1 `ai_edited`
  flashcards (4 > 2). `lives_ok` on `recount`. Assert `accepted_unedited_count = 2` and
  `accepted_edited_count = 0` (per the `least` formula), and `accepted_unedited + accepted_edited = generated_count`.
  `ok` that the total `<= generated_count`. (Comment: reverting to the pre-clamp body from
  `20260825143000` makes this go red — the function would throw on the CHECK.)
- **Delete last card → `(0,0)`**: a generation with exactly 1 `ai` flashcard and `generated_count = 1`;
  `recount` → `(1,0)`; `delete` that flashcard; `recount` → `results_eq` `(0, 0)`.
- **Deleted generation is a no-op**: capture a `p_generation_id`; `delete from public.generations
  where id = <that>` (flashcards' `generation_id` nulls via `on delete set null`); `lives_ok` on
  `recount(<that id>)` — the `for update` selects nothing, the `update … where g.id = …` matches
  nothing, no throw.
- Re-count assertions, set `plan(N)` last.

#### 4. Cookbook §6.5

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.5 "TBD — see §3 Phase 3" stub with the schedule-state test pattern.

**Contract**: §6.5 "Dodanie testu stanu harmonogramu powtórek" — a bulleted pattern in the style of
§6.1–§6.4, referencing the real files Phase 1/2 produced.

- Cover: oracle from the wrapper's own `applyGrade` output compared field-by-field (never the
  library's arithmetic, never an inline recompute); SRS fixtures derived from the real module with
  `state`/`reps` overrides; `SupabaseStub` for the write payload + `reps`-guard *shape*; pgTAP
  (`review_queue.test.sql`) for real `due <= now()`, ordering, the 50-row cap, queue isolation, and
  the `reps`-guard *semantics* against a real row; the `.strict()` body guard against a smuggled
  clock; the `recount` `rpcCalls == []` idiom for "an edit must not move a counter".

#### 5. §6.7 per-phase note + §3 status + §4 count

**File**: `context/foundation/test-plan.md`

**Intent**: Record what Phase 3 taught and advance the rollout state.

**Contract**:
- §3 row 3 ("Integralność harmonogramu i liczników") Status cell: `researched` → `complete`.
- §4 pgTAP row Notes: bump the suite count to reflect the new `review_queue.test.sql`. The cell
  currently reads "5 suit w `supabase/tests/`" but the directory holds **4** files
  (`generations_error_contract`, `recount_generation_acceptance`, `rls_flashcards`,
  `rls_generations`) — the "5" is stale. Set it to the true post-change count: **"5 suit w
  `supabase/tests/`"** (4 existing + `review_queue.test.sql`).
- §6.7: new "**Faza 3 — Integralność harmonogramu i liczników**" block, 2–3 lines (where the
  schedule fixtures live and that they derive from `@/lib/srs`; that `review_queue.test.sql` is the
  first reviews pgTAP; that the `reps`-guard semantics needed a real row because the stub only fakes
  the lost race with a hand-fed `{ data: null }`).

#### 6. §7 deliberately-not-tested entries

**File**: `context/foundation/test-plan.md`

**Intent**: Record the four boundaries the research surfaced, in the established §7 format (a
"Przewartościować, jeśli…" clause + source).

**Contract**: four new bullets under §7:
- **Strefa czasowa w kolejce powtórek** — the queue compares `due <= now()` in UTC server-side; no
  client timezone handling. No source specifies per-client-timezone behaviour. Reconsider if the
  PRD adds a "study day" boundary or users report cards appearing at the wrong local time.
  (Source: research Open Question 2; rollout Faza 3.)
- **Współbieżność `recount` (`for update`)** — the lock is present and reviewed; single-session
  pgTAP cannot reproduce the parallel-writes race and a `pg_get_functiondef` presence assertion is
  brittle and low-signal. Reconsider if a load test reproduces undercounting or the lock line is
  removed. (Source: research Open Question 7; rollout Faza 3.)
- **Populacja zagregowanego kryterium "75%"** — no aggregate query over `generations` exists in
  code; per-user vs per-generation vs lifetime, and whether `pending`/`failed` rows count, is
  undefined. The per-generation `recount` invariant is what Phase 3 pins. Reconsider when the
  success-metric query is actually implemented. (Source: research Open Question 8; rollout Faza 3.)
- **Wykonawcza równoważność SQL `applyReviewGrade` ↔ pgTAP** — `review_queue.test.sql` odtwarza
  ręcznie `select … where due <= now() …` i `update … where id = ? and user_id = ? and reps = ?`,
  które emituje serwis; wiąże je z `src/lib/reviews/service.ts` tylko komentarz-kotwica, nie
  wykonanie (pgTAP nie woła TypeScriptu, a nie ma warstwy Vitest przeciw realnemu Postgresowi).
  Dryf w łańcuchu `.from()/.update()/.eq()`, który nadal buduje poprawny payload (zła tabela,
  zgubione `.eq("user_id")`, `.lte` → `.eq`), przechodzi obie warstwy — łapie go przegląd, nie
  automat. Przewartościować, jeśli powstanie harness integracyjny Vitest ↔ Postgres albo `db-tests`
  zacznie wołać kod serwisu. (Source: research Open Question 5; rollout Faza 3.)

#### 7. Deferred-item register

**File**: `context/changes/testing-schedule-counter-integrity/deferred.md` (new)

**Intent**: One place listing every research Open Question and where it landed (resolved in plan /
→ §7 / out of scope), so a future contributor doesn't re-litigate.

**Contract**: a short table — Open Question → disposition → pointer (plan section or §7 bullet).

#### 8. change.md status

**File**: `context/changes/testing-schedule-counter-integrity/change.md`

**Intent**: `/10x-plan` sets `status: planned`; `/10x-implement` will advance it.

**Contract**: frontmatter `status` and `updated`.

### Success Criteria

#### Automated Verification

- Unit + integration pass: `npm test`
- pgTAP passes locally: `npm run db:test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- `recount_generation_acceptance.test.sql` `plan(N)` matches its assertion count
- `test-plan.md` §3 row 3 shows `complete`; §6.5 no longer contains "TBD — see §3 Phase 3"

#### Manual Verification

- Ad-hoc Stryker on `src/lib/flashcards/service.ts` (narrowed): survived mutants around the
  `recount` call sites and the `updateFlashcard` no-recount path reviewed; kill any that would let
  an edit move a counter. Do not chase 100%.
- §6.5 pattern reviewed against what Phase 1 + Phase 2 actually produced (no aspirational bullets).
- §7 entries reviewed for the "Przewartościować, jeśli…" clause + source attribution.
- `deferred.md` cross-checked against all 9 research Open Questions — every one has a disposition.

**Implementation Note**: After automated verification passes, pause for manual confirmation. This
phase closes the rollout phase — `/10x-test-plan --status` should then show Phase 3 `complete`.

---

## Testing Strategy

### Unit Tests

- `applyReviewGrade` write payload = wrapper's `applyGrade` output, all 9 schedule fields, no
  `updated_at`; `last_review === now`; Learning / Relearning / `reps:0` fixtures.
- `updateFlashcard` / PATCH make zero `recount` calls.

### Integration Tests

- Reviews POST `.strict()` rejects a body with an extra `now` field (400, no side effects).
- PATCH `/api/flashcards/[id]` success path records no rpc.

### Database Procedure Tests (pgTAP)

- `review_queue.test.sql` (new): `due <= now()` selection, `due` ordering, 50-row cap, cross-account
  queue isolation, `reps`-guarded update (stale write → 0 rows, legitimate second grade → 1 row +
  consistent re-parse).
- `recount_generation_acceptance.test.sql` (extended): `least()` clamp with more AI cards than
  `generated_count`; delete-last-card → `(0,0)`; `recount` on a deleted generation is a safe no-op.

### Manual Testing Steps

1. `supabase start`, then `npm run db:test` — both pgTAP suites green.
2. `npm test` — full Vitest suite green.
3. Ad-hoc Stryker per phase on the named module; review survived mutants against "would this hurt a
   user?".
4. Read §6.5 and §7 additions end to end; confirm they describe what shipped.

## Performance Considerations

None. Test-only. The new pgTAP suite adds a few seconds to the `db-tests` CI job (already ~1–2 min
for `supabase start`); the Vitest additions are microseconds.

## Migration Notes

None. No schema or data changes.

## References

- Research: `context/changes/testing-schedule-counter-integrity/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (risks #3, #6), §3 (rollout row 3), §6, §7
- Lessons: `context/foundation/lessons.md` — "Metryka deklarowana przez klienta nie jest metryką"
- Live `recount`: `supabase/migrations/20260826141500_clamp_generation_acceptance.sql`
- Queue: `src/lib/reviews/service.ts:62-96`; write: `:98-160`
- O2-13 worked example: `supabase/tests/rls_flashcards.test.sql:191-224`
- `SupabaseStub`: `src/lib/test-support/supabase-stub.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Risk #3 — Schedule-State Integrity

#### Automated

- [ ] 1.1 Unit + integration pass: `npm test`
- [ ] 1.2 pgTAP passes locally: `npm run db:test`
- [ ] 1.3 Type checking passes: `npx astro check`
- [ ] 1.4 Linting passes: `npm run lint`
- [ ] 1.5 `supabase/tests/review_queue.test.sql` exists and `plan(N)` matches its assertion count

#### Manual

- [ ] 1.6 Ad-hoc Stryker on `src/lib/reviews/service.ts` — survived write-payload mutants reviewed
- [ ] 1.7 `review_queue.test.sql` reviewed for pgTAP conventions + `service.ts` comment-anchor
- [ ] 1.8 New schedule-field assertion confirmed not to recompute the expected value inline per field

### Phase 2: Risk #6 — Counter Integrity + Rollout Close-Out

#### Automated

- [ ] 2.1 Unit + integration pass: `npm test`
- [ ] 2.2 pgTAP passes locally: `npm run db:test`
- [ ] 2.3 Type checking passes: `npx astro check`
- [ ] 2.4 Linting passes: `npm run lint`
- [ ] 2.5 `recount_generation_acceptance.test.sql` `plan(N)` matches its assertion count
- [ ] 2.6 `test-plan.md` §3 row 3 shows `complete`; §6.5 no longer contains "TBD — see §3 Phase 3"

#### Manual

- [ ] 2.7 Ad-hoc Stryker on `src/lib/flashcards/service.ts` — survived recount-path mutants reviewed
- [ ] 2.8 §6.5 pattern reviewed against what Phases 1–2 actually produced
- [ ] 2.9 §7 entries reviewed for the "Przewartościować, jeśli…" clause + source
- [ ] 2.10 `deferred.md` cross-checked against all 9 research Open Questions
