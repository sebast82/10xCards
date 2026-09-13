<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Code Review Evals (promptfoo)

- **Plan**: context/changes/code-review-evals/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-09-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Automated verification (re-run 2026-09-11)

| Check | Result |
|-------|--------|
| 1.1 / 2.6 / 3.4 `npm test` (package) | PASS — 124/124 tests |
| 1.2 `npm run typecheck` (package) | PASS |
| 1.3 `npm run build`, no `dist/testing/` | PASS |
| 1.4 `new MockLanguageModelV4` only in `src/testing/mock-model.ts` | PASS |
| 2.1 evals install from lockfile | NOT RE-RUN (`npm ci` ≈ 2.4 GB); `npm ls promptfoo` in evals resolves `promptfoo@0.123.0` |
| 2.2 / 3.1 `npm run typecheck` (evals) | PASS |
| 2.3 / 3.2 `npm run eval:smoke` without `OPENROUTER_API_KEY` | PASS — exit 0, 1/1 on `react-19-migration` |
| 2.4 no `ai` imports under `evals/*.ts` | PASS — no matches |
| 2.5 `npm ls promptfoo` in the package | PASS — `(empty)`, exit 1 |
| 3.3 `git ls-files --eol` on `pr.diff` | PASS — `i/lf w/lf attr/text eol=lf` |

Manual checks 3.5–3.8 are backed by the paid-run notes in `change.md` and `follow-ups/review-fixes.md`.
1.5 (CLI run) and 2.7 (README on a fresh path) have no artefact in the diff; the CLI tests and the smoke
run reproduce what they cover.

## Findings

### F1 — Seeded-flaw fixtures enter the CI review diff ahead of `src/`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: .github/actions/code-review/action.yml:86
- **Detail**: The diff pathspec excludes `context` and `**/package-lock.json`, not
  `packages/code-reviewer/evals/fixtures`. Any PR that changes a fixture sends its `pr.diff` (18,802 chars of
  deliberately flawed code, seeded XSS included) to the CI reviewer as if it were the PR's own code. `git diff`
  lists `packages/code-reviewer/evals/` before `packages/code-reviewer/src/`, so fixtures use the 60,000-char
  budget (`src/prompts/reviewer.ts:54` truncates) before the code actually under review. The plan chose this on
  purpose for the PR that adds the fixture ("What We're NOT Doing"), and for that PR it fits. The plan did not weigh
  what happens next: the security-calibration follow-up (ci-cd-code-review F1) will add more flawed fixtures. Each one
  pushes toward `ai-cr:failed` and crowds out real code.
- **Fix A ⭐ Recommended**: Queue it for the change that adds the next fixture: add
  `':(exclude)packages/code-reviewer/evals/fixtures'` to the first pathspec and extend the comment at L73-77.
  - Strength: Keeps this plan's explicit "no CI action change" guardrail; the one existing fixture fits the budget.
  - Tradeoff: Someone has to remember it; if they forget, the next fixture PR gets a noisy advisory review.
  - Confidence: HIGH — the same exclusion mechanism already handles `context/` and lockfiles.
  - Blind spot: Whether the PR for these commits is already open (the commits sit on local `master`).
- **Fix B**: Add the exclusion now, with a plan addendum.
  - Strength: Closes the gap before a second fixture exists; it is one line.
  - Tradeoff: Overrides a scope decision the plan made explicitly, and fixture edits then get no AI review at all.
  - Confidence: HIGH — mechanical change.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — queued as `impl-review F1` in follow-ups/review-fixes.md

### F2 — README privacy note is wrong on two counts

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/code-reviewer/evals/README.md:56-57
- **Detail**: It says promptfoo stores "full diffs" and does so "(even with `--no-write`)". But the provider loads
  the diff from disk, and promptfoo's vars and rendered prompt carry only the fixture name, so no diff is stored
  (a review may still quote snippets). `--no-write` skips the DB migrations and uses an in-memory `Eval`
  (promptfoo `dist/src/index.js:18333, 18584-18590`), which is what line 29 of the same README already says
  ("nothing stored"). Both claims come from research §191, written before the decision that fixture text never
  travels as a promptfoo var; the plan's README contract (L343) copied them over.
