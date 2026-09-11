# Code Review Evals (promptfoo) Implementation Plan

## Overview

Introduce promptfoo into `packages/code-reviewer` as a nested, separately-installed `evals/` project. The first
configuration runs the unchanged reviewer (same `REVIEWER_INSTRUCTIONS`, same `ToolLoopAgent`, same schema) on
three OpenRouter models — `anthropic/claude-sonnet-5` (production baseline), `z-ai/glm-5.1` and
`deepseek/deepseek-v4-flash` — against one realistic React 16 → 19 migration diff that carries three impactful
flaws. An LLM judge (`openai/gpt-5.4`) grades, one rubric per flaw, whether each review identified what is broken,
plus one rubric whether it wrongly flagged the diff's correct React 19 idioms, and a deterministic assertion checks
that the review's verdict fails. A small, additive library change makes the
reviewer cancellable, bounds its retries and exposes token usage and cost so promptfoo can compare models on
quality *and* spend.

## Current State Analysis

- The package is already shaped for an eval consumer (research §1): a side-effect-free barrel
  (`packages/code-reviewer/src/index.ts:1-15`), model injection via `createReviewerAgent({ model })`
  (`src/agent/reviewer.ts:15-23`), prompts as TS constants (`src/prompts/reviewer.ts:7-56`), a Zod output
  contract with post-generation range checks (`src/schemas/review.ts:8-37`, `src/agent/reviewer.ts:40-46`) and a
  pure, exported verdict rule (`src/verdict.ts:5-22`).
- Gaps this plan closes (research §4, G1/G2/G5): `reviewCode` takes no `abortSignal` and calls
  `agent.generate({ prompt })` only (`src/agent/reviewer.ts:35-37`); it returns only `Review`, dropping usage,
  `finishReason` and model id (`:40-46`); `maxRetries` is unset (SDK default 2 → up to 3 paid attempts).
- The mock-model helper is duplicated in `src/agent/reviewer.test.ts:9-21` and `src/run-cli.test.ts:12-24`.
- `MAX_DIFF_CHARS` / `MAX_DESCRIPTION_CHARS` exist (`src/prompts/reviewer.ts:4-5`) but are not exported from the
  barrel.
