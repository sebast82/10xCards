---
change_id: ci-cd-code-review
title: Ci cd code review
status: implementing
created: 2026-09-11
updated: 2026-09-11
archived_at: null
---

## Notes

First Github Actions workflow for agentic code review based on packages/code-reviewer

- **Adapted in Phase 1 (manual check 1.5):** the plan kept `maxOutputTokens` at 2048. Claude Sonnet 5
  reasons by default (effort `high`) and OpenRouter counts reasoning inside `max_tokens`, so a
  59k-char diff spent all 2048 tokens reasoning (`finishReason: length`, 0 text tokens) and returned
  no JSON. Chosen fix: `reasoning: { effort: 'low' }` on the OpenRouter model + `maxOutputTokens` 8192.
  The model doesn't support budget-based reasoning (`reasoning.max_tokens`), so the split is not hard.
- **Adapted in Phase 2 (manual check 2.3):** the plan computed one `git diff base...head`. On PR #19
  the reviewer saw 60k of 127k chars: `git diff` orders by path, `context/` (75k of plan/research
  docs) sorts before `packages/` (40k), so the package code was cut off and scored unseen. Chosen
  fix: the action diffs everything except `context/` and lockfiles first, then appends `context/`.
  Docs are still reviewed when budget remains; code is never cut off in their favour.