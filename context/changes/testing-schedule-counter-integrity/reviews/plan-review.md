<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Test Rollout Phase 3 — Schedule & Counter Integrity

- **Plan**: `context/changes/testing-schedule-counter-integrity/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-04
- **Verdict**: REVISE (near-SOUND — one targeted fix, rest observations)
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

15/15 paths ✓, symbols ✓ (`.strict()` reviews.ts:20, `applyReviewGrade` 9-field payload
service.ts:134-144, `updateFlashcard` no-rpc service.ts:147-171, `least()` clamp migration
20260826141500, target test names all exist: flashcards/service.test.ts:196, [id].test.ts:24,
reviews.test.ts:79), brief↔plan ✓. One mismatch: test-plan §4 says "5 suit w supabase/tests/"
but the directory holds 4 files.

## Findings

### F1 — recount pgTAP extension: insertion point and role unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness / Blind Spots
- **Location**: Phase 2 — Changes Required #3
- **Detail**: Plan said "extend plan(9) → plan(9+k)" / "set plan(N) last" but never specified WHERE
  in the 155-line file the new cases go or which DB role they run under. The existing file mutates
  gen1 (:97, :129), switches to user B at :131, then `set local role postgres` at :134 and runs its
  last assertions as superuser. Appending the new cases after those → they execute as `postgres`,
  bypassing RLS + `security invoker` caller-scoping; the clamp math still passes, masking the loss.
- **Fix**: Specify insertion before the isolation block (~line 120, still `authenticated` as user
  A), fresh generation/flashcard UUIDs, role context stated explicitly.
- **Decision**: FIXED (Fix in plan — added "Placement & role" paragraph to Phase 2 change #3)

### F2 — §4 suite-count edit perpetuates a pre-existing miscount

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Changes Required #5
- **Detail**: Plan edited §4 Notes "5 suit" → "6 suit", but `supabase/tests/` holds 4 files
  (matching the plan's own Current State Analysis). Adding `review_queue.test.sql` makes 5, not 6.
- **Fix**: Set the cell to "5 suit"; note the "5" was already stale (counted 4).
- **Decision**: FIXED (Fix in plan — target corrected to "5 suit" with the stale-count note)

### F3 — No execution-level coverage that the real applyReviewGrade emits the SQL the pgTAP hand-writes

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details / Phase 1 #3
- **Detail**: Vitest layer asserts the payload against a stub; `review_queue.test.sql` hand-writes
  the guarded UPDATE, tied to `service.ts` only by comment. A service drift (wrong table, dropped
  `.eq("user_id")`, `.lte`→`.eq`) that still builds a valid payload passes both layers. Plan
  accepts this (OQ5: no Vitest-vs-Postgres harness) but didn't record the residual risk.
- **Fix**: Add a §7 entry recording the mirror-by-comment drift risk.
- **Decision**: FIXED (added 4th §7 bullet "Wykonawcza równoważność SQL applyReviewGrade ↔ pgTAP"
  in Phase 2 change #6; count updated three→four)

### F4 — OQ9 / gap B.5.2 disposition not stated in the plan body

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: What We're NOT Doing
- **Detail**: "An edit cannot change source/generation_id" + "should an edit promote ai→ai_edited"
  are handled implicitly (existing trigger + key-set assertion) but not stated in "What We're NOT
  Doing" — left to deferred.md (written last).
- **Fix**: Add a "What We're NOT Doing" bullet citing the existing coverage.
- **Decision**: FIXED (Fix in plan — bullet added to "What We're NOT Doing")

## Triage Summary

- Fixed: F1 (Fix in plan), F2 (Fix in plan), F3 (§7 entry), F4 (Fix in plan)
- Verdict after fixes: SOUND — all findings resolved in the plan; ready for `/10x-implement`.
