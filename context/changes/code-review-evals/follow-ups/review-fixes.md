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
