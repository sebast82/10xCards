# Reviewer model comparison — which model should CI review with?

Run `eval-7yx-2026-09-13T21:25:19` · 3 diffs × 3 models × 3 runs = 27 reviews · judge `openai/gpt-5.4`.

Regenerate the tables from the stored run with `npm run report` in `packages/code-reviewer/evals/`; re-measure
from scratch with `npm run matrix -- --repeat 3`.

## Headline

| Model               | Assertions | Reviews | Cost / review | Cost / 3 diffs | Median latency | Slowest | Errors |
| ------------------- | ---------- | ------- | ------------- | -------------- | -------------- | ------- | ------ |
| `claude-sonnet-5`   | **30/33**  | 9/9     | $0.0191       | $0.0572        | 7.7 s          | 15.2 s  | —      |
| `glm-5.1`           | 26/33      | 8/9     | $0.0109       | $0.0328        | 30.5 s         | 67.2 s  | 1      |
| `deepseek-v4-flash` | 28/33      | 9/9     | $0.0008       | $0.0025        | 77.4 s         | 184.7 s | —      |

`Cost / review` is the reviewed model's own OpenRouter billing for one PR — judge tokens are not in it.
GLM's one error was `No output generated`; its five metrics on that run count as failures, which is why its
total is 26 rather than 31.

## Per-metric (3 runs each)

| Fixture / metric              | `claude-sonnet-5` | `glm-5.1` | `deepseek-v4-flash` |
| ----------------------------- | ----------------- | --------- | ------------------- |
| **react-19-migration**        |                   |           |                     |
| `verdict_fails`               | ✅ 3/3            | ⚠️ 2/3    | ⚠️ 2/3              |
| `flaw_default_props`          | ❌ 0/3            | ⚠️ 1/3    | ❌ 0/3              |
| `flaw_effect_cleanup`         | ✅ 3/3            | ⚠️ 2/3    | ✅ 3/3              |
| `flaw_xss`                    | ✅ 3/3            | ⚠️ 2/3    | ✅ 3/3              |
| `no_false_react19_flags`      | ✅ 3/3            | ⚠️ 2/3    | ⚠️ 2/3              |
| **deck-search-endpoint**      |                   |           |                     |
| `verdict_fails`               | ✅ 3/3            | ✅ 3/3    | ✅ 3/3              |
| `security_floor_trips`        | ✅ 3/3            | ✅ 3/3    | ✅ 3/3              |
| `flaw_sql_injection`          | ✅ 3/3            | ✅ 3/3    | ✅ 3/3              |
| `flaw_broken_authz`           | ✅ 3/3            | ✅ 3/3    | ✅ 3/3              |
| **clean-control**             |                   |           |                     |
| `verdict_passes`              | ✅ 3/3            | ✅ 3/3    | ✅ 3/3              |
| `no_invented_defects`         | ✅ 3/3            | ⚠️ 2/3    | ✅ 3/3              |

## Cost and latency per diff

| Diff                   | `claude-sonnet-5` | `glm-5.1`        | `deepseek-v4-flash` |
| ---------------------- | ----------------- | ---------------- | ------------------- |
| `react-19-migration`   | $0.0337 · 14.7 s  | $0.0193 · 22.0 s | $0.0008 · 66.3 s    |
| `deck-search-endpoint` | $0.0126 · 7.7 s   | $0.0070 · 28.9 s | $0.0007 · 131.1 s   |
| `clean-control`        | $0.0109 · 5.8 s   | $0.0094 · 31.1 s | $0.0011 · 57.4 s    |

## Decision: keep `anthropic/claude-sonnet-5` in CI

The pass counts are close (30 / 26 / 28 of 33), so they are not the reason:

- **Cost is a non-argument at this volume.** DeepSeek V4 Flash is 24× cheaper per review and still saves only
  ~$0.018 per PR — $3.80 vs $0.16 a month at 200 PRs.
- **Latency is the real constraint.** The CI action kills a review at `timeout 300`. Sonnet's slowest of nine
  reviews was 15.2 s; DeepSeek's was 184.7 s on a 19 KB diff, and the reviewer's input cap is 60 KB. The cheap
  model is the one that can time the job out.
- **The cheaper models fail unpredictably.** DeepSeek called correct React 19 (`<ThemeContext value>`) a bug in
  1 of 3 runs and framed the IDOR as something else once; GLM invented a defect on the clean PR in 1 of 3,
  missed the XSS and the effect leak once each, and once returned no output at all. A reviewer that cries wolf
  is the failure mode that gets a bot ignored.
- **Stability, not just the average.** Across two runs of the same set Sonnet scored 31 then 30 of 33; GLM 30
  then 26. Three runs per model is enough to see that spread, and not enough to rank GLM against DeepSeek —
  which does not matter, because neither is a candidate.
- **The security case does not separate them.** All three named the SQL injection and the broken access control
  and scored `security` under the floor, in 3 of 3 runs each.

## Two caveats before trusting this table

- **`flaw_default_props` measures the rubric, not the models** (0/3, 1/3, 0/3). All three name
  `DeckPanel.defaultProps` and say React 19 ignores it on function components; the judge docks them for not
  also stating that the render's `formatDueDate(…)` call then throws. That is the open follow-up F1 in
  `code-review-evals`, which asked for exactly this `--repeat 3` "before" measurement. `baseline.json` records
  0/3, so the gate does not cry wolf while the rubric decision is pending.
- **The clean control's PR description was corrected mid-change, after GLM 5.1 flagged it.** It claimed
  `<time dateTime>` keeps the timestamp available "to screen readers and on hover", which it does not reliably
  do — so a correct review had something real to report and the fixture was measuring itself. The description
  now claims only that the timestamp stays in the markup in machine-readable form. The rubric was not touched:
  fixing an inaccuracy in the instrument is not fitting the grader to the results. The tables above are the
  post-fix run; the pre-fix run (`eval-uWt`, 31 / 30 / 29) is not comparable metric-for-metric.

Three diffs is a short set, not a benchmark. It covers a framework migration, a security regression and a clean
change, and says nothing about large diffs, non-TypeScript code, or PRs whose description lies.

## The regression gate

`npm run gate` runs the CI model over these same three diffs and compares it to `baseline.json` — 10 of 11
metrics at 3/3, `flaw_default_props` at 0/3 — exiting 1 on any drop in a metric's pass rate. Run it before and
after changing the reviewer's prompt, output schema or verdict thresholds. A new metric, or a review that got
dearer, is reported for a human to judge rather than failed; fold it in with `npm run gate:update`.

Both directions were verified offline with mock models: a simulated regression exits 1 and names the metric, a
clean run exits 0.
