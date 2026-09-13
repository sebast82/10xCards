---
date: 2026-09-11T17:14:42+02:00
researcher: Claude Code (claude-opus-5)
git_commit: 4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da
branch: master
repository: sebast82/10xCards
topic: "Eval readiness of packages/code-reviewer — prompt reusability, agent importability, and promptfoo (or OSS alternative) fit"
tags: [research, codebase, code-reviewer, evals, promptfoo, ai-sdk, tool-loop-agent, openrouter]
status: complete
last_updated: 2026-09-11
last_updated_by: Claude Code (claude-opus-5)
---

# Research: Eval readiness of `packages/code-reviewer` and promptfoo fit

**Date**: 2026-09-11T17:14:42+02:00
**Researcher**: Claude Code (claude-opus-5)
**Git Commit**: 4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da
**Branch**: master
**Repository**: sebast82/10xCards

## Research Question

Analyze the current state of `packages/code-reviewer` in the context of introducing evals — reusability of
prompts, importability of the agent, etc. First pick for the eval toolkit is promptfoo: if the tech stack is
aligned with it, go in that direction; otherwise analyze other OSS tools for evaluating prompts and agents.

## Summary

**The stack is aligned with promptfoo — go with it.** The fit was verified empirically, not only on paper: a
throwaway spike (scratchpad copy of the package + `promptfoo@0.123.0`, mock model, zero API cost) proved that:

- a promptfoo **TypeScript provider** (`file://provider.ts`) can import the package's `src/index.js` directly —
  promptfoo registers the same `tsx` loader the package already uses (`tsx@4.23.13`, deduped), and `tsx`
  resolves the package's NodeNext `.js` specifiers to `.ts` files. No build step, no `exports`, no `.d.ts` needed;
- `ai@7.0.97` and `zod@4.6.1` dedupe cleanly with promptfoo — no peer conflicts (the two TS-native alternatives,
  evalite and vitest-evals, both fail `npm install` with ERESOLVE against `ai@7`);
- a structured `Review` object returned as `output` reaches YAML `javascript` assertions as an object
  (`output.scores.security <= 3` works as written);
- a **TS config** (`promptfooconfig.ts`) can import `computeVerdict` / `PASS_THRESHOLDS` from the package and use
  them inside assertions — thresholds are reused, not re-typed in YAML;
- `PROMPTFOO_EVAL_TIMEOUT_MS` fires the `abortSignal` promptfoo passes to `callApi` (third argument) — this
  answers the open question from the tool-loop-agent follow-ups;
- a failing or erroring test makes `promptfoo eval` exit with code `100` — CI-usable as-is.

**The package is mostly eval-ready by design.** The tool-loop-agent change was explicitly shaped for "a future
promptfoo eval provider": a side-effect-free barrel ([src/index.ts:1-15](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/index.ts#L1-L15)),
model injection via `createReviewerAgent({ model })`, a one-call `reviewCode(input, { agent? })`, prompts as
importable TS constants, and a Zod output contract plus a pure verdict function that double as eval oracles.

**Five seam gaps block a good eval, all small and additive:**

1. `reviewCode` cannot take an `abortSignal` — promptfoo's timeout would give up on a case while the paid
   OpenRouter call keeps running.
2. `reviewCode` returns only `Review` — token usage, `finishReason` (the "reasoning ate the budget" failure mode)
   and model id are thrown away, so promptfoo's token/cost columns stay empty.
3. `createReviewerAgent` takes only a `model` — instructions, output cap and tools are fixed, so prompt variants
   (the security-anchor rubric the ci-cd follow-up asks for) cannot be A/B'd without editing the source.
4. `createOpenRouterModel` hard-codes `reasoning: { effort: 'low' }` — the follow-up asks to compare `low` vs
   `medium` on the same fixtures.
5. `maxRetries` is not set (SDK default 2) — up to 3 paid attempts per failing case, silently smoothing flakiness
   the eval is supposed to see.

**One layout decision matters more than any code:** promptfoo is heavy (2.4 GB `node_modules`, ~600 top-level
entries, 47 s install in the spike). The CI review action runs a full `npm ci` (dev deps included) in
`packages/code-reviewer` on every PR, so promptfoo must **not** become a devDependency of the reviewer package.
A nested `packages/code-reviewer/evals/` project with its own `package.json`/lockfile mirrors the repo's
existing "standalone package, own lockfile" pattern and keeps the review job lean.

