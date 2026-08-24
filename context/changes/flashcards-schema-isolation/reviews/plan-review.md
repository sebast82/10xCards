<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Schemat fiszek i izolacja danych per użytkownik — Implementation Plan

- **Plan**: context/changes/flashcards-schema-isolation/plan.md
- **Mode**: Deep
- **Date**: 2026-08-24
- **Verdict**: SOUND
- **Findings**: 0 critical, 0 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | PASS |

## Grounding
Grounding: 5/5 paths ✓, 3/3 symbols ✓, brief↔plan ✓

## Findings

### F1 — Source column is not actually immutable

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 1 — Tabela flashcards; Phase 2 — Test polityk RLS
- **Detail**: The plan repeatedly says the source flag is immutable and part of the contract, but the UPDATE policy only checks that the row belongs to the same user. There is no `with check` guard, trigger, or check constraint preventing `source` from being rewritten to a different enum value. That means the plan's end state says “source remains invariant” while the database schema still permits mutation on the same user’s records.
- **Fix**: Add a database-level invariant such as a trigger or update guard that blocks `source` changes after insert, and include that expectation in the pgTAP checks. This keeps the contract aligned with the product rule instead of leaving it as an app-level convention only.
- **Decision**: FIXED

### F2 — Production migration has no rollback or drift safety path

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 4 — Powiązanie i wypchnięcie migracji
- **Detail**: The plan correctly calls out that `db push` is not reversible and requires `--dry-run`, but it does not define a rollback or drift-detection path if the remote project is already ahead of local history, a migration fails halfway, or the schema differs from the intended one. That is a real deployment risk for a production database, especially because the plan is making a schema commitment that is supposed to be synchronized across all environments.
- **Fix**: Add a preflight step that checks remote migration ancestry and a documented rollback plan (e.g., disable new code, revert migration, or repair migration status) before executing the push. The plan should also state what to do when `db push --dry-run` shows anything other than exactly one new migration.
- **Decision**: FIXED

═══════════════════════════════════════════════════════════
  PLAN REVIEW: Schemat fiszek i izolacja danych per użytkownik — Implementation Plan
  Mode: Deep  |  Date: 2026-08-24
  Findings: 0 critical 0 warnings 0 observations
═══════════════════════════════════════════════════════════

  End-State Alignment    PASS    ✅
  Lean Execution         PASS    ✅
  Architectural Fitness  PASS    ✅
  Blind Spots            PASS    ✅
  Plan Completeness      PASS    ✅

  Grounding: 5/5 paths ✓, 3/3 symbols ✓, brief↔plan ✓
  ► Overall: SOUND

═══════════════════════════════════════════════════════════
  WARNING FINDINGS ⚠️
═══════════════════════════════════════════════════════════

  F1 — Source column is not actually immutable
  ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
    Severity:  ⚠️ WARNING
    Impact:    🔎 MEDIUM — real tradeoff; pause to reason through it
    Dimension: End-State Alignment
    Location:  Phase 1 — Tabela flashcards; Phase 2 — Test polityk RLS

    Detail:
    The plan repeatedly says the source flag is immutable and part of the
    contract, but the UPDATE policy only checks that the row belongs to the
    same user. There is no `with check` guard, trigger, or check constraint
    preventing `source` from being rewritten to a different enum value.
    That means the plan's end state says “source remains invariant” while the
    database schema still permits mutation on the same user’s records.

    Fix: Add a database-level invariant such as a trigger or update guard
         that blocks `source` changes after insert, and include that
         expectation in the pgTAP checks.

  F2 — Production migration has no rollback or drift safety path
  ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
    Severity:  ⚠️ WARNING
    Impact:    🔬 HIGH — architectural stakes; think carefully before deciding
    Dimension: Blind Spots
    Location:  Phase 4 — Powiązanie i wypchnięcie migracji

    Detail:
    The plan correctly calls out that `db push` is not reversible and
    requires `--dry-run`, but it does not define a rollback or drift-detection
    path if the remote project is already ahead of local history, a migration
    fails halfway, or the schema differs from the intended one. That is a
    real deployment risk for a production database, especially because the plan
    is making a schema commitment that is supposed to be synchronized across all
    environments.

    Fix: Add a preflight step that checks remote migration ancestry and a
         documented rollback plan (e.g., disable new code, revert migration, or
         repair migration status) before executing the push. The plan should also
         state what to do when `db push --dry-run` shows anything other than
         exactly one new migration.
═══════════════════════════════════════════════════════════