- No promptfoo config, provider, dependency or fixture exists. The CI action runs a full `npm ci` (dev deps
  included) in `packages/code-reviewer` on every PR (`.github/actions/code-review/action.yml`, step "Install and
  build the reviewer"), so promptfoo must not become a dependency of that package.
- Root tooling already ignores `packages/**` (`eslint.config.js:96`, `tsconfig.json:4`, `vitest.config.ts:15`,
  `.prettierignore:2`); root `.gitignore` already covers `node_modules/`, `dist/` and `.env`.

## Desired End State

- `packages/code-reviewer/evals/` is a standalone project (own `package.json` + lockfile, `promptfoo@0.123.0`
  pinned) whose files import the reviewer from `../src` — never from `ai`.
- `npm run eval:smoke` (in `evals/`) runs offline with a mock model and no API key, exercising the real fixture,
  the provider contract and the static verdict assertion; it exits 0.
- `npm run eval` (in `evals/`, key from `../.env`) produces a 3-model × 5-assertion matrix: per model, the named
  metrics `flaw_default_props`, `flaw_effect_cleanup`, `flaw_xss` (judge, recall), `no_false_react19_flags`
  (judge, precision) and `verdict_fails` (static), plus
  token usage and cost per model; `npm run view` opens the history.
- The reviewer library can be cancelled (`abortSignal`), retries at most once, and exposes `runReview()` returning
  `{ review, usage, finishReason, modelId, providerMetadata }`; `reviewCode()` and the CLI output are unchanged.

### Key Discoveries:

- promptfoo loads `.ts` providers/configs through `tsx`, which resolves the package's NodeNext `.js` specifiers
  to `.ts` files — verified by a spike in both the flat and the nested layout (research §6; nested run: YAML exit
  100 on a deliberately failing assertion, TS config exit 0, `tsc --noEmit` exit 0).
- **In the nested layout promptfoo installs its own `ai@6.0.280` into `evals/node_modules`.** A direct
  `import … from 'ai/test'` in `evals/` resolved to v6 and failed (`MockLanguageModelV4` missing). Imports that go
  through `../src/**` resolve the parent's `ai@7.0.97` (verified with `import.meta.resolve`). Hence: no `ai`
  imports (value or type) anywhere under `evals/`; the mock model lives in `src/testing/`.
- promptfoo passes `abortSignal` as the **third** `callApi` argument (`CallApiOptionsParams`), not in `context`;
  `PROMPTFOO_EVAL_TIMEOUT_MS` / `evaluateOptions.timeoutMs` aborts it and records an error — cancellation is
  cooperative (spike).
- An object `output` reaches YAML `javascript` assertions as an object, but a function-valued assertion in a TS
  config receives it as a JSON **string** (spike).
- `ai@7`: `AgentCallParameters` accepts `abortSignal` and `timeout` (`node_modules/ai/dist/index.d.ts:4623-4633`);
  `maxRetries` lives in `RequestOptions` (`:640-660`), which `ToolLoopAgentSettings` includes minus `abortSignal`
  (`:5045`) — so retries are an agent setting, the signal a per-call parameter. `GenerateTextResult.usage` is the
  all-steps total; `totalUsage` and `response` are deprecated in favour of `usage` and `finalStep.response`
  (`:4530-4556`). `NoObjectGeneratedError` carries `finishReason` and `usage` (`:7088-7115`).
- OpenRouter now returns usage (incl. `cost`) on every response; `usage: { include: true }` is deprecated. The
  provider surfaces it as `providerMetadata.openrouter.usage.cost` (`@openrouter/ai-sdk-provider` d.ts:457-476,
  567-577).
- All three reviewer models and the judge support `structured_outputs`, `response_format` and `reasoning` on
  OpenRouter (catalog, 2026-09-11). `z-ai/glm-5.1` has the smallest context (204,800 tokens) — far above the
  60k-char diff cap.
- React 19 facts the fixture relies on (react.dev upgrade guide): `defaultProps` is removed for function components
  (class components keep it); string refs, `ReactDOM.render` and legacy context are removed; ref is a regular prop
  (no `forwardRef` needed); `<Context value>` works as a provider.

## What We're NOT Doing

- No CI job for evals (neither per-PR nor `workflow_dispatch`); evals run locally only.
- No prompt or reasoning-effort variants: no `instructions` override on `createReviewerAgent`, no `reasoningEffort`
  parameter (research G3/G4). Every model runs with the same instructions, output cap (8192) and effort (`low`).
- No security-calibration work (rubric anchors, security-floor assertions) — that is the ci-cd-code-review follow-up
  F1; this change only builds the harness it will use.
- Only one fixture; no dataset of real PRs, no diff-assembly script shared with the CI action.
- No response caching for the reviewer provider; no `derivedMetrics`; no precision / false-positive rubric beyond
  the fixture's four correct React 19 idioms (`no_false_react19_flags`) — no clean control fixture.
- No change to the CLI's JSON output, `formatReviewComment`, the verdict thresholds or the CI workflow/action
  (including not excluding `evals/fixtures/**` from the AI review diff — the PR adding the flawed fixture will be
  reviewed by the advisory reviewer like any other file).
- No `exports`/`types`/`declaration` for bare-name imports of the package.

## Implementation Approach

Seam first, harness second, content last. Phase 1 changes the library in a backward-compatible way and proves it
offline with the existing vitest harness. Phase 2 stands up the nested promptfoo project with a provider that
wraps `runReview`, and proves the whole loader/provider/assertion chain offline with a mock model — so every later
failure is about models or content, not plumbing. Phase 3 authors the fixture and the ground-truth rubrics, wires
the three models and the judge, and ends with the first paid run as the manual gate.

promptfoo's `prompts × providers × tests` model is used with a single placeholder prompt (`'{{fixture}}'`): the
provider ignores the rendered prompt, reads only a fixture **name** from `context.vars.fixture` and loads the
`ReviewInput` from disk itself, so the prompt under test is always the package's own `REVIEWER_INSTRUCTIONS` +
`buildReviewPrompt`, fed byte-identical fixture text. Models differ only by provider `config.model`.

## Critical Implementation Details

**Never import `ai` under `evals/`.** promptfoo's own dependency tree puts `ai@6.0.280` into
`evals/node_modules`, which wins resolution for files in `evals/`. Everything the evals need from the SDK — the
mock model, types such as `LanguageModelUsage` — must come through `../src/**`, whose imports resolve the parent's
`ai@7`. The same applies to `import type`: v6 types would silently diverge from what `src` returns. Phase 2's
automated check greps for this.

**Assertion input shape.** Function-valued assertions in a TS config receive the provider's object `output` as a
JSON string, YAML string assertions receive the object. Every assertion reads the review through one helper that
accepts both.

**Fixture text never travels as a promptfoo var.** promptfoo 0.123.0 runs every string var through Nunjucks in
`renderPrompt` (`dist/src/evaluatorHelpers-*.js:395-401`), strips a trailing `\n` from each var (`:352`) and
substitutes `{{ word }}` with other vars' values (`resolveVariables`). A React diff is full of `{{ … }}` — flaw 3's
`dangerouslySetInnerHTML={{ __html: … }}` throws `expected variable end` before `callApi` is reached, and milder
cases silently change the input. Test vars therefore carry only `fixture: '<name>'`; the provider calls
`loadFixture(name)`. This also keeps full diffs out of the vars promptfoo stores in its local DB.

**Cancellation is cooperative.** promptfoo aborts `options.abortSignal` (third `callApi` argument) when
`evaluateOptions.timeoutMs` elapses and moves on; without forwarding it into `runReview`, the OpenRouter call
keeps running and billing.

**Fixture line endings.** The review input is the raw diff text; a CRLF checkout on Windows would feed the models a
different input than on Linux. The fixture diff is pinned to LF via `.gitattributes`.

**Retry test timing.** The SDK's retry backoff starts at 2 s, but it honours a `retry-after-ms` header between 0 and
60 s (`ai/dist/index.js:2784-2811`) and retries only when `isRetryable === true` (default for 429, not for 400).
The "retries once" test throws a 429 with `retry-after-ms: '0'`, which runs in milliseconds with no fake timers.

**Exit codes.** `promptfoo eval` exits `100` whenever any assertion fails — for `npm run eval` that is the normal
outcome of a model missing a flaw, not a broken harness. Only `eval:smoke` is expected to exit 0.

## Phase 1: Library seam — `runReview`, abort signal, bounded retries

### Overview

Additive changes to the reviewer library so an eval provider can cancel a review, see what it cost and why it
finished, and not pay for silent retries. `reviewCode` and the CLI keep their exact behaviour.

### Changes Required:

#### 1. Reviewer core

**File**: `packages/code-reviewer/src/agent/reviewer.ts`

**Intent**: Split `reviewCode` into a lower-level `runReview` that returns the review together with its run
metadata, accept an abort signal on both, and cap SDK retries at one on the agent.

**Contract**:
- New constant `MAX_RETRIES = 1` with a one-line rationale comment (one retry for a transient provider error;
  the SDK default of 2 means up to three paid attempts and hides flakiness from evals); passed as
  `maxRetries` in `createReviewerAgent`.
- `export type ReviewRun = { review: Review; usage: LanguageModelUsage; finishReason: FinishReason; modelId: string; providerMetadata: ProviderMetadata | undefined }` (types from `ai`).
- `export async function runReview(input: ReviewInput, options?: { agent?: ReviewerAgent; abortSignal?: AbortSignal }): Promise<ReviewRun>`
  — calls `agent.generate({ prompt: buildReviewPrompt(input), abortSignal })`, keeps the existing `result.output`
  read and `ScoresSchema` check, and returns `usage` from `result.usage`, `finishReason` from
  `result.finishReason`, `modelId` from `result.finalStep.response.modelId`, `providerMetadata` from
  `result.finalStep.providerMetadata` (non-deprecated fields only — top-level `providerMetadata`, `response` and
  `totalUsage` are deprecated in ai@7, `d.ts:4538-4566`).
- `reviewCode(input, options?: { agent?; abortSignal? })` becomes `(await runReview(input, options)).review` —
  same return type and rejection behaviour as today.

#### 2. Barrel

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Expose the new seam and the input caps the eval's fixture guard needs.

**Contract**: add `runReview`, `type ReviewRun`, `MAX_DIFF_CHARS`, `MAX_DESCRIPTION_CHARS` to the existing
re-exports. `src/testing/**` is deliberately **not** re-exported.

#### 3. Shared mock model

**File**: `packages/code-reviewer/src/testing/mock-model.ts` (new)

**Intent**: One helper that builds a `MockLanguageModelV4` returning a fixed text, used by the unit tests and by
the eval's offline smoke run (which cannot import `ai/test` itself — see Critical Implementation Details).

**Contract**: `export function mockReviewModel(text: string): MockLanguageModelV4` — same response shape as the
current local helpers (`src/agent/reviewer.test.ts:9-21`), which are replaced by imports of this function in
`reviewer.test.ts` and `run-cli.test.ts`.

#### 4. Build exclusion

**File**: `packages/code-reviewer/tsconfig.build.json`

**Intent**: Keep test-only code out of `dist/`.

**Contract**: `exclude` gains `src/testing/**` next to `src/**/*.test.ts`.

#### 5. Unit tests

**File**: `packages/code-reviewer/src/agent/reviewer.test.ts`

**Intent**: Prove the new contract offline.

**Contract**: new cases —
- `runReview` resolves to `{ review, usage, finishReason: 'stop', modelId }` where `usage.inputTokens`/
  `outputTokens` match the mock (10 / 20) and `modelId` equals the mock model's `modelId`.
- The abort signal reaches the model call: after `controller.abort()`, the `abortSignal` recorded in
  `model.doGenerateCalls[0]` reports `aborted === true` (assert on state, not identity — the SDK may combine
  signals).
- A retryable `APICallError` thrown by the mock — `statusCode: 429` (so `isRetryable` is true) and
  `responseHeaders: { 'retry-after-ms': '0' }` (so the SDK skips its 2 s backoff) — is attempted exactly
  `1 + MAX_RETRIES` = 2 times before `runReview` rejects.
- Existing cases keep passing unchanged (single step, instructions/prompt/token cap, schema without numeric bounds,
  score range rejection).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `cd packages/code-reviewer && npm test`
- Type checking passes: `cd packages/code-reviewer && npm run typecheck`
- Build passes and ships no test helper: `cd packages/code-reviewer && npm run build` and `dist/testing/` does not exist
- No local mock-model helper remains in test files: `git grep --untracked -n "new MockLanguageModelV4" packages/code-reviewer/src` matches only `src/testing/mock-model.ts`

#### Manual Verification:

- A real CLI run still prints the same JSON shape (review + `verdict`) for a small input file: `cd packages/code-reviewer && npm start -- --input-file <small-input>.json`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual
confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Evals project, provider and offline smoke run

### Overview

Create the nested promptfoo project, the fixture loader, the provider that wraps `runReview`, a shared assertion
helper and an offline smoke config on a tiny wiring fixture, and prove the whole chain without an API key.

### Changes Required:

#### 1. Project manifest and lockfile

**File**: `packages/code-reviewer/evals/package.json` (new) + `packages/code-reviewer/evals/package-lock.json` (generated by `npm install`)

**Intent**: A private, standalone project so promptfoo (~2.4 GB installed) never enters the reviewer's CI install.

**Contract**: `"private": true`, `"type": "module"`, `"engines": { "node": ">=24" }`; devDependencies
`promptfoo` pinned to exactly `0.123.0`, `typescript` `^7.0.2`, `@types/node` `^24.13.4` (same ranges as the
parent). Scripts:
- `eval`: `promptfoo eval -c promptfooconfig.ts --env-file ../.env`
- `eval:smoke`: `promptfoo eval -c promptfooconfig.smoke.ts --no-write --no-cache`
- `view`: `promptfoo view`
- `typecheck`: `tsc --noEmit`

#### 2. TypeScript config

**File**: `packages/code-reviewer/evals/tsconfig.json` (new)

**Intent**: Type-check the eval files (and, transitively, the `../src` they import) with the package's compiler
settings.

**Contract** (verified in the spike):

```json
{ "extends": "../tsconfig.json", "compilerOptions": { "rootDir": "..", "noEmit": true }, "include": ["*.ts"] }
```

#### 3. Fixture loader and wiring fixture

**Files**: `packages/code-reviewer/evals/fixtures.ts` (new) and
`packages/code-reviewer/evals/fixtures/wiring/pr.json` + `pr.diff` (new)

**Intent**: Load a fixture as a validated `ReviewInput` straight from disk — the only path by which fixture text
reaches the reviewer (see Critical Implementation Details) — failing loudly instead of letting the eval silently
test a truncated or malformed input.

**Contract**: `loadFixture(name: string): ReviewInput` — reads `fixtures/<name>/pr.json` (`{ title, description }`)
and `pr.diff` relative to the module (`import.meta.dirname`), validates with `ReviewInputSchema`, throws if
`diff.length > MAX_DIFF_CHARS` or `description.length > MAX_DESCRIPTION_CHARS`. The `wiring` fixture is the tiny
`add()` fix from `src/agent/reviewer.test.ts:23-27`, used only by the Phase 2 smoke run.

#### 4. Provider

**File**: `packages/code-reviewer/evals/provider.ts` (new)

**Intent**: The promptfoo provider for the reviewer: one instance per model, reads the PR from test vars, runs the
real agent, and reports output, tokens, cost and finish reason — or a message-only error.

**Contract**:
- Default-exported class implementing promptfoo's `ApiProvider`; constructor receives `ProviderOptions` whose
  `config` carries exactly one of `model: string` (OpenRouter model id) or `mockReview: Review` (offline); neither
  or both throws at construction. Other keys are ignored, not rejected: promptfoo always injects `config.basePath`
  (`dist/src/providers-*.js:23601-23608`), so an exact-shape check would break every provider.
- `id()` → `code-reviewer:<model>` or `code-reviewer:mock`.
- The agent is built once per instance: real mode via
  `createReviewerAgent({ model: createOpenRouterModel({ ...loadConfig(), OPENROUTER_MODEL: config.model }) })`;
  mock mode via `createReviewerAgent({ model: mockReviewModel(JSON.stringify(config.mockReview)) })` (mock mode
  never calls `loadConfig`, so it needs no key).
- `callApi(prompt, context, options)`: ignores `prompt`; reads `context.vars.fixture` (a non-empty string) and gets
  the input from `loadFixture(fixture)` — never from other vars; calls
  `runReview(input, { agent, abortSignal: options?.abortSignal })`; returns `output` = the `Review` object,
  `tokenUsage` = `{ prompt: usage.inputTokens, completion: usage.outputTokens, total: usage.totalTokens, numRequests: 1, completionDetails: { reasoning: usage.outputTokenDetails.reasoningTokens } }`,
  `cost` = `providerMetadata.openrouter.usage.cost` when it is a number, `metadata` = `{ modelId, upstreamProvider, finishReason, verdict: computeVerdict(review.scores) }`, where
  `upstreamProvider` = `providerMetadata.openrouter.provider` when it is a string (the host OpenRouter routed to).
- On any failure returns `{ error }` built from `error.message` only, plus ` (finishReason: …)` when the error
  carries a `finishReason` property (duck-typed — no `ai` import). Never the request body or the diff
  (mirrors `src/run-cli.ts:43-44`).
- Imports only from `../src/index.js`, `../src/testing/mock-model.js`, `./fixtures.js` and `promptfoo` (types).

#### 5. Assertion helpers

**File**: `packages/code-reviewer/evals/assertions.ts` (new)

**Intent**: One place that turns promptfoo's `output` into a typed `Review`, and the deterministic "review fails"
assertion reused by both configs.

**Contract**:
- `asReview(output: unknown): Review` — accepts the object or its JSON string (see Critical Implementation
  Details) and validates with `ReviewSchema`.
- `verdictFails` — a promptfoo `javascript` assertion (function value) with `metric: 'verdict_fails'` that passes
  iff `computeVerdict(asReview(output).scores).pass === false`, `score` 1/0, and `reason` = the verdict's `reason`
  string. Thresholds come from the package (`PASS_THRESHOLDS` via `computeVerdict`), never re-typed.

#### 6. Offline smoke config

**File**: `packages/code-reviewer/evals/promptfooconfig.smoke.ts` (new)

**Intent**: A zero-cost check of the loader → provider → assertion chain, runnable by an agent without secrets.

**Contract**: default-exported `UnifiedConfig`; one placeholder prompt `'{{fixture}}'`; one provider
`file://provider.ts` labelled `mock` with `config.mockReview` = a canned failing `Review` (e.g. security 2, average
below 7, one high issue); one test with `vars: { fixture: 'wiring' }`; assertions: `verdictFails` only. (Phase 3
switches it to the real fixture.)

#### 7. README

**File**: `packages/code-reviewer/evals/README.md` (new)

**Intent**: How to install and run, what the numbers mean, and the traps.

**Contract**: sections — Setup (`npm ci` in both `packages/code-reviewer` and `evals/`; key in
`packages/code-reviewer/.env`), Run (`eval`, `eval:smoke`, `view`, `-- --repeat 3` for decisions), Reading results
(exit 100 = some assertion failed; per-flaw metrics; cost column), Rules (no `ai` imports under `evals/`; results
incl. full diffs are stored in promptfoo's local DB under `~/.promptfoo`; `PROMPTFOO_DISABLE_TELEMETRY=1` /
`PROMPTFOO_DISABLE_UPDATE=1` to opt out).

### Success Criteria:

#### Automated Verification:

- Evals install from the lockfile: `cd packages/code-reviewer/evals && npm ci`
- Evals type-check (incl. `../src`): `cd packages/code-reviewer/evals && npm run typecheck`
- Offline smoke run passes without a key: `cd packages/code-reviewer/evals && npm run eval:smoke` exits 0 with `OPENROUTER_API_KEY` unset
- No `ai` imports under evals: `git grep --untracked -nE "from ['\"]ai(/[^'\"]*)?['\"]" -- packages/code-reviewer/evals/*.ts` returns nothing
- Reviewer package stays promptfoo-free: `cd packages/code-reviewer && npm ls promptfoo` reports no promptfoo (it prints `(empty)` and exits 1 — that is the pass)
- Package tests still pass: `cd packages/code-reviewer && npm test`

#### Manual Verification:

- README instructions work as written on a fresh clone path (install both projects, run the smoke config).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual
confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: React 19 migration fixture and three-model judge config

### Overview

Author the one complex fixture with three seeded flaws, encode the ground truth as per-flaw judge rubrics, wire the
three models and the judge, point the smoke run at the real fixture, and run the first paid eval.

### Changes Required:

#### 1. Fixture

**Files**: `packages/code-reviewer/evals/fixtures/react-19-migration/pr.json` (new: `{ "title", "description" }`)
and `packages/code-reviewer/evals/fixtures/react-19-migration/pr.diff` (new: unified diff)

**Intent**: A realistic multi-file PR that migrates a small React 16 app shell and its `DeckPanel` class component
to React 19 function components — mostly correct, with exactly three impactful flaws. The flaws must be real
React 19 behaviour, not stylistic.

**Contract**:
- Authoring method: build the before-state in a throwaway git repo outside this repository, commit it, write the
  after-state, and export `git diff -M HEAD` so paths and renames (`.js` → `.tsx`) look like a real PR. Only
  `pr.diff` and `pr.json` are committed.
- Files in the diff (correct changes act as realistic noise): `package.json` (react/react-dom 16 → 19, drop
  `prop-types`, add types); `src/index.js` → `src/main.tsx` (`ReactDOM.render` → `createRoot` — correct);
  `src/theme/ThemeContext` (`<ThemeContext.Provider value>` → `<ThemeContext value>` — correct);
  `src/components/SearchInput` (`forwardRef` → `ref` as a prop — correct); `src/App` (renders
  `<DeckPanel deckId={…} />` **without** `formatDueDate`/`pageSize`); `src/components/DeckPanel` (class →
  function, `propTypes` → TS props interface, deck fetch in a `useEffect` **with** an `AbortController` cleanup —
  correct, and a contrast to flaw 2; `use(ThemeContext)` — correct); the `DeckPanel` test file
  (`react-test-renderer` → Testing Library, passing `formatDueDate` explicitly and not asserting unsubscribe — so
  the tests would not catch flaws 1–2).
- Flaw 1 — `defaultProps` on a function component: `DeckPanel.defaultProps = { formatDueDate, pageSize: 20 }`
  carried over from the class; the body calls `formatDueDate(card.dueAt)` and `cards.slice(0, pageSize)`. React 19
  ignores it, `App` omits both props → `TypeError` on render.
- Flaw 2 — lost cleanup: `componentDidMount`/`componentDidUpdate`/`componentWillUnmount` subscription logic becomes
  `useEffect(() => { deckStore.subscribe(deckId, onLiveUpdate); }, [deckId])` — the returned unsubscribe is
  discarded.
- Flaw 3 — stored XSS: the deck description (authored by other users) moves from `<p>{deck.description}</p>` to
  `dangerouslySetInnerHTML={{ __html: deck.description }}` with no sanitisation.
- `pr.json` description: plausible and neutral (lists the migration steps, says descriptions now render the rich
  text the new editor saves, claims tests were updated); it must not hint at the flaws and must not address the
  reviewer.
- Size: comfortably below `MAX_DIFF_CHARS` (60,000) and `MAX_DESCRIPTION_CHARS` (4,000) — no truncation in the
  eval.

**File**: `packages/code-reviewer/evals/.gitattributes` (new)

**Intent/Contract**: `*.diff text eol=lf` so every checkout feeds the models byte-identical input.

#### 2. Test case with ground-truth rubrics

**File**: `packages/code-reviewer/evals/cases.ts` (new)

**Intent**: The single shared definition of the React 19 case — vars from the fixture, the static assertion, and
(optionally) the three judge rubrics — so the smoke and main configs cannot drift.

**Contract**: `reactMigrationCase(options: { judge: boolean }): TestCase` — `description`
`'React 16 → 19 migration with three seeded flaws'`, `vars` = `{ fixture: 'react-19-migration' }` (preceded by a
module-level `loadFixture('react-19-migration')` call, so a malformed or over-cap fixture fails at config load),
`assert` =
`[verdictFails]` plus, when `judge` is true, four `llm-rubric` assertions with `threshold: 1` and metrics
`flaw_default_props`, `flaw_effect_cleanup`, `flaw_xss`, `no_false_react19_flags`. The three flaw rubrics share this
preamble and append their flaw:

> The output is a JSON code review (summary, scores, issues[].severity/message) of a pull request that migrates a
> React 16 class component to React 19. Judge only whether the summary or issues identify the defect below.
> Score 1 if the defect is identified at the right code AND its consequence is stated; 0.5 if it points at the
> right code but misses or misstates the consequence; 0 if it is not identified. Generic advice (e.g. "add
> tests") does not count. Pass only on score 1.

- `flaw_default_props`: `DeckPanel` is now a function component but still sets `DeckPanel.defaultProps`; React 19
  ignores `defaultProps` on function components, so `formatDueDate` (and `pageSize`) are `undefined` when a parent
  omits them — `App` does — and the render calls `formatDueDate(…)`, throwing a `TypeError` that crashes the panel.
  Fix: ES default parameters in the props destructuring.
- `flaw_effect_cleanup`: the live-update subscription moved into a `useEffect` that calls
  `deckStore.subscribe(…)` without returning the unsubscribe; subscriptions leak on unmount and accumulate on every
  `deckId` change, so stale decks keep pushing updates. Fix: return the unsubscribe from the effect.
- `flaw_xss`: the user-authored deck description is rendered with `dangerouslySetInnerHTML` without sanitisation
  (previously escaped text) — a stored XSS vulnerability. Fix: sanitise (e.g. DOMPurify) or render as text.
- `no_false_react19_flags` (own text, not the preamble): the output is a JSON code review of a PR migrating to
  React 19. These changes in it are correct React 19: `ReactDOM.render` → `createRoot`; `<ThemeContext value>` used
  as a provider; `ref` passed as a regular prop instead of `forwardRef`; `use(ThemeContext)` to read context. Score 0
  if the summary or any issue claims one of these is a bug, unsupported, or must be reverted; 1 otherwise. Neutral
  mentions or praise are fine. Pass only on score 1.

#### 3. Main config

**File**: `packages/code-reviewer/evals/promptfooconfig.ts` (new)

**Intent**: The first real comparison: same prompt, three models, one judge.

**Contract**: default-exported `UnifiedConfig` —
- one placeholder prompt `'{{fixture}}'` (the provider uses the package's own prompt);
- providers: three `file://provider.ts` entries with `config.model` `anthropic/claude-sonnet-5`, `z-ai/glm-5.1`,
  `deepseek/deepseek-v4-flash` and labels `claude-sonnet-5`, `glm-5.1`, `deepseek-v4-flash`;
- `defaultTest.options.provider`: `openrouter:openai/gpt-5.4` (judge; uses the same `OPENROUTER_API_KEY`);
- `tests`: `[reactMigrationCase({ judge: true })]`;
- `evaluateOptions.timeoutMs`: `300_000` (matches the CI action's `timeout 300`).

#### 4. Smoke config on the real fixture

**File**: `packages/code-reviewer/evals/promptfooconfig.smoke.ts`

**Intent**: Make the offline run cover the real fixture's loading and size guard.

**Contract**: `tests` becomes `[reactMigrationCase({ judge: false })]`; the `wiring` test and `fixtures/wiring/` are
removed.

### Success Criteria:

#### Automated Verification:

- Evals type-check: `cd packages/code-reviewer/evals && npm run typecheck`
- Offline smoke run on the real fixture passes: `cd packages/code-reviewer/evals && npm run eval:smoke` exits 0
- Fixture diff is stored with LF endings: `git ls-files --eol packages/code-reviewer/evals/fixtures/react-19-migration/pr.diff` shows `i/lf`
- Package tests still pass: `cd packages/code-reviewer && npm test`

#### Manual Verification:

- Fixture review: each of the three flaws is present exactly as its rubric states; the "correct" migration parts are
  actually correct React 19; the PR description is neutral and contains no hints or reviewer-directed text.
- First paid run: `cd packages/code-reviewer/evals && npm run eval` completes with each of the three providers
  returning either a review (5 graded assertions) or a message-only model error (e.g. `finishReason: length`) — a
  model error is a result and is recorded as one; a harness error (config load, provider construction, auth, fixture
  load) fails this check. With three reviews that is 15 graded assertions (3 models × 5); a nonzero exit (100) from
  failed flaw assertions is expected.
- `npm run view` shows the matrix with the five named metrics per model and populated token and cost columns.
- Judge spot-check: for each model, read the review and the judge's reason per flaw; the pass/fail decisions match
  a human reading of the same review.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual
confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `runReview` result shape (usage, finishReason, modelId) from the mock model.
- Abort signal propagation to the model call (state-based assertion).
- Retry bound: a retryable `APICallError` is attempted `1 + MAX_RETRIES` times.
- Existing reviewer and CLI tests unchanged, now using the shared `mockReviewModel`.

### Integration Tests:

- `eval:smoke`: promptfoo → tsx loader → provider → `loadFixture` → `runReview` (mock model) → `verdictFails`, on the real fixture,
  offline. This is the regression guard for the provider contract and the no-`ai`-imports rule.

### Manual Testing Steps:

1. Run the CLI once against a small input to confirm unchanged output (Phase 1).
2. Install both projects from scratch and run `eval:smoke` following the README (Phase 2).
3. Read the fixture diff end to end against the three rubric statements (Phase 3).
4. Run `npm run eval`, open `npm run view`, and spot-check every judge decision (Phase 3).

## Performance Considerations

- One `npm run eval` = 3 reviewer calls (fixture + instructions in, ≤ 8,192 tokens out each) + 12 judge calls. At
  the OpenRouter list prices read on 2026-09-11 (Sonnet 5 $2/$10, GLM 5.1 $0.97/$3.04, DeepSeek V4 Flash
  $0.09/$0.17, GPT-5.4 $2.50/$15 per M tokens) that is well under $0.50 per run, dominated by the judge and Sonnet
  output. `--repeat 3` triples it.
- Reviewer calls are never cached by promptfoo (custom provider), so every run pays for them; judge calls on
  identical outputs may be served from promptfoo's cache.
- Default promptfoo concurrency (4) runs the three reviews in parallel; the 300 s per-case timeout bounds a hung
  model.

## Migration Notes

None. `reviewCode`, the CLI and its JSON output are unchanged; `runReview`, the new exports and `maxRetries: 1` are
additive. The only behaviour change in production is at most two attempts (instead of three) per failing model call
in the CI review.

## References

- Related research: `context/changes/code-review-evals/research.md`
- Seam design this builds on: `context/archive/2026-09-10-tool-loop-agent/plan.md`, `plan-brief.md`
- Queued seam fixes: `context/archive/2026-09-10-tool-loop-agent/follow-ups/review-fixes.md:6-17`
- Security calibration follow-up (future user of this harness): `context/archive/2026-09-11-ci-cd-code-review/follow-ups/review-fixes.md:5-24`
- Reviewer core: `packages/code-reviewer/src/agent/reviewer.ts:15-47`
- Message-only error pattern: `packages/code-reviewer/src/run-cli.ts:43-44`
- promptfoo docs: custom providers, `llm-rubric`, command line, configuration reference (links in research.md)
- React 19 upgrade guide: https://react.dev/blog/2024/04/25/react-19-upgrade-guide

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Library seam — `runReview`, abort signal, bounded retries

#### Automated

- [x] 1.1 Unit tests pass
- [x] 1.2 Type checking passes
- [x] 1.3 Build passes and ships no test helper
- [x] 1.4 No local mock-model helper remains in test files

#### Manual

- [x] 1.5 A real CLI run still prints the same JSON shape

### Phase 2: Evals project, provider and offline smoke run

#### Automated

- [ ] 2.1 Evals install from the lockfile
- [ ] 2.2 Evals type-check (incl. `../src`)
- [ ] 2.3 Offline smoke run passes without a key
- [ ] 2.4 No `ai` imports under evals
- [ ] 2.5 Reviewer package stays promptfoo-free
- [ ] 2.6 Package tests still pass

#### Manual

- [ ] 2.7 README instructions work as written

### Phase 3: React 19 migration fixture and three-model judge config

#### Automated

- [ ] 3.1 Evals type-check
- [ ] 3.2 Offline smoke run on the real fixture passes
- [ ] 3.3 Fixture diff is stored with LF endings
- [ ] 3.4 Package tests still pass

#### Manual

- [ ] 3.5 Fixture review: three flaws present as stated, correct parts correct, neutral PR description
- [ ] 3.6 First paid run completes with no harness errors
- [ ] 3.7 Results view shows per-model metrics, tokens and cost
- [ ] 3.8 Judge spot-check matches a human reading
