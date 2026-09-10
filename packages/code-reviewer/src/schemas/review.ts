import { z } from 'zod';

export const ReviewSchema = z.object({
  summary: z.string().describe('One-paragraph summary of the reviewed code'),
  issues: z
    .array(
      z.object({
        severity: z.enum(['low', 'medium', 'high']).describe('Impact of the issue on the code under review'),
        message: z.string().describe('What is wrong and how to fix it, referring to the relevant code'),
      }),
    )
    .describe('Issues found, correctness bugs first, then maintainability issues'),
});

export type Review = z.infer<typeof ReviewSchema>;
export type ReviewIssue = Review['issues'][number];
export type Severity = ReviewIssue['severity'];
