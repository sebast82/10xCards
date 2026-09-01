<!-- PLAN-REVIEW-REPORT -->
# Plan Review: SRS Review Session (S-05)

- **Plan**: context/changes/srs-review-session/plan.md
- **Mode**: Deep
- **Date**: 2026-09-02
- **Verdict**: REVISE (SOUND after fixes)
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

15/15 paths ✓. Symbols verified: `Grade` accepts `1 | 2 | 3 | 4` (checked with `tsc` 5.9.3 — the boundary Zod union is fine, no explicit `Rating` mapping needed); `reps += 1` is unconditional in `AbstractScheduler.init` for every grade including Again (the `reps`-guarded UPDATE is a sound optimistic-concurrency guard); `supabase-stub.ts` shape confirmed missing `lte`/`order`/`limit`/`range`; `AppNavigation.astro` renders `navigationItems` data-driven (no component change needed). brief↔plan consistent. `## Progress` mechanical contract ✓ (one heading, 5 phases matched, every success-criteria bullet mapped, no stray checkboxes in phase bodies).

## Findings

### F1 — Phase 1 automated gate depends on a Phase 2 change

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 (tests) vs Phase 2 §2 (stub extension)
- **Detail**: Phase 1's `service.test.ts` needs `lte`/`order`/`range` on `SupabaseStub`, which was added in Phase 2 §2. Phase 1 Success Criterion 1.1 (`npm test` green) is unreachable in isolation. The plan flagged it ("land both together") but left the phase split intact, tripping `/10x-implement <id> phase 1` at its own gate.
- **Fix**: Move the `SupabaseStub` extension into Phase 1 as a new change item; renumber Phase 2.
- **Decision**: FIXED — moved stub extension to Phase 1 §4; Phase 2 route tests renumbered to §2; Implementation Approach + Phase 2 criterion 2.1/2.4 + Progress 2.1/2.4 synced.

### F2 — GET response shape stated three ways

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1, Phase 2 §1 (GET), Phase 3 §2
- **Detail**: Phase 1 types `getReviewQueue → Promise<ReviewCard[]>` (bare array); Phase 2's GET snippet serializes that array but annotates the body as `{ cards: ReviewCard[] }`; Phase 3's island parses `{ cards: [...] }`. Copying the Phase 2 snippet verbatim ships a bare array and the island's parse fails.
- **Fix**: Route wraps — `json({ cards: await getReviewQueue(...) }, 200)`; service keeps returning `ReviewCard[]`.
- **Decision**: FIXED — Phase 2 GET contract now wraps in the route; Key Discoveries envelope note updated to call out the GET exception.

### F3 — Keyboard useEffect: stale-closure + react-compiler lint unaddressed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §2 (Keyboard bullet) / Critical Implementation Details
- **Detail**: "Attach once, clean up on unmount" closes over stale `status`/`queue`, so `1`–`4` grades the mount-time card. `react-compiler/react-compiler` and `react-hooks/exhaustive-deps` are both `error` in `eslint.config.js:56-58`, and there is zero `useEffect` precedent in `src/`.
- **Fix**: Specify the mechanism — re-subscribe per transition (effect keyed on `status` + current card id) or one subscription reading through a ref mirror.
- **Decision**: FIXED via "re-subscribe per transition" — effect keyed on `status` + `currentCard.id`; Critical Implementation Details and the Phase 3 Keyboard bullet both updated, with an explicit warning against `[]` deps and a note that the two lint rules would catch it.

### F4 — Interval labels frozen at fetch time; preview↔applyGrade parity unverified

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 (intervals), Phase 5
- **Detail**: `ReviewCard.intervals` is built once with GET-time `now`; late cards in a long session show labels computed against a stale `now` while the write uses POST-time `applyGrade`. Practically small, but unstated. Nothing asserts `scheduler.repeat()` (preview) equals `scheduler.next()` (applyGrade) for a given grade.
- **Fix**: Add a Phase 5 parity assertion; note the fetch-time limitation in "What We're NOT Doing".
- **Decision**: FIXED — Phase 5 §2 is a new `preview()`/`applyGrade()` parity test (criterion 5.2, Progress 5.2, Testing Strategy bullet); "What We're NOT Doing" gains the fetch-time-approximation line.

### F5 — "Karta N z M" denominator grows on re-fetch; plan body implies it's fixed

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Desired End State / Phase 3 §2 (`sessionTotal`)
- **Detail**: Desired End State shows "Karta 3 z 12" as if M is fixed; the brief's Open Risks admits `sessionTotal` is a running denominator. `/10x-impl-review` checks build↔plan and the growing M would read as drift.
- **Fix**: One clarifying sentence in Desired End State.
- **Decision**: FIXED — Desired End State now states M = seen + remaining queue and grows across re-fetches by design.

## Triage summary

- **Fixed**: F1, F2, F3 (re-subscribe per transition), F4, F5 — all 5
- **Skipped / Accepted / Dismissed**: none

Verdict after fixes: **SOUND** — the two Plan Completeness warnings and the keyboard blind spot are resolved in the plan text; the remaining observations are documented rather than left implicit.
