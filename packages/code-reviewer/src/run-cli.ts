import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { reviewCode, type ReviewerAgent } from './agent/reviewer.js';
import { formatReviewComment } from './format.js';
import { ReviewInputSchema, type ReviewInput } from './schemas/input.js';
import { computeVerdict } from './verdict.js';

const USAGE = 'Usage: code-reviewer --input-file <path> [--markdown-out <path>]';

async function readInput(path: string): Promise<ReviewInput> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read input file ${path}: ${error instanceof Error ? error.message : error}`);
  }
  const parsed = ReviewInputSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Invalid input file ${path}:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

// Exit code 0 means the review ran — whatever its verdict. A failing verdict is a normal outcome;
// only an invocation failure (bad arguments or input, model/schema error) returns nonzero.
export async function runCli(argv: string[], deps?: { agent?: ReviewerAgent }): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      options: { 'input-file': { type: 'string' }, 'markdown-out': { type: 'string' } },
    });
    const inputFile = values['input-file'];
    if (!inputFile) throw new Error(`Missing --input-file.\n${USAGE}`);

    const review = await reviewCode(await readInput(inputFile), deps);
    const result = { ...review, verdict: computeVerdict(review.scores) };
    const markdownOut = values['markdown-out'];
    if (markdownOut) await writeFile(markdownOut, formatReviewComment(result));
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    // The message only: an APICallError also carries the request body, i.e. the whole reviewed diff.
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}
