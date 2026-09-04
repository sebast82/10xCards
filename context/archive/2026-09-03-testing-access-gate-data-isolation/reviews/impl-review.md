<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Bramka dostępu i izolacja danych w CI

- **Plan**: context/changes/testing-access-gate-data-isolation/plan.md
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-09-04
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation
- **Triage**: F1 FIXED, F2 FIXED (2026-09-04)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Stale §4 tooling row: "not a CI step / two tests exist"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/foundation/test-plan.md:96
- **Detail**: The §4 "Narzędzia" table row for `polityki i procedury bazy` still reads
  "dwa testy istnieją; **nie jest krokiem CI** — bramkę wpina §3 Faza 2". After Phase 1
  the `db-tests` job runs `supabase test db` on every PR (and per Phase 4 / §6.4 it is in
  `master` required status checks), and after Phase 2 there are more than two suites
  (`rls_generations.test.sql` added, `rls_flashcards` `plan(10)`→`plan(22)`). Phase 4's
  change #4 synced §3 (row → `complete`) and §5, but missed this §4 cell. A contributor
  reading §4 is told the gate does not exist.
- **Fix**: Update the §4 cell to note the suite runs in CI via the `db-tests` job (PR-only,
  in `master` required checks) and drop the "dwa testy" count, mirroring the §3 row #2
  wording.
- **Decision**: FIXED — §4 cell now reads "5 suit w `supabase/tests/`; **krok CI** — job `db-tests` (PR-only, w required status checks `master`), patrz §6.4"; prettier re-checked.

### F2 — "reddens on drop OR weakening" overclaims which assertion catches a dropped write policy

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/foundation/test-plan.md:222-226 (also plan.md "Critical Implementation Details" / manual-verification 2.4–2.5)
- **Detail**: The O2-13 write-isolation block neutralises the SELECT policy, then asserts a
  cross-account `UPDATE/DELETE ... RETURNING 1` affects 0 rows. If the write policy is
  *weakened* to `using (true)` the assertion correctly reddens. If the write policy is
  *dropped* entirely, Postgres default-deny still yields 0 affected rows, so that specific
  assertion stays green — only the paired positive assertion ("user A can update/delete own
  row") reddens. Coverage of the block as a whole is complete (positive + negative), but the
  plan/cookbook phrasing "goes red on the write-isolation assertion ... is dropped **or** its
  `using` clause is weakened" is imprecise about the drop case. No code change needed; the
  test suite catches both regressions.
- **Fix**: Add a half-line to §6.4 noting that on full policy *removal* it is the positive
  write assertion that reddens (default-deny), while *weakening* reddens the isolation
  assertion — the pair together is the guard.
- **Decision**: FIXED — §6.4 O2-13 bullet now spells out the removal-vs-weakening division of labour and requires the paired positive assertion; prettier re-checked. (plan.md left as historical record.)
