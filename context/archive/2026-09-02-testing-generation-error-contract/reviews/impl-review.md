<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Kontrakt błędów generowania

- **Plan**: context/changes/testing-generation-error-contract/plan.md
- **Scope**: Phase 6 of 6 (full plan — all phases complete)
- **Date**: 2026-09-03
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations
- **Triage**: complete — F1 fixed; F2 recorded as lesson (code fix deferred to Phase 2); F3 skipped (accepted deviation)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

- `npx vitest run` — 18 files / 171 tests green (59 in the 3 new files).
- `npm run lint` — clean.
- `npx astro check` — 0 errors, 0 warnings.
- pgTAP (`npm run db:test`) not run here (needs `supabase start`); relying on recorded evidence in `## Progress` (commit afb322f: `Files=3, Tests=24, PASS`).
- Diff scope (99585e1..HEAD): 3 new test files, 1 new pgTAP file, `.gitignore`, `test-plan.md`, `contract-surfaces.md`, `plan.md`/`change.md`. **No production source touched** — `client.ts`, `generations.ts`, `service.ts`, `GenerateView.tsx`, `parse.ts` unchanged. No `package.json`, CI, or `vitest.config` drift.
- Oracle cross-check: status ladder (401/503/400-no-`issues`/429/502), ZDR fallback semantics, `finish_reason:"length"` → 502, `AbortError` → 502 all match `context/archive/2026-08-25-first-gated-generation/plan.md` §Phase 3–4. Assertions are behavioral (mutual difference + non-emptiness of instruction-bearing messages), not equality to imported constants — no mirror tests.
- pgTAP CHECK names and `generation_status` enum verified against `supabase/migrations/20260826140000_generation_reservation.sql`; `error_code` value list in `contract-surfaces.md` matches the union of `OpenRouterErrorCode` + `GenerationParseErrorCode` + service `"unknown"`.

## Findings

### F1 — `.gitignore` ignores all of `reports/`, plan scoped it to `reports/mutation/`

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: .gitignore:34
- **Detail**: Phase 5 plan says "Raport HTML w `reports/mutation/` — również efemeryczny, dopisany do `.gitignore`". The implementation added a bare `reports/` line, which would also silently ignore any future top-level `reports/` directory unrelated to Stryker. Benign today (no other `reports/` use), but broader than the plan intended.
- **Fix**: Narrow the entry to `reports/mutation/` (keep `.stryker-tmp/` and the two `stryker*.conf` lines as-is).
- **Decision**: FIXED — `.gitignore` line changed from `reports/` to `reports/mutation/`.

### F2 — Q3 orphan-`pending`-row debt not captured in `lessons.md`, skip not recorded in `## Progress`

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/testing-generation-error-contract/plan.md (Progress, Phase 6)
- **Detail**: The plan flags the "double failure → orphan `pending` row that counts to the daily limit forever" twice as a `lessons.md` / Phase 2 candidate (§What We're NOT Doing; Phase 6 item 6). Phase 6 item 6 says the outcome should be "append-only wpis wg formatu pliku, **albo świadome pominięcie odnotowane w `## Progress`**". `lessons.md` has no such entry and Progress records no explicit skip decision. The debt is not lost (it lives in the plan's "What We're NOT Doing" and in a `generations.test.ts` comment), but the plan's own bookkeeping rule for the optional item wasn't followed.
- **Fix**: Either add a short `lessons.md` entry for the orphan-`pending` class of bug, or add one line under Phase 6 Progress noting the conscious skip and that it is tracked as a Phase 2 candidate.
- **Decision**: ACCEPTED-AS-RULE: "Osierocony wiersz `pending` po podwójnej awarii generowania" appended to `context/foundation/lessons.md` (Rule / Applies-to left as PLACEHOLDER for the user). Code fix deliberately not applied — repair stays a Rollout Phase 2 candidate per the plan's "What We're NOT Doing".

### F3 — pgTAP uses `throws_like` with constraint-name match instead of the plan's `throws_ok`

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; no change likely needed
- **Dimension**: Plan Adherence
- **Location**: supabase/tests/generations_error_contract.test.sql:16
- **Detail**: Plan Phase 4 specifies "po jednej na `throws_ok` / `lives_ok`". The file uses `throws_like(sql, '%generations_source_text_hash_format%', ...)` for the four negative cases. This is a *stronger* assertion than bare `throws_ok` — it pins the specific CHECK that must fire, so a test can't pass because some unrelated constraint threw. Deviation from the letter of the plan, improvement in substance.
- **Fix**: No change needed — keep `throws_like`. Noting only because it diverges from the written plan text.
- **Decision**: SKIPPED — deviation accepted; `throws_like` with constraint-name match is stronger than the plan's `throws_ok`.
