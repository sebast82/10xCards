import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_DESCRIPTION_CHARS, MAX_DIFF_CHARS, ReviewInputSchema, type ReviewInput } from '../src/index.js';

const MetaSchema = ReviewInputSchema.omit({ diff: true });

// The only path by which fixture text reaches the reviewer. Test vars carry just the fixture name:
// promptfoo renders every string var through Nunjucks, and a diff full of `{{ … }}` would either
// throw before the provider runs or reach it silently altered.
export function loadFixture(name: string): ReviewInput {
  const dir = join(import.meta.dirname, 'fixtures', name);
  const meta = MetaSchema.safeParse(JSON.parse(readFileSync(join(dir, 'pr.json'), 'utf8')));
  if (!meta.success) {
    throw new Error(`Fixture ${name}: invalid pr.json: ${meta.error.message}`);
  }
  const input: ReviewInput = { ...meta.data, diff: readFileSync(join(dir, 'pr.diff'), 'utf8') };
  // Over a cap the reviewer would see a truncated input, and the eval would grade something else.
  if (input.diff.length > MAX_DIFF_CHARS) {
    throw new Error(`Fixture ${name}: diff has ${input.diff.length} characters, over the ${MAX_DIFF_CHARS} cap`);
  }
  if (input.description.length > MAX_DESCRIPTION_CHARS) {
    throw new Error(
      `Fixture ${name}: description has ${input.description.length} characters, over the ${MAX_DESCRIPTION_CHARS} cap`,
    );
  }
  return input;
}
