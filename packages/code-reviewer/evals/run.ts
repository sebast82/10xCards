import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

// `promptfoo eval` exits 100 when an assertion fails — the normal outcome of a model missing a flaw, and
// the input the report exists to tabulate. Only a different non-zero exit means the harness itself broke
// (bad config, missing key, fixture over cap), and then there is nothing worth reporting.
const ASSERTIONS_FAILED = 100;

// Fixed targets rather than arguments: nothing here is assembled from user input, which is what makes
// `shell: true` safe. The shell is needed for the `promptfoo` bin shim on Windows.
const TARGETS = {
  matrix: { config: 'promptfooconfig.ts', output: 'results/comparison.json', report: [] as string[] },
  gate: { config: 'promptfooconfig.gate.ts', output: 'results/gate.json', report: ['--check', 'baseline.json'] },
} as const;

function main(): void {
  const name = process.argv[2];
  if (name !== 'matrix' && name !== 'gate') {
    throw new Error(`usage: node run.ts <${Object.keys(TARGETS).join('|')}>`);
  }
  const target = TARGETS[name];
  mkdirSync('results', { recursive: true });

  const evalArgs = ['eval', '-c', target.config, '--env-file', '../.env', '--output', target.output];
  const evaluated = spawnSync('promptfoo', [...evalArgs, ...process.argv.slice(3)], {
    stdio: 'inherit',
    shell: true,
  });
  if (evaluated.error !== undefined) throw evaluated.error;
  if (evaluated.status !== 0 && evaluated.status !== ASSERTIONS_FAILED) {
    console.error(`\npromptfoo eval exited ${evaluated.status}: no results to report.`);
    process.exit(evaluated.status ?? 1);
  }

  const reported = spawnSync(process.execPath, ['report.ts', target.output, ...target.report], { stdio: 'inherit' });
  if (reported.error !== undefined) throw reported.error;
  process.exit(reported.status ?? 1);
}

main();
