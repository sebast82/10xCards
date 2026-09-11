import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReviewerAgent } from './agent/reviewer.js';
import { formatReviewComment } from './format.js';
import { runCli } from './run-cli.js';
import type { ReviewInput } from './schemas/input.js';
import type { Review, Scores } from './schemas/review.js';

function mockModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    },
  });
}

const input: ReviewInput = {
  title: 'Fix add()',
  description: 'It subtracted.',
  diff: '-  return a - b;\n+  return a + b;',
};

const passing: Scores = { correctness: 9, idiomaticity: 8, complexity: 9, testCoverage: 7, documentation: 7, security: 10 };
const failing: Scores = { ...passing, security: 3 };

const reviewWith = (scores: Scores): Review => ({
  summary: 'Fixes add().',
  scores,
  issues: [{ severity: 'low', message: 'Add a test.' }],
});

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'code-reviewer-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

async function writeInput(content: string): Promise<string> {
  const path = join(dir, 'input.json');
  await writeFile(path, content);
  return path;
}

function printedJson(): unknown {
  const [output] = vi.mocked(console.log).mock.calls.at(-1) ?? [];
  return JSON.parse(String(output));
}

describe('runCli', () => {
  it.each([
    ['passing', passing, true],
    ['failing', failing, false],
  ])('returns 0 and prints the review with its verdict for a %s review', async (_, scores, pass) => {
    const model = mockModel(JSON.stringify(reviewWith(scores)));
    const inputFile = await writeInput(JSON.stringify(input));

    const code = await runCli(['--input-file', inputFile], { agent: createReviewerAgent({ model }) });

    expect(code).toBe(0);
    expect(printedJson()).toMatchObject({ ...reviewWith(scores), verdict: { pass } });
  });

  it('writes the rendered comment to --markdown-out', async () => {
    const model = mockModel(JSON.stringify(reviewWith(failing)));
    const inputFile = await writeInput(JSON.stringify(input));
    const markdownOut = join(dir, 'comment.md');

    const code = await runCli(['--input-file', inputFile, '--markdown-out', markdownOut], {
      agent: createReviewerAgent({ model }),
    });

    expect(code).toBe(0);
    const printed = printedJson() as Parameters<typeof formatReviewComment>[0];
    await expect(readFile(markdownOut, 'utf8')).resolves.toBe(formatReviewComment(printed));
  });

  it.each([
    ['is not JSON', '{"title":'],
    ['misses a field', JSON.stringify({ title: 't', diff: '' })],
    ['has a wrong type', JSON.stringify({ ...input, title: 1 })],
  ])('returns 1 without calling the model when the input file %s', async (_, content) => {
    const model = mockModel(JSON.stringify(reviewWith(passing)));
    const inputFile = await writeInput(content);

    const code = await runCli(['--input-file', inputFile], { agent: createReviewerAgent({ model }) });

    expect(code).toBe(1);
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(inputFile));
  });

  it.each([
    ['no --input-file', () => []],
    ['a missing input file', () => ['--input-file', join(dir, 'absent.json')]],
    ['an unknown flag', () => ['--input-file', join(dir, 'input.json'), '--verbose']],
  ])('returns 1 without calling the model for %s', async (_, argv) => {
    const model = mockModel(JSON.stringify(reviewWith(passing)));
    await writeInput(JSON.stringify(input));

    const code = await runCli(argv(), { agent: createReviewerAgent({ model }) });

    expect(code).toBe(1);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('returns 1 when the model output breaks the schema', async () => {
    const model = mockModel(JSON.stringify({ summary: 's', issues: [] }));
    const inputFile = await writeInput(JSON.stringify(input));

    const code = await runCli(['--input-file', inputFile], { agent: createReviewerAgent({ model }) });

    expect(code).toBe(1);
    expect(console.log).not.toHaveBeenCalled();
  });
});
