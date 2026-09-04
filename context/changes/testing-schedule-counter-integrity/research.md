---
date: 2026-09-04T11:49:00+02:00
researcher: Sebastian Urbański
git_commit: 132edb2ef0574370cf91b4ed27431b32609cb4e4
branch: master
repository: 10xCards
topic: "Test rollout Phase 3 — integrity of the review schedule (#3) and generation acceptance counters (#6)"
tags: [research, codebase, srs, ts-fsrs, reviews, generations, counters, recount, pgtap]
status: complete
last_updated: 2026-09-04
last_updated_by: Sebastian Urbański
---

# Research: Test rollout Phase 3 — schedule state (#3) & generation counters (#6)

**Date**: 2026-09-04T11:49:00+02:00
**Researcher**: Sebastian Urbański
**Git Commit**: 132edb2ef0574370cf91b4ed27431b32609cb4e4
**Branch**: master
**Repository**: 10xCards (github.com/sebast82/10xCards)

## Research Question

Rollout Phase 3 of `context/foundation/test-plan.md` — "Integralność harmonogramu i liczników".
Produce the oracle (what the code *should* do, from sources) and the coverage-gap map for:

- **Risk #3** — a review session loses or corrupts schedule state: a grade doesn't persist, or
  sets a nonsensical due date, and the user silently loses study progress.
- **Risk #6** — generation acceptance counters drift from collection state after a flashcard is
  edited or deleted: the "75%" success criterion reports a number that can't be reconstructed
  from data.

Scope decided with the user:
- **#3 oracle boundary = our wrapper only.** Pin the row↔card mapping, the persist, the
  optimistic `reps` conflict, and the due-queue selection. `ts-fsrs` output is treated as given
  (test-plan §7: "wnętrze biblioteki powtórek" is deliberately not tested).
- **#6 = gaps + service integration.** Extend the existing `recount` pgTAP with its missing
  edge cases **and** add integration tests that the service calls `recount` on create/delete and
  that an edit cannot shift `source`.
- Both risks weighted equally.

## Summary

**Risk #3.** Schedule state is nine columns on `public.flashcards` (no `review_logs` table — F-01
decision #1). The grading contract is small and already mostly covered at the unit layer, but
**the single most important assertion is missing**: no test checks that `applyReviewGrade` actually
persists the eight non-`reps` schedule fields (`due`, `stability`, `difficulty`, `scheduled_days`,
`learning_steps`, `lapses`, `state`, `last_review`). Today only `reps: prev+1` and the *absence* of
`updated_at` are asserted on the write payload. The named failure in the risk map — *"ocena nie
zapisuje się"* — would pass every current test. The other real gaps: the due-queue `lte("due", now)`
predicate is unverifiable under `SupabaseStub` (it records `eq`/`gte`/`lte` into one undistinguished
list), and there is no pgTAP for the review-queue read against a real `(user_id, due)` index + RLS.

The "nonsensical due date" half of the risk has **no stated numeric bound** in any source — the only
DB constraint on `due` is `not null`. "Nonsensical" resolves to: (a) violates a DB CHECK, or (b) is
not what the pinned `ts-fsrs@5.4.1` computes for `(row, now, grade)`. A `due ≈ now + 1 min` after
"Again" is *correct*, not nonsensical.

**Risk #6.** Counters are **recomputed from `flashcards`, not incremented**
(`recount_generation_acceptance`, `security invoker`, `for update` lock, `least()` clamp). The pgTAP
test covers the happy path, idempotence, delete-lowers-counter, and cross-user isolation. Gaps: the
`least()` **clamp** (the entire reason the second migration exists) has no regression test — only the
equality boundary is tested; the `for update` lock is neither exercised nor asserted present; delete
of the **last** card in a generation (→ `(0,0)`) is untested; and there is **no test that
`updateFlashcard` / `PATCH` does not call `recount`** — the "reconstructable after edit" half of the
risk rests entirely on the implicit "source is immutable so an edit can't move a counter" argument,
which nothing locks down.

**Oracle caveat carried from `lessons.md`:** the `accepted_unedited` vs `accepted_edited` split is
**self-reported** — the client sends `edited`, the server keeps no proposals and cannot verify it.
"Reconstructable from data" means "reconstructable from `flashcards.source`", accepting that `source`
is a client assertion frozen at save time. This is a documentation truth to preserve, not a bug to
test away.

## Detailed Findings

### A. Risk #3 — the schedule-state contract (oracle)

#### A.1 What the sources bind

| # | Behaviour the test must prove | Source |
| --- | --- | --- |
| 1 | **Deterministic** state change: fixed `(row, now, grade)` → same next row every call | F-01 `plan.md` Phase 2 contract; `enable_fuzz: false` in pinned defaults; `now` is always an explicit arg, never the system clock |
| 2 | **Durable** persistence: after a grade the DB row carries the advanced state across **all nine** fields | test-plan §2 risk #3 ("ocena nie zapisuje się"); S-05 research F2 (ignored `.error` = silent guardrail breach) |
| 3 | **Repeat grade ≠ contradictory state**: double-click / two tabs must not lose a write | `change.md` L21; S-05 `plan.md` — `reps`-guarded conditional `UPDATE`, 0 rows → `grade_conflict` → 409, island absorbs as "already graded, advance" |
| 4 | **Source-independence**: `ai` / `ai_edited` / `manual` traverse an identical path; the service never selects or branches on `source` | PRD L40 guardrail; roadmap F-01 point 4, S-05 L177; F-01 `plan.md` L202 |
| 5 | **Server owns the clock and the queue**: `now` and schedule state are never read from the request body; queue = `WHERE user_id=? AND due<=now() ORDER BY due` server-side | contract-surfaces L103; S-05 research §7 table |
| 6 | **Schema-validated read**: every DB row passes `scheduleStateRowSchema.safeParse` before the scheduler; malformed → typed `schedule_state_invalid` → 500, never an uncatchable `FSRSValidationError` | F-01 research §3; S-05 research §2.1/§3 |

