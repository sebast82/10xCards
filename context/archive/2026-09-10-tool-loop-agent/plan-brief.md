# Code Reviewer on ToolLoopAgent — Plan Brief

> Full plan: `context/changes/tool-loop-agent/plan.md`

## What & Why

Turn the one-file script `packages/code-reviewer/src/index.ts` into a modular code-review library built on the
AI SDK `ToolLoopAgent`, with the schema, prompts, config, model, agent and CLI in separate modules. The goal is a
reviewer that other code can import, first of all a future promptfoo eval provider. Today that's impossible,
because importing the file exits the process on bad env and runs the CLI.

## Starting Point

A standalone package (its own lockfile, TS 7 `nodenext`, `ai@7.0.97`, no test runner) where one file does
everything through `generateText` + `Output.object`. Root tooling quietly covers it: the per-edit hook and
pre-commit run root `eslint --fix` (it would rewrite the package's quotes), `astro check` typechecks it under the
Astro tsconfig, and root vitest would collect its tests.

## Desired End State

`import { createReviewerAgent, reviewCode } from "./src/index.ts"` is inert. This is a relative import: the package
doesn't ship `exports` or `.d.ts` yet, so a bare `"code-reviewer"` import is left to the promptfoo change. You can inject any model, and a call
returns a typed `Review` or throws. `npm start -- "<code>"` works as before. `npm test` in the package runs
offline against a mock model. Root tooling ignores `packages/**`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Tools | None yet; empty `agent/tools.ts` seam | A pure structural migration that stays deterministic enough for a first eval baseline. |
| Public API | `createReviewerAgent({ model })` + `reviewCode(code, { agent? })` | Evals and tests can inject models; simple callers get a one-liner. |
| Config | Lazy `loadConfig()` that throws; only the CLI sets the exit code | Importing never kills the process, and errors still name the missing var. |
| Output schema | Same shape, `.describe()` added | No contract change in a refactor; descriptions guide the model for free. |
| Code framing | `buildReviewPrompt` wraps the code in `<code_to_review>` and neutralises the closing tag | Hardens against instructions embedded in the reviewed code. |
| Prompt storage | TS modules (`prompts/reviewer.ts`) | Type-checked, no fs/build copy step, importable by a provider. |
| Testing | vitest + `MockLanguageModelV4`, inside the package | Proves the exported contract offline at no API cost. |
| Root tooling | Isolate: `packages/**` ignored by root eslint, prettier, tsconfig and vitest | It's a standalone project; one toolchain per file, no hook rewriting its style. |

## Scope

**In scope:** module split; `ToolLoopAgent` migration; side-effect-free barrel + separate CLI; package build
config that keeps tests out of `dist/`; offline unit tests; four root config excludes (eslint, prettier, tsconfig, vitest).

**Out of scope:** promptfoo config/provider/deps, agent tools, schema field changes, streaming, model changes,
reformatting to root style, package-level CI or pre-commit, SDK upgrade.

## Architecture / Approach

`cli.ts` → `reviewCode()` (`agent/reviewer.ts`) → a `ToolLoopAgent` built by `createReviewerAgent({ model })`
from `prompts/reviewer.ts` (instructions + delimited user prompt), `schemas/review.ts` (`Output.object`) and
`agent/tools.ts` (empty). When no agent is injected, a default one is built lazily from `config.ts` → `model.ts`
(OpenRouter). `index.ts` only re-exports. A future promptfoo provider calls `reviewCode` or `agent.generate`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Isolate from root tooling | Root eslint, prettier, tsconfig and vitest skip `packages/**` | Must land before any package edit, or the per-edit hook rewrites files mid-implementation |
| 2. Modular library on ToolLoopAgent | Module split, agent factory, `reviewCode`, CLI split, build config | Behaviour drift in the CLI; OpenRouter handling of an empty tool set |
| 3. Offline test harness | vitest + mock-model tests for output, failures, wiring, framing, config, import purity | Asserting the wrong SDK error class; vacuous tests |

**Prerequisites:** `npm install` in `packages/code-reviewer`; an OpenRouter key in its `.env` for the manual CLI run.
**Estimated effort:** ~1 session across 3 small phases.

## Open Risks & Assumptions

- After isolation the root commit gate no longer checks package code, so the package's `typecheck`/`test` must be run explicitly.
- The delimited prompt may shift review wording slightly, and there is no eval baseline yet to measure it.
- When the package is first committed, the root `.gitignore` patterns `.claude/skills/*` and `.agents/*` are root-anchored, so the vendored AI SDK skills under `packages/code-reviewer/.claude/` and `.agents/` would be tracked. Decide at commit time.

## Success Criteria (Summary)

- A promptfoo provider (or any script) inside the package can `import { reviewCode } from "./src/index.ts"` with no side effects and get a typed `Review`.
- `npm start` reviews code exactly as before; `npm test` proves the agent contract offline.
- Root `npm run typecheck`, `npm test` and `npm run lint` stay green and no longer touch the package.
