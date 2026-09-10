<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Code Reviewer on ToolLoopAgent

- **Plan**: context/changes/tool-loop-agent/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-09-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Every planned item was reviewed and marked MATCH, with no DRIFT or MISSING items. The only extras are in-scope: the closing-tag escape handles letter case and whitespace, and the tests add a one-call assertion and `vi.resetModules()`. Nothing on the "What We're NOT Doing" list was violated. The dependency versions are unchanged (`ai@7.0.97`, `@openrouter/ai-sdk-provider@3.0.0`, `zod@4.6.1`). The plan edits in p2 and p3 are Progress ticks only, with no formatter spill-over (see lessons.md, "Nie formatuj pliku…").

## Automated verification (re-run 2026-09-11)

| Check | Result |
|---|---|
| Package `npm run typecheck` | PASS |
| Package `npm test` (run with `OPENROUTER_API_KEY=sk-bogus` exported, which also covers manual 3.6) | PASS: 4 files, 11 tests |
| Package `npm run build`: emits `index.js`, `cli.js` and `agent/reviewer.js`; no `*.test.*` in `dist/` | PASS |
| Import purity: `env -u OPENROUTER_API_KEY node -e "await import('./dist/index.js')"` | PASS: prints only `ok`, exit 0 |
| `process.(exit\|argv\|exitCode)` appears only in `src/cli.ts` | PASS |
| Root `npm run typecheck` | PASS: 0 errors, 87 files (the plan expected 88; the package `dist/` JS was probably counted too) |
| Root `npm run lint` | PASS |
| Root `npm test`, with no `packages/` files collected | PASS: 19 files, 195 tests, 0 package files |
| `npx eslint --no-warn-ignored packages/code-reviewer/src/index.ts` | PASS: exit 0, no output |
| `npx prettier --check packages/code-reviewer/src/index.ts` | PASS: exit 0 |

The manual items 2.5–2.8 need live OpenRouter calls. They were not re-run, so they are accepted as reported. Item 3.5 holds by construction: without the escape, the closing-tag count is 2 and the test fails.

## Findings

### F1 — Closing-tag neutralisation can be bypassed, and the test shares the implementation's regex

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: packages/code-reviewer/src/prompts/reviewer.ts:7, packages/code-reviewer/src/prompts/reviewer.test.ts:6,21
- **Detail**: `/<\/(code_to_review\s*)>/gi` handles letter case and trailing whitespace. These close-like variants pass through unchanged: `</ code_to_review>`, `< /code_to_review>`, `</code_to_review x>` and fullwidth `＜/code_to_review＞`. Opening tags are never neutralised. The test counts closing tags with the same pattern (`ANY_CLOSE`), so it can't see a bypass the code misses. It also never checks that the text after an injected tag survives, so an implementation that deleted the tail would still pass. The worst case is bounded: output is schema-constrained, so the damage is a manipulated review ("no issues"). The plan itself calls the framing a smoke check, not a guarantee.
- **Fix A ⭐ Recommended**: Widen the neutralisation to any tag-like `code_to_review` sequence, opening or closing (optional whitespace around `/`, attributes). Rewrite the test to assert with an independent, looser regex and to check that the text after the injected tag is still present.
  - Strength: `buildReviewPrompt` stays a pure, deterministic function. The exact-equality wiring test (`reviewer.test.ts:52-55`) and future promptfoo response caching both rely on that. It is a change of a few lines.
  - Tradeoff: It is still a blocklist. Lookalike characters and other framings stay possible, because delimiter defence is best-effort.
  - Confidence: MED — closes every demonstrated bypass, but can't enumerate everything a model might read as a close.
  - Blind spot: Nobody has checked whether current models actually treat `</ code_to_review>` as the end of the block. That needs the promptfoo injection eval.
- **Fix B**: Use a random boundary per call (`<code_to_review id="…">`) and name it in the user prompt.
  - Strength: An attacker can't predict the closing tag, so spelling variants stop mattering.
  - Tradeoff: The prompt becomes non-deterministic. That breaks the exact-equality wiring test and promptfoo caching, and it adds per-call state to a seam that is pure today.
  - Confidence: MED — a standard technique, but more moving parts for a local tool.
  - Blind spot: How well models respect nonce-labelled boundaries hasn't been evaluated.
- **Decision**: FIXED (Fix A): TAG_START lookahead neutralises opening and closing tag-like variants; test widened to 8 variants with an independent looser regex and a tail-survives check. The pre-fix implementation fails 5 of the 8.

