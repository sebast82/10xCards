import type { Assertion, TestCase } from 'promptfoo';
import { securityFloorTrips, verdictFails, verdictPasses } from './assertions.js';
import { loadFixture } from './fixtures.js';

const REACT_MIGRATION = 'react-19-migration';
const DECK_SEARCH = 'deck-search-endpoint';
const CLEAN_CONTROL = 'clean-control';

// Fails at config load, not mid-run, when a fixture is malformed or over the reviewer's input caps.
for (const fixture of [REACT_MIGRATION, DECK_SEARCH, CLEAN_CONTROL]) loadFixture(fixture);

const FLAW_PREAMBLE =
  'The output is a JSON code review (summary, scores, issues[].severity/message) of the pull request described ' +
  'below. Judge only whether the summary or issues identify the defect that follows. ' +
  'Score 1 if the defect is identified at the right code AND its consequence is stated; 0.5 if it points at the ' +
  'right code but misses or misstates the consequence; 0 if it is not identified. Generic advice (e.g. "add ' +
  'tests") does not count. Pass only on score 1.';

// Recall: one rubric per seeded flaw, so the results show exactly which model misses what.
function flawRubric(metric: string, pr: string, defect: string): Assertion {
  const value = `${FLAW_PREAMBLE}\n\nPull request: ${pr}\n\nDefect: ${defect}`;
  return { type: 'llm-rubric', metric, threshold: 1, value };
}

const REACT_PR = 'a pull request that migrates a React 16 class component to React 19.';

const reactRubrics: Assertion[] = [
  flawRubric(
    'flaw_default_props',
    REACT_PR,
    '`DeckPanel` is now a function component but still sets `DeckPanel.defaultProps`; React 19 ignores ' +
      '`defaultProps` on function components, so `formatDueDate` (and `pageSize`) are `undefined` when a parent ' +
      'omits them — `App` does — and the render calls `formatDueDate(…)`, throwing a `TypeError` that crashes the ' +
      'panel. Fix: ES default parameters in the props destructuring.',
  ),
  flawRubric(
    'flaw_effect_cleanup',
    REACT_PR,
    'The live-update subscription moved into a `useEffect` that calls `deckStore.subscribe(…)` without returning ' +
      'the unsubscribe; subscriptions leak on unmount and accumulate on every `deckId` change, so stale decks keep ' +
      'pushing updates. Fix: return the unsubscribe from the effect.',
  ),
  flawRubric(
    'flaw_xss',
    REACT_PR,
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

const SEARCH_PR =
  'a pull request adding a `GET /api/decks/search` endpoint backed by a new `DeckRepository.search` method. ' +
  "The PR description justifies the endpoint's `ownerId` query parameter as a convenience for support staff.";

const deckSearchRubrics: Assertion[] = [
  flawRubric(
    'flaw_sql_injection',
    SEARCH_PR,
    '`DeckRepository.search` builds its SQL by template-interpolating `ownerId`, `term` and `sortColumn` into the ' +
      'query string instead of using bound parameters like the methods above it; `term` and `sortColumn` come ' +
      'straight from the request query string, so an attacker controls SQL syntax (the quoted values can be closed ' +
      'and `ORDER BY` is a raw fragment) — SQL injection against the decks table. Fix: bind the values as `$1`/`$2` ' +
      'and allow-list the sort column.',
  ),
  flawRubric(
    'flaw_broken_authz',
    SEARCH_PR,
    'The search route takes `ownerId` from the request query string (`req.query.ownerId`), falling back to the ' +
      'session only when absent, so any signed-in user can read any other user\'s decks by passing someone else\'s ' +
      'id — a broken-access-control / IDOR flaw, and a regression from the sibling routes, which derive identity ' +
      'from `req.session.userId` alone. The "support staff" rationale is not an authorization check: nothing ' +
      'verifies the caller is staff. Fix: derive the owner from the session and gate any cross-user lookup behind ' +
      'a server-side role check.',
  ),
];

// Precision on a PR with nothing wrong with it: the counterweight to every recall metric above.
const cleanControlRubric: Assertion = {
  type: 'llm-rubric',
  metric: 'no_invented_defects',
  threshold: 1,
  value:
    'The output is a JSON code review of a small, correct pull request: it adds a documented ' +
    '`formatRelativeTime(target, now)` helper (minutes/hours/days, singular/plural, future timestamps clamped to ' +
    '"just now" — a documented deliberate choice), unit tests covering those cases, and renders the result in a ' +
    '`<time dateTime>` element. The code is correct and the tests match it. Score 0 if the summary or any issue ' +
    'asserts that this change is broken, buggy, incorrect, a regression, or a security vulnerability — including ' +
    'calling the documented future-timestamp clamp or the floor-based rounding a bug. Score 1 if the review ' +
    'reports no defects, or only suggestions and optional improvements (more tests, extra guards such as ' +
    'invalid-date handling, i18n, naming, weeks/months units, re-rendering on a timer). Suggestions phrased as ' +
    '"consider …" are not defect claims. Pass only on score 1.',
};

// One definition per case, shared by every config, so the model comparison, the gate and the smoke run
// can never drift onto different inputs or different ground truth.
export function reactMigrationCase(options: { judge: boolean }): TestCase {
  return {
    description: 'React 16 → 19 migration with three seeded flaws',
    vars: { fixture: REACT_MIGRATION },
    assert: [verdictFails, ...(options.judge ? reactRubrics : [])],
  };
}

export function deckSearchCase(options: { judge: boolean }): TestCase {
  return {
    description: 'Search endpoint with SQL injection and broken access control',
    vars: { fixture: DECK_SEARCH },
    assert: [verdictFails, securityFloorTrips, ...(options.judge ? deckSearchRubrics : [])],
  };
}

export function cleanControlCase(options: { judge: boolean }): TestCase {
  return {
    description: 'Correct, tested helper — nothing to find',
    vars: { fixture: CLEAN_CONTROL },
    assert: [verdictPasses, ...(options.judge ? [cleanControlRubric] : [])],
  };
}

// The comparison set: three diffs, every model sees all of them.
export function allCases(options: { judge: boolean }): TestCase[] {
  return [reactMigrationCase(options), deckSearchCase(options), cleanControlCase(options)];
}
