# code-reviewer evals

[promptfoo](https://www.promptfoo.dev/) evals for the reviewer in `../src`: the same instructions, agent and output
schema that run in CI, fed fixture pull requests and graded per model. This is a separate project with its own
lockfile, so promptfoo (~2.4 GB installed) never enters the reviewer's `npm ci` in the CI review job.

It answers two questions, and the set is deliberately the same for both:

- **Which model should CI review with?** `npm run matrix` runs every model in `promptfooconfig.ts` over the same
  diffs and prints pass/fail per seeded flaw next to cost and latency.
- **Did a change to the reviewer make it worse?** `npm run gate` runs one model over the same diffs and compares
  it to `baseline.json`. Run it before and after touching the prompt, the schema or the verdict thresholds.

## Setup

```sh
cd packages/code-reviewer && npm ci
cd evals && npm ci
```

Both installs are needed: the eval files import the reviewer from `../src`, which resolves `ai`, `zod` and the
OpenRouter provider from `packages/code-reviewer/node_modules`.

The paid runs read `OPENROUTER_API_KEY` from `packages/code-reviewer/.env` (see `../.env.example`); the same key
serves the reviewed models and the judge. The smoke run needs no key.

npm may report blocked install scripts (`@playwright/browser-chromium`, `@swc/core`, `onnxruntime-node`, `sharp`,
`protobufjs`); the evals run without them.

## Run

All commands run in `packages/code-reviewer/evals/`.

| Command                        | What it does                                                            | Cost     |
| ------------------------------ | ----------------------------------------------------------------------- | -------- |
| `npm run eval:smoke`           | The whole chain on mock models: loaders, provider, verdict assertions    | free     |
| `npm run matrix`               | Every model in `promptfooconfig.ts` over all three diffs, then tables    | paid     |
| `npm run matrix -- --repeat 3` | Three runs per model — output varies, so use this before deciding        | 3×       |
| `npm run gate`                 | Gate model over all three diffs vs `baseline.json`; exit 1 on regression | paid     |
| `npm run gate:update`          | Rewrites `baseline.json` from the last gate output — no model calls      | free     |
| `npm run report`               | Re-prints the tables from the last `matrix` output — no model calls      | free     |
| `npm run eval`                 | The bare promptfoo run behind `matrix`, without the report               | paid     |
| `npm run view`                 | Local web UI with the run history, including every judge reason          | free     |

`npm run matrix` and `npm run gate` write raw promptfoo JSON to `results/` (git-ignored) and read it back with
`report.ts`. Extra flags pass through: `npm run gate -- --repeat 3`.

The gate runs the reviewer's own default model (`anthropic/claude-sonnet-5`, from `../src/config.ts` — the CI
workflow sets no override). `GATE_MODEL=… npm run gate` points it elsewhere; `baseline.json` records which model
it was recorded for, and the check refuses to compare across models.

`baseline.json` records what the gate model does **today**, known failures included — `flaw_default_props` sits at
0/3, see the follow-up in `context/changes/code-review-evals/follow-ups/`. That is the point: the gate fails on a
*drop* from the recorded rate, so it works on a suite the reviewer does not yet fully pass. Recording it at
`--repeat 3` means a metric at 3/3 tolerates nothing while a 2/3 metric tolerates one flake. To start a baseline
from scratch (or after deliberately changing what the suite measures):

```sh
npx promptfoo eval -c promptfooconfig.gate.ts --env-file ../.env --repeat 3 --output results/gate.json
npm run gate:update
```

## The fixtures

Three diffs, because a single PR cannot separate a model that finds defects from one that flags everything:

| Fixture                | What it is                                                | What it measures             |
| ---------------------- | --------------------------------------------------------- | ---------------------------- |
| `react-19-migration`   | React 16 → 19 port, 3 flaws among correct new idioms      | recall + precision on idioms |
| `deck-search-endpoint` | New endpoint: SQL injection + `ownerId` from query string | security recall, calibration |
| `clean-control`        | Small, correct, tested helper — nothing to find           | precision: does it cry wolf? |

