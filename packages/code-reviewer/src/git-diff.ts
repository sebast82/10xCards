import { execSync } from 'node:child_process';

// Reads the diff for a ref straight from git, so the CLI can review a branch without a prepared
// input file.
export function readGitDiff(ref: string): string {
  return execSync(`git diff ${ref}`, { encoding: 'utf8' });
}
