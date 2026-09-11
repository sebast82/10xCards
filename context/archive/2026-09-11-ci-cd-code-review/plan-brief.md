# CI/CD Agentic Code Review — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Every pull request to `master` gets an automated AI code review, scored 1–10 across six criteria (correctness, idiomaticity, complexity, test/risk coverage, documentation, security), posted as a PR comment with a pass/fail label. The review runs through `packages/code-reviewer` (already built, OpenRouter-backed) — but that package's current shape can't carry per-criterion scores or the three inputs (title, description, diff) this feature needs, so its contract changes first.

## Starting Point

`packages/code-reviewer` exists today with a `{summary, issues[]}` schema and a CLI that takes one opaque string. No composite action or review workflow exists yet — `.github/workflows/ci.yml` is the only live workflow. A near-complete GHA *mechanics* template exists at `.claude/skills/10x-impl-review-ci/references/workflow-template.yml` (label-gated triggers, `gh pr view --json labels`) but calls a different tool (`claude-code-action`), so it's a pattern source, not reusable code.

## Desired End State

A same-repo PR gets a comment with all six scores, issues, and a verdict within minutes of opening or pushing; `ai-cr:passed`/`ai-cr:failed` reflects the verdict; adding `ai-cr:review` re-runs it. Fork PRs are skipped. A reviewer-infra failure posts a neutral notice instead of blocking the PR.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Plan scope | Include the package contract change in this plan | Research found the schema/CLI gap is the actual blocking dependency, not the GHA wrapper — sequencing them together keeps that visible. | Plan |
| Input shape | Single JSON file, one `--input-file` CLI arg | Avoids argv-length limits on large diffs and is trivially fixture-testable. | Plan |
| Pass/fail rule | Average ≥ 7 across all six scores AND security ≥ 6 | Matches how real reviews work — a serious security issue fails the review even if everything else scores well. | Plan |
| PR description input | Always included, capped at 4,000 chars | Descriptions are short relative to diffs; the intent context is worth the small added cost. | Plan |
| Diff size | Truncated at 60,000 chars with an explicit note | Bounds cost/latency predictably; a partial review beats none for large PRs. | Plan |
| Invocation failure | Post a neutral comment, keep the job green, no label change | User's explicit choice — don't let reviewer-infra flakiness block merges. | Plan |
| Retry/label UX | Remove `ai-cr:review` after run; always post a new comment (no upsert) | Simpler — no comment-lookup logic needed. | Plan |
| Token/permissions | Default `GITHUB_TOKEN`, job-scoped `issues: write` + `pull-requests: write` | No new secret to provision; matches the proven template pattern (with the label-API permission gap closed). | Plan |
| Build strategy | `npm ci && npm run build` every run; no `node_modules`/`dist` caching (setup-node's npm download cache only) | Simplest; avoids any risk of a stale `dist/` being reviewed by the tool meant to catch exactly that kind of bug. | Plan |

## Scope

**In scope:** package schema/prompt/CLI contract change (scores, three inputs, verdict logic), composite action to build+invoke the reviewer, workflow to trigger/gate/comment/label, end-to-end verification against this repo's real GitHub settings.

**Out of scope:** repo-read tools for the agent (deliberate seam, not revisited here), business-alignment/architectural-fit criteria (parked in requirements.md), commit-status checks, override-label bypass gate, running on `push` to master, caching `node_modules`/`dist`, workflow-level retries beyond the SDK's default.

## Architecture / Approach

Phase 1 changes `packages/code-reviewer`'s contract (schema → prompt → CLI → verdict logic), fully covered by the existing mocked-model test pattern. Phase 2 builds a composite action (`.github/actions/code-review`) that installs/builds the package, assembles a `{title, description, diff}` JSON input file (title/description read from the event payload, diff via a three-dot `git diff` on a full-history checkout — never shell-interpolated, to avoid GHA script injection), and invokes the CLI; the calling workflow (`.github/workflows/code-review.yml`) handles triggering, fork/label gating, and the PR-facing comment + label side effects. Phase 3 verifies the whole path against real GitHub permissions and a seeded pass/fail case.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Package contract change | Scores schema, three-input support, verdict logic, updated CLI — all unit-tested | Breaking schema change, but no real external consumer yet |
| 2. Composite action + workflow | Full automated review on every PR: build, invoke, comment, label | Untested-by-nature GHA mechanics (permissions, label API scope, diff-fetch ordering) |
| 3. End-to-end verification | Confirmed against this repo's real token permissions and a seeded fail case | Default `GITHUB_TOKEN` permission sufficiency was flagged as unconfirmed by research |

**Prerequisites:** an `OPENROUTER_API_KEY` repository secret (referenced but not newly provisioned by this plan — assumed already usable given the package's existing `.env.example`).
**Estimated effort:** ~2-3 sessions across 3 phases.

## Open Risks & Assumptions

- Default `GITHUB_TOKEN` with `issues: write` + `pull-requests: write` is assumed sufficient for label creation + PR comments in this repo's actual branch/token settings — unconfirmed until Phase 3's real run (research flagged this as unverified, not broken).
- The 60,000/4,000-character truncation caps are defensive defaults, not measured against this package's actual per-token cost — may need tuning after real usage.
- A seeded "security issue" PR for Phase 3 testing needs to be crafted carefully so it doesn't itself introduce a real vulnerability into the branch history.

## Success Criteria (Summary)

- Every same-repo PR to `master` gets a scored review comment and a pass/fail label without manual intervention.
- A serious security issue always fails the review, regardless of how well the rest of the PR scores.
- Reviewer-infra failures never silently block a PR nor silently pass it without any signal — they post a visible neutral notice.