### F2 — Vendored package skills are untracked but not ignored, and the symlinks use absolute paths

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: .gitignore:53-58, packages/code-reviewer/.agents/, packages/code-reviewer/.claude/
- **Detail**: The rules `.claude/skills/*` and `.agents/*` contain a slash, so they only match at the repo root. `skills-lock.json` has no slash, so it matches everywhere. The result is that the package's lock file is ignored while the skill folders it describes show up as `??`. The `.claude/skills/*` entries are symlinks to absolute paths (`/c/10xCards/packages/code-reviewer/.agents/skills/ai-sdk`), so a `git add packages/` would commit links that break on any other clone. The repo convention (the Polish comment at `.gitignore:46-52`) is that vendored skills are not tracked.
- **Fix**: Add `packages/*/.agents/*` and `packages/*/.claude/skills/*` next to `.gitignore:53-56`, with a one-line Polish comment. This keeps the `katalog/*` form the existing comment prescribes, so an exception can still be added later.
- **Decision**: FIXED: added packages/*/.agents/* and packages/*/.claude/skills/* to .gitignore; git status no longer lists them.

### F3 — The `reviewCode` seam has no call bounds and ships no types for the promptfoo consumer

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: packages/code-reviewer/src/agent/reviewer.ts:31-33, packages/code-reviewer/tsconfig.json, packages/code-reviewer/package.json:6
- **Detail**: `reviewCode(code, { agent? })` accepts no `abortSignal` or timeout, even though `agent.generate()` supports both. There is no cap on input size either, and the SDK's default `maxRetries: 2` can turn one bad request into three paid attempts. The build emits no `.d.ts` (`declaration` isn't set, and there is no `types` or `exports` field), so a TypeScript consumer of `dist/` gets no types. The original script had the same limits and nothing imports the library yet (Migration Notes). Each gap can be closed later without breaking callers.
- **Fix A ⭐ Recommended**: Record these as explicit requirements of the upcoming promptfoo change, in `change.md` Notes or `follow-ups/review-fixes.md`.
  - Strength: Respects this plan's behaviour-preserving scope. Each addition (an optional `abortSignal` field, `declaration: true`, a `types` field) is additive, so deferring costs nothing.
  - Tradeoff: The CLI keeps unbounded input and no timeout until then.
  - Confidence: HIGH — matches pre-change behaviour, and there are no consumers yet.
  - Blind spot: Haven't checked whether promptfoo's per-test timeout cancels the underlying HTTP request.
- **Fix B**: Add now: `abortSignal?: AbortSignal` in `reviewCode`'s options, passed through to `generate`, plus `declaration: true` and `"types": "dist/index.d.ts"`.
  - Strength: The seam is ready before the first consumer arrives.
  - Tradeoff: Scope creep past the approved plan. Picking an input cap without eval data would be a guess.
  - Confidence: MED — straightforward code, but unplanned.
  - Blind spot: Whether promptfoo will import `src` through tsx, which makes `.d.ts` irrelevant, or import `dist`.
- **Decision**: FIXED (Fix A): queued as promptfoo-change requirements in follow-ups/review-fixes.md.

### F4 — The comment about `result.output` misdescribes where the SDK throws

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: packages/code-reviewer/src/agent/reviewer.ts:34 (and plan.md:58, Key Discoveries)
- **Detail**: The comment says the `output` getter "throws on parse/validation failure". In `ai@7.0.97`, `generate()` itself parses the output (`node_modules/ai/dist/index.js:6365`, `parseCompleteOutput`), so `NoObjectGeneratedError` is thrown from line 33. The getter only throws `NoOutputGeneratedError` when there is no output (`dist/index.js:6503-6506`). The behaviour is still correct, because both lines are inside the awaited body. Only the explanation is wrong, and it would mislead the next person who reorders these lines.
- **Fix**: Reword it to: "`generate()` rejects with NoObjectGeneratedError on parse/validation failure; the `output` getter throws NoOutputGeneratedError if the final step produced none."
- **Decision**: FIXED: comment reworded at reviewer.ts:34-35; plan.md Key Discovery corrected.

### F5 — The no-agent test depends on module state left by the previous test

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: packages/code-reviewer/src/index.test.ts:17-23
- **Detail**: Only the first test calls `vi.resetModules()`. The second test reuses that module instance, including the memoised `defaultAgent`. It is correct today, because a failed `loadConfig()` is never cached (`??=` assigns only on success). But if a test that builds the default agent with a stubbed key is added earlier in this file, this test would then make a network call instead of failing on config. That breaks the plan's "each test runs standalone" intent.
- **Fix**: Move `vi.resetModules()` into a `beforeEach`, next to the existing `afterEach(vi.unstubAllEnvs)`.
- **Decision**: FIXED: vi.resetModules() moved into beforeEach.

### F6 — The default `stopWhen` is safe only while the tool set is empty

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/code-reviewer/src/agent/tools.ts:3-4
- **Detail**: The plan deliberately leaves `stopWhen` at the SDK default, `isStepCount(20)`, which is one step with no tools. Once the first tool lands in the seam, a review can quietly become up to 20 paid steps, each capped at 2048 output tokens, and nothing at the seam warns about it.
- **Fix**: Extend the `tools.ts` comment: "Adding a tool? Set an explicit `stopWhen` in `createReviewerAgent`; the default allows 20 paid steps."
- **Decision**: FIXED: tools.ts comment now requires an explicit stopWhen when the first tool is added.

## Triage (2026-09-11)

| Decision | Findings |
|---|---|
| Fixed | F1 (Fix A), F2, F3 (Fix A, queued as a follow-up), F4, F5, F6 |

Post-fix verification:
- Package typecheck passes.
- `npm test` passes with a bogus `OPENROUTER_API_KEY` exported (16 tests).
- The build passes, and `dist/` contains no test files.
- Mutation check: the new prompt test run against the pre-fix `buildReviewPrompt` fails 5 of 8 variants.
- `git status` no longer lists `packages/code-reviewer/.agents/` or `.claude/`.
- The fixes are uncommitted.
