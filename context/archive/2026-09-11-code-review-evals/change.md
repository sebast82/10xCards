---
change_id: code-review-evals
title: Introduce promptfoo to evaluate the AI code-review agent
status: archived
created: 2026-09-11
updated: 2026-09-13
archived_at: 2026-09-13T21:45:19Z
---

## Notes

introducing promtfoo for ai agent evaluation

- **Adapted in Phase 1:** the retry test needs a model that throws, and the "no local
  `new MockLanguageModelV4`" check puts every mock in `src/testing/mock-model.ts`, so it exports a second
  helper, `mockFailingModel(error)`. The barrel also exports `ReviewOptions` (`{ agent?, abortSignal? }`),
  the options type of `runReview`/`reviewCode`.
- **Adapted in Phase 3 (fixture):** `src/main.tsx` implies Vite, so the fixture diff also carries
  `vite.config.ts`, `tsconfig.json` and a root `index.html` (correct changes, realistic noise). `App` moves
  from `<ThemeContext.Consumer>` to `use(ThemeContext)`, which puts its `<DeckPanel deckId query />` call —
  without `formatDueDate`/`pageSize` — into the diff. Git reports most `.js` → `.tsx` files as delete + add
  (below its 50% rename similarity); the CI diff would show the same.
- **First paid run (manual checks 3.6–3.8), `eval-WMQ-2026-09-11T17:19:00`, repeat 1:** all three models
  returned a review (`finishReason: stop`): 15 graded assertions, exit 100. `verdict_fails`,
  `flaw_effect_cleanup` and `flaw_xss` passed for all three; `flaw_default_props` scored 0.5 for all three
  (see follow-up F1); `no_false_react19_flags` failed only for DeepSeek V4 Flash, which claimed
  `<ThemeContext value>` is a runtime error. Cost per review: Sonnet 5 $0.032, GLM 5.1 $0.020, DeepSeek V4
  Flash $0.0018; latency 14 s / 22 s / 204 s (DeepSeek routed to Venice — two thirds of the 300 s timeout).
  A single run — not a model ranking.
