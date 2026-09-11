import type { Assertion, TestCase } from 'promptfoo';
import { verdictFails } from './assertions.js';
import { loadFixture } from './fixtures.js';

const REACT_MIGRATION = 'react-19-migration';

// Fails at config load, not mid-run, when the fixture is malformed or over the reviewer's input caps.
loadFixture(REACT_MIGRATION);

const FLAW_PREAMBLE =
  'The output is a JSON code review (summary, scores, issues[].severity/message) of a pull request that migrates ' +
  'a React 16 class component to React 19. Judge only whether the summary or issues identify the defect below. ' +
  'Score 1 if the defect is identified at the right code AND its consequence is stated; 0.5 if it points at the ' +
  'right code but misses or misstates the consequence; 0 if it is not identified. Generic advice (e.g. "add ' +
  'tests") does not count. Pass only on score 1.';

// Recall: one rubric per seeded flaw, so the results show exactly which model misses what.
function flawRubric(metric: string, defect: string): Assertion {
  return { type: 'llm-rubric', metric, threshold: 1, value: `${FLAW_PREAMBLE}\n\nDefect: ${defect}` };
}

const judgeRubrics: Assertion[] = [
  flawRubric(
    'flaw_default_props',
    '`DeckPanel` is now a function component but still sets `DeckPanel.defaultProps`; React 19 ignores ' +
      '`defaultProps` on function components, so `formatDueDate` (and `pageSize`) are `undefined` when a parent ' +
      'omits them — `App` does — and the render calls `formatDueDate(…)`, throwing a `TypeError` that crashes the ' +
      'panel. Fix: ES default parameters in the props destructuring.',
  ),
  flawRubric(
    'flaw_effect_cleanup',
    'The live-update subscription moved into a `useEffect` that calls `deckStore.subscribe(…)` without returning ' +
      'the unsubscribe; subscriptions leak on unmount and accumulate on every `deckId` change, so stale decks keep ' +
      'pushing updates. Fix: return the unsubscribe from the effect.',
  ),
  flawRubric(
    'flaw_xss',
    'The user-authored deck description is rendered with `dangerouslySetInnerHTML` without sanitisation ' +
      '(previously escaped text) — a stored XSS vulnerability. Fix: sanitise (e.g. DOMPurify) or render as text.',
  ),
  // Precision: stops a review that flags everything from scoring full marks on recall.
  {
    type: 'llm-rubric',
    metric: 'no_false_react19_flags',
    threshold: 1,
    value:
      'The output is a JSON code review of a pull request migrating to React 19. These changes in it are correct ' +
      'React 19: `ReactDOM.render` → `createRoot`; `<ThemeContext value>` used as a provider; `ref` passed as a ' +
      'regular prop instead of `forwardRef`; `use(ThemeContext)` to read context. Score 0 if the summary or any ' +
      'issue claims one of these is a bug, unsupported, or must be reverted; 1 otherwise. Neutral mentions or ' +
      'praise are fine. Pass only on score 1.',
  },
];

// The single definition of the React 19 case, shared by the main and the smoke config so they cannot drift.
export function reactMigrationCase(options: { judge: boolean }): TestCase {
  return {
    description: 'React 16 → 19 migration with three seeded flaws',
    vars: { fixture: REACT_MIGRATION },
    assert: [verdictFails, ...(options.judge ? judgeRubrics : [])],
  };
}
