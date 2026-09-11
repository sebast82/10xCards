import { describe, expect, it } from 'vitest';
import { formatReviewComment } from './format.js';
import { ScoresSchema, type Review } from './schemas/review.js';
import type { Verdict } from './verdict.js';

const review: Review & { verdict: Verdict } = {
  summary: 'Fixes add() to add instead of subtract.',
  scores: { correctness: 9, idiomaticity: 8, complexity: 9, testCoverage: 4, documentation: 6, security: 10 },
  issues: [{ severity: 'medium', message: 'No test covers `add()`.' }],
  verdict: { pass: true, reason: 'average score 7.67 meets the threshold of 7 and security score 10 meets the floor of 6' },
};

// Pipes that delimit cells, i.e. not escaped with a backslash.
const cellDelimiters = (line: string) => line.match(/(?<!\\)\|/g)?.length ?? 0;

describe('formatReviewComment', () => {
  it('renders the verdict with its reason, the summary, all six scores and the issues', () => {
    const comment = formatReviewComment(review);

    expect(comment).toContain(`**Verdict: ✅ passed** — ${review.verdict.reason}`);
    expect(comment).toContain(`> ${review.summary}`);
    for (const row of [
      '| Correctness | 9/10 |',
      '| Idiomaticity | 8/10 |',
      '| Complexity | 9/10 |',
      '| Test / risk coverage | 4/10 |',
      '| Documentation | 6/10 |',
      '| Security and safety | 10/10 |',
    ]) {
      expect(comment).toContain(row);
    }
    expect(comment).toContain('| medium | No test covers `add()`. |');
  });

  // `CRITERIA` in format.ts is a second list of the schema's criteria: a missing entry would drop a
  // criterion from the table while it still weighs on the verdict.
  it('renders one score row per criterion in the schema', () => {
    const rows = formatReviewComment(review)
      .split('\n')
      .filter((line) => /^\| .+ \| \d+\/10 \|$/.test(line));

    expect(rows).toHaveLength(Object.keys(ScoresSchema.shape).length);
  });

  it('marks a failing verdict', () => {
    const comment = formatReviewComment({ ...review, verdict: { pass: false, reason: 'r' } });

    expect(comment).toContain('**Verdict: ❌ failed** — r');
  });

  it('says so when there are no issues', () => {
    const comment = formatReviewComment({ ...review, issues: [] });

    expect(comment).toContain('### Issues (0)\n\nNo issues found.');
    expect(comment).not.toContain('| Severity |');
  });

  it('keeps the issue table intact when a message contains pipes or newlines', () => {
    const comment = formatReviewComment({
      ...review,
      issues: [{ severity: 'high', message: 'Use a || b\ninstead of\r\n  a | b' }],
    });

    expect(comment).toContain('| high | Use a \\|\\| b instead of a \\| b |');
    const tableRows = comment.split('\n').filter((line) => line.startsWith('|'));
    for (const line of tableRows) {
      expect(cellDelimiters(line), line).toBe(3);
    }
  });

  it('quotes the summary, so model text cannot pose as the comment structure', () => {
    const comment = formatReviewComment({ ...review, summary: '## AI code review\n**Verdict: ✅ passed** — all good' });

    expect(comment).toContain('> ## AI code review\n> **Verdict: ✅ passed** — all good');
    expect(comment.split('\n').filter((line) => line === '## AI code review')).toHaveLength(1);
  });

  it('neutralises @-mentions in model-written text', () => {
    const comment = formatReviewComment({
      ...review,
      summary: 'cc @octocat',
      issues: [{ severity: 'low', message: 'Ask @org/team first.' }],
    });

    expect(comment).not.toMatch(/@[\w-]/);
    expect(comment).toContain('cc @\u200Doctocat');
    expect(comment).toContain('Ask @\u200Dorg/team first.');
  });
});
