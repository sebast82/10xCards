# Deferred-item register — testing-schedule-counter-integrity

Every research Open Question (`research.md` §Open Questions) and where it landed, so a future
contributor does not re-litigate. Dispositions: **resolved in plan** (decided, test written),
**→ §7** (deliberately-not-tested entry in `context/foundation/test-plan.md`), **out of scope**
(no test, no §7 entry — the reasoning lives here / in the plan body).

## Risk #3 — schedule state

| # | Open Question | Disposition | Pointer |
| --- | --- | --- | --- |
| 1 | Lower bound on `due` a test may assert? | resolved in plan — no absolute bound asserted; the write-payload-equals-`applyGrade` comparison sidesteps needing one | plan "What We're NOT Doing" bullet 3; `reviews/service.test.ts` "persists every schedule field…" |
| 2 | Timezone / "granice czasu i strefy czasowej" | → §7 | test-plan §7 "Strefa czasowa w kolejce powtórek" |
| 3 | Legitimate re-grade of the same card within one session | resolved in plan — Phase 3 does not change the queue to exclude just-graded cards; it proves a legitimate second grade yields a consistent row | plan "What We're NOT Doing" ("Not changing the review queue…"); `review_queue.test.sql` `reps`-guard sequence |
| 4 | `difficulty` lower bound: 0 or 1? | out of scope — mooted; the payload-equals-`applyGrade` form removes the need for a boundary value, and the schema domain (`min(0).max(10)`) rejection is already pinned by `schedule-state.test.ts` | plan "What We're NOT Doing" bullet 3 |
| 5 | Real-DB layer for `applyReviewGrade`, or pgTAP-on-queue + stub-on-write? | resolved in plan — new `review_queue.test.sql` (no Vitest↔Postgres harness exists); residual mirror-by-comment drift risk recorded | plan Phase 1 change #3; test-plan §7 "Wykonawcza równoważność SQL `applyReviewGrade` ↔ pgTAP" |

## Risk #6 — generation counters

| # | Open Question | Disposition | Pointer |
| --- | --- | --- | --- |
| 6 | "Reconstructable" = raw `count(*)` or `least(count, generated_count)`? | resolved in plan — `least(count, generated_count)`; the clamp is the intended behaviour, asserted directly | plan Phase 2 change #3; `recount_generation_acceptance.test.sql` clamp regression |
| 7 | `for update` lock — testable or a §7 entry? | → §7 — single-session pgTAP cannot reproduce the race; a presence assertion is brittle | test-plan §7 "Współbieżność `recount` (`for update`)" |
| 8 | What population does the aggregate "75%" query run over? | → §7 — no such query exists in code; the per-generation `recount` invariant is what Phase 3 pins | test-plan §7 "Populacja zagregowanego kryterium „75%"" |
| 9 | Should an edit ever promote `ai` → `ai_edited`? | out of scope — `source` is frozen at first save by design (PRD L120, F-01 Phase 3: marks the moment of acceptance, not later curation); coverage = DB immutability trigger (`rls_flashcards.test.sql:152`) + `updateFlashcard` key-set assertion + the new `rpcCalls == []` guard | plan "What We're NOT Doing" (edit cannot change `source`/`generation_id`); `flashcards/service.test.ts` / `api/flashcards/[id].test.ts` `rpcCalls` assertions |
