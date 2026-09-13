# Code Review Evals (promptfoo) — Plan Brief

> Full plan: `context/changes/code-review-evals/plan.md`
> Research: `context/changes/code-review-evals/research.md`

## What & Why

Add a first promptfoo eval to `packages/code-reviewer`: the same reviewer prompt runs on three OpenRouter models
against one complex React 16 → 19 migration diff with three seeded flaws. An LLM judge checks, flaw by flaw,
whether each review found what is broken, and a deterministic check confirms the review fails. Today model choice
and prompt quality are judged by anecdote (PR #20's seeded vulnerabilities passed unnoticed); this gives a
repeatable measurement.

## Starting Point

The reviewer is already an importable, side-effect-free library with model injection, TS-module prompts, a Zod
output contract and a pure `computeVerdict`. It lacks cancellation, usage/cost reporting and a retry bound, and no
eval tooling, fixture or config exists.

## Desired End State

`npm run eval` in `packages/code-reviewer/evals/` prints a matrix — Claude Sonnet 5, GLM 5.1, DeepSeek V4 Flash ×
five named checks (`flaw_default_props`, `flaw_effect_cleanup`, `flaw_xss`, `no_false_react19_flags`,
`verdict_fails`) — with tokens and
cost per model, browsable in `npm run view`. `npm run eval:smoke` proves the harness offline, with no API key.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Eval toolkit | promptfoo `0.123.0`, pinned | Only TS-native option compatible with `ai@7`; spike-verified loader, abort, exit codes. | Research |
| Layout | Nested `evals/` project with own lockfile | Keeps promptfoo's ~2.4 GB install out of the per-PR review job's `npm ci`. | Research |
| No `ai` imports in `evals/` | Everything SDK-related comes via `../src` | promptfoo nests `ai@6.0.280`; direct imports resolved to v6 in the spike. | Plan |
| Models | `anthropic/claude-sonnet-5` (baseline), `z-ai/glm-5.1`, `deepseek/deepseek-v4-flash` | Challengers are measured against what CI runs today. | Plan |
| Judge | `openai/gpt-5.4` via OpenRouter | Different family from all three reviewers — no self-preference bias. | Plan |
| Flaws | `defaultProps` ignored on function component; effect without unsubscribe; `dangerouslySetInnerHTML` XSS | Three categories (React 19 break, lifecycle, security), all realistic migration slips. | Plan |
| Grading | One `llm-rubric` per flaw (threshold 1, named metric) + `no_false_react19_flags` rubric + static `verdict_fails` | The model × flaw matrix shows exactly who misses what; the precision rubric stops "flag everything" from scoring full marks. | Plan / plan-review F2 |
| Library seam | `runReview` (usage, finishReason, modelId, metadata), `abortSignal`, `maxRetries: 1` | Cost/tokens are half of a model comparison; timeouts must stop billing. | Plan |
| Running | Local scripts, repeat 1 (`--repeat 3` documented) | Cheap iteration, no new CI secrets surface. | Plan |

## Scope

**In scope:**
- `runReview` + abort signal + retry bound; shared mock model in `src/testing/` (excluded from build)
- `evals/` project: provider, assertion helper, smoke config, main config, README
- One React 19 migration fixture (`pr.json` + `pr.diff`) and three ground-truth rubrics

**Out of scope:**
- CI job for evals; prompt or reasoning-effort variants; security-calibration anchors (ci-cd follow-up F1)
- More fixtures (incl. a clean control), response caching, CLI/verdict/workflow changes

## Architecture / Approach

`promptfooconfig.ts` → three `file://provider.ts` instances (one per `config.model`) → `runReview()` from
`../src` (real `ToolLoopAgent`, `REVIEWER_INSTRUCTIONS`, OpenRouter model) → `Review` object + tokens/cost →
assertions: `verdictFails` (package's `computeVerdict`) and three `llm-rubric` checks graded by
`openrouter:openai/gpt-5.4`. The test case (fixture vars + assertions) lives in `cases.ts`, shared by the main
config and the mock-model smoke config.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Library seam | `runReview`, abort signal, `maxRetries: 1`, shared mock model, unit tests | Asserting signal identity instead of state; 2 s retry backoff in tests |
| 2. Evals project + offline smoke | Nested promptfoo project, provider, assertion helper, smoke config, README | An `ai` import slipping into `evals/` (resolves v6) |
| 3. Fixture + three-model config | React 19 diff with 3 flaws, per-flaw rubrics, main config, first paid run | Fixture flaws not crisp enough for a fair judge; judge disagreeing with humans |

**Prerequisites:** `npm ci` in `packages/code-reviewer`; `OPENROUTER_API_KEY` in `packages/code-reviewer/.env`
(Phase 3 paid run only); Node ≥ 24.
**Estimated effort:** ~1–2 sessions across 3 phases (fixture authoring is the largest single item).

## Open Risks & Assumptions

- A single pass per model is noisy; conclusions about model ranking need `--repeat 3`.
- GLM 5.1 / DeepSeek V4 Flash may burn the 8,192-token output cap on reasoning at effort `low`; this surfaces as a
  provider error with `finishReason: length`, which is itself a result, not a harness bug.
- OpenRouter may route GLM / DeepSeek to an upstream host that ignores `response_format`; `metadata.upstreamProvider`
  lets such a failure be attributed to the host, not the model. Pinning via `provider.require_parameters` would
  change `model.ts` (production) and is deferred.
- The PR that adds the flawed fixture will be reviewed by the advisory AI reviewer and may get `ai-cr:failed`.
- Prices quoted are OpenRouter list prices on 2026-09-11 and will drift.

## Success Criteria (Summary)

- One command compares three models on the same prompt and shows, per model, which of the three flaws it caught,
  whether its verdict failed, and what it cost.
- The harness is provably correct offline (`eval:smoke`), and the reviewer's CLI and CI behaviour are unchanged.
