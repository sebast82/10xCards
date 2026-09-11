import { z } from 'zod';

// Model-facing: plain `z.number()`. The OpenRouter provider sends this schema verbatim with
// `strict: true`, Anthropic structured outputs reject JSON Schema `minimum`/`maximum` with a 400,
// and zod's `.int()` alone already emits them (±2^53). The range is enforced by `ScoresSchema`.
const score = (criterion: string) => z.number().describe(`${criterion}. Integer from 1 (worst) to 10 (best)`);

export const ReviewSchema = z.object({
  summary: z.string().describe('One-paragraph summary of the reviewed change'),
  scores: z
    .object({
      correctness: score('Implementation correctness: edge cases, error paths, regressions'),
      idiomaticity: score('Follows language/framework/project conventions'),
      complexity: score('Solution simplicity relative to the problem'),
      testCoverage: score('Risk-weighted test coverage of the change'),
      documentation: score('Non-obvious decisions and public surfaces documented'),
      security: score('No introduced vulnerabilities, safe handling of untrusted input'),
    })
    .describe('Per-criterion score'),
  issues: z
    .array(
      z.object({
        severity: z.enum(['low', 'medium', 'high']).describe('Impact of the issue on the code under review'),
        message: z.string().describe('What is wrong and how to fix it, referring to the relevant code'),
      }),
    )
    .describe('Issues found, most severe first'),
});

// Enforced in code after generation; never sent to the model. Keys come from `ReviewSchema`, so a
// criterion added there is range-checked here — and weighs on the verdict — without a second edit.
const strictScore = z.number().int().min(1).max(10);
export const ScoresSchema = z.object(
  Object.fromEntries(Object.keys(ReviewSchema.shape.scores.shape).map((key) => [key, strictScore])) as {
    [K in keyof Scores]: typeof strictScore;
  },
);

export type Review = z.infer<typeof ReviewSchema>;
export type Scores = Review['scores'];
export type ReviewIssue = Review['issues'][number];
export type Severity = ReviewIssue['severity'];
