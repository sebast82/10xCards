<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Test Rollout Phase 3 — Schedule & Counter Integrity

- **Plan**: `context/changes/testing-schedule-counter-integrity/plan.md`
- **Scope**: Phase 1 + Phase 2 of 2 (full plan)
- **Date**: 2026-09-04
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Grounding

Changed-file set is exactly the plan's file list (10 files: 4 test files, 2 new pgTAP / 1 extended
pgTAP, `test-plan.md`, `deferred.md`, plan/change). No production code touched — test-only, as
intended. Automated criteria re-run this session: `npm test` 194 pass, `npm run db:test` 71 pass
(`review_queue` plan(16), `recount` plan(15) — both match), `npx astro check` 0 errors,
`npm run lint` clean. Cross-phase: the `recount` pgTAP extension inserts only fresh generation /
flashcard UUIDs before the isolation block; existing gen1/gen2 assertions and the final all-rows
CHECK assertion still hold (verified by the green run).

## Findings

### F1 — pgTAP assertion descriptions use Polish diacritics; sibling suites are ASCII-only

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `supabase/tests/review_queue.test.sql` (assertion description strings + comments; 32 diacritic chars)
- **Detail**: Every existing suite in `supabase/tests/` keeps the TAP-visible description string
  (3rd arg to `is` / `ok` / `results_eq` / `lives_ok`) ASCII-only — `generations_error_contract`,
  `rls_flashcards`, `rls_generations` have zero diacritics, and even
  `recount_generation_acceptance.test.sql`, which uses diacritics in *comments*, keeps its
  assertion strings ASCII ("usuniecie fiszki AI obniza licznik"). `review_queue.test.sql` breaks
  this: "kolejka zwraca dokładnie 50 wierszy", "najwcześniejsza karta A jest w kolejce", etc.
  `db-tests` is a required status check on `master`; non-ASCII in TAP diagnostic lines is a known
  source of parser fragility, though `supabase test db` parsed it fine locally.
- **Fix**: Rewrite the ~16 description strings (and, for full consistency, the comments) in
  `review_queue.test.sql` to ASCII, matching `recount_generation_acceptance.test.sql`'s style.
- **Decision**: FIXED — `review_queue.test.sql` rewritten ASCII-only (0 diacritic chars); `npm run db:test` re-run green (71 tests, plan(16)).

### F2 — §4 pgTAP suite-count cell kept at "5" rather than re-derived

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/foundation/test-plan.md` §4, pgTAP row Notes
- **Detail**: Plan Phase 2 change #5 flagged the "5 suit" cell as stale (it counted 4 actual files)
  and asked to "set it to the true post-change count: 5 (4 existing + review_queue)". The
  implementation left the number "5" and appended a parenthetical naming `review_queue.test.sql`.
  Net effect is correct — there are now genuinely 5 files — but the number was not re-derived, it
  coincidentally matched. Within intent; noted so a future reader knows the "5" is now accurate.
- **Fix**: None required. Optionally add a half-line noting the count was previously stale.
- **Decision**: SKIPPED — net effect correct; no change.

### F3 — ordering assertion oracle is DB-side-sort vs DB-side-sort

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/tests/review_queue.test.sql` (`results_eq` "kolejka oddaje wiersze w rosnącym porządku due")
- **Detail**: The ascending-`due` check compares `order by due asc` against `order by id asc` over
  a seed where `due` rises with the id index. Both sides are Postgres sorts, so a bug in Postgres's
  own `ORDER BY` cannot be caught — but that is not the risk. The assertion does catch the service
  dropping `.order("due")` or flipping to descending (the pgTAP hand-writes the query shape). The
  plan explicitly accepted this residual (research OQ5) and the impl adds the matching §7 entry
  "Wykonawcza równoważność SQL `applyReviewGrade` ↔ pgTAP". No action — recorded for completeness.
- **Fix**: None. Residual is documented in §7.
- **Decision**: SKIPPED — residual accepted by the plan (OQ5) and recorded in §7.

## Success Criteria

**Phase 1 Automated** (1.1–1.5): all pass — re-verified this session.
**Phase 1 Manual** (1.6–1.8): marked `[x]` with SHA 537cf55; user-attested at the gate.
**Phase 2 Automated** (2.1–2.6): all pass — re-verified this session; `test-plan.md` §3 row 3 =
`complete`, §6.5 TBD stub removed.
**Phase 2 Manual** (2.7–2.10): marked `[x]` with SHA 0824a7d; user-attested at the gate.