`due <= now` selection, ordering, and `range(0, 49)` (`REVIEW_BATCH_SIZE = 50`) are the queue contract:
[`src/lib/reviews/service.ts:62-96`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/reviews/service.ts#L62-L96).

#### A.2 "Nonsensical due date" — there is no stated bound

- The **only** DB constraint on `due` is non-null (`flashcards_due_required` was later dropped as
  redundant with `NOT NULL`). Other schedule CHECKs:
  `stability >= 0`, `difficulty between 0 and 10`, `scheduled_days >= 0`, `learning_steps >= 0`,
  `reps >= 0`, `lapses >= 0`, `state between 0 and 3`
  ([`20260824202259_flashcards_schema.sql:54-65`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/supabase/migrations/20260824202259_flashcards_schema.sql#L54-L65)).
- Pinned `ts-fsrs@5.4.1` default params: `learning_steps: ['1m','10m']`, `maximum_interval: 36500`
  days, `enable_fuzz: false`. Smallest legitimate interval ≈ **1 minute** (Again on New/Learning),
  largest 36500 days.
- **Therefore "nonsensical" = (a) violates a DB CHECK, or (b) ≠ `applyGrade(row, now, grade)` for
  the pinned lib with explicit `now`.** `due ≈ now + 1 min` after Again is correct — S-05 impl-review
  F1 treated a 1-minute `due` as a bug *only because the grade was accidental*, not because the value
  is invalid.

#### A.3 Design facts an implementer must not "fix"

- **`elapsed_days` is deliberately not persisted** — `scheduleStateRowToCard` hard-codes `0`
  ([`src/lib/srs/schedule-state.ts:21-30`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/srs/schedule-state.ts#L21-L30));
  ts-fsrs recomputes it from `last_review` vs `now`. Excluded from schema as a deprecated field
  (contract-surfaces L105).
- **Write emits ISO `Z`, Postgres returns `+00:00`.** String inequality between write and read is
  expected; both pass the schema (S-05 research §3).
- **No `ReviewLog`** — `scheduler.next()` keeps `.card`, drops `.log`
  ([`src/lib/srs/scheduler.ts:32-36`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/srs/scheduler.ts#L32-L36)).
  Undo is structurally impossible; a test cannot "reconstruct schedule from history".
- **`reps` is the monotonic guard.** It increments on every `next()` call, so
  `.eq("reps", previousReps)` on the UPDATE detects a concurrent grade
  ([`src/lib/reviews/service.ts:127-157`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/reviews/service.ts#L127-L157)).
- **`createScheduler()` is always called with no arguments.** Per-user FSRS params would silently
  diverge from stored state (S-05 `plan.md`).
- **`updated_at` is left to the DB trigger** `flashcards_set_updated_at` — the write payload must
  *not* contain it (asserted at `reviews/service.test.ts:96`).

#### A.4 Existing #3 coverage (what is already solid)

- `scheduleStateRowSchema` rejects bad `state`, missing fields, out-of-domain values; round-trips a
  `state:Review, reps:8, lapses:2, last_review` fixture
  ([`src/lib/srs/schedule-state.test.ts`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/srs/schedule-state.test.ts)).
- `scheduler.test.ts`: `createNewCard` zeroes, New→Learning after Good with `last_review = now`,
  `preview` = 4 grades no mutation, `lapses++` after Again-from-Review, **determinism** (same
  triple ⇒ equal), `preview[g] == applyGrade(...,g)` parity for Learning + Review cards.
- `reviews/service.test.ts`: queue query shape (`filters` contains `["due", NOW]`, `order due asc`,
  `range [0,49]`); malformed row → `schedule_state_invalid`; DB error → `persist_failed`; empty
  queue; `applyReviewGrade` filter triple `[id, user_id, reps=prev]` and `reps: prev+1`; pre-read
  null → `flashcard_not_found`; guarded 0-row → `grade_conflict`; **manual vs AI card ⇒ identical
  payload/filters, `source` never touched** ([`:163-185`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/reviews/service.test.ts#L163-L185)).
- `api/reviews.test.ts`: 401/503 deny with **no query / no rpc**; `{ cards }` / `{ id }` envelopes;
  corrupt state → 500; body validation (bad JSON, bad uuid, grade `0`, grade `5` → 400); 404; 409
  with the exact static message.
- `ReviewSession.test.tsx`: empty state, mouse loop, keyboard loop, progress label,
  **Space-after-reveal is a no-op** (regression for S-05 impl-review F1), **409 is silent** (card
  done, advance), 500 surfaces + retry.
- `interval.test.ts`: all `formatInterval` buckets + boundary switches + non-positive clamp.
- pgTAP `rls_flashcards.test.sql:191-224`: cross-account UPDATE of `due/stability/state/reps` is
  blocked by the WRITE policy and the row is byte-unchanged (added in Phase 2).

#### A.5 Risk #3 — GAPS

1. **[primary] Written schedule state is not asserted.** `applyReviewGrade` builds an 8-field
   `update({...})` payload; the only assertions are `toMatchObject({ reps: prev+1 })` and
   `not.toHaveProperty("updated_at")`
   ([`src/lib/reviews/service.test.ts:72-97`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/reviews/service.test.ts#L72-L97)).
   Nothing checks the persisted `due/stability/difficulty/scheduled_days/learning_steps/lapses/state/
   last_review` equal `createScheduler().applyGrade(parsed.data, now, grade)`. "A grade persists
   deterministically" is verified only for the `reps` counter. **Oracle-safe assertion** (not a
   mirror): the payload's every schedule key equals the wrapper's own `applyGrade` output for the
   same `(parsedRow, now, grade)` — this pins *our* persistence contract (the row→card→row plumbing
   and that we write what we computed), while treating the ts-fsrs numbers themselves as given.
2. **`last_review = now` is never checked through the service.** Only the pure scheduler asserts it
   (`scheduler.test.ts:30`). No durable-write evidence.
3. **No write → re-read → re-parse → re-grade round-trip.** "Repeat grade must not create
   contradictory state" is covered *only* as the stale-`reps` 409 path. There is no positive test
   that a **legitimate** second grade (with `reps` advanced) yields a consistent, re-parseable row,
   and no `state=1` (Learning) / `state=3` (Relearning) fixture through the service.
4. **Due-queue `lte("due", now)` is unverifiable under the stub.** `SupabaseStub` pushes `eq`,
   `gte`, `lte` into one `filters` array with no operator distinction and applies no filtering
   ([`src/lib/test-support/supabase-stub.ts:53-66`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/test-support/supabase-stub.ts#L53-L66)).
   Changing `.lte` → `.gte` / `.eq` in the service keeps every test green. Needs pgTAP against a
   real DB.
5. **Batch-size 50 boundary + multi-row ordering untested.** `range(0, 49)` arithmetic is asserted;
   no test feeds 50/51 rows or checks `order("due", ascending)` actually orders.
6. **No pgTAP for the review-queue read.** `supabase/tests/` has no reviews file. The
   `(user_id, due)` index + RLS interaction with `WHERE due <= now()` is never exercised on a real
   DB. This is where gaps 3–5 land cheaply.
7. **`.strict()` on the POST body is not proven.** `postBodySchema` is `.strict()`
   ([`src/pages/api/reviews.ts:20`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/pages/api/reviews.ts#L20));
   no test sends an extra `now`/`date` field to prove a client cannot smuggle a clock.
8. **`reps = 0` guard untested.** A brand-new (`state:New, reps:0`) card is due immediately; the
   guarded update would use `.eq("reps", 0)`. All fixtures use `REVIEW_ROW` with `reps:2`.
9. **Timezone / "granice czasu i strefy czasowej"** is named as context to ground (test-plan §2.3
   row #3) but **no source specifies expected behaviour** — see Open Questions.

#### A.6 Risk #3 — cheapest layer per gap

| Gap | Layer | Why |
| --- | --- | --- |
| 1, 2, 3 (write payload, `last_review`, re-grade consistency) | **unit** on `applyReviewGrade` with `SupabaseStub` | payload is inspectable; oracle is the wrapper's own `applyGrade` output, compared field-by-field (not recomputed inline) |
| 3 (round-trip re-parse), 4, 5, 6 (real `due<=now`, ordering, index, RLS) | **pgTAP** `supabase/tests/review_queue.test.sql` (new) | `SupabaseStub` structurally cannot model `WHERE due<=now()` or RLS |
| 7, 8 | **integration** on the route handler | body `.strict()` and `reps:0` are handler/service concerns |

Do **not** write a real-DB Vitest "integration" layer for #3 — there is no harness for it
(`npm test` = `vitest run`, node env, `SupabaseStub`; the only real-Postgres layer is pgTAP,
PR-only in CI). "Integration on endpoint session" in the risk guidance = the existing
handler-with-stub pattern in `api/reviews.test.ts`.

---

### B. Risk #6 — the generation-counter contract (oracle)

#### B.1 What the sources bind

| # | Behaviour the test must prove | Source |
| --- | --- | --- |
| 1 | **Reconstructable after EDIT**: editing an AI card's `front`/`back` leaves both counters unchanged, because `source` is immutable and `recount` keys off `source` | contract-surfaces L94; S-03 plan ("editing must not affect acceptance buckets"); PRD L120 |
| 2 | **Reconstructable after DELETE**: deleting an AI card recounts; afterwards `accepted_unedited + accepted_edited == count(remaining ai/ai_edited cards for G)` and `<= generated_count` | test-plan §2 risk #6; S-03 plan; `recount` pgTAP `:97-118` |
| 3 | **Idempotence / no drift on replay**: a repeated accept or a second `recount` does not inflate — the value is recalculated from `flashcards`, not `+1` | `20260825143000_...sql:1-2`; pgTAP `:70-80` |
| 4 | **Isolation**: `recount` invoked by user B does not change user A's counters (`security invoker` + RLS); `anon` cannot `EXECUTE` | `20260825143000_...sql:28-29`; pgTAP `:120-144`; `rls_generations.test.sql:165-170` |
| 5 | **Source of truth is a recount over the collection**, not the stored counter; the stored counters are a cache that must equal `count(*)` grouped by `source`, scoped by `generation_id` | test-plan §2.3 row #6 |

**Measurement formulas** (stated authoritatively only in S-02 research §4.3):
- Criterion #1 "75% akceptowane bez istotnych zmian" = `accepted_unedited_count / generated_count`.
- Criterion #2 "75% kolekcji z AI" = share of `flashcards` with `source IN ('ai','ai_edited')` among
  all cards. Manual cards (`generation_id = null`) never touch counters but count in this
  denominator.
- The `unedited` vs `edited` split: `edited` is `true` iff saved text differs from generated text
  (content comparison, frozen at save by the immutable-`source` trigger) — **but self-reported**,
  see caveat below.

#### B.2 How `recount` actually works

[`supabase/migrations/20260826141500_clamp_generation_acceptance.sql`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/supabase/migrations/20260826141500_clamp_generation_acceptance.sql)
(live version — later timestamp wins; `CREATE OR REPLACE` keeps the earlier migration's ACL):

```sql
perform 1 from public.generations where id = p_generation_id for update;   -- lock before count
update public.generations g set
  accepted_unedited_count = least(c.unedited, g.generated_count),
  accepted_edited_count   = least(c.edited, g.generated_count - least(c.unedited, g.generated_count))
from (
  select count(*) filter (where source = 'ai')        as unedited,
         count(*) filter (where source = 'ai_edited')  as edited
  from public.flashcards where generation_id = p_generation_id
) c
where g.id = p_generation_id;
```

- `security invoker`, `set search_path = ''`, `grant execute ... to authenticated`,
  `revoke ... from public`.
- `manual` cards are never counted.
- The `least()` **clamp** exists because a replayed save (dropped network, client retry) could put
  more AI cards under a generation than `generated_count`, and the raw `count(*)` then violated
  `generations_accepted_total_leq_generated`
  ([`20260824202259_flashcards_schema.sql:33`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/supabase/migrations/20260824202259_flashcards_schema.sql#L33)),
  the function threw, and counters stayed **permanently low**.

**Call sites** (both best-effort — `.error` is read, logged as a Postgres code only, never
rethrown):
- [`createAiFlashcard`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/flashcards/service.ts#L54-L117)
  — after a successful insert. The last card in a generation has "no one to fix it" if `recount`
  fails → this is the only instrument for the 75% criterion, so a silent failure deflates it with
  no trace.
- [`deleteFlashcard`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/flashcards/service.ts#L173-L221)
  — only when the deleted card's `generation_id` was non-null (reads it first).
- **`updateFlashcard` does NOT call `recount`** — it writes only `{ front, back }` (trimmed). This
  is correct by design (S-03 plan): `source` is immutable, counters derive from `source`, so an
  edit cannot move a counter.

#### B.3 The self-reported caveat (must be preserved, not tested away)

`lessons.md` — "Metryka deklarowana przez klienta nie jest metryką":
the server keeps no proposals (privacy decision), so it cannot verify the `edited` flag or the card
content. A client can send any `front`/`back` with `edited: false` and feed
`accepted_unedited_count`. **"Reconstructable from data" therefore means "reconstructable from
`flashcards.source`"** — `source` itself is a client assertion frozen at save. A Phase 3 test proves
counters equal a recount of `flashcards.source`; it cannot and should not try to prove `source` is
truthful. (The user chose **not** to expand scope to a server-side evidence assertion for `edited`.)

#### B.4 Existing #6 coverage (what is already solid)

Unit / integration (`SupabaseStub`, positional queue):
- `createAiFlashcard` calls `rpc("recount_generation_acceptance", { p_generation_id: GENERATION_ID })`
  — asserted at both service and route layer
  ([`flashcards/service.test.ts:112-124`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/flashcards/service.test.ts#L112-L124),
  `api/flashcards.test.ts:134-136`).
- `source: 'ai'` vs `'ai_edited'` from the `edited` flag; generation lookup scoped
  `id + status='succeeded' + user_id`; unseen generation → `generation_not_found` (stops after 1
  query); insert failure → typed error; 9 schedule columns written on insert.
- `createManualFlashcard`: **no recount**, exactly 1 query, `generation_id: null`, `source: 'manual'`
  — `rpcCalls` asserted `[]`.
- `deleteFlashcard`: AI card → delete scoped `(id, user_id)` then recount with the stored
  `generation_id`; manual card → **no recount** (`rpcCalls` `[]`); concurrent delete (0 rows) →
  `flashcard_not_found`, `rpcCalls` `[]`; DB failure → `persist_failed`.
- `updateFlashcard`: writes only `{front,back}` trimmed, key-set asserted exactly `["front","back"]`,
  owner-scoped; inaccessible → `flashcard_not_found`.
- `generations/service`: `generated_count` filled + `status: 'succeeded'` on completion.

pgTAP
([`supabase/tests/recount_generation_acceptance.test.sql`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/supabase/tests/recount_generation_acceptance.test.sql),
`plan(9)`):
- `accepted_unedited_count` = count(`source='ai'`); `accepted_edited_count` = count(`source='ai_edited'`).
- Second call is idempotent (recount, not increment).
- Recount to a value **equal** to `generated_count` doesn't break the CHECK.
- Deleting one AI card of three lowers the counter to `(1,1)`; post-delete `total <= generated_count`.
- `security invoker` — a call by user B does **not** touch user A's counters (test re-dirties
  gen1's counters first so the assertion is not vacuous).

DB-level immutability: `rls_flashcards.test.sql:152` — updating `source` raises
`'%flashcard source is immutable%'`.

#### B.5 Risk #6 — GAPS

1. **[primary] No test asserts `updateFlashcard` / `PATCH` does NOT call `recount`.** The
   "reconstructable after **edit**" half of the risk. `flashcards/service.test.ts:196-218` asserts
   the payload key-set is `["front","back"]` but never asserts `supabase.rpcCalls` is `[]`;
   `api/flashcards/[id].test.ts` PATCH cases don't check `rpcCalls` either. **Cheap fix**: add
   `expect(supabase.rpcCalls).toEqual([])` to the existing edit tests (service + route).
2. **No service/route test that an edit cannot change `source` / `generation_id`.** Only the DB
   trigger is covered. The service just omits those columns; the key-set assertion is the sole
   proxy. Consider a pgTAP assertion that `update ... set source = 'ai'` on an `ai_edited` card
   raises, paired with "owner can edit front/back of the same card" (positive control).
3. **[primary] The `least()` clamp has no regression test.** `recount` pgTAP tests only the
   **equality** boundary (gen2: `generated_count=2`, one `ai` + one `ai_edited`). Reverting to the
   pre-clamp body ([`20260825143000_...sql:13-24`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/supabase/migrations/20260825143000_recount_generation_acceptance.sql#L13-L24))
   keeps every test green. New case: seed **more** AI cards than `generated_count`, call `recount`,
   assert (a) it does not throw, (b) `accepted_unedited + accepted_edited == generated_count`,
   (c) the CHECK holds.
4. **Delete of the LAST card in a generation is untested.** Existing test deletes 1 of 3. New case:
   drain a generation to zero AI cards, `recount`, assert `(0, 0)`.
5. **`for update` lock is neither exercised nor asserted present.** Single-session pgTAP can't
   demonstrate the race; at minimum consider a source-level assertion (or a comment-anchored
   `pg_get_functiondef` check) that the `for update` line is still there — the comment
   ("bez niej dwa równoległe zapisy fiszek zaniżają licznik") describes exactly the risk-#6 failure
   mode. Flag for the plan: this may be a *conscious* "can't test cheaply" entry for §7.
6. **Recount after the parent generation is deleted / `generation_id` nulled by cascade is
   untested.** `generation_id ... on delete set null`
   ([schema:39](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/supabase/migrations/20260824202259_flashcards_schema.sql#L39)).
   No test that `recount` on an already-deleted `p_generation_id` is a safe no-op (the `for update`
   selects nothing, the `update ... where g.id = ...` matches nothing).
7. **`createAiFlashcard` skip-recount-on-insert-failure only weakly covered.** The failing-insert
   test supplies 2 stub results and asserts rejection, but does not assert `rpcCalls` is `[]`; a
   stray rpc would get the stub's default `{data:null,error:null}` and pass silently. Add the
   negative assertion.
8. **DELETE **route** AI-card → recount path untested at the integration layer.**
   `api/flashcards/[id].test.ts` DELETE cases all use `{ generation_id: null }` (the manual path).
   The recount branch is only covered in `flashcards/service.test.ts:236`.
9. **No end-to-end reconstruct through the service.** The counters-from-flashcards property is
   proven only by the SQL function test with **hand-inserted** rows. No test runs `createAiFlashcard`
   ×N (mixed edited/unedited) + `deleteFlashcard` + reads `generations` to confirm the counters
   equal the surviving `source` distribution. (This would be pgTAP calling the SQL function directly
   with rows shaped like the service produces, *not* Vitest — the service layer can't reach a real
   DB.)
10. **`deleteFlashcard` does not re-check generation `status` before recounting.** `least(count, 0)`
    on a `generated_count=0` generation yields 0 — safe — but unverified.

#### B.6 Risk #6 — cheapest layer per gap

| Gap | Layer |
| --- | --- |
| 1, 2 (service side), 7, 8 | **integration / unit** with `SupabaseStub` — `rpcCalls` assertions on edit; route DELETE recount branch |
| 2 (DB side), 3 (clamp), 4 (last card), 6 (cascade / deleted generation), 9 (end-to-end reconstruct), 10 (status) | **pgTAP** — extend `recount_generation_acceptance.test.sql` |
| 5 (`for update` lock) | likely **§7 "deliberately don't test"** entry — single-session pgTAP can't show the race; a presence assertion is low-signal. Decide in `/10x-plan`. |

---

### C. Test infrastructure (what will and won't work)

#### C.1 Conventions (carried from Phases 1–2, test-plan §6.2 / §6.4)

- **Route handlers are called as plain functions.** `import { GET, POST } from "./reviews"`; a local
  `context()` helper returns `{ locals: { user, supabase }, request, params } as never`; `request`
  is a real WHATWG `Request`. The helper is **copied per file — do not extract it**.
- **`SupabaseStub`** (`src/lib/test-support/supabase-stub.ts`): constructed with an ordered
  `StubResult[]`; **one shared positional index** consumed by *both* `.from()` and `.rpc()`. Chains
  `.eq().eq().maybeSingle()`, `.eq().lte().order().range()`, `.update().eq().eq().eq().select().maybeSingle()`
  all work. `.rpc(name, args)` pushes `{ name, args }` to `supabase.rpcCalls` and consumes one slot.
  Assert positive with `expect(supabase.rpcCalls).toEqual([{ name: "...", args: {...} }])`, negative
  with `toEqual([])`. `supabase.queries[i]` is in `from()`-call order; `.eq/.gte/.lte` all push
  `[col, val]` into one undistinguished `filters` array.
- **SRS fixtures are derived from the real module, never hand-authored**:
  `REVIEW_ROW = scheduler.applyGrade(scheduler.applyGrade(scheduler.createNewCard(SEED_NOW), SEED_NOW, Easy), SEED_NOW, Good)`.
  Corrupt-row cases spread an override (`queueRow({ state: 9 })`).
- **`astro:env/server`**: the reviews and flashcards route modules do **not** import it — no mock
  needed. (Only the generations route does.)
- **Vitest**: `vitest.config.ts` is `environment: "node"` + alias `@` → `./src`, nothing else. No
  `setupFiles`, no `globals` (explicit `{ describe, it, expect, vi }` imports), no
  `@testing-library/jest-dom`. Component tests opt into jsdom with a first-line
  `// @vitest-environment jsdom`. `npm test` = `vitest run`. There is **no `test:integration`**.
- **pgTAP**: `begin; select plan(N); … select * from finish(); rollback;` — **`plan(N)` set last**.
  Role switch = two statements: `set local role authenticated;` then
  `set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';`. Seed `auth.users`
  as superuser first. Run `npm run db:test` (→ `supabase test db` against `supabase start`).
  CI job `db-tests` is **`pull_request`-only** (Docker + `supabase start` ~1–2 min) and is in
  `master`'s **required status checks**.
- **O2-13 rule** (for any cross-account write assertion): run it with the SELECT policy neutralised
  (`alter policy ... using (true)`, undone by `rollback`), pair every blocked write with a
  byte-unchanged check **and** a positive "owner writes own row" assertion. Worked example:
  `rls_generations.test.sql:57-107`.
- **Stryker**: selective + ad hoc — no devDependency, ephemeral gitignored `stryker.conf.json`,
  `npx --yes -p @stryker-mutator/core -p @stryker-mutator/vitest-runner stryker run`. Windows needs
  three workarounds (see test-plan §6.7 Faza 1). Run it narrowed to the changed module after the
  risk phase greens; do not chase 100%.

#### C.2 Things that would make a naive test lie

1. **`SupabaseStub` models neither `FOR UPDATE`, RLS, `SECURITY INVOKER`, triggers, CHECK
   constraints, nor transactions.** Risk #6's real behaviour (concurrent writes not undercounting;
   cross-user isolation; the `least()` clamp; the CHECK) lives entirely in the DB function. A
   hermetic test of `createAiFlashcard`/`deleteFlashcard` proves only "rpc called with
   `{ p_generation_id: X }`" — nothing about the counter value. **Risk #6's value oracle must be
   pgTAP.**
2. **The stub applies no filters** — feeding a full row into `{ data }` and asserting the handler
   returns it proves nothing about `.eq("user_id", …)` scoping (test-plan §6.3: "Hermetyczny stub
   nie zna RLS — to nie dowód izolacji").
3. **The reps-guard optimistic lock is "modeled" only by the test hand-feeding `{ data: null }` as
   the 2nd result.** The stub never checks `reps` actually differs. Proving "a repeated grade does
   not double-advance / create contradictory state" needs a real row (two sequential grades, second
   rejected) → pgTAP.
4. **`.single()` never errors** on 0/>1 rows in the stub — can't catch a wrong `.single()` vs
   `.maybeSingle()` choice.
5. **DB triggers don't run under the stub** — `flashcards_set_updated_at`,
   `flashcards_prevent_source_change`. Only a real DB confirms an `applyReviewGrade` UPDATE doesn't
   trip the source-immutability trigger and that `updated_at` moves.
6. **ts-fsrs mirror-test trap.** `reviews.test.ts` / `reviews/service.test.ts` seed `REVIEW_ROW` via
   `scheduler.applyGrade(...)`. Using that **same call inline** to compute the *expected* value in a
   risk-#3 assertion is a vibe test (test-plan §1, §7). The oracle-safe form for gap A.5.1 is to
   compare the service's *write payload* against a **single** `applyGrade(parsedRow, now, grade)`
   result object, field by field — this pins "we persist what we computed and the row plumbing is
   lossless", not the library's arithmetic.
7. **The stub shares one positional index between `from()` and `rpc()`.** For `deleteFlashcard`
   (lookup → delete → rpc) the results array must be exactly `[lookup, delete, rpcResult]`; an
   off-by-one silently returns `{ data: null }` instead of failing loudly.
8. **Reason about the *clamped* `recount` semantics** (`20260826141500`). The pre-clamp "the CHECK
   throws and counters stay stuck low" scenario is now handled by the clamp; a test asserting a
   throw there would be testing dead behaviour.

#### C.3 DB constraints relevant to seeding test rows

- `generation_status` enum = `('pending','succeeded','failed')`, column default `'pending'`. The FK
  `flashcards.generation_id → generations(id)` references the **PK only** — a flashcard *can*
  physically link to a `pending`/`failed` generation; the `status='succeeded'` filter is
  **application-only** (`createAiFlashcard`).
- `generations_accepted_total_leq_generated check (accepted_unedited_count + accepted_edited_count <= generated_count)`
  — fires on any INSERT/UPDATE to `generations`; this is what `recount` must not violate.
- `generations_error_code_shape` (`error_code ~ '^[a-z_]{1,40}$'` or null) and
  `generations_error_code_only_when_failed` (`(status='failed') = (error_code is not null)`).
- `flashcards` CHECKs: front/back not-blank + length (≤500 / ≤2000), `stability >= 0`,
  `difficulty between 0 and 10`, `scheduled_days/learning_steps/reps/lapses >= 0`,
  `state between 0 and 3`. `learning_steps` and `state` are `smallint`.
- FK on-delete: `flashcards.user_id → auth.users CASCADE`,
  `flashcards.generation_id → generations SET NULL`, `generations.user_id → auth.users CASCADE`.
- GRANT/REVOKE: `authenticated` has `select/insert/update/delete` on both tables **minus**
  `truncate/trigger/references` (revoked 2026-09-04). `anon` has nothing. `recount` execute granted
  to `authenticated`, revoked from `public`.
- **No `seed.sql`** — every pgTAP suite seeds its own `auth.users` inline with
  `on conflict (id) do nothing`.

#### C.4 Client contract (`ReviewSession.tsx`) — for completeness, not a Phase 3 target

- GET/POST `/api/reviews`; POST body is `{ flashcardId, grade }` with `grade ∈ {1,2,3,4}` raw
  (server maps to `Rating`). Response body is **ignored**.
- **409 is treated as success** — card done, advance / re-fetch, no error surfaced.
- **No 401 branch, no redirect to `/auth/signin`** on mid-session expiry — inline error + retry.
  This is a deliberate §7 non-target ("Nawigacja wysp klienckich na 401 w trakcie sesji").
- Queue advancement is client-side `queue.slice(1)`; Again-graded cards reappear on the next GET
  because their `due` was reset server-side to ≈ now.

## Code References

- [`src/lib/srs/schedule-state.ts`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/srs/schedule-state.ts) — `scheduleStateRowSchema`, `scheduleStateRowToCard` (hard-codes `elapsed_days: 0`), `cardToScheduleStateRow`
- [`src/lib/srs/scheduler.ts`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/srs/scheduler.ts) — `createScheduler`: `createNewCard` / `preview` / `applyGrade`; drops `.log`
- [`src/lib/reviews/service.ts:62-96`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/reviews/service.ts#L62-L96) — `getReviewQueue`: `.eq(user_id).lte(due, now).order(due).range(0, 49)`
- [`src/lib/reviews/service.ts:98-160`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/reviews/service.ts#L98-L160) — `applyReviewGrade`: read → `safeParse` → `applyGrade` → `reps`-guarded UPDATE → `grade_conflict`
- [`src/pages/api/reviews.ts`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/pages/api/reviews.ts) — `now = new Date()` in-handler; `.strict()` body; grade `1|2|3|4` → `Rating`
- [`src/lib/flashcards/service.ts:54-117`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/flashcards/service.ts#L54-L117) — `createAiFlashcard`: `status='succeeded'` lookup, `source` decision, best-effort `recount`
- [`src/lib/flashcards/service.ts:147-221`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/flashcards/service.ts#L147-L221) — `updateFlashcard` (no recount), `deleteFlashcard` (recount iff `generation_id`)
- [`src/pages/api/flashcards/[id].ts`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/pages/api/flashcards/%5Bid%5D.ts) — PATCH / DELETE handlers
- [`supabase/migrations/20260824202259_flashcards_schema.sql`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/supabase/migrations/20260824202259_flashcards_schema.sql) — schema, CHECKs, `prevent_flashcard_source_change` trigger, RLS
- [`supabase/migrations/20260825143000_recount_generation_acceptance.sql`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/supabase/migrations/20260825143000_recount_generation_acceptance.sql) — original `recount` (pre-clamp)
- [`supabase/migrations/20260826141500_clamp_generation_acceptance.sql`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/supabase/migrations/20260826141500_clamp_generation_acceptance.sql) — **live** `recount` with `least()` clamp
- [`supabase/migrations/20260826140000_generation_reservation.sql`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/supabase/migrations/20260826140000_generation_reservation.sql) — `generation_status` enum, `error_code`, two CHECKs
- [`supabase/tests/recount_generation_acceptance.test.sql`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/supabase/tests/recount_generation_acceptance.test.sql) — `plan(9)`, the pgTAP to extend
- [`supabase/tests/rls_flashcards.test.sql:152`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/supabase/tests/rls_flashcards.test.sql#L152) — `source` immutability; `:191-224` cross-account SRS-column tamper
- [`src/lib/test-support/supabase-stub.ts`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/src/lib/test-support/supabase-stub.ts) — positional queue, `rpcCalls`, undistinguished `filters`
- [`docs/reference/contract-surfaces.md`](https://github.com/sebast82/10xCards/blob/132edb2ef0574370cf91b4ed27431b32609cb4e4/docs/reference/contract-surfaces.md) — L64-72 schedule columns, L85-87 counters, L94 `source` immutable, L101-103 counter update + queue query, L105 pinned `ts-fsrs 5.4.1`

## Architecture Insights

- **The schedule state is per-flashcard and the scheduler is a pure, stateless wrapper over a
  pinned library.** No `review_logs`, no undo, no server-side session object. The project's own
  contract is: the zod row schema, the row↔card conversion, the `reps`-guarded write, and the
  `due <= now ORDER BY due` queue. Everything numeric inside `applyGrade` belongs to `ts-fsrs@5.4.1`
  and is out of scope by §7.
- **`public.generations` is a measurement instrument, not a helper table.** Its three counters are
  the *only* source for both PRD success criteria. That is why they are recomputed from `flashcards`
  (not incremented), locked with `for update`, clamped to `generated_count`, and executed
  `security invoker` so RLS scopes them to the caller.
- **Non-atomic save sequences → hermetic tests for the branches, pgTAP for the state.**
  `createAiFlashcard` = insert + best-effort `recount` (two independent operations, no transaction).
  Per CLAUDE.md, partial-failure branches get hermetic assertions (`rpcCalls`), and the actual
  counter *value* gets pgTAP.
- **`SupabaseStub` is a call recorder, not a database.** Route/service tests are regression guards
  on query *shape* and side-effect *presence*; they are explicitly not proof of isolation, ordering,
  or constraint behaviour. Phase 3's load-bearing signal for both risks is pgTAP.
- **The two prior phases established the pgTAP + hermetic split precisely so Phase 3 can lean on
  it:** Phase 1 put the `recount` pgTAP in place as an ad-hoc gate; Phase 2 wired `db-tests` into
  `master`'s required checks and added the SRS-column cross-account guards. Phase 3 extends both.

## Historical Context (from prior changes)

- `context/archive/2026-08-23-srs-algorithm-contract/` (F-01) — decided: no `ReviewLog` table
  ("log to tabela doklejana, nie kolumna"); `state` as `smallint` + CHECK 0–3; `stability`/
  `difficulty` as `double precision`; FSRS params as code constants; `ts-fsrs` pinned to exact
  `5.4.1` (minor bump could move default weights). Open question then: *"Test obu źródeł fiszki
  należy do integracji F-02/S-05"* — i.e. the AI-vs-manual grading path test was **explicitly
  delegated forward**, and is now a Phase 3 concern (partly covered at `reviews/service.test.ts:163`).
- `context/archive/2026-09-01-srs-review-session/` (S-05) — established the `reps`-guarded
  read-modify-write, the `ReviewServiceError` codes, and the "never trust the client for `now` /
  schedule state / queue composition" table. impl-review F1 (accidental Space-Space → silent Again)
  was fixed + regression-tested; F2 (guardrail had only automated guards, no behavioural evidence)
  resolved at deploy. Open questions left for later: session size / re-fetch behaviour, whether
  Again-graded cards re-enter the same session, double-grade defence scope.
- `context/archive/2026-08-25-first-gated-generation/` (S-02) — decided counters are recomputed
  (`supabase-js` has no atomic increment); impl-review F2 ("silent `recount` failure freezes the
  75% number permanently") → fixed by reading `.error` + the `least()` clamp migration; impl-review
  F9 ("75% KPI is self-reported") → `lessons.md` rule. Measurement formulas
  (`accepted_unedited / generated`, `share of ai/ai_edited in flashcards`) stated only in that
  research §4.3.
- `context/archive/2026-09-02-testing-generation-error-contract/` (Phase 1) — `recount` pgTAP is an
  **ad-hoc** gate; `stubFetch`/`jsonResponse` duplicated per file by convention; Stryker mechanics
  + Windows workarounds; `astro:env/server` one-line `vi.mock` + `vi.hoisted`.
- `context/archive/2026-09-03-testing-access-gate-data-isolation/` (Phase 2) — `db-tests` job into
  `master` required checks; the O2-13 SELECT/write de-conflation rule; `rls_flashcards` `plan(10)` →
  `plan(22)` added the SRS-column cross-account guards; O2-9 (`recount` isolation survives
  `SECURITY INVOKER`); change #5 added `.eq("user_id", userId)` to the generation lookup in
  `createAiFlashcard`. §7 gained: FK same-user predicate on `flashcards.generation_id` deliberately
  not tested (app filter + RLS defend it).
- `context/foundation/lessons.md` — entry 1 ("Metryka deklarowana przez klienta nie jest metryką")
  directly scopes risk #6's oracle. Entry 2 ("Osierocony wiersz `pending`") is still a `[PLACEHOLDER]`
  and concerns `assertWithinDailyLimit`, not `recount` — adjacent, not in scope, but worth noting
  the rule may generalise to "any counter over rows reserved before an external op".

## Related Research

- `context/archive/2026-08-23-srs-algorithm-contract/research.md` — the F-01 state contract
- `context/archive/2026-09-01-srs-review-session/research.md` — §3 "state at read", §4.4 RMW race,
  §7 client-trust table
- `context/archive/2026-08-25-first-gated-generation/research.md` — §4.3 measurement formulas, §3
  "no atomic increment"
- `context/archive/2026-09-03-testing-access-gate-data-isolation/research.md` — §C.1 (no SRS table),
  O2-9, §F.1/F.2 (stub is not proof of isolation)

## Open Questions

Sources do not resolve these — `/10x-plan` must decide or the plan must record them as ambiguities
(test-plan §1: "stop and ask rather than guess").

### Risk #3

1. **Is there a lower bound on `due` a test may assert?** DB enforces only `due is not null`. An
   "Again" grade legitimately produces `due ≈ now + 1 min`. Whether a test may assert `due > now`
   (and how it tolerates clock skew / the `Z` vs `+00:00` write-read asymmetry) is unresolved.
   *Recommendation:* assert `due` equals the wrapper's own `applyGrade` output (gap A.5.1), which
   sidesteps needing an absolute bound.
2. **Timezone / "granice czasu i strefy czasowej"** — named in the risk guidance as context to
   ground, but no source specifies behaviour. `due` is `timestamptz`, `now` is a server `Date`, the
   queue compares in UTC. Is there anything to test beyond "the comparison is UTC and server-side"?
   *Likely a §7 entry* ("no client timezone handling — the queue is UTC `due <= now()`").
3. **Legitimate re-grade of the same card within one session.** Only the *concurrent* double-submit
   (409) is specified. An Again card is due again in ~1 min; is re-grading it in the same session
   expected, or should the queue exclude just-graded cards? S-05 left this open.
4. **`difficulty` lower bound: 0 or 1?** contract-surfaces L66 and the ts-fsrs doc say "skala 1–10";
   the DB CHECK says `between 0 and 10`; a deployed row showed `difficulty → 1`. Which is the
   oracle for a boundary test?
5. **Does Phase 3 add a real-DB layer for `applyReviewGrade`, or is pgTAP-on-the-queue +
   stub-on-the-write sufficient?** There is no Vitest integration harness against Postgres. The
   `reps`-guard "second grade rejected" property (A.5.3) can only be shown for real in pgTAP.
   *Recommendation:* new `supabase/tests/review_queue.test.sql` covering due-selection, ordering,
   batch boundary, and a two-sequential-grades sequence.

### Risk #6

6. **Does "reconstructable" mean "equals raw `count(*)`" or "equals `least(count, generated_count)`"?**
   The clamp means that when a generation holds more AI cards than `generated_count` (replayed
   save), `accepted_unedited + accepted_edited` no longer equals the raw count. No foundation doc
   anticipates this. The test must pick a definition. *Recommendation:* "equals
   `least(count, generated_count)`" — the clamp is the intended behaviour; assert the CHECK holds
   and the total is capped.
7. **`for update` lock — testable, or a conscious §7 entry?** Single-session pgTAP cannot show the
   race; a `pg_get_functiondef` presence assertion is low-signal and brittle. *Recommendation:*
   §7 entry ("concurrency of `recount` under parallel flashcard writes — the `for update` lock is
   present and reviewed; no cheap test reproduces the race").
8. **What population does the aggregate 75% query run over?** Per user? per generation? lifetime?
   first N? Are `pending`/`failed` generations (`generated_count = 0`) included in
   `sum(accepted)/sum(generated)`? No source says. This is arguably out of Phase 3's scope (no such
   query exists in code yet) but affects whether the per-generation invariant is the right thing to
   pin.
9. **Should an edit of an `ai`/`ai_edited` card ever be able to *promote* `ai` → `ai_edited`?**
   Today `source` is frozen at first save and an edit cannot change it — so a user who accepts an
   AI card unedited, then later fixes a typo, leaves it counted as `accepted_unedited`. Sources
   (PRD L120, F-01 Phase 3) say the marker "measures the moment of acceptance, not later
   curation" — so this is *intended*. Confirm the plan states this explicitly as the oracle for
   gap B.5.2.