## Detailed Findings

### 1. Package anatomy and public surface (importability)

- Standalone ESM package: `"type": "module"`, `engines.node >= 24`, own lockfile, deps limited to
  `ai@^7.0.97`, `@openrouter/ai-sdk-provider@^3.0.0`, `zod@^4.6.1`
  ([package.json:1-28](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/package.json#L1-L28)).
  Installed: `ai@7.0.97`, provider `3.0.0`, `zod@4.6.1`, `vitest@4.1.11`; local Node `v24.19.0`, npm `12.0.2`.
- `main: dist/index.js`, **no `exports`, no `types`**, and `tsconfig.json` has no `declaration: true`
  ([tsconfig.json:1-23](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/tsconfig.json#L1-L23)).
  A bare `import 'code-reviewer'` from another package would get untyped JS. Irrelevant for an in-package eval
  that imports `../src/index.js` through tsx (proven by the spike); relevant only if evals live in a separate
  package that depends on it by name.
- The barrel re-exports everything an eval needs and nothing more: `createReviewerAgent`, `reviewCode`,
  `ReviewerAgent`, `loadConfig`, `createOpenRouterModel`, `buildReviewPrompt`, `REVIEWER_INSTRUCTIONS`,
  `ReviewInputSchema`, `ReviewSchema`, `ScoresSchema`, `computeVerdict`, `PASS_THRESHOLDS`, `formatReviewComment`
  and the types ([src/index.ts:1-15](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/index.ts#L1-L15)).
- **Import purity is enforced by a test**: importing the barrel with an empty key neither reads env nor sets
  `process.exitCode` ([src/index.test.ts:14-19](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/index.test.ts#L14-L19)).
  The default agent is memoised lazily on first use, never at import
  ([src/agent/reviewer.ts:27-33](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/agent/reviewer.ts#L27-L33)).
- **Model injection** — the key eval seam — is `createReviewerAgent({ model: LanguageModel })`
  ([src/agent/reviewer.ts:15-23](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/agent/reviewer.ts#L15-L23)),
  already exercised by the unit tests with `MockLanguageModelV4`
  ([src/agent/reviewer.test.ts:9-21](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/agent/reviewer.test.ts#L9-L21)).
  An eval provider can build one agent per model id with
  `createReviewerAgent({ model: createOpenRouterModel({ OPENROUTER_API_KEY, OPENROUTER_MODEL: id }) })`.
- The agent is a `ToolLoopAgent` with **no tools** (`reviewerTools = {}`), so it completes in one step
  ([src/agent/tools.ts:3-5](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/agent/tools.ts#L3-L5)).
  Today an "agent eval" is effectively a single structured-output call; trajectory/tool-use assertions
  (promptfoo's `trajectory:*`, `agent-rubric`) have nothing to grade yet.
- `reviewCode` returns `result.output` after an extra range check through `ScoresSchema`, throwing on invalid
  scores ([src/agent/reviewer.ts:35-47](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/agent/reviewer.ts#L35-L47)).
  A provider must call `reviewCode` (not `agent.generate` directly) or it would bypass that check.

### 2. Prompt reusability

- Prompts are TS modules, not files: `REVIEWER_INSTRUCTIONS` (system) and `buildReviewPrompt(input)` (user)
  ([src/prompts/reviewer.ts:7-56](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/prompts/reviewer.ts#L7-L56)).
  Decision recorded in tool-loop-agent: "Type-checked, no fs/build copy step, importable by a provider".
- `buildReviewPrompt` does real work an eval must not reimplement: it wraps title/description/diff in
  `<pr_title>` / `<pr_description>` / `<pr_diff>` blocks, neutralises forged tags (`TAG_START`, incl. fullwidth
  `＜`), and truncates description at 4 000 and diff at 60 000 chars with a `[truncated …]` note
  ([src/prompts/reviewer.ts:4-5, 40-48](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/prompts/reviewer.ts#L40-L48)).
- **Mismatch with promptfoo's prompt model**: promptfoo thinks in `prompts × providers × tests`, where a prompt is
  a template rendered with `{{vars}}`. An agent-level provider ignores the rendered prompt and reads
  `context.vars` instead (spike: `prompts: ['{{title}}']` was a label-only placeholder). Consequence: prompt
  variants become **provider variants** (e.g. two provider entries with `config.instructions` pointing at
  different instruction sets), not promptfoo "prompts". That works, but requires gap #3 (instructions override).
- **Alternative (prompt-level eval)**: a promptfoo prompt function (`file://prompt.ts:messages`) returning
  `[{ role: 'system', content: REVIEWER_INSTRUCTIONS }, { role: 'user', content: buildReviewPrompt(vars) }]`
  against a native `openrouter:anthropic/claude-sonnet-5` provider. It reuses the same prompt code and unlocks
  promptfoo's native prompt matrix, but bypasses `ToolLoopAgent`, `Output.object`, the `ScoresSchema` check, the
  reasoning-effort setting and `maxOutputTokens` — i.e. it evaluates something other than what ships, and drifts
  further once tools are added. Recommended only as a secondary, prompt-wording experiment.

### 3. Built-in eval oracles: schema and verdict

- `ReviewSchema` — `summary`, six numeric `scores`, `issues[{ severity: low|medium|high, message }]`
  ([src/schemas/review.ts:8-28](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/schemas/review.ts#L8-L28)).
  Model-facing scores deliberately have no numeric bounds (Anthropic structured outputs 400 on
  `minimum`/`maximum`); bounds live in `ScoresSchema`
  ([src/schemas/review.ts:3-6, 32-37](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/schemas/review.ts#L32-L37)).
  Schema conformance is therefore already guaranteed by `reviewCode` — an eval does not need `is-json` checks;
  a schema violation surfaces as a provider `error`.
- `computeVerdict` + `PASS_THRESHOLDS = { average: 7, security: 6 }` are pure and exported
  ([src/verdict.ts:5-22](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/verdict.ts#L5-L22)).
  They are the natural deterministic oracle for "seeded vulnerability ⇒ verdict fails" and "clean change ⇒ verdict
  passes". The spike reused them from a TS config successfully.
- Spike caveat: in a TS config, a **function-valued** `javascript` assertion received `output` as a JSON **string**
  (`typeof output === 'string'`), while an inline YAML `javascript` string assertion received the object. A
  shared helper that does `typeof output === 'string' ? JSON.parse(output) : output` avoids the trap.

### 4. Eval-relevant gaps in the seam

| # | Gap | Where | Why it matters for evals |
|---|-----|-------|--------------------------|
| G1 | No `abortSignal` (or `timeout`) option | [reviewer.ts:35-37](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/agent/reviewer.ts#L35-L37) — `agent.generate({ prompt })` only | Spike: promptfoo aborts via `options.abortSignal` at `PROMPTFOO_EVAL_TIMEOUT_MS`; cancellation is cooperative, so without forwarding the call runs on, billed, holding a concurrency slot. `ai@7` call settings expose `abortSignal`, `timeout`, `maxRetries` (`node_modules/ai/dist/index.d.ts:646-659`). Also lets the CI action drop its `timeout 300` workaround later. |
| G2 | Only `Review` is returned | [reviewer.ts:40-46](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/agent/reviewer.ts#L40-L46) | promptfoo's `tokenUsage`/`cost`/`metadata` stay empty; `finishReason: length` (the Phase 1 "reasoning ate 2048 tokens" failure) is invisible. Additive fix: a lower-level function returning `{ review, usage, finishReason, modelId }`, with `reviewCode` as a thin wrapper — avoids a provider duplicating the `ScoresSchema` check. |
| G3 | `createReviewerAgent` takes only `model` | [reviewer.ts:15-23](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/agent/reviewer.ts#L15-L23) | Instructions, `MAX_OUTPUT_TOKENS` (8192, line 13) and tools are fixed; prompt A/B (security anchors) needs an `instructions?` override defaulting to `REVIEWER_INSTRUCTIONS`. |
| G4 | Reasoning effort hard-coded `low` | [model.ts:5-10](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/model.ts#L5-L10) | ci-cd follow-up F1 asks to compare `low` vs `medium` on the same fixtures; needs an optional `reasoningEffort` parameter. Model id is already a parameter via `Config.OPENROUTER_MODEL` ([config.ts:3-6](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/config.ts#L3-L6)). |
| G5 | `maxRetries` unset (SDK default 2) | [reviewer.ts:35-37](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/agent/reviewer.ts#L35-L37) | Up to 3 paid attempts per failing case; retries hide provider flakiness that `--repeat` is meant to measure. |
| G6 | Error hygiene in a new consumer | [run-cli.ts:43-44](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/run-cli.ts#L43-L44) | The CLI prints `error.message` only because `APICallError` carries the request body (whole diff). The provider must return `{ error: error.message }` the same way. |
| G7 | Duplicated `mockModel` helper | [reviewer.test.ts:9-21](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/agent/reviewer.test.ts#L9-L21), [run-cli.test.ts:12-24](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/run-cli.test.ts#L12-L24) | Minor. An offline "wiring" eval run (mock model, as in the spike) would be a third copy; worth one shared test helper. |

### 5. Input fidelity: the CI diff is assembled outside the package

- The CI input is built in bash in the composite action, not by the package: `git diff base...head` with
  `context/` and `**/package-lock.json` excluded first, then `context/` appended; title/description read from the
  event payload and written as `{ title, description, diff }` JSON (`.github/actions/code-review/action.yml`,
  steps "Compute the PR diff" and "Assemble the reviewer input").
- That ordering exists because of a real incident: docs sorted before `packages/` and filled the 60k window, so
  code was reviewed unseen (ci-cd-code-review `change.md`, Phase 2 adaptation).
- **Implication for evals**: fixtures built from real PRs must be produced the same way, or the eval measures a
  different input distribution than CI. Either extract diff assembly into a script both CI and fixture
  generation call, or document the exact `git diff` command next to the fixtures.
- Fixture format: `ReviewInputSchema` (`title`, `description`, `diff`) is exactly the CLI's `--input-file` JSON
  ([src/schemas/input.ts:4-8](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/packages/code-reviewer/src/schemas/input.ts#L4-L8)).
  Storing fixtures as such JSON files lets one fixture run through both `npm start -- --input-file` and the eval,
  and a TS config can load and validate them with `ReviewInputSchema`.
- Side effect to plan for: a PR that adds fixtures with seeded vulnerabilities will itself be reviewed by the AI
  reviewer (the action excludes only `context/` and lockfiles). Consider excluding `**/evals/fixtures/**` from the
  review diff.

### 6. promptfoo — stack alignment (docs + spike evidence)

| Concern | Finding | Evidence |
|---------|---------|----------|
| Version / license / ownership | `0.123.0`, MIT, ESM. Acquisition by OpenAI announced 2026-03-09; the announcement says it stays open source under the current license. Pin the version. | npm registry; promptfoo.dev blog; openai.com |
| Node | `engines.node >= 22.22.0`; local v24.19.0, package requires ≥24 | npm registry |
| TS provider loading | `ensureTypescriptLoader` dynamically imports `tsx` for `.ts/.mts/.cts`; `.js`→`.ts` specifiers inside `src/` resolve | promptfoo `src/esm.ts`; spike |
| Dep conflicts | None: `ai@7.0.97`, `zod@4.6.1`, `tsx@4.23.13` deduped | spike `npm ls` |
| Install weight | 2.4 GB `node_modules`, ~600 top-level entries, 47 s; npm 12 `allowScripts` blocked install scripts of `@swc/core`, `onnxruntime-node`, `sharp`, `protobufjs` — the eval ran fine without them | spike |
| Provider contract | `callApi(prompt, context: CallApiContextParams, options: CallApiOptionsParams)`; `context` has `vars`, `test`, `repeatIndex`, `getCache`, `bustCache`; `options.abortSignal` | `promptfoo/dist/src/index.d.ts:52-84` |
| Timeout | `PROMPTFOO_EVAL_TIMEOUT_MS` (per case) aborts `options.abortSignal` (~1008 ms at a 1000 ms limit) and records `Evaluation timed out after 1000ms` as an error; `PROMPTFOO_MAX_EVAL_TIME_MS` caps the whole run | CLI docs; spike |
| Structured output | Object `output` reaches YAML `javascript` assertions as an object; TS function assertions get a string (see §3) | spike |
| Config reuse | `promptfooconfig.ts` (`UnifiedConfig`) can import package exports | docs; spike |
| Nondeterminism | `--repeat N` / `evaluateOptions.repeat`; `repeatIndex` visible in the provider | CLI docs; spike |
| LLM-as-judge | `llm-rubric` (score 0–1, `threshold`), `g-eval`, `factuality`, `select-best`, custom `rubricPrompt`; grader overridable via `--grader`, `defaultTest.options.provider`, or per assertion. Native `openrouter:<model>` provider reads the same `OPENROUTER_API_KEY` | promptfoo docs |
| Caching | Not automatic for custom providers — opt-in via `promptfoo.cache` / `context.getCache`; otherwise every re-run pays | custom-provider docs |
| CI | Exit `100` on any failure/error; `PROMPTFOO_FAILED_TEST_EXIT_CODE`, `PROMPTFOO_PASS_RATE_THRESHOLD`; outputs json/html/junit.xml; a `promptfoo-action` exists for PR before/after comparisons | CLI docs; spike |
| Privacy | Results (full diffs + reviews) go to a local SQLite DB under the config dir (spike: `PROMPTFOO_CONFIG_DIR/promptfoo.db`, even with `--no-write`) and to `-o` files. Telemetry (command/assertion events, no prompts/outputs) is on by default: `PROMPTFOO_DISABLE_TELEMETRY=1`; update check: `PROMPTFOO_DISABLE_UPDATE=1`. Sharing is explicit (`promptfoo share` / `sharing` config) | telemetry docs; spike |

### 7. Integration design options

**Provider level (recommended: agent-level provider).** A class provider in `evals/provider.ts` that validates
`context.vars` with `ReviewInputSchema`, builds (and caches per config) an agent from `config.model` /
`config.reasoningEffort` / `config.instructions`, calls `reviewCode(input, { agent, abortSignal })`, and returns
`{ output: review, tokenUsage, metadata: { finishReason, verdict } }` or `{ error: error.message }`. Spike-proven
shape (mock model in place of OpenRouter):

```ts
import type { ApiProvider, CallApiContextParams, CallApiOptionsParams, ProviderOptions, ProviderResponse } from 'promptfoo';
import { createReviewerAgent, reviewCode, ReviewInputSchema } from '../src/index.js';

export default class ReviewerProvider implements ApiProvider {
  options: ProviderOptions;
  constructor(options: ProviderOptions) { this.options = options; }
  id() { return this.options.id ?? 'code-reviewer'; }
  async callApi(_prompt: string, context?: CallApiContextParams, options?: CallApiOptionsParams): Promise<ProviderResponse> {
    const input = ReviewInputSchema.parse(context?.vars);
    try {
      // after G1/G3/G4: pass options?.abortSignal, config.instructions, config.reasoningEffort
      const review = await reviewCode(input, { agent: createReviewerAgent({ model /* from this.options.config */ }) });
      return { output: review };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }; // never the request body
    }
  }
}
```

**Package layout.**

| Option | Pros | Cons |
|--------|------|------|
| **A. Nested `packages/code-reviewer/evals/` with its own `package.json` + lockfile (recommended)** | Mirrors the repo's standalone-package pattern (root already ignores `packages/**`: [eslint.config.js:96](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/eslint.config.js#L96), [tsconfig.json:4](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/tsconfig.json#L4), [vitest.config.ts:15](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/vitest.config.ts#L15), [.prettierignore:2](https://github.com/sebast82/10xCards/blob/4ff66d61e4deea7b0aef5c7a8ddeb5ae2fbcc3da/.prettierignore#L2)); the review action's `npm ci` stays lean; `../src/index.js` imports keep working because Node resolves `ai`/`zod` by walking up from the `src` file | Two installs to run evals; nested layout not yet exercised by the spike (the spike used a single package) |
| B. `promptfoo` as a devDependency of `code-reviewer` | One install, simplest | Every PR's review job pays the 2.4 GB / ~47 s install (`npm ci` in the action includes dev deps, and the build needs `typescript` from devDeps, so `--omit=dev` is not an option) |
| C. `npx promptfoo@0.123.0` with no dependency | Zero footprint in lockfiles | No `import type` from `promptfoo` for the provider/config; less reproducible |

The package `tsconfig.json` includes only `src`, and the vitest default include (`*.test.ts`) does not match eval
files, so option A needs no change to the package's typecheck or test config. `.gitignore` should cover the
evals output files and any local promptfoo config dir.

### 8. What the first eval should measure (from recorded history)

- **Security calibration (ci-cd follow-up F1)**: seeded fixtures — GHA script injection
  (`${{ github.event.pull_request.title }}` in `run:`), command injection (`execSync` with a CLI flag), secret
  leaked to logs — each asserting `security < PASS_THRESHOLDS.security` and `computeVerdict(...).pass === false`;
  optionally an `llm-rubric` (judge from a different model family than the reviewer) that the issues list names
  the vulnerability. PR #20 already produced two real failures (security 7 and 6 → `ai-cr:passed`), which are
  ready-made regression fixtures.
- **Controls**: clean/benign fixtures that must pass. Without them a stricter security rubric can "win" by failing
  everything.
- **Truncation**: a near-cap (~60k) diff with the vulnerability placed late (Phase 3's seed sat at char 9 358 of
  129k) — also feeds tool-loop-agent F3 "choose an input-size cap from eval data".
- **Matrix**: reasoning effort `low` vs `medium` (G4), current vs anchored instructions (G3), `--repeat ≥ 3` with
  a pass-rate threshold, since scores are nondeterministic.

### 9. Alternatives assessed

| Tool | Stack fit | Verdict |
|------|-----------|---------|
| **evalite** (Matt Pocock, Vitest-based, TS-native, local UI) | `0.19.0` depends on `@ai-sdk/provider@^2` (AI SDK 5 era) + native `better-sqlite3`; `1.0.0-beta.16` has `peerOptional ai@^6` → **ERESOLVE against `ai@7`** (dry-run). Its core `evalite()` task function doesn't need the AI SDK, so it would work under `--legacy-peer-deps`, but AI SDK tracing/caching wrappers target v6, and the project is still experimental with breaking changes | Best DX on paper; blocked by `ai@7` today |
| **vitest-evals** (Sentry) | `0.17.0` (2026-09-10): `peer ai >=4 <7` (optional) → **ERESOLVE against `ai@7`** (dry-run); `vitest >=4 <5` fits | Blocked by `ai@7` today |
| **Plain vitest + own scorers** | Zero new deps; vitest 4 already in the package; `MockLanguageModelV4` pattern exists | Viable fallback; you'd rebuild repeat/aggregation, LLM-judge, result history and a matrix view |
| **autoevals** (Braintrust, TS) | Scorer library only; usable inside promptfoo or vitest | Complement, not a runner |
| DeepEval, Inspect AI, RAGAS | Python-first; would call the TS agent across a process/HTTP boundary | Misaligned with the stack |

## Code References

- `packages/code-reviewer/src/index.ts:1-15` — side-effect-free barrel; the eval's import surface
- `packages/code-reviewer/src/agent/reviewer.ts:13` — `MAX_OUTPUT_TOKENS = 8192` (covers reasoning + answer)
- `packages/code-reviewer/src/agent/reviewer.ts:15-23` — `createReviewerAgent({ model })`, the injection seam (G3)
- `packages/code-reviewer/src/agent/reviewer.ts:27-33` — lazy memoised default agent (import purity)
- `packages/code-reviewer/src/agent/reviewer.ts:35-47` — `reviewCode`: no abortSignal/retries/usage (G1, G2, G5)
- `packages/code-reviewer/src/agent/tools.ts:3-5` — empty tool set; add `stopWhen` before adding tools
- `packages/code-reviewer/src/prompts/reviewer.ts:4-5` — 4 000 / 60 000 char caps
- `packages/code-reviewer/src/prompts/reviewer.ts:7-35` — `REVIEWER_INSTRUCTIONS` (rubric anchors live here)
- `packages/code-reviewer/src/prompts/reviewer.ts:40-56` — tag neutralisation + `buildReviewPrompt`
- `packages/code-reviewer/src/model.ts:5-10` — OpenRouter model, `reasoning: { effort: 'low' }` hard-coded (G4)
- `packages/code-reviewer/src/config.ts:3-16` — env schema, default `anthropic/claude-sonnet-5`
- `packages/code-reviewer/src/schemas/review.ts:3-37` — model-facing `ReviewSchema` vs enforced `ScoresSchema`
- `packages/code-reviewer/src/schemas/input.ts:4-8` — `ReviewInputSchema` = fixture format
- `packages/code-reviewer/src/verdict.ts:5-22` — `PASS_THRESHOLDS`, `computeVerdict` (deterministic oracle)
- `packages/code-reviewer/src/format.ts:52-54` — PR-comment footer admitting the security score is uncalibrated
- `packages/code-reviewer/src/run-cli.ts:43-44` — message-only error logging (G6)
- `packages/code-reviewer/src/agent/reviewer.test.ts:9-21`, `src/run-cli.test.ts:12-24` — duplicated mock-model helper (G7)
- `packages/code-reviewer/src/index.test.ts:14-27` — import-purity and lazy-config tests
- `packages/code-reviewer/package.json:6-16` — `main` without `exports`/`types`; `tsx` start; `vitest run`
- `packages/code-reviewer/tsconfig.json:1-23` — `rootDir: src`, `include: [src]`, no `declaration`
- `.github/actions/code-review/action.yml` — `npm ci` + build, diff assembly/ordering, `timeout 300`
- `.github/workflows/code-review.yml:7-10` — labels are advisory and self-attested

## Architecture Insights

- **Seams were designed for this change.** Every structural decision in tool-loop-agent (lazy config, injected
  model, TS-module prompts, standalone schema module, offline harness) names the promptfoo provider as the
  consumer. The remaining gaps are call-level knobs (signal, retries, effort, instructions, usage), not structure.
- **Two-schema pattern.** The model sees a permissive schema and the code enforces a strict one. Evals inherit
  that: schema failures are provider errors, so assertions can focus on judgement quality.
- **Verdict is policy, scores are judgement.** `computeVerdict` is deterministic and unit-tested; the unreliable
  part is the model's `scores.security`. Evals should target the judgement (scores/issues on labelled fixtures)
  and reuse the policy as an oracle, never re-derive thresholds.
- **Standalone-package isolation is the repo convention.** Root tooling ignores `packages/**`; the package has its
  own lockfile and CI builds it on its own. A nested, separately-installed evals project fits that convention and
  protects the per-PR review job from promptfoo's weight.
- **Cancellation must be explicit.** promptfoo's timeout is cooperative (it aborts a signal); the action's
  `timeout 300` is a process-level workaround for the same missing parameter. Fixing G1 serves both.

## Historical Context (from prior changes)

- `context/archive/2026-09-10-tool-loop-agent/plan-brief.md:9,22,31,52,73` — the library split exists "first of
  all" for a future promptfoo eval provider; bare-name import (`exports`/`.d.ts`) was deferred to this change;
  success criterion: a provider can `import { reviewCode } from "./src/index.ts"` with no side effects.
- `context/archive/2026-09-10-tool-loop-agent/plan.md:64-66` — promptfoo provider contract noted (`id()`,
  `callApi`, `transform: JSON.parse(output)`); now outdated: an object `output` works without a transform in YAML
  assertions.
- `context/archive/2026-09-10-tool-loop-agent/follow-ups/review-fixes.md:6-17` — F3 queue carried into this
  change: abortSignal/timeout (the spike confirms promptfoo aborts the signal), input-size cap from eval data,
  explicit `maxRetries`, `declaration`/`types` only if importing `dist/`, message-only error logging.
- `context/archive/2026-09-11-ci-cd-code-review/change.md:14-17` — `reasoning: { effort: 'low' }` +
  `maxOutputTokens: 8192` adopted after default effort burned the 2048-token budget with no JSON.
- `context/archive/2026-09-11-ci-cd-code-review/change.md:19-23` — the diff-ordering incident (docs crowded code out
  of the 60k window) that fixture generation must reproduce.
- `context/archive/2026-09-11-ci-cd-code-review/change.md:24-32` and `follow-ups/review-fixes.md:5-24` — manual
  check 3.2 failed: seeded PR #20 got security 7 and 6 → `ai-cr:passed`. The follow-up asks for rubric anchors,
  a seeded eval fixture set asserting security below the floor, and a `low` vs `medium` effort comparison.
- `context/foundation/lessons.md` — no eval-specific lesson yet. Two transfer: "a self-reported metric is not a
  metric" (score what the fixture labels say, not what the model claims) and "don't format files you don't mean
  to" (applies when adding eval YAML/markdown next to `context/` docs).

## Related Research

- `context/archive/2026-09-11-ci-cd-code-review/research.md` — CI workflow design for the same reviewer
- `context/archive/2026-09-10-tool-loop-agent/plan.md` — the refactor that produced today's importable seams

## Open Questions

1. **Layout**: nested `packages/code-reviewer/evals/` (recommended) vs devDependency vs `npx` — and whether evals
   should run in CI at all (manual/`workflow_dispatch` vs per-PR), given real OpenRouter cost per case.
2. **Return shape for G2**: new `runReview()` returning `{ review, usage, finishReason, modelId }` with `reviewCode`
   kept as a wrapper, or extend `reviewCode`'s return type (breaking for the CLI's JSON output shape)?
3. **Judge model** for `llm-rubric`: which OpenRouter model, and should it be a different family from the reviewer
   to limit self-grading bias?
4. **Fixture provenance**: extract the action's diff assembly into a reusable script, or keep fixtures hand-built
   and document the command?
5. **Nested-layout resolution** (`evals/` importing `../src/index.js`, which resolves `ai` from the parent
   `node_modules`) is expected to work by Node's resolution rules but was not exercised — verify in the first
   planning phase.
6. **Caching**: wrap provider calls with promptfoo's cache (keyed on model + effort + instructions hash + input)
   to make re-runs of unchanged cases free, or always run fresh to measure variance?
7. Spike evidence lives only in this session's scratchpad (`scratchpad/pf/evals/`); the plan should recreate it as
   the offline "wiring" run (mock model) that guards the provider contract without API cost.

## Sources

- [Promptfoo is joining OpenAI (promptfoo.dev blog)](https://www.promptfoo.dev/blog/promptfoo-joining-openai/)
- [OpenAI to acquire Promptfoo (openai.com)](https://openai.com/index/openai-to-acquire-promptfoo/)
- [promptfoo — Custom JavaScript provider](https://www.promptfoo.dev/docs/providers/custom-api/)
- [promptfoo — OpenRouter provider](https://www.promptfoo.dev/docs/providers/openrouter/)
- [promptfoo — Command line](https://www.promptfoo.dev/docs/usage/command-line/)
- [promptfoo — Configuration reference](https://www.promptfoo.dev/docs/configuration/reference/)
- [promptfoo — LLM Rubric](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/)
- [promptfoo — Model-graded metrics](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/)
- [promptfoo — Telemetry](https://www.promptfoo.dev/docs/configuration/telemetry/)
- [promptfoo `src/esm.ts` (TS loader)](https://raw.githubusercontent.com/promptfoo/promptfoo/main/src/esm.ts)
- [promptfoo TypeScript provider example](https://github.com/promptfoo/promptfoo/tree/main/examples/provider-custom/typescript)
- Context7: `/promptfoo/promptfoo` (custom providers, assertions, Node API / TS config)
- [npm: promptfoo](https://registry.npmjs.org/promptfoo/latest), [npm: evalite](https://registry.npmjs.org/evalite), [npm: vitest-evals](https://registry.npmjs.org/vitest-evals)
- [Evalite (GitHub)](https://github.com/mattpocock/evalite), [Evalite on InfoQ](https://www.infoq.com/news/2025/11/evalite-ai-testing/)
- [Braintrust vs. Promptfoo (2026)](https://www.braintrust.dev/articles/braintrust-vs-promptfoo), [DeepEval alternatives (2026)](https://www.braintrust.dev/articles/deepeval-alternatives-2026)
