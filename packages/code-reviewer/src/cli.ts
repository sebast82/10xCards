import { reviewCode } from './index.js';

const DEFAULT_SAMPLE = 'function add(a, b) { return a - b; }';

const input = process.argv.slice(2).join(' ') || DEFAULT_SAMPLE;
try {
  console.log(JSON.stringify(await reviewCode(input), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
