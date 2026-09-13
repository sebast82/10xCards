---
change_id: code-review-model-gate
title: Compare reviewer models on one eval set, and keep it as a regression gate
status: implemented
created: 2026-09-13
updated: 2026-09-13
archived_at: null
---

## Notes

Follow-on to `code-review-evals`, which left the harness at one fixture and explicitly deferred "no dataset
of real PRs" and "no clean control fixture". Built directly, without a `/10x-plan` cycle: the shape was
already fixed by the existing harness.

What changed in `packages/code-reviewer/evals/`:

- **Two more fixtures**, so no conclusion rests on a single PR. `deck-search-endpoint` (SQL injection via
  template-interpolated SQL + `ownerId` taken from the query string) and `clean-control` (a small, correct,
  tested, documented helper). Both diffs were generated from a throwaway git repo, so hunk headers and
  blob hashes are real rather than hand-written.
- **`clean-control` is the counterweight to every recall metric.** With only flawed fixtures, "found all
  three flaws" and "calls everything broken" score identically. `verdict_passes` (deterministic) plus
  `no_invented_defects` (judged, and explicit that suggestions and "consider …" notes are fine) separate them.
- **Calibration, not just recall.** `security_floor_trips` asserts an exploitable flaw pushes the `security`
  score under `PASS_THRESHOLDS.security`. Naming a vulnerability in prose while scoring security 7/10 still
  ships the PR, because `computeVerdict` gates on the score.
- **`report.ts`** turns promptfoo's JSON into the comparison tables, and doubles as the gate
  (`--check baseline.json`, `--update`). promptfoo's per-result `cost` is the reviewed model's own OpenRouter
  billing — judge tokens land in `tokenUsage`, not `cost` — so the cost column is what reviewing one PR costs.
  An errored run still counts in a metric's denominator: a model that fails to answer must not outscore one
  that answers badly.
- **`promptfooconfig.gate.ts` + `baseline.json`**: one model, the same three diffs and the same ground truth,
  compared to recorded per-metric pass rates. Exit 1 on a drop.
- **`run.ts`** because `promptfoo eval` exits 100 when an assertion fails (the normal outcome of a model
  missing a flaw) and `;` is not a command separator in `cmd.exe`, so the npm scripts could not chain.
- Every config shares `cases.ts`, so the comparison, the gate and the offline smoke run can never drift onto
  different inputs or different ground truth.
- The smoke run's mock is now keyed by fixture, which exercises `verdict_fails`, `verdict_passes` and
  `security_floor_trips` in both directions offline, at zero cost.

## Results

`eval-7yx-2026-09-13T21:25:19` — 3 diffs × 3 models × 3 runs = 27 reviews, judged by `openai/gpt-5.4`.

| Model               | Assertions | Reviews | Cost / review | Median latency | Slowest |
| ------------------- | ---------- | ------- | ------------- | -------------- | ------- |
| `claude-sonnet-5`   | 30/33      | 9/9     | $0.0191       | 7.7 s          | 15.2 s  |
| `glm-5.1`           | 26/33      | 8/9     | $0.0109       | 30.5 s         | 67.2 s  |
| `deepseek-v4-flash` | 28/33      | 9/9     | $0.0008       | 77.4 s         | 184.7 s |

Where they differ (3 runs each):

| Metric                                       | `claude-sonnet-5` | `glm-5.1` | `deepseek-v4-flash` |
| -------------------------------------------- | ----------------- | --------- | ------------------- |
| `flaw_sql_injection`, `flaw_broken_authz`    | 3/3               | 3/3       | 3/3                 |
| `security_floor_trips`                       | 3/3               | 3/3       | 3/3                 |
| `flaw_xss`, `flaw_effect_cleanup`            | 3/3               | 2/3       | 3/3                 |
| `no_false_react19_flags`                     | 3/3               | 2/3       | 2/3                 |
| `no_invented_defects` (clean control)        | 3/3               | 2/3       | 3/3                 |
| `flaw_default_props`                         | 0/3               | 1/3       | 0/3                 |

A first run (`eval-uWt`, same shape) scored 31/30/29 and is kept only as context for the fixture fix below;
its `clean-control` differs, so it is not comparable metric-for-metric.

## Decision: keep `anthropic/claude-sonnet-5` in CI

- **The price gap is real but the absolute cost is not.** DeepSeek V4 Flash reviews a PR for $0.0008 against
  Sonnet's $0.0191 — 24× cheaper, and still only ~$0.018 saved per PR. At 200 PRs/month that is $3.80 vs
  $0.16. Nothing about this decision should be made on cost at this volume.
- **Latency is the operational argument.** The CI action kills a review at `timeout 300`. Sonnet's slowest of
  nine reviews was 15.2 s; DeepSeek's was 184.7 s on a 19 KB diff, and the reviewer's input cap is 60 KB.
  The cheap model is the one that can time the job out.
- **Both cheaper models cost accuracy where it matters least predictably.** DeepSeek called correct React 19
  (`<ThemeContext value>`) a bug in 1 of 3 runs; GLM 5.1 invented a defect on the clean PR in 1 of 3, missed
  the XSS and the effect-leak once each, and returned no output at all once. A reviewer that cries wolf is
  the failure mode that gets a bot ignored.
- **Stability, not just the average.** Across the two runs Sonnet scored 31 and 30 of 33; GLM 30 then 26.
  Three runs per model is enough to see that spread and not enough to rank the two cheaper models against
  each other — which is fine, because neither is a candidate.
- **All three pass the security case.** Every model named the SQL injection and the IDOR and scored security
  under the floor, all 3 runs. The security floor is not what separates them.

## Caveats and follow-ups

- **`flaw_default_props` measures the rubric, not the models** — 0/3, 1/3, 0/3. All three name
  `DeckPanel.defaultProps` and say React 19 ignores it; the judge docks them for not stating that the render's
  `formatDueDate(…)` call then throws. This is the open follow-up F1 in `code-review-evals`, which asked for a
  `--repeat 3` measurement before and after retuning the bar: the "before" is now recorded.
- **The clean control's PR description was fixed mid-change, after GLM 5.1 flagged it.** The description
  claimed `<time dateTime>` keeps the timestamp available "to screen readers and on hover", which it does not
  reliably do — a correct review had something real to report, so the fixture was measuring itself. The
  description now claims only that the timestamp stays in the markup in machine-readable form. The rubric was
  not touched: fixing an inaccuracy in the instrument is not fitting the grader to the results.
- **Three diffs is a short set, not a benchmark.** It covers a framework migration, a security regression and
  a clean change. It says nothing about large diffs, non-TypeScript code, or PRs whose description lies.
- **Discharged from `code-review-evals`:** impl-review F1 — eval fixtures now excluded from the CI review
  diff in `.github/actions/code-review/action.yml`, so a PR touching them no longer hands the reviewer
  deliberately seeded vulnerabilities as its own code.
