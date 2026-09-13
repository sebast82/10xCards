import { readFileSync, writeFileSync } from 'node:fs';
import type { EvaluateResult, OutputFile } from 'promptfoo';

// promptfoo's `ResultFailureReason.ERROR`, inlined: importing a value from `promptfoo` would pull its whole
// runtime into a script that only reads a JSON file. 0 = passed, 1 = an assertion failed, 2 = errored.
const FAILURE_REASON_ERROR = 2;

// How much dearer a review may get before the gate mentions it. Model prices and OpenRouter routing move
// on their own, so this is a reported note, never a failure.
const COST_DRIFT_TOLERANCE = 1.5;

type MetricOutcome = { pass: number; total: number };

type Baseline = {
  gateModel: string;
  recordedAt: string;
  evalId: string | null;
  metrics: Record<string, MetricOutcome>;
  costPerReviewUsd: number | null;
  medianLatencyMs: number | null;
};

type Row = {
  model: string;
  fixture: string;
  // promptfoo returns results in completion order; these are its config order — `promptIdx` indexes the
  // prompt × provider list, `testIdx` the tests. Sorting by them keeps the CI model in the first column.
  modelIdx: number;
  fixtureIdx: number;
  metrics: Map<string, boolean>;
  cost: number | undefined;
  latencyMs: number;
  errored: boolean;
  error: string | undefined;
};

function parseArgs(argv: string[]): { input: string; baseline: string | undefined; update: boolean } {
  const positional: string[] = [];
  const queue = [...argv];
  let baseline: string | undefined;
  let update = false;
  while (queue.length > 0) {
    const arg = queue.shift();
    if (arg === undefined) break;
    if (arg === '--check') {
      baseline = queue.shift();
      if (baseline === undefined) throw new Error('--check needs the path to a baseline file');
    } else if (arg === '--update') {
      update = true;
    } else {
      positional.push(arg);
    }
  }
  const input = positional[0];
  if (input === undefined) {
    throw new Error('usage: node report.ts <results.json> [--check <baseline.json>] [--update]');
  }
  // `--update` rewrites the file `--check` reads, so one flag names the baseline for both.
  if (update && baseline === undefined) {
    throw new Error('--update needs --check <baseline.json>: the same file is read and rewritten');
  }
  return { input, baseline, update };
}

function toRows(results: EvaluateResult[]): Row[] {
  return results.map((result) => {
    const metrics = new Map<string, boolean>();
    for (const component of result.gradingResult?.componentResults ?? []) {
      const metric = component.assertion?.metric;
      if (metric !== undefined) metrics.set(metric, component.pass);
    }
    const fixture = result.vars.fixture;
    const errored = result.failureReason === FAILURE_REASON_ERROR;
    return {
      model: result.provider.label ?? result.provider.id ?? 'unknown',
      fixture: typeof fixture === 'string' ? fixture : 'unknown',
      modelIdx: result.promptIdx,
      fixtureIdx: result.testIdx,
      metrics,
      cost: result.cost,
      latencyMs: result.latencyMs,
      errored,
      // `error` also carries the reason an assertion failed, so it is only an error when `failureReason` says so.
      error: errored ? (result.error ?? undefined) : undefined,
    };
  });
}

// First-appearance order, so the tables follow the order they are given rather than an alphabet.
function ordered<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

// Config order, not completion order: rank each name by the lowest index promptfoo gave it.
function byConfigOrder(rows: Row[], name: (row: Row) => string, index: (row: Row) => number): string[] {
  const lowest = new Map<string, number>();
  for (const row of rows) {
    const key = name(row);
    lowest.set(key, Math.min(lowest.get(key) ?? Number.POSITIVE_INFINITY, index(row)));
  }
  return [...lowest.entries()].sort((a, b) => a[1] - b[1]).map(([key]) => key);
}

function modelsOf(rows: Row[]): string[] {
  return byConfigOrder(
    rows,
    (row) => row.model,
    (row) => row.modelIdx,
  );
}

function fixturesOf(rows: Row[]): string[] {
  return byConfigOrder(
    rows,
    (row) => row.fixture,
    (row) => row.fixtureIdx,
  );
}

