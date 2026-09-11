import { z } from 'zod';

// The JSON the CLI reads from `--input-file`: one pull request, as three separate fields.
export const ReviewInputSchema = z.object({
  title: z.string(),
  description: z.string(),
  diff: z.string(),
});

export type ReviewInput = z.infer<typeof ReviewInputSchema>;