`clean-control` is the counterweight to every recall metric: a reviewer that calls everything broken scores well
on the two flawed fixtures and fails here, and `verdict_passes` catches it deterministically.

## Reading results

- **Exit code 100** from promptfoo means at least one assertion failed. For `matrix` that is the normal outcome of
  a model missing a flaw, not a broken harness — `npm run matrix` therefore reports and exits 0, and only a
  different non-zero exit (bad config, missing key, fixture over cap) stops it. `eval:smoke` must exit 0, and
  `npm run gate` exits 1 only on a regression against the baseline.
- **Deterministic metrics** come from the package's own `computeVerdict` and thresholds, never re-typed in the
  eval: `verdict_fails` (a flawed fixture must fail), `verdict_passes` (the control must pass) and
  `security_floor_trips` (an exploitable flaw must push `security` under its floor, not merely get a mention —
  scoring a SQL-injection PR 7/10 on security still ships it).
- **Judged metrics** are one rubric per seeded flaw (`flaw_default_props`, `flaw_effect_cleanup`, `flaw_xss`,
  `flaw_sql_injection`, `flaw_broken_authz`), passed only when the review names the defect at the right code *and*
  states its consequence. `no_false_react19_flags` and `no_invented_defects` fail a review that calls correct code
  a bug; suggestions and "consider …" notes are explicitly allowed.
- **Cost and latency are per reviewer call.** promptfoo's `cost` is the reviewed model's own billing as reported by
  OpenRouter — judge tokens land in `tokenUsage`, not in `cost`, so the cost column is what reviewing one PR
  costs. `latencyMs` is the reviewer call's wall clock, so it includes whatever host OpenRouter routed to.
- **A provider error is a result.** `… (finishReason: length)` means the model spent its output cap (8,192 tokens,
  reasoning included) without producing a valid review. `metadata.upstreamProvider` names the host OpenRouter
  routed the call to. An errored run still counts in a metric's denominator: a model that fails to answer must not
  score better than one that answers badly.
- **One run is not a ranking.** Model output varies run to run; `--repeat 3` and the `n/3` cells exist so a single
  lucky or unlucky review cannot decide anything.

## Rules

- **Never import `ai` under `evals/`** — values or types, `ai` or `ai/test`. promptfoo installs its own `ai@6`
  into `evals/node_modules`, which wins module resolution here. Everything SDK-related comes through `../src`; the
  mock model lives in `../src/testing/`.
- **Fixture text never goes into promptfoo vars.** A test passes `fixture: '<name>'` and the provider loads
  `fixtures/<name>/pr.json` (`title`, `description`) and `pr.diff` itself. promptfoo renders every var through
  Nunjucks, and a diff is full of `{{ … }}`. `loadFixture` rejects a fixture over the reviewer's input caps, so the
  eval never grades a truncated input.
- **Every config shares `cases.ts`.** The comparison, the gate and the smoke run must grade the same inputs against
  the same ground truth, or the gate stops meaning anything. Adding a fixture means adding it to `allCases`.
- **Fixtures are excluded from the CI review diff** (`.github/actions/code-review/action.yml`): they carry flaws on
  purpose, and a PR touching them would otherwise hand the reviewer seeded bugs as its own code.
- **A rubric tuned after reading one run's outputs is fitted to that run.** Change a rubric on its own merits, and
  re-measure with `--repeat 3` before and after.
- **Privacy.** The paid runs store every run — reviews, judge reasons and fixture names; diff text only where a
  review quotes it — in a local SQLite database under `~/.promptfoo`, plus the JSON under `results/`.
  `eval:smoke` (`--no-write`) stores nothing. Telemetry and the update check are on by default; opt out with
  `PROMPTFOO_DISABLE_TELEMETRY=1` and `PROMPTFOO_DISABLE_UPDATE=1`.