function median(values: number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function defined(values: (number | undefined)[]): number[] {
  return values.filter((value): value is number => value !== undefined);
}

function usd(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(4)}`;
}

function seconds(value: number | null): string {
  return value === null ? '—' : `${(value / 1000).toFixed(1)} s`;
}

function table(header: string[], rows: string[][]): string {
  const separator = header.map(() => '---');
  return [header, separator, ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n');
}

// The metric names each fixture produced, across every model: a metric only one model managed to
// produce still gets a column entry for the others, which is how a missed metric stays visible.
function metricNames(rows: Row[]): Map<string, string[]> {
  const byFixture = new Map<string, string[]>();
  for (const fixture of fixturesOf(rows)) {
    byFixture.set(
      fixture,
      ordered(rows.filter((row) => row.fixture === fixture).flatMap((row) => [...row.metrics.keys()])),
    );
  }
  return byFixture;
}

// Every run of that (model, fixture) counts in the denominator, including runs that errored before
// producing a review — otherwise a model that fails to answer scores better than one that answers badly.
function outcome(rows: Row[], model: string, fixture: string, metric: string): MetricOutcome {
  const runs = rows.filter((row) => row.model === model && row.fixture === fixture);
  return { pass: runs.filter((row) => row.metrics.get(metric) === true).length, total: runs.length };
}

function render(output: OutputFile, rows: Row[]): string {
  const models = modelsOf(rows);
  const fixtures = fixturesOf(rows);
  const metrics = metricNames(rows);
  const repeats = fixtures.length === 0 ? 0 : rows.filter((row) => row.model === models[0]).length / fixtures.length;
  const timestamp = 'timestamp' in output.results ? output.results.timestamp : 'unknown';

  const lines: string[] = [];
  lines.push('# code-reviewer model comparison');
  lines.push('');
  lines.push(`- Eval \`${output.evalId ?? 'not stored'}\` · ${timestamp}`);
  lines.push(`- ${fixtures.length} diffs × ${models.length} models × ${repeats} run(s) = ${rows.length} reviews`);
  lines.push('');
  lines.push('## Headline');
  lines.push('');
  lines.push(
    table(
      ['Model', 'Assertions', 'Reviews', 'Cost / review', 'Cost / full set', 'Median latency', 'Slowest', 'Errors'],
      models.map((model) => {
        const modelRows = rows.filter((row) => row.model === model);
        const completed = modelRows.filter((row) => !row.errored);
        const costs = defined(completed.map((row) => row.cost));
        const latencies = completed.map((row) => row.latencyMs);
        const errors = modelRows.filter((row) => row.errored).length;
        let pass = 0;
        let total = 0;
        for (const fixture of fixtures) {
          for (const metric of metrics.get(fixture) ?? []) {
            const result = outcome(rows, model, fixture, metric);
            pass += result.pass;
            total += result.total;
          }
        }
        const perReview = mean(costs);
        return [
          `\`${model}\``,
          `**${pass}/${total}**`,
          `${completed.length}/${modelRows.length}`,
          usd(perReview),
          usd(perReview === null ? null : perReview * fixtures.length),
          seconds(median(latencies)),
          seconds(latencies.length === 0 ? null : Math.max(...latencies)),
          errors === 0 ? '—' : String(errors),
        ];
      }),
    ),
  );
  lines.push('');
  lines.push('## Per-metric');
  lines.push('');
  const matrixRows: string[][] = [];
  for (const fixture of fixtures) {
    matrixRows.push([`**${fixture}**`, ...models.map(() => '')]);
    for (const metric of metrics.get(fixture) ?? []) {
      matrixRows.push([
        `  \`${metric}\``,
        ...models.map((model) => {
          const result = outcome(rows, model, fixture, metric);
          if (result.total === 0) return '—';
          const mark = result.pass === result.total ? '✅' : result.pass === 0 ? '❌' : '⚠️';
          return `${mark} ${result.pass}/${result.total}`;
        }),
      ]);
    }
  }
  lines.push(table(['Fixture / metric', ...models.map((model) => `\`${model}\``)], matrixRows));
  lines.push('');
  lines.push('## Cost and latency per diff');
  lines.push('');
  lines.push(
    table(
      ['Diff', ...models.map((model) => `\`${model}\``)],
      fixtures.map((fixture) => [
        `\`${fixture}\``,
        ...models.map((model) => {
          const runs = rows.filter((row) => row.model === model && row.fixture === fixture && !row.errored);
          const cost = usd(mean(defined(runs.map((row) => row.cost))));
          return `${cost} · ${seconds(median(runs.map((row) => row.latencyMs)))}`;
        }),
      ]),
    ),
  );
  lines.push('');

  const errored = rows.filter((row) => row.errored);
  if (errored.length > 0) {
    lines.push('## Errors');
    lines.push('');
    for (const row of errored) lines.push(`- \`${row.model}\` on \`${row.fixture}\`: ${row.error ?? 'unknown'}`);
    lines.push('');
  }
  return lines.join('\n');
}

