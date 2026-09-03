<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Kontrakt błędów generowania — Implementation Plan

- **Plan**: context/changes/testing-generation-error-contract/plan.md
- **Mode**: Deep
- **Date**: 2026-09-02
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 0 critical, 3 warnings, 3 observations (all fixed in triage)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | WARNING |
| Architectural Fitness | PASS (1 observation) |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

10/10 paths ✓, 7/7 symbols ✓ (ERROR_MESSAGES, upstreamCode, isZdrRouteMissing, 3× CHECK constraint,
DAILY_GENERATION_LIMIT, MODEL, GENERATE_TIMEOUT_MS), brief↔plan ✓. Progress↔Phase: 6 phases, all
Success Criteria bullets mapped to Progress rows, well-formed. Three pgTAP CHECK constraints
(`generations_source_text_hash_format`, `generations_error_code_shape`,
`generations_error_code_only_when_failed`) verified against migrations — exact match.

## Findings

### F1 — Expected error-message values sourced by importing the module under test

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 (manual verif.), Phase 2 (verif. 2.6), Phase 3 (verif. 3.7), Phase 6 §6.1/§6.2
- **Detail**: Plan permitted importing `ERROR_MESSAGES` from `client.ts` / `parse.ts` / `service.ts` and
  asserting equality — a tautology that survives any wording regression, contradicting the plan's own
  oracle rule and CLAUDE.md's mirror-test anti-pattern. The cited oracle (archive S-02 plan) was grepped
  and does NOT contain the Polish user-facing strings; the genuine oracle (test-plan §2, team-accepted)
  is the behavioural property: non-empty + mutual distinctness for instruction-carrying classes. Risk
  amplified because Phase 6 enshrines the P1/P2 pattern as the project cookbook (§6.1/§6.2).
- **Fix**: Behavioural assertions made primary — mutual inequality across
  {timeout, network, rate_limited, truncated, no_proposals} + non-empty, compared against each other;
  at most one lightweight "constant routed through unchanged" check per layer; exact-text assertions
  pinned to inline literals from the S-02 ladder only where S-02 specifies them (status codes, envelope
  keys, absence of `issues`). §6.1/§6.2 intents rewritten to describe this split.
- **Decision**: FIXED (Fix in plan)

### F2 — No failure-class coverage matrix; phase case-lists use inconsistent labels

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Desired End State; Phase 1 / Phase 2 case lists
- **Detail**: End State promised "każda z klas A–I ... na co najmniej jednej warstwie" but Phase 1 listed
  A/B/C1/C2/D, Phase 2 listed A/B/C1/C2/E/F/I; classes G, H, J appeared nowhere by letter and there was
  no traceability table, so an implementer could not tell whether G/H/J were their responsibility.
- **Fix**: Added `### Pokrycie klas awarii (traceability)` table (class → trigger → layer/file →
  assertion) to Implementation Approach; reconciled A–J labels; stated G/H are covered by the untouched
  `parse.test.ts` and J is out of scope (200, not a failure path). Desired End State bullet rewritten to
  reference the matrix.
- **Decision**: FIXED (Fix in plan)

### F3 — Phase 5 Stryker: install method and config persistence left unresolved

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 5 — Changes Required #1; Success Criteria 5.3
- **Detail**: The phase offered "devDependency albo npx" and "jeśli zacommitowane: stryker.conf.json ...";
  success criterion 5.3 + the config bullet implied a committed `stryker.conf.json` + two new devDeps —
  scope creep for what CLAUDE.md wants kept as a selective, ad-hoc, non-CI gate.
- **Fix**: Pinned to `npx --yes @stryker-mutator/core run --testRunner vitest --mutate "..."`, ephemeral
  config (`.gitignore` or deleted after), no devDependency, no committed config. Added a `git status`
  clean-tree check to criterion 5.1; updated Manual Testing Steps and Migration Notes to match.
- **Decision**: FIXED (Fix in plan)

### F4 — Phase 2 mutable-key 503 branch not among research's verified paths

- **Severity**: 🔷 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Critical Implementation Details
- **Detail**: Research verified `vi.mock("astro:env/server")` unblocks the import and that 401/503
  (`supabase: null`)/400 pass, but not the *mutation* of a `vi.hoisted` key object between tests with the
  route's imported binding reflecting the change. No fallback was named.
- **Fix**: Added fallback to the phase — mock factory reads a module-scoped `let` reset in `beforeEach`,
  or the empty-key case moves to its own file with its own factory return; noted the choice changes only
  mechanics, not assertions.
- **Decision**: FIXED (Fix in plan)

### F5 — Phase 4 plan(N) count inconsistent within the phase

- **Severity**: 🔷 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 — Overview / Contract / assertion list
- **Detail**: Contract said `plan(3)`, Overview "trzy asercje", but the bullet list enumerated 4–5
  assertions with a parenthetical "albo plan(4)". Criterion 4.2 makes the count load-bearing.
- **Fix**: Rewrote the assertion list as exactly 5 numbered `throws_ok`/`lives_ok` entries; set
  `select plan(5)` in Contract; updated Overview, criterion 4.2, Progress row 4.2, Desired End State and
  Testing Strategy. Named the NOT NULL seed columns explicitly.
- **Decision**: FIXED (Fix in plan)

### F6 — contract-surfaces.md stale on the exact columns Phase 4 pins

- **Severity**: 🔷 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: What We're NOT Doing; Phase 6
- **Detail**: `docs/reference/contract-surfaces.md` §Nazwy w danych has no `public.generations` entry, so
  `status` / `error_code` (the columns Phase 4's pgTAP makes executable spec for) are undocumented. Plan
  excluded the register entirely though Phase 6 already does doc-sync.
- **Fix**: Added Phase 6 step 5 — append a `public.generations` column table (status, error_code + three
  CHECK shapes) to the register; other register drift stays explicitly out of scope. Updated the
  "What We're NOT Doing" bullet, Success Criteria, and Progress (new row 6.6).
- **Decision**: FIXED (Fix in plan)

## Triage Summary

- **Fixed**: F1, F2, F3, F4, F5, F6 (6)
- **Verdict after fixes**: REVISE → SOUND
