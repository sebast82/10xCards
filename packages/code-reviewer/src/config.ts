import { z } from 'zod';

export const EnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().min(1).default('anthropic/claude-sonnet-5'),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment (see .env.example):\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
