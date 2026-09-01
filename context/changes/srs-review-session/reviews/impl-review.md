<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: SRS Review Session (S-05)

- **Plan**: context/changes/srs-review-session/plan.md
- **Scope**: Phases 1–5 of 5 (full plan)
- **Date**: 2026-09-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Space after reveal silently grades the card "Znowu"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/review/ReviewSession.tsx:207-224
- **Detail**: In `answer` state, focus sits on the first grade button ("Znowu · …") via the focus effect. The `document` `keydown` handler only intercepts `1`–`4`; `Space` and `Enter` fall through with no `event.preventDefault()`, so the browser's native button activation fires `handleGrade(1)`. A user who presses Space twice — once to reveal, once out of momentum — silently grades the card **Again**: `reps` increments, `due` collapses to ~1 minute, and on a review-state card `lapses` bumps. Reproduced in jsdom: a single Space press in `answer` state produces one grade POST. The plan's "gate handlers by current status" instruction did not anticipate native button activation on the focused control.
- **Fix**: In the `answer` branch of the keydown handler, call `event.preventDefault()` for `" "` and `"Enter"` before the `1`–`4` check, so the focused grade button cannot be keyboard-activated. Grading stays on `1`–`4` / click, matching the plan's stated input model.
  - Strength: Removes the accidental-grade class entirely; preserves the plan's "grade via 1–4 or click" contract; ~3 lines, local to one handler.
  - Tradeoff: A keyboard user can no longer activate the focused grade button with Enter/Space — a minor deviation from the standard button interaction, mitigated by the `1`–`4` keys which are the documented path and are announced in the live region.
  - Confidence: HIGH — reproduced; fix is contained.
  - Blind spot: None significant.
- **Decision**: FIXED — `preventDefault()` for Space/Enter added to the `answer` branch of the keydown handler (ReviewSession.tsx:211-215); regression test "does not grade the card when Space is pressed again after the reveal" added.

### F2 — Phase 5 guardrail manual checks unverified; change marked `implemented`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real open risk; the one hard PRD guardrail is behaviourally unverified
- **Dimension**: Success Criteria
- **Location**: context/changes/srs-review-session/plan.md Progress 5.4–5.6; context/changes/srs-review-session/manual-verification.md
- **Detail**: `GET https://10x-cards.sebger82.workers.dev/review` returns **404** — the last Worker deployment (2026-09-01 22:39 UTC) predates every S-05 commit. Manual checks 5.4 (local manual + AI card DB observation), 5.5 (full session on the deployed instance), and 5.6 (deployed ts-fsrs label parity — the F-01 inherited question) are unrun. The PRD guardrail "the review mechanism must not fail regardless of card source" has an automated regression guard (`service.test.ts`, `scheduler.test.ts`) but no behavioural evidence. `change.md` was set to `implemented` by explicit user choice (option A), with the debt recorded in `manual-verification.md` and the `change.md` notes. `/10x-archive` will surface 5.4–5.6 as warnings.
- **Fix**: Before `/10x-archive`: `git push` p1–p5 → Cloudflare auto-deploy, run one full review session on the Worker, record the DB observations + deployed short SHA + date in `manual-verification.md`, and flip 5.4–5.6 in `plan.md`.
  - Strength: Closes the only hard PRD guardrail for this slice and the F-01 parity question in one deploy.
  - Tradeoff: None — this is required work, only deferred.
  - Confidence: HIGH — the checklist is already scaffolded.
  - Blind spot: Whether ts-fsrs behaves identically on `workerd` is exactly what 5.6 exists to confirm; until it runs the parity is assumed, not shown.
- **Decision**: SKIPPED — accepted as tracked debt. `manual-verification.md` and `change.md` notes carry it; `/10x-archive` will warn on 5.4–5.6. Deploy + manual session to be run before archiving.

### F3 — Island `sessionTotal` state replaced with a derived value

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/review/ReviewSession.tsx:78-95, 268
- **Detail**: The Phase 3 contract lists `sessionTotal: number` as island state ("running denominator for 'karta N z M'"). The implementation has no such field and derives the denominator inline as `reviewedCount + queue.length`. Behaviour matches the Desired End State exactly — it grows when a re-fetch adds cards and is never a fixed "N of M" — and the derived form avoids a second source of truth. Documented drift, not a defect.
- **Fix**: None required. If the plan is later used as ground truth, note that the denominator is derived rather than stored.
- **Decision**: SKIPPED — derivation accepted as a cleaner implementation of the same behaviour.

### F4 — Unplanned edit to `FlashcardCollection.tsx` bundled into Phase 1

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/deck/FlashcardCollection.tsx:143-145
- **Detail**: Phase 1's commit (`a8d0d5e`) includes a one-line change to `FlashcardCollection.tsx` — `source: "manual"` → `source: "manual" as const`, with the setter call reflowed onto three lines. The file is referenced in the plan only as an empty-state precedent, not as a change target. The edit is a benign type-tightening; the full suite is green. Most likely a pre-existing working-tree edit swept into the phase commit by the touched-file discipline.
- **Fix**: None required. Confirm it was intentional; harmless either way.
- **Decision**: SKIPPED — benign type-tightening, already committed, left as-is.

## Automated success criteria (re-run 2026-09-02)

| Check | Result |
|-------|--------|
| `npm test` | PASS — 15 files, 111 tests |
| `npm run astro check` | PASS — 0 errors, 0 warnings |
| `npm run lint` | PASS |
| `npm run build` | PASS |
