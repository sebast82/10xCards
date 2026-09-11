# CI/CD Agentic Code Review — Implementation Plan

## Overview

Add a GitHub Actions workflow that runs an AI code review on every pull request to `master`, using `packages/code-reviewer` (OpenRouter-backed) scored across six 1–10 criteria (correctness, idiomaticity, complexity, test/risk coverage, documentation, security), posting a PR summary comment and a pass/fail label, with an on-demand retry via a label. `packages/code-reviewer`'s current shape (`{summary, issues[]}`, single opaque-string input) cannot carry per-criterion scores or three named inputs (title/description/diff) — the package's schema, prompt, and CLI contract change first, then a composite action + workflow are built on top of the new contract.

## Current State Analysis

- `packages/code-reviewer` is a standalone Node ≥24 ESM package (own lockfile, not an npm workspace of root). `ReviewSchema` ([schemas/review.ts](../../../packages/code-reviewer/src/schemas/review.ts)) is `{summary, issues[severity, message]}` — no score field. `cli.ts` joins all argv into one string and calls `reviewCode(code: string)` — no way to pass three named inputs. The agent ([agent/reviewer.ts](../../../packages/code-reviewer/src/agent/reviewer.ts)) is tool-less by deliberate design (`agent/tools.ts` is an empty seam) and caps `maxOutputTokens` at 2048. `buildReviewPrompt` ([prompts/reviewer.ts](../../../packages/code-reviewer/src/prompts/reviewer.ts)) neutralizes injection attempts against its single `<code_to_review>` tag, tested against 8 variants.
- `.github/workflows/ci.yml` is the only live workflow and establishes this repo's own GHA conventions: workflow-level `permissions: contents: read`, ref-scoped `concurrency` with `cancel-in-progress`, `persist-credentials: false` on non-writing checkouts, fork-PR exclusion via `github.event.pull_request.head.repo.full_name == github.repository`, `timeout-minutes` on any job that can hang, one job per concern, and artifacts/logs that never carry secrets.
- No composite action exists anywhere in the repo (`.github/actions/` is empty). [.claude/skills/10x-impl-review-ci/references/workflow-template.yml](../../../.claude/skills/10x-impl-review-ci/references/workflow-template.yml) is a full worked template for a sibling PR-automation feature and is the mechanics source for label-gated triggering, `gh pr view --json labels`, and job-scoped write permissions — but it calls `claude-code-action@v1`, not our OpenRouter path, so it's a pattern source, not a drop-in.
- Tests in `packages/code-reviewer` are fully mocked (`MockLanguageModelV4` / stubbed empty API key) — `npm test` needs no live secret.

## Desired End State

Every same-repo PR to `master` gets an AI review within its own job: the composite action builds and invokes `packages/code-reviewer` against the PR's title, description, and diff; the workflow posts a markdown summary comment (six scores + issues + verdict) and applies `ai-cr:passed` or `ai-cr:failed`. Adding the `ai-cr:review` label re-runs the review. Fork PRs are skipped (no secrets available to them). A reviewer-invocation failure — model/schema error, or an OpenRouter hang cut off after 5 minutes — posts a neutral "unavailable" comment without failing the job or touching existing labels. A failure before the reviewer runs (install, build, diff) deliberately stays red: nothing else in CI builds `packages/**`, so it is the only signal that a PR broke the package.

Verified by: opening a real PR against this repo, confirming the comment + label appear, confirming the retry label re-triggers a run, and confirming a fork PR (or an equivalent dry check of the `if:` condition) does not trigger the job.

### Key Discoveries:

