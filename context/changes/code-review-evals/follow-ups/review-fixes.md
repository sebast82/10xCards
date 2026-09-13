# Follow-ups: code-review-evals

Queued from the implementation (manual check 3.8, first paid run `eval-WMQ-2026-09-11T17:19:00`).

## F1 — The `flaw_default_props` rubric may be stricter than a human reading

- **Where from:** GLM 5.1 scored 0.5 on `flaw_default_props`. Its top issue says `DeckPanel.defaultProps`
  "will be silently ignored, so callers who omit `formatDueDate`/`pageSize` will receive `undefined`", and a
  second issue says the defaults "currently won't" work. The judge docked it only for not stating that the
  render's `formatDueDate(…)` call throws. The judge applied the rubric faithfully; a human reader would likely
  count the defect as found.
- **Why not fixed now:** re-tuning a rubric after seeing one run's outputs fits the rubric to that run.
- **To do:**
  - Decide what "consequence stated" means for this flaw: accept "the props are `undefined` at runtime" as the
    consequence, or keep the crash as the bar and say so explicitly in the rubric text.
  - Re-grade with `--repeat 3` before and after the change, and check that the other two 0.5 scores stay at 0.5 —
    Sonnet 5 ("dead for type safety") and DeepSeek V4 Flash ("deprecated") misstate the mechanism rather than
    only omitting the crash.
- **Related observation:** no model connected `App` omitting `formatDueDate`/`pageSize` (visible in the diff) to
  the crash, and all three scored 0.5 here — today this metric does not separate the models at all.
- **"Before" measurement now recorded** (`code-review-model-gate`, `eval-7yx-2026-09-13T21:25:19`, `--repeat 3`):
  `flaw_default_props` passes 0/3 for Sonnet 5, 1/3 for GLM 5.1, 0/3 for DeepSeek V4 Flash, while every other
  recall metric on that fixture is 3/3 for Sonnet. The judge reasons are consistent: each model names
  `DeckPanel.defaultProps` and says React 19 ignores it, and is docked for not stating that the render's
  `formatDueDate(…)` call then throws. Re-measure against these numbers after retuning the bar. The gate's
  `baseline.json` records 0/3, so the rubric decision can be made without the gate crying wolf in the meantime.
- **Consequence facts (impl-review F3):** the fixture has no error boundary, so under React 19 the uncaught
  `TypeError` unmounts the whole root — the app goes blank, not only the panel — and it throws only once cards have
  loaded (`formatDueDate` runs per visible card). The current text ("crashes the panel", `cases.ts:27-28`)
  understates this; state the consequence accurately whichever bar is chosen above.

## impl-review F1 — Eval fixtures enter the CI review diff

- **Where:** `.github/actions/code-review/action.yml:86` — the first `git diff` pathspec excludes `context` and
  lockfiles, not `packages/code-reviewer/evals/fixtures`.
- **Why it matters:** a PR that changes a fixture sends deliberately flawed code to the CI reviewer as the PR's own,
  and `evals/` sorts before `src/`, so fixtures use the 60,000-char budget first. The plan accepted this for the PR
  that adds `react-19-migration`; it recurs with every new fixture (the security-calibration follow-up adds some).
- **To do (in the change that adds the next fixture):** add `':(exclude)packages/code-reviewer/evals/fixtures'` to
  the first pathspec and extend the comment at L73-77 (fixtures are seeded with flaws on purpose).
- **Done** in `code-review-model-gate` (2026-09-13), the change that added `deck-search-endpoint` and
  `clean-control`: the pathspec excludes `packages/code-reviewer/evals/fixtures` and the comment says why.
