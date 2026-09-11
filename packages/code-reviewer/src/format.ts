import type { Review, Scores } from './schemas/review.js';
import type { Verdict } from './verdict.js';

const CRITERIA: ReadonlyArray<readonly [keyof Scores, string]> = [
  ['correctness', 'Correctness'],
  ['idiomaticity', 'Idiomaticity'],
  ['complexity', 'Complexity'],
  ['testCoverage', 'Test / risk coverage'],
  ['documentation', 'Documentation'],
  ['security', 'Security and safety'],
];

// Model output is untrusted: a zero-width joiner after `@` stops `@user` / `@org/team` from pinging anyone.
function neutralizeMentions(text: string): string {
  return text.replace(/@(?=[\w-])/g, '@\u200D');
}

// A newline or an unescaped `|` would end the cell, and with it the table.
function tableCell(text: string): string {
  return neutralizeMentions(text.replace(/\s*[\r\n]+\s*/g, ' ').replace(/\|/g, '\\|'));
}

export function formatReviewComment(review: Review & { verdict: Verdict }): string {
  const { verdict, issues } = review;
  return [
    '## AI code review',
    '',
    `**Verdict: ${verdict.pass ? '✅ passed' : '❌ failed'}** — ${verdict.reason}`,
    '',
    neutralizeMentions(review.summary),
    '',
    '| Criterion | Score |',
    '| --- | ---: |',
    ...CRITERIA.map(([key, label]) => `| ${label} | ${review.scores[key]}/10 |`),
    '',
    `### Issues (${issues.length})`,
    '',
    ...(issues.length === 0
      ? ['No issues found.']
      : [
          '| Severity | Issue |',
          '| --- | --- |',
          ...issues.map((issue) => `| ${issue.severity} | ${tableCell(issue.message)} |`),
        ]),
    '',
    // The workflow runs this reviewer from the PR's own code, so the verdict is self-attested.
    '<sub>Advisory review by `packages/code-reviewer`, built from this PR — not a merge gate.</sub>',
    '',
  ].join('\n');
}
