# code-reviewer evals

[promptfoo](https://www.promptfoo.dev/) evals for the reviewer in `../src`: the same instructions, agent and output
schema that run in CI, fed a fixture pull request and graded per model. This is a separate project with its own
lockfile, so promptfoo (~2.4 GB installed) never enters the reviewer's `npm ci` in the CI review job.

## Setup

```sh
cd packages/code-reviewer && npm ci
cd evals && npm ci
```

Both installs are needed: the eval files import the reviewer from `../src`, which resolves `ai`, `zod` and the
OpenRouter provider from `packages/code-reviewer/node_modules`.

The paid run reads `OPENROUTER_API_KEY` from `packages/code-reviewer/.env` (see `../.env.example`); the same key
serves the reviewed models and the judge. The smoke run needs no key.

npm may report blocked install scripts (`@playwright/browser-chromium`, `@swc/core`, `onnxruntime-node`, `sharp`,
`protobufjs`); the evals run without them.

## Run

All commands run in `packages/code-reviewer/evals/`.

| Command                      | What it does                                                                                      | Cost          |
| ---------------------------- | ------------------------------------------------------------------------------------------------- | ------------- |
| `npm run eval:smoke`         | The whole chain — fixture loader, provider, assertions — with a mock model; nothing stored        | free, offline |
| `npm run eval`               | The reviewer on every model in `promptfooconfig.ts`, graded by the judge model                    | paid          |
| `npm run eval -- --repeat 3` | Three runs per model. Model output varies run to run: use this before deciding anything on models | 3×            |
| `npm run view`               | Local web UI with the history of `npm run eval` runs                                              | free          |

## Reading results

- **Exit code 100** means at least one assertion failed. For `npm run eval` that is the normal outcome of a model
  missing a flaw, not a broken harness. Only `eval:smoke` must exit 0.
- **Named metrics** — one per seeded flaw (`flaw_default_props`, `flaw_effect_cleanup`, `flaw_xss`), graded by an
  LLM judge that passes a review only when it names the defect at the right code and states its consequence;
  `no_false_react19_flags` fails a review that calls the fixture's correct React 19 code a bug; `verdict_fails` is
  deterministic and checks that the package's own `computeVerdict` fails the review.
- **A provider error is a result.** `… (finishReason: length)` means the model spent its output cap (8,192 tokens,
  reasoning included) without producing a valid review. `metadata.upstreamProvider` names the host OpenRouter
  routed the call to.
- **Tokens and cost** are reported per reviewer call: tokens from the AI SDK usage, cost as billed by OpenRouter.

## Rules

- **Never import `ai` under `evals/`** — values or types, `ai` or `ai/test`. promptfoo installs its own `ai@6`
  into `evals/node_modules`, which wins module resolution here. Everything SDK-related comes through `../src`; the
  mock model lives in `../src/testing/`.
- **Fixture text never goes into promptfoo vars.** A test passes `fixture: '<name>'` and the provider loads
  `fixtures/<name>/pr.json` (`title`, `description`) and `pr.diff` itself. promptfoo renders every var through
  Nunjucks, and a diff is full of `{{ … }}`. `loadFixture` rejects a fixture over the reviewer's input caps, so the
  eval never grades a truncated input.
- **Privacy.** promptfoo stores every run — full diffs and reviews included — in a local SQLite database under
  `~/.promptfoo` (even with `--no-write`). Telemetry and the update check are on by default; opt out with
  `PROMPTFOO_DISABLE_TELEMETRY=1` and `PROMPTFOO_DISABLE_UPDATE=1`.