- **Fix**: Reword to: "`npm run eval` stores every run — reviews, judge reasons and fixture names (diff text only
  where a review quotes it) — in a local SQLite database under `~/.promptfoo`; `eval:smoke` (`--no-write`) stores
  nothing."
- **Decision**: FIXED — README.md privacy note reworded (no diffs stored; `--no-write` stores nothing)

### F3 — `flaw_default_props` ground truth understates the consequence

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/code-reviewer/evals/cases.ts:27-28
- **Detail**: The rubric says the `TypeError` "crashes the panel". The fixture has no error boundary (no
  `ErrorBoundary`/`componentDidCatch` in `pr.diff`), and React 19 unmounts the whole root on an uncaught render
  error, so the entire app goes blank. The throw also happens only once cards load (`formatDueDate` runs per
  visible card). Follow-up F1 (`follow-ups/review-fixes.md`) is already rethinking this rubric, and by its own
  reasoning this should not be retuned now.
- **Fix**: Add these two facts to follow-up F1 in `follow-ups/review-fixes.md` so the rubric redesign states the
  correct consequence.
- **Decision**: FIXED — consequence facts added to follow-up F1 in follow-ups/review-fixes.md; cases.ts unchanged

### F4 — Reported cost is final-step only while tokens cover all steps

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/code-reviewer/evals/provider.ts:83-86 (source: src/agent/reviewer.ts:71-74)
- **Detail**: `usage` is `result.usage` (the all-steps total), but `cost` comes from
  `result.finalStep.providerMetadata`, and `numRequests` is hard-coded to 1. The numbers agree today only because
  the reviewer has no tools and finishes in one step (`src/agent/tools.ts:3-5`). Add a tool and the eval
  under-reports cost at exactly the point where cost is most worth comparing. The "Adding a tool?" note in
  `tools.ts` mentions only `stopWhen`. The plan specified both sources.
- **Fix**: Extend the `tools.ts` "Adding a tool?" note: `runReview` reports final-step cost only, so sum
  `openrouter.usage.cost` over `result.steps` and set `numRequests` from `steps.length`.
- **Decision**: FIXED — `Adding a tool?` comment in src/agent/tools.ts extended (comment only)

### F5 — `loadFixture` error handling is weaker than its sibling `readInput`

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: packages/code-reviewer/evals/fixtures.ts:12-14
- **Detail**: `JSON.parse(readFileSync(…pr.json))` is not wrapped, so a malformed `pr.json` fails with a bare V8
  message ("… in JSON at position N") that does not name the fixture. Schema failures use `meta.error.message`
  (raw issue JSON). `src/run-cli.ts:14-20` wraps the read and parse with the path and uses `z.prettifyError`. Note:
  `zod` imported from `evals/` resolves promptfoo's own copy (4.6.2, while `src` uses 4.6.1), the same trap as `ai`.
- **Fix**: Wrap the read and parse in `try`/`catch` so the error reads `Fixture ${name}: cannot read pr.json: …`,
  and keep `zod` imports out of `evals/`.
- **Decision**: FIXED — pr.json read and parse wrapped with a fixture-named error in fixtures.ts; no zod import

### F6 — action.yml comment now says the package cannot cancel

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: .github/actions/code-review/action.yml:111-112
- **Detail**: "the package threads no abort signal into the model call" is out of date: `runReview`/`reviewCode`
  accept `abortSignal` now (`src/agent/reviewer.ts:46, 59`). It is only the CLI that passes none. A reader could
  conclude that cancelling needs library work first.
- **Fix**: Reword to "the CLI passes no abort signal to the model call". This can land together with F1.
- **Decision**: FIXED — action.yml:112 reworded to "the CLI passes no abort signal" (comment only)