- `ReviewSchema` and `cli.ts` are the actual blocking dependency, not the GHA wrapper — every GHA mechanic is buildable today, but only against a schema that can't carry per-criterion scores ([research.md](research.md), Architecture Insights).
- The tool-less agent is a deliberate seam from its prior refactor (`context/archive/2026-09-10-tool-loop-agent/plan.md:78`), not a gap to close here — out of scope for this change.
- `dist/` is gitignored; a build step (`npm ci && npm run build` inside `packages/code-reviewer`) is required before `dist/cli.js` exists.
- Root ESLint/Prettier/tsconfig/vitest all exclude `packages/**` — no root tooling touches this package; nothing to wire into root CI.
- No `context/foundation/roadmap.md` item traces to this change (confirmed by exact-match lookup) — this is net-new scope, not a roadmap item being picked up.

## What We're NOT Doing

- Adding repo-read tools to the reviewer agent (the tool-less design is a deliberate, documented seam — revisiting it is a separate future change).
- Business alignment and architectural-fit criteria (explicitly parked in `requirements.md` — they require broader context than a diff).
- A commit-status check or an override-label bypass gate (the sibling `impl-review-ci` template has both; this feature's requirements only ask for a PR comment + pass/fail label — no human-override escape hatch is requested).
- Making the `ai-cr:*` labels trustworthy against the PR under review. Under `pull_request`, the workflow, the composite action and `packages/code-reviewer` are all built from the PR's own merge commit, so a PR that edits `PASS_THRESHOLDS`, the prompt or the workflow grades itself by its own rules. The labels are **advisory and self-attested** (per `context/foundation/lessons.md`, "Metryka deklarowana przez klienta nie jest metryką") and must not become a required status check without a trusted-build redesign (reviewer built from the base branch, workflow edits protected).
- Running the review on `push` events to `master` (PR-only, matching the `db-tests`/`e2e` convention already in `ci.yml`).
- Caching `node_modules/` or `dist/` for the composite action (setup-node's `cache: npm` download cache is used — it only speeds up `npm ci` and cannot make `dist/` stale).
- Workflow-level retries of the OpenRouter call beyond the AI SDK's own default (`maxRetries: 2`, unchanged) — a failed invocation surfaces as a neutral comment, not an automatic re-attempt.
- Migrating or backfilling anything: the old `{summary, issues}` shape has no real external consumer yet (the only ever-named future consumer, a promptfoo eval provider, doesn't exist in the repo).

## Implementation Approach

Two phases, sequenced by the actual dependency: the package's contract change lands first (schema, prompt, CLI, verdict logic — all covered by the existing mocked-model test pattern), then the composite action + workflow are built against that new contract, then a real end-to-end pass verifies the GitHub-side mechanics that can't be unit-tested (labels, comments, trigger conditions).

## Critical Implementation Details

- **Injection guard must cover all three input tags, not one.** With title/description/diff each wrapped in their own tag (e.g. `<pr_title>`, `<pr_description>`, `<diff>`), content in one field could otherwise forge a closing tag for another (e.g. a PR description containing `</diff>` followed by fabricated diff text). The existing single-tag neutralization pattern in `buildReviewPrompt` must be generalized to guard against opening/closing sequences for all three tag names, not just extended to run three times independently.
- **Untrusted PR text must never be interpolated into a `run:` shell script via `${{ }}`.** Read title/description inside the Node assembly step, straight from the event payload file (`$GITHUB_EVENT_PATH`), rather than assigning them to a shell variable via inline expression substitution — this is the standard mitigation for the GitHub Actions script-injection class of vulnerability, and it applies here because any repo collaborator (not just fork authors) controls this text.
- **Label creation needs `issues: write`, not just `pull-requests: write`.** `gh label create` operates on the Issues API surface even though these labels are applied to PRs; the "ensure labels exist" step will fail with only `pull-requests: write` in job permissions.
- **The diff needs a full-history checkout and a three-dot range.** On `pull_request`, `actions/checkout` checks out `refs/pull/N/merge` (the merge commit) at depth 1 — `pull_request.head.sha` is that commit's parent and is not in the local object store, so `git diff <base-sha> <head-sha>` fails with "bad object" even after fetching the base SHA. A two-dot diff against `base.sha` would also show master commits made after branching as reverted lines. Check out with `fetch-depth: 0` (keeping `persist-credentials: false` — checkout's own fetch is authenticated, and nothing after it touches the network) and compute `git diff "$BASE_SHA...$HEAD_SHA"` (three-dot: against the merge base, the same diff as the PR's "Files changed" tab). **Adapted in implementation:** two three-dot diffs, code before `context/`, so the docs cannot fill the 60,000-character budget ahead of the code — see `change.md`.
- **The CLI must exit 0 on a legitimate fail verdict.** `verdict.pass === false` is a normal review outcome, not an error — `cli.ts` sets a nonzero exit code only on actual invocation failure (bad input file, model/schema error). This is what lets the composite action's step outcome distinguish "reviewer ran and said fail" from "reviewer didn't run," which the neutral-comment failure path depends on.
- **The model-facing schema must carry no numeric constraints.** `@openrouter/ai-sdk-provider` sends the zod schema verbatim as `response_format: json_schema` with `strict: true`; Anthropic's structured outputs reject `minimum`/`maximum` with a 400, and only `@ai-sdk/anthropic` strips them client-side. zod's `.int()` alone already emits them (±2^53), so scores are plain `z.number()` toward the model and validated as integers 1–10 in code afterward (`ScoresSchema`). The mocked-model tests can't catch a regression here — `MockLanguageModelV4` never validates the schema — hence the JSON Schema assertion in Phase 1's tests.

## Phase 1: `packages/code-reviewer` contract change

### Overview

Change the package's schema, prompt, and CLI to carry per-criterion scores and three named inputs (title, description, diff), and add the pass/fail verdict logic the workflow will read.

### Changes Required:

#### 1. Review schema — add per-criterion scores

**File**: `packages/code-reviewer/src/schemas/review.ts`

**Intent**: Add a `scores` object (six 1–10 integer fields, one per requirements.md criterion) to `ReviewSchema`, alongside the existing `summary` and `issues[]`. This is the field the pass/fail verdict and the PR comment table both read. The model-facing schema carries **no numeric constraints** (see Critical Implementation Details); integer-in-range is enforced after generation by a separate strict `ScoresSchema`.

**Contract**:
```ts
// Model-facing: plain z.number(). Anthropic structured outputs reject JSON Schema
// `minimum`/`maximum` with a 400, and zod's `.int()` alone already emits them (±2^53).
const score = (criterion: string) =>
  z.number().describe(`${criterion}. Integer from 1 (worst) to 10 (best)`);

export const ReviewSchema = z.object({
  summary: z.string().describe('One-paragraph summary of the reviewed change'),
  scores: z.object({
    correctness: score('Implementation correctness: edge cases, error paths, regressions'),
    idiomaticity: score('Follows language/framework/project conventions'),
    complexity: score('Solution simplicity relative to the problem'),
    testCoverage: score('Risk-weighted test coverage of the change'),
    documentation: score('Non-obvious decisions and public surfaces documented'),
    security: score('No introduced vulnerabilities, safe handling of untrusted input'),
  }).describe('Per-criterion score'),
  issues: z.array(z.object({
    severity: z.enum(['low', 'medium', 'high']).describe('Impact of the issue on the code under review'),
    message: z.string().describe('What is wrong and how to fix it, referring to the relevant code'),
  })).describe('Issues found, correctness bugs first, then maintainability issues'),
});

// Enforced in code after generation; never sent to the model.
const strictScore = z.number().int().min(1).max(10);
export const ScoresSchema = z.object({
  correctness: strictScore,
  idiomaticity: strictScore,
  complexity: strictScore,
  testCoverage: strictScore,
  documentation: strictScore,
  security: strictScore,
});
```
This is a breaking change to the `Review` type (field added, no existing consumer beyond this package's own tests and the not-yet-built CLI/GHA layer).

#### 2. Review input schema (new)

**File**: `packages/code-reviewer/src/schemas/input.ts`

**Intent**: Define and export the shape of the JSON the CLI reads from `--input-file`, so `cli.ts` can validate it before building a prompt.

**Contract**: `ReviewInputSchema = z.object({ title: z.string(), description: z.string(), diff: z.string() })`, with `type ReviewInput = z.infer<typeof ReviewInputSchema>`.

#### 3. Prompt building — three tagged, injection-safe sections

**File**: `packages/code-reviewer/src/prompts/reviewer.ts`

**Intent**: Replace the single `buildReviewPrompt(code: string)` with `buildReviewPrompt(input: ReviewInput)`, wrapping title/description/diff in their own tags (e.g. `<pr_title>`, `<pr_description>`, `<diff>`). Generalize the existing tag-neutralization regex to guard opening/closing sequences for all three tag names (see Critical Implementation Details), not just `code_to_review`. Apply a defensive length cap to `description` and `diff` (e.g. 4,000 / 60,000 characters), appending an explicit "[truncated]" note into the affected section when a cap is hit, so the model never treats a partial view as complete. Update `REVIEWER_INSTRUCTIONS` to state the six criteria and their 1/10 anchors from `requirements.md`, so the model has the rubric it's scoring against, and to cap the issues list at 10, most severe first — a full PR diff yields far more findings than the snippets the 2048-token output cap was sized for, and a response truncated mid-JSON surfaces as `NoObjectGeneratedError`.

**Contract**: `buildReviewPrompt(input: ReviewInput): string`. Extend the existing `prompts/reviewer.test.ts` injection-variant coverage (currently 8 cases against one tag) to run against all three tags, plus new tests for the truncation notes.

#### 4. Agent entry point — structured input

**File**: `packages/code-reviewer/src/agent/reviewer.ts`

**Intent**: Change `reviewCode(code: string, options?)` to `reviewCode(input: ReviewInput, options?)`, passing `input` through to the updated `buildReviewPrompt`. After generation, parse `output.scores` with `ScoresSchema` and throw on a non-integer or out-of-range score — the CLI turns that into a nonzero exit, i.e. the workflow's neutral-comment path. No other agent construction changes (tools stay empty, `maxOutputTokens` stays 2048 — the score fields are a handful of small numbers, and the 10-issue cap in `REVIEWER_INSTRUCTIONS` bounds the rest; manual check 1.5 confirms this against a near-cap diff). **Adapted in implementation:** check 1.5 disproved the token assumption — 8192 tokens plus `reasoning: { effort: 'low' }` in `model.ts`, see `change.md`.

**Contract**: `reviewCode(input: ReviewInput, options?: { agent?: ReviewerAgent }): Promise<Review>`.

#### 5. Verdict logic (new)

**File**: `packages/code-reviewer/src/verdict.ts`

**Intent**: Compute pass/fail from `Review['scores']` using the decided rule: average across all six ≥ 7, AND security ≥ 6 specifically (a security floor that can't be averaged away). Export the thresholds as named constants so they're one place to tune. Compare the score sum against `PASS_THRESHOLDS.average * 6` rather than a float average, so the boundary is exact.

**Contract**:
```ts
export const PASS_THRESHOLDS = { average: 7, security: 6 } as const;

export function computeVerdict(scores: Review['scores']): { pass: boolean; reason: string }
```
`reason` is a short human-readable string (which threshold passed/failed and the actual values) — the workflow's PR comment surfaces it directly, so it must read naturally inline.

#### 6. PR comment formatting (new)

**File**: `packages/code-reviewer/src/format.ts`

**Intent**: Render the PR comment body in the package, where it's unit-testable, instead of in workflow shell: summary, a six-row score table, the issues list (severity + message), and the verdict with its `reason`. Model-written text is untrusted output: escape `|` and collapse newlines inside table cells, and neutralize `@` mentions (e.g. a zero-width joiner after `@`) so a model message can't ping people.

**Contract**: `formatReviewComment(review: Review & { verdict: { pass: boolean; reason: string } }): string` (markdown).

#### 7. CLI — structured input file, verdict in output

**File**: `packages/code-reviewer/src/cli.ts`

**Intent**: Move the CLI logic into an exported `runCli` in a new `src/run-cli.ts` that returns the exit code, and reduce `cli.ts` to `process.exitCode = await runCli(process.argv.slice(2))` — `cli.ts` runs on import and exports nothing, so this seam is the only way a test can inject `MockLanguageModelV4`. `runCli` replaces argv-joining with `node:util`'s `parseArgs`, reading a required `--input-file <path>` flag and an optional `--markdown-out <path>`. Read and `JSON.parse` the file, validate it against `ReviewInputSchema` (fail with a clear message if invalid), call `reviewCode(input, deps)`, then `computeVerdict(result.scores)`, and print `{ ...result, verdict }` as JSON to stdout — matching the existing `console.log(JSON.stringify(..., null, 2))` convention. With `--markdown-out`, also write `formatReviewComment({ ...result, verdict })` to that path. Per Critical Implementation Details, the exit code stays 0 for a legitimate fail verdict; it's nonzero only when `reviewCode`/input-parsing itself throws.

**Contract**: `runCli(argv: string[], deps?: { agent?: ReviewerAgent }): Promise<number>`. CLI usage becomes `node dist/cli.js --input-file <path> [--markdown-out <path>]`; stdout is `Review & { verdict: { pass: boolean; reason: string } }` as JSON.

#### 8. Barrel export

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Export the new `ReviewInputSchema`/`ReviewInput` type, `ScoresSchema`, `formatReviewComment`, and `computeVerdict`/`PASS_THRESHOLDS`, and update the `reviewCode` re-export to reflect its new signature (no functional change here, just following the existing barrel pattern).

#### 9. Tests

**Files**: `packages/code-reviewer/src/schemas/review.test.ts` (new), `packages/code-reviewer/src/verdict.test.ts` (new), `packages/code-reviewer/src/prompts/reviewer.test.ts` (extend), `packages/code-reviewer/src/agent/reviewer.test.ts` (update), `packages/code-reviewer/src/index.test.ts` (update), `packages/code-reviewer/src/run-cli.test.ts` (new), `packages/code-reviewer/src/format.test.ts` (new)

**Intent**: Follow the existing mocked-model pattern (`MockLanguageModelV4`, stubbed empty API key for the "no network" tests) — no live `OPENROUTER_API_KEY` needed. Cover: `z.toJSONSchema(ReviewSchema)` contains no `minimum`/`maximum` anywhere (offline regression guard for the provider 400); `ScoresSchema` rejects 0, 11 and 7.5; `reviewCode` rejects when the mocked model returns an out-of-range score; `computeVerdict` against the average/security-floor rule (including the boundary cases — security exactly at 6, average exactly at 7); prompt injection across all three tags plus truncation notes; `reviewCode` sends the new prompt shape; `runCli` (with a `MockLanguageModelV4` agent) parses `--input-file`, validates its contents, returns 0 on both pass and fail verdicts but nonzero on a malformed input file, and writes the markdown when `--markdown-out` is given; `formatReviewComment` keeps the table intact when model text contains `|` or newlines, and neutralizes `@` mentions.

### Success Criteria:

#### Automated Verification:

- Dependencies install cleanly: `cd packages/code-reviewer && npm ci`
- Typecheck passes: `npm run typecheck`
- Unit tests pass: `npm test`
- Build succeeds: `npm run build`

#### Manual Verification:

- Running `node dist/cli.js --input-file <fixture>.json` against a real `OPENROUTER_API_KEY` returns a JSON object with all six scores present and a `verdict` matching the computed rule — once with a small fixture and once with a near-cap (~60,000-char) diff, which must still come back as complete, parseable JSON (no output truncation).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Composite action + GHA workflow

### Overview

Build the composite action that installs, builds, and invokes `packages/code-reviewer` against a PR's diff/title/description, and the workflow that triggers it, posts the PR comment, and manages labels.

### Changes Required:

#### 1. Composite action (new)

**File**: `.github/actions/code-review/action.yml`

**Intent**: Encapsulate "run the reviewer" so the calling workflow stays easy to reason about (per requirements.md). Takes `base-sha`, `head-sha`, `openrouter-api-key` as inputs (`secrets` isn't available inside composite actions, hence the key as an input; no GitHub token is needed — nothing in the action calls the GitHub API). Every `run:` step declares `shell: bash` (required in composite actions). Steps: `actions/setup-node@v4` (node-version 24, cache npm, `cache-dependency-path: packages/code-reviewer/package-lock.json`) → `npm ci` and `npm run build` in `packages/code-reviewer` (working-directory) → compute the diff with `git diff "$BASE_SHA...$HEAD_SHA"` (three-dot, against the merge base) to a file — this relies on the calling workflow's `fetch-depth: 0` checkout, with no further `git fetch` (see Critical Implementation Details) → assemble the `--input-file` JSON in a small Node step (`node -e`): read `pull_request.title`/`pull_request.body` (`body` may be `null` → `''`) from the event payload at `$GITHUB_EVENT_PATH`, read the diff from its file, and write the result with `JSON.stringify` — PR text never passes through a shell variable or `${{ }}` (see Critical Implementation Details), and no field's content can break the JSON → run `timeout 300 node dist/cli.js --input-file <path> --markdown-out <comment.md> > review.json` (coreutils `timeout` exits 124 on a hang — composite steps can't take `timeout-minutes`, and the package threads no `abortSignal` into `agent.generate()`), `id: run_review`, `continue-on-error: true`.

**Contract**: Outputs `outcome` (the `run_review` step's own outcome: `success` or `failure`), plus `review-file` and `comment-file` (absolute paths to the written `review.json` and `comment.md`, valid only when `outcome == success`) for the calling workflow to read.

#### 2. Workflow (new)

**File**: `.github/workflows/code-review.yml`

**Intent**: Trigger on PRs to `master`, gate forks and unrelated label events, call the composite action, then branch on its outcome — post a formatted comment + set the pass/fail label on success, or post a neutral "review unavailable" comment (no label change) on failure.

**Contract**:
- `on.pull_request: { branches: [master], types: [opened, synchronize, reopened, labeled] }`
- Workflow-level `permissions: {}`; job `review` sets `permissions: { contents: read, issues: write, pull-requests: write }` (see Critical Implementation Details on why `issues: write` is required alongside `pull-requests: write`). Every step that runs `gh` sets `env: GH_TOKEN: ${{ github.token }}` — `gh` doesn't pick up the job token on its own.
- Job `if:` combines fork exclusion (`github.event.pull_request.head.repo.full_name == github.repository`, same convention as `ci.yml`'s `e2e` job) with the label filter (`github.event.action != 'labeled' || github.event.label.name == 'ai-cr:review'`) — so `opened`/`synchronize`/`reopened` always run, but a `labeled` event only runs for the retry label.
- Job-level (under `jobs.review`, never workflow-level) `concurrency: { group: code-review-${{ github.event.pull_request.number }}, cancel-in-progress: true }` and `timeout-minutes: 10`. At workflow level a run joins the group before the job's `if:` is evaluated, so a run for an unrelated label — skipped moments later — would still cancel an in-flight review (e.g. `gh pr create --label bug` dispatches `opened` + `labeled` back to back).
- Steps: checkout (`fetch-depth: 0`, `persist-credentials: false` — see Critical Implementation Details on the diff) → "Ensure review labels exist" (`gh label create ai-cr:passed --color 2ea44f --force`, `ai-cr:failed --color d73a4a --force`, `ai-cr:review --color ededed --force`) → call `.github/actions/code-review` with the PR's `base.sha`/`head.sha` and `secrets.OPENROUTER_API_KEY` → a step with `if: always()` that removes the `ai-cr:review` label if present (retry consumed either way, even when an earlier step failed) → on the action's `outcome == 'success'`: `gh pr comment --body-file` with the action's `comment-file` (rendered by the package's `formatReviewComment` — no formatting logic in the workflow), then `gh pr edit` to add the matching pass/fail label and remove the other one → on `outcome == 'failure'`: `gh pr comment` with a neutral "reviewer invocation failed this run, see the workflow run" message (linking `github.server_url`/`github.repository`/`actions/runs`/`github.run_id`), no label change.

### Success Criteria:

#### Automated Verification:

- Package build still passes (consumed by the action): `cd packages/code-reviewer && npm run build`
- Workflow lints clean, including the local action's inputs/outputs: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest` (or a local `actionlint` binary)

#### Manual Verification:

- Open a real PR (or push to an existing one) in this repo and confirm the `review` job runs, the composite action completes, and a PR comment with all six scores appears.
- Confirm the label matches the computed verdict (`ai-cr:passed` or `ai-cr:failed`).
- Add the `ai-cr:review` label to an already-reviewed PR and confirm the job re-runs and the label is removed afterward.
- Add an unrelated label (not `ai-cr:review`) and confirm the job does NOT run — and add one while a review is in progress, confirming that review still completes and comments.
- Temporarily set an invalid `OPENROUTER_API_KEY` (or otherwise force the invocation to fail) and confirm a neutral comment is posted, the job stays green, and no label is added/changed.
- Confirm the job's `if:` condition would skip a fork PR (via a fork PR if available, or by tracing the condition against `github.event.pull_request.head.repo.full_name` for a hypothetical fork).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: End-to-end verification

### Overview

Confirm the full feature works against this repo's real GitHub settings (token permissions, label state, fork behavior) that can't be verified by unit tests or a code read alone.

### Changes Required:

None — this phase is verification only, no file changes.

### Success Criteria:

#### Manual Verification:

- A same-repo PR with an intentionally clean, well-tested change gets `ai-cr:passed` and a comment with high scores across the board.
- A same-repo PR with a seeded issue (e.g. an obvious security gap, such as an unvalidated input passed to a shell command) gets `ai-cr:failed`, and the comment's `reason` names the security floor as the cause.
- The default `GITHUB_TOKEN`'s `issues: write` + `pull-requests: write` job permissions are sufficient in this repo's actual settings — no PAT/App token needed (confirms the open question research flagged as unconfirmed).
- No secrets (API key, raw diff content beyond what's already public in the PR) appear in workflow logs or the PR comment.

**Implementation Note**: This is the final phase — no further pause needed after manual confirmation.

---

## Testing Strategy

### Unit Tests:

- Schema: model-facing `ReviewSchema` emits no `minimum`/`maximum` in its JSON Schema; `ScoresSchema` rejects out-of-range/non-integer values; input schema rejects missing fields.
- Verdict: average/security-floor rule at and around both thresholds (security = 5/6/7; score sums 41/42/43 — average ≈6.83/7.0/≈7.17, the reachable values around 7 — with security otherwise passing).
- Prompt: injection variants across all three tags (extending the existing 8-case table); truncation note appears only when a cap is actually exceeded.
- Agent: `reviewCode` sends the new three-section prompt in a single step, same token cap as today.
- CLI (`runCli` with an injected mock agent): valid input file → 0 with `verdict` in stdout JSON (both pass and fail cases); malformed/missing input file → nonzero, no network call attempted.
- Formatter: `|` and newlines in model text don't break the score table; `@` mentions are neutralized.

### Integration Tests:

- None new for the package (the existing mocked-model suite already exercises the full `reviewCode` → schema round trip). The composite action + workflow have no automated integration test — GHA has no local test harness in this repo; Phase 2/3's manual verification is the integration test.

### Manual Testing Steps:

1. Run `packages/code-reviewer`'s CLI locally against a real `OPENROUTER_API_KEY` with a small fixture input file, confirm all six scores and a verdict come back.
2. Open a real PR in this repo, watch the `review` job run in the Actions tab, confirm comment + label.
3. Add `ai-cr:review` to that PR, confirm a second run and label cleanup.
4. Force an invocation failure (bad key), confirm the soft-fail path.

## Performance Considerations

- Diff and description are capped (60,000 / 4,000 characters) before reaching the model — bounds cost and latency predictably, consistent with the package's existing `maxOutputTokens: 2048` discipline (raised to 8192 in implementation, see `change.md`). Uncapped diffs were an explicitly flagged risk in `research.md`.
- No `node_modules/`/`dist/` caching — `npm ci` and `npm run build` run every time, helped only by setup-node's npm download cache; acceptable for v1 given the package's small size; revisit only if review-job latency becomes a real complaint.
- The CLI step's `timeout 300` turns a hung OpenRouter call into the neutral-comment path. The job's `timeout-minutes: 10` is only a backstop for a wedged install/build, and that case goes red.

## Migration Notes

None. The `ReviewSchema` change is breaking, but the only prior consumer is this package's own test suite (updated in Phase 1) — no external caller or stored data depends on the old `{summary, issues}` shape.

## References

- Requirements: `context/changes/ci-cd-code-review/requirements.md`
- Research: `context/changes/ci-cd-code-review/research.md`
- Current schema: [packages/code-reviewer/src/schemas/review.ts](../../../packages/code-reviewer/src/schemas/review.ts)
- Current prompt: [packages/code-reviewer/src/prompts/reviewer.ts](../../../packages/code-reviewer/src/prompts/reviewer.ts)
- This repo's GHA conventions: [.github/workflows/ci.yml](../../../.github/workflows/ci.yml)
- GHA mechanics pattern source: [.claude/skills/10x-impl-review-ci/references/workflow-template.yml](../../../.claude/skills/10x-impl-review-ci/references/workflow-template.yml)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: `packages/code-reviewer` contract change

#### Automated

- [x] 1.1 Dependencies install cleanly: `cd packages/code-reviewer && npm ci` — 62da68e
- [x] 1.2 Typecheck passes: `npm run typecheck` — 62da68e
- [x] 1.3 Unit tests pass: `npm test` — 62da68e
- [x] 1.4 Build succeeds: `npm run build` — 62da68e

#### Manual

- [x] 1.5 CLI run against a real OPENROUTER_API_KEY returns all six scores and a verdict (small and near-cap fixtures) — 62da68e

### Phase 2: Composite action + GHA workflow

#### Automated

- [x] 2.1 Package build still passes: `cd packages/code-reviewer && npm run build` — a3b163c
- [x] 2.2 Workflow lints clean with actionlint — a3b163c

#### Manual

- [x] 2.3 Real PR triggers the review job and a comment with all six scores appears — d474e80
- [x] 2.4 Label matches the computed verdict — d474e80
- [x] 2.5 `ai-cr:review` label re-triggers a run and is removed afterward — d474e80
- [x] 2.6 Unrelated label addition does NOT trigger the job nor cancel an in-flight review — d474e80
- [x] 2.7 Forced invocation failure posts a neutral comment, job stays green, no label change — d474e80
- [x] 2.8 Fork PR condition confirmed to skip the job — d474e80

### Phase 3: End-to-end verification

#### Manual

- [x] 3.1 Clean PR gets `ai-cr:passed` with high scores — 28fc9e7
- [ ] 3.2 PR with a seeded security issue gets `ai-cr:failed`, reason names the security floor
- [x] 3.3 Default GITHUB_TOKEN permissions confirmed sufficient (no PAT needed) — 28fc9e7
- [x] 3.4 No secrets or raw sensitive content appear in logs or the PR comment — d9b90fb