function collect(rows: Row[], model: string): Record<string, MetricOutcome> {
  const collected: Record<string, MetricOutcome> = {};
  for (const [fixture, names] of metricNames(rows)) {
    for (const metric of names) {
      const result = outcome(rows, model, fixture, metric);
      if (result.total > 0) collected[`${fixture}::${metric}`] = result;
    }
  }
  return collected;
}

function rate(value: MetricOutcome): number {
  return value.total === 0 ? 0 : value.pass / value.total;
}

// The gate: a metric that used to pass and now does not is a regression, and so is a metric that has
// vanished. A new metric or a dearer review is reported for a human to judge, not failed.
function check(baseline: Baseline, rows: Row[]): { report: string; failed: boolean } {
  const lines: string[] = ['## Regression gate', ''];
  const models = modelsOf(rows);
  if (models.length !== 1 || models[0] !== baseline.gateModel) {
    lines.push(`❌ This run is \`${models.join('`, `')}\`; the baseline is \`${baseline.gateModel}\` — not comparable.`);
    return { report: lines.join('\n'), failed: true };
  }

  const observed = collect(rows, baseline.gateModel);
  const regressions: string[] = [];
  const notes: string[] = [];
  for (const [key, before] of Object.entries(baseline.metrics)) {
    const after = observed[key];
    if (after === undefined) {
      regressions.push(`\`${key}\` is in the baseline but not in this run — the suite lost a case or a metric.`);
    } else if (rate(after) < rate(before)) {
      regressions.push(`\`${key}\`: ${before.pass}/${before.total} → **${after.pass}/${after.total}**`);
    } else if (rate(after) > rate(before)) {
      notes.push(`\`${key}\`: ${before.pass}/${before.total} → ${after.pass}/${after.total} — improved`);
    }
  }
  for (const key of Object.keys(observed)) {
    if (!(key in baseline.metrics)) notes.push(`\`${key}\` is new — the baseline does not cover it`);
  }

  const costPerReview = mean(defined(rows.filter((row) => !row.errored).map((row) => row.cost)));
  if (
    baseline.costPerReviewUsd !== null &&
    costPerReview !== null &&
    costPerReview > baseline.costPerReviewUsd * COST_DRIFT_TOLERANCE
  ) {
    notes.push(
      `cost per review ${usd(baseline.costPerReviewUsd)} → ${usd(costPerReview)}, ` +
        `over ${COST_DRIFT_TOLERANCE}× the baseline`,
    );
  }

  if (regressions.length === 0) {
    lines.push(`✅ No regression against the baseline recorded ${baseline.recordedAt} for \`${baseline.gateModel}\`.`);
  } else {
    lines.push(`❌ ${regressions.length} regression(s) against the baseline recorded ${baseline.recordedAt}:`);
    lines.push('');
    for (const regression of regressions) lines.push(`- ${regression}`);
  }
  if (notes.length > 0) {
    lines.push('');
    lines.push('Judge these, then fold them in with `--update`:');
    lines.push('');
    for (const note of notes) lines.push(`- ${note}`);
  }
  return { report: lines.join('\n'), failed: regressions.length > 0 };
}

function main(): void {
  const { input, baseline: baselinePath, update } = parseArgs(process.argv.slice(2));
  const output = JSON.parse(readFileSync(input, 'utf8')) as OutputFile;
  const results = 'results' in output.results ? (output.results.results as EvaluateResult[]) : [];
  const rows = toRows(results);
  if (rows.length === 0) throw new Error(`${input} holds no results`);

  console.log(render(output, rows));
  if (baselinePath === undefined) return;

  if (update) {
    const models = modelsOf(rows);
    const gateModel = models[0];
    if (models.length !== 1 || gateModel === undefined) {
      throw new Error(`--update needs a single-model run (the gate model); this run has ${models.length}`);
    }
    const completed = rows.filter((row) => !row.errored);
    const next: Baseline = {
      gateModel,
      recordedAt: new Date().toISOString().slice(0, 10),
      evalId: output.evalId,
      metrics: collect(rows, gateModel),
      costPerReviewUsd: mean(defined(completed.map((row) => row.cost))),
      medianLatencyMs: median(completed.map((row) => row.latencyMs)),
    };
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`\nBaseline rewritten: ${baselinePath}`);
    return;
  }

  const { report, failed } = check(JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline, rows);
  console.log('');
  console.log(report);
  if (failed) process.exitCode = 1;
}

main();
