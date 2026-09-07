# E2E krytycznej pętli — Implementation Plan

## Overview

Rollout Phase 4 of `context/foundation/test-plan.md:80` lands a browser-level gate on the main user
path, plus the CI plumbing to run it on every PR. Research proved the phase cannot deliver the goal
as literally worded — `page.route` cannot reach OpenRouter because the call is server-side, and
stubbing the app's own `/api/generations` makes the acceptance step 404 — so the gate covers the
**quota-free, deterministic half of the loop**: `login → deck → review`. The generation leg's real
signal stays where Phase 1 already pins it, at the actual network boundary under Vitest.

The phase ships four things: one small production anchor on `/review`, one reviewed E2E spec, one
PR-only CI job with database and test-user provisioning, and a correction of the documented claims
research disproved.

## Current State Analysis

**The loop is fully built.** Every step is reachable and every screen renders; no feature work
blocks this phase.

**The provider seam does not exist in the browser.** `src/lib/openrouter/client.ts:6` hardcodes
`OPENROUTER_ENDPOINT` as a module-level const, called from the Astro server runtime via
`src/pages/api/generations.ts:57` → `src/lib/generations/service.ts:114`. The browser never issues
that request. There is no injectable client, no base-URL env var, no fake-provider flag. This
directly contradicts `context/foundation/test-plan.md:98`, which records `page.route` as the Phase 4
mechanism.

**Stubbing the app's own endpoint cascades.** A fabricated `generationId` never creates a
`generations` row, so the follow-up `POST /api/flashcards` 404s at
`src/lib/flashcards/service.ts:66-80`, which requires a row owned by the user with
`status = 'succeeded'`.

**The generation leg consumes an unreclaimable resource.** `DAILY_GENERATION_LIMIT = 20` over a
rolling 24 h, counted with no status filter so `pending` and `failed` rows count
(`src/lib/generations/service.ts:9,50-66`). There is no DELETE route for `generations`. With
`retries: 2` in CI, one flaky generate-based spec costs 3 permanent rows — roughly 6–7 PR runs per
day before the shared account 429s on our own limit.

**The `/deck → /review` half is free and deterministic.** `POST /api/flashcards` stamps `due = now`
via `createScheduler().createNewCard(new Date())` (`src/lib/flashcards/service.ts:84,125`), and the
queue predicate is a non-strict `.lte("due", now)` with `now` minted server-side
(`src/lib/reviews/service.ts:62-70`). No clock faking, no seeded schedule columns, no quota.

**CI has none of what the gate needs.** `.github/workflows/ci.yml` references exactly two secrets
(`SUPABASE_URL`, `SUPABASE_KEY`), passed only to `npm run build`. There is no e2e job, no
`E2E_USERNAME`/`E2E_PASSWORD`, no `supabase/seed.sql`, and no login-capable user in a fresh local
Supabase — while `tests/e2e/auth.setup.ts:15-22` deliberately hard-fails under CI rather than
falling back to a saved state. `playwright.config.ts:20-27` is already written for a gate that does
not exist.

**`/review` is under-anchored.** `src/pages/review.astro` renders a bare island and
`ReviewSession.tsx:248` is a plain `<div className="flex flex-col gap-8">`. The region-scoping rule
at `context/foundation/lessons.md:59-63` explicitly names *"karty na `/review`"* and has nothing to
attach to. `/deck` by contrast has `<section aria-label="Kolekcja fiszek">`
(`src/components/deck/FlashcardCollection.tsx:224`).

**Two live hazards on the review screen.** `ReviewSession.tsx:167` treats a **409
`Ta fiszka została już oceniona.`** as success and advances the queue anyway — a silent-swallow path
that produces a green-looking but meaningless assertion. And `getReviewQueue` returns *every* due
card for the user capped at 50 (`src/lib/reviews/service.ts:33`), so leftovers from earlier runs
make `Karta 1 z 1` and `To na dziś wszystko — powtórzono 1 fiszek.` non-deterministic assertions.
Worse than non-deterministic: the queue is ordered `due` ascending
(`src/lib/reviews/service.ts:62-70`) and the island renders only `queue[0]`
(`ReviewSession.tsx:94,294`), while a freshly created card is due *now* — the latest due date. A
single leftover therefore hides the card under test entirely, so no assertion about it can hold
until the queue is known empty. `GET /api/reviews` (`src/pages/api/reviews.ts:55-65`) makes that
checkable over HTTP.

## Desired End State

A PR opened against `master` runs a required `e2e` status check. That check starts a local Supabase
stack, provisions a test user, boots the app, and drives one browser test that signs in with a saved
session, creates a flashcard on `/deck` through the UI, navigates to `/review` by the app's own
navigation, finds that exact card, reveals it, grades it, and confirms the server accepted the grade
— then deletes the card it made. A broken main user path turns the check red and blocks the merge
button. A broken CI environment turns a *named provisioning step* red instead, so the two are never
confused.

`context/foundation/test-plan.md` describes what actually exists: Playwright as the e2e stack with
the note that `page.route` cannot reach the provider, a filled §6.6 cookbook, Phase 4 marked
complete, and §7 deferrals recording honestly what this gate does *not* prove.

**Verification**: `npm run test:e2e` is green locally; the `e2e` job is green on a PR; deliberately
breaking the deck→review navigation link turns it red.

### Key Discoveries:

- `src/lib/openrouter/client.ts:6` — the endpoint is a module const in the server runtime; this is
  why `page.route` cannot reach it and why the loop is split.
- `src/lib/flashcards/service.ts:84,125` — `createNewCard(new Date())` means a card created via
  `POST /api/flashcards` is due the instant it exists. The review leg needs no clock manipulation.
- `src/components/review/ReviewSession.tsx:167` — the 409 swallow. The grade assertion must read the
  response status, not the UI.
- `src/pages/api/reviews.ts:55-65` — `GET /api/reviews` returns the whole due queue as `{ cards }`
  with 200. The due queue *is* enumerable over HTTP (unlike the collection, which has no `GET`), so
  the spec can assert an empty-queue precondition instead of hoping the new card lands first.
- `src/components/review/ReviewSession.tsx:250-252` — `role="status" aria-live="polite"` sr-only
  announcer carrying `Karta {n} z {m}` and `Odpowiedź odsłonięta`, added deliberately for
  testability (`context/archive/2026-09-01-srs-review-session/plan.md:211`).
- `src/components/review/ReviewSession.tsx:318-331` — grade button names are `{label} · {interval}`
  with `·` = U+00B7, and the interval half is dynamic FSRS output.
- Playwright's `getByRole(role, { name })` is **case-insensitive substring** by default
  (`escapeForAttributeSelector(name, !!options.exact)`, verified in Playwright source via Context7).
  So `{ name: "Dobrze" }` matches `Dobrze · za 3 dni` with no regex — and `Usuń` ⊂ `Usuń trwale`
  genuinely needs `exact: true`.
- `supabase status -o env --override-name <key>=<NAME>` is the documented machine-readable form
  (Supabase CLI docs via Context7) — closes research Open Question 4.
- `supabase/config.toml:209` — `enable_confirmations = false` locally, so any signup is immediately
  sign-in-able. Closes the "how does CI get a user" problem without a hand-written bcrypt hash.
- `.github/workflows/ci.yml:28-43` — the `db-tests` job is the working precedent for a PR-only job
  with `supabase/setup-cli@v3` pinned to `2.23.4`, documenting its own required-status-check
  requirement in a comment.
- `tests/e2e/seed.spec.ts` — the four patterns this phase inherits: region scoping, the retryable
  hydration block, `waitForResponse` for both the signal and the id, and cleanup via `page.request`
  with an `Origin` header.
- `@astrojs/cloudflare` reads `.dev.vars` at `astro:config:done` and assigns into `process.env`
  unconditionally, so locally `.dev.vars` **overrides** shell env. It is gitignored and absent in
  CI — which is why a green local run does not prove the CI env plumbing.

## What We're NOT Doing

- **Not driving `/generate` in a browser.** No stub of `/api/generations`, no real provider call, no
  fabricated `generationId`. Risk #1's signal stays with Phase 1's Vitest tests at the real network
  boundary.
- **Not adding a server-side provider seam.** Research option (d) is production refactoring; if the
  generation leg must eventually be covered in-browser it gets its own change.
- **Not claiming risk #2 (ownership/IDOR).** pgTAP owns that proof by explicit prior decision
  (`context/archive/2026-09-03-testing-access-gate-data-isolation/plan.md:159-162`), and
  cross-account coverage would need a second account the e2e infra has no provision for.
- **Not re-asserting risk #4.** `tests/e2e/protected-routes.guest.spec.ts` already covers the access
  gate across all four protected routes and needs no test account.
- **Not asserting `due` values or recomputing the schedule.** The oracle rule at
  `context/foundation/test-plan.md:239-244` bars it; the e2e claim is limited to the observable
  outcome.
- **Not adding anchors to `/generate`.** The split loop no longer drives that screen; building
  anchors no test consumes is speculative churn. Recorded as a §7 deferral instead.
- **Not filling the `[PLACEHOLDER]` at `context/foundation/lessons.md:20-34`.** The split loop means
  the gate never creates a `generations` row, so the CI-quota pressure that made it urgent does not
  apply. It stays open for whoever owns the cleanup decision.
- **Not running against a built worker.** `astro dev` is the target; the workerd-runtime gap stays
  covered by the optional pre-prod smoke gate (`context/foundation/test-plan.md:124`).
- **Not adding cloud CI secrets.** Local `supabase start` only.
- **Not asserting screenshots or visual state.** Deterministic DOM only.

## Implementation Approach

Dependency-ordered, four phases, each independently verifiable.

The anchor lands first because the spec's scoping depends on it, and because it is production code
that belongs to `/10x-implement` rather than to the e2e loop — the `/10x-e2e` skill explicitly
declines to write production code (`.claude/skills/10x-e2e/SKILL.md:61-65`). The spec lands second
and must be green locally before any CI work, so that a red CI job can only mean CI. The gate lands
third, following the `db-tests` job structurally so the reviewer has a precedent to diff against.
Docs land last, once there is a real spec to describe.

**Tool routing per phase.** `/10x-e2e` declines three categories by its own contract
(`.claude/skills/10x-e2e/SKILL.md:61-65`): it does not write production code, does not wire up CI,
and does not scaffold test infrastructure. That maps cleanly onto the phases:

| Phase | Kind of work | Driven by |
| --- | --- | --- |
| 1 | Production React component change | `/10x-implement` |
| 2 | The E2E spec itself | **`/10x-e2e`** |
| 3 | CI workflow + provisioning | `/10x-implement` |
| 4 | Documentation | `/10x-implement` |

The skill's entry gate — Playwright installed, config present, `storageState` auth pattern, app
runnable — is already satisfied (`@playwright/test` 1.63.0, `playwright.config.ts`,
`playwright/.auth/`), so Phase 2 passes it rather than stopping to scaffold.

The spec's design turns on two decisions forced by the code: assert the **card's own text**, never a
counter, because leftover due cards are unbounded on a real account; and assert the **grade response
status**, never the UI advance, because `ReviewSession.tsx:167` advances on a 409 too.

## Critical Implementation Details

**Ordering — the anchor gates the spec.** Phase 2's region locator does not exist until Phase 1 is
merged. Writing the spec first means writing it against a locator that resolves to nothing, and the
failure looks like a hydration race rather than a missing attribute.

**The 409 swallow is the phase's sharpest trap.** `ReviewSession.tsx:167` catches a 409 and advances
the queue as if the grade succeeded. Any assertion phrased as "the session moved on" is therefore
satisfiable without the server having recorded anything. The grade step must await the
`POST /api/reviews` response and assert `200` before it looks at the DOM at all.

**`.dev.vars` inverts the usual env precedence.** The Cloudflare adapter assigns it into
`process.env` at `astro:config:done`, so locally it wins over shell variables. Since it is gitignored
and absent in CI, the CI env plumbing is genuinely unproven until the job runs on a real PR — plan
for the first run to fail on something local testing cannot surface.

**`process.env.CI` changes `auth.setup.ts` behavior.** `tests/e2e/auth.setup.ts:15-22` skips to a
saved `storageState` locally but hard-fails under CI by design. The CI job must therefore supply
`E2E_USERNAME`/`E2E_PASSWORD` *and* the user must actually exist — there is no fallback.

---

## Phase 1: Anchor `/review` with a named region

### Overview

Give `ReviewSession` the named landmark that `context/foundation/lessons.md:59-63` prescribes for
this screen, matching the pattern `/deck` already uses. One attribute, one element type change.

### Changes Required:

#### 1. Review session root element

**File**: `src/components/review/ReviewSession.tsx`

**Intent**: The component's root is a bare `<div>` (line 248), so `/review` exposes no named region
and content assertions have nothing to scope to. Change it to a labelled `<section>` so it exposes
role `region`, mirroring `FlashcardCollection.tsx:224`.

**Contract**: Root element becomes `<section aria-label="Sesja powtórkowa">` carrying the existing
`className`. A `<div>` with `aria-label` exposes **no role** and would not be reachable via
`getByRole("region")` — the element type change is load-bearing, not cosmetic. The label collides on
substring with the `<h1>` and the `AppLayout` title of the same text, which is harmless because the
locator is role-scoped.

#### 2. Component test coverage for the region

**File**: `src/components/review/ReviewSession.test.tsx`

**Intent**: Pin the region so a future refactor that drops the attribute fails a fast unit test
rather than a slow, ambiguous E2E run.

**Contract**: One added assertion that a `region` with the accessible name `Sesja powtórkowa` is
present in the rendered output.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes, including `eslint-plugin-jsx-a11y`: `npm run lint`
- Unit and integration tests pass: `npm test`
- The new region assertion in `ReviewSession.test.tsx` passes

#### Manual Verification:

- `/review` renders unchanged visually — no layout shift from `div` → `section`
- Browser devtools accessibility pane shows a `region` named `Sesja powtórkowa`
- The existing sr-only announcer still announces `Karta {n} z {m}` on card change

**Implementation Note**: This phase is production code and runs through `/10x-implement`, not
`/10x-e2e`. It must be merged before Phase 2 begins.

---

## Phase 2: The critical-loop spec

### Overview

One reviewed E2E test proving the main user path still connects: an authenticated session reaches
`/deck`, creates a card through the UI, navigates to `/review` by the app's own navigation, finds
that card, and grades it with the server confirming the grade.

### Changes Required:

#### 1. The loop spec

**File**: `tests/e2e/critical-loop.spec.ts`

**Intent**: Prove that a change to any screen, route, or navigation link in the main path turns a PR
red. This is a smoke gate against `zerwana główna ścieżka użytkownika`
(`context/foundation/test-plan.md:122`), not a proof of provider behavior, ownership, or schedule
arithmetic.

**Contract**: One `test()` in one file, in the `chromium` project so it inherits `storageState` and
the `setup` dependency. Named to bind it to the risk, not to the mechanism. Flow:

1. Unique data — `front`/`back` carrying a timestamp suffix, so parallel runs and the two configured
   retries never collide.
2. **Precondition — the review queue must be empty.** `page.request.get("/api/reviews")` (the route
   exists: `src/pages/api/reviews.ts:55-65`, returns `{ cards }` with 200) and assert `cards` is
   empty, with a message naming the leftovers. This is load-bearing, not defensive:
   `getReviewQueue` orders by `due` ascending (`src/lib/reviews/service.ts:62-70`) and
   `ReviewSession` renders only `queue[0]` (`ReviewSession.tsx:94,294`), while a card created through
   `/deck` is stamped `due = now` — the *latest* due date in the queue. Any pre-existing due card
   therefore hides the new one completely and step 6 fails on a missing locator. Failing here
   instead names the real cause: a dirty account, not a broken app.
3. `page.goto("/deck")`, scope to `getByRole("region", { name: "Kolekcja fiszek" })`.
4. Create the card **through the UI**, wrapping the first island interaction in the retryable
   `expect(async () => {…}).toPass()` block from `context/foundation/lessons.md:37-49` — the
   `client:load` hydration race applies here exactly as in `seed.spec.ts:21-24`. Capture the created
   id from the `POST /api/flashcards` 201 body via `page.waitForResponse`; it is the only handle for
   cleanup, since **no `GET /api/flashcards` exists** — the collection cannot be enumerated over
   HTTP (the *due queue* can, via `GET /api/reviews`, which is what step 2 uses).
5. Navigate to `/review` by clicking the `Powtórki` link inside the `Główna nawigacja` landmark —
   the deck has no "start review" affordance, and the nav link is the real user path. Every
   step-to-step move is a full page load, so the review island hydrates from scratch.
6. Assert the card is the one under review by its **own `front` text**, scoped to the new
   `Sesja powtórkowa` region. Never assert `Karta 1 z 1` or
   `To na dziś wszystko — powtórzono {n} fiszek.` — those read leftover state directly; the own-text
   assertion is only sound because step 2 has already pinned the queue to exactly this card.
7. Reveal via `Pokaż odpowiedź` (also a hydration-race candidate), assert the `back` text.
8. Grade: await the `POST /api/reviews` response and assert **status 200** *before* asserting any UI
   change. `ReviewSession.tsx:167` advances the queue on a 409 as well, so a UI-only assertion is
   satisfiable by a grade the server rejected. Select the grade button by label substring only —
   names are `{label} · {interval}` and the interval half is dynamic FSRS output.
9. Cleanup, **unconditional**: `page.request.delete("/api/flashcards/:id")` with
   `headers: { Origin: new URL(page.url()).origin }`. Both details are load-bearing per
   `context/foundation/lessons.md:65-77` — the `request` fixture has its own network context and
   misses the refreshed Supabase cookie, and without `Origin` the Astro gate returns 403. Assert the
   result with a message carrying status and body.

   Run it from a `test.afterEach` (or a `finally`) over the id captured in step 4, **not** as the
   last statement of the test body the way `seed.spec.ts:48-51` does. Inline cleanup is skipped by
   any earlier failed assertion, and the card it strands is due immediately — which is precisely the
   leftover that makes the *next* run fail step 2. One red run would otherwise poison the account
   for every run after it, and criterion 2.6 ("run twice") only exercises the happy path. Where the
   id was never captured (a failure before step 4), the hook does nothing. §6.6 records both shapes
   and when each applies.

Provenance header linking the spec to Phase 4 of `test-plan.md`, to this plan, and to
`seed.spec.ts` as the pattern source.

### Success Criteria:

#### Automated Verification:

- The spec passes: `npx playwright test tests/e2e/critical-loop.spec.ts`
- The full suite passes: `npm run test:e2e`
- Linting passes on the new file: `npm run lint`
- Type checking passes: `npx astro check`
- The spec contains no `waitForTimeout`, no `.first()`/`.nth()`, no CSS or XPath selectors
- Re-running the spec immediately twice in a row passes both times — proving cleanup works and no
  leftover state is assumed

#### Manual Verification:

- Reviewed against all five anti-patterns in
  `.claude/skills/10x-e2e/references/e2e-anti-patterns.md` — hallucinated assertion, brittle
  selector, shared state, wait-for-time, no cleanup
- Deliberate break: change the `Powtórki` nav href in `src/lib/navigation.ts`, confirm the spec goes
  red, revert, confirm green
- Deliberate break: make `POST /api/reviews` return 409, confirm the spec goes red rather than
  passing on the swallowed advance — this is the assertion the phase most needs to prove
- After a full run, `/deck` contains no leftover `E2E`-tagged cards
- With a leftover due card on the account, the spec fails at the **precondition** with a message
  naming the non-empty queue — not later, on a locator that cannot resolve
- A **deliberately failed** run (break an assertion after the card is created) still leaves `/deck`
  clean — the cleanup hook runs on the failure path, so a red run does not poison the next one

**Implementation Note**: Runs through `/10x-e2e`, which owns the plan → generate → review → verify
loop for this phase. Phase 1 must be merged first.

**Take the browser-driven path, not the prompt-template path.** `context/foundation/test-plan.md:106`
records Playwright MCP as unavailable (checked 2026-09-02) and the research inherited that, which
would push this phase onto the prompt-template path — writing locators from reading code. That note
is now only half true: MCP is still absent, but the Playwright **CLI** is present and has been used
(`.playwright-cli/` exists, as does a saved `playwright/.auth/`). `/10x-e2e` prefers the CLI over MCP
for the browser-driven path anyway, on token cost
(`.claude/skills/10x-e2e/references/browser-driven-generation.md`). So map the flow against a live
accessibility snapshot and write the spec from what the run actually exposes — the enumerated names
in the research doc become a cross-check, not the source. Correct the `:106` note in Phase 4.

---

## Phase 3: The CI gate

### Overview

A PR-only `e2e` job that provisions a database and a user, runs the spec, and blocks the merge
button when the main path breaks.

### Changes Required:

#### 1. The e2e job

**File**: `.github/workflows/ci.yml`

**Intent**: Run the loop spec on every PR against a hermetic local Supabase, structurally mirroring
the existing `db-tests` job so a reviewer can diff the two.

**Contract**: A new job alongside `ci` and `db-tests`, `if: github.event_name == 'pull_request'`,
carrying a comment documenting its required-status-check requirement exactly as
`.github/workflows/ci.yml:29-32` does. Steps, in order, each failing under its own name:

- `actions/checkout@v4`, `actions/setup-node@v4` (node 24, npm cache), `npm ci`, `npx astro sync`.
- `supabase/setup-cli@v3` pinned to `2.23.4` (same pin as `db-tests`), then `supabase start`.
- **Capture the keys** into the job env using
  `supabase status -o env --override-name <key>=<NAME>` — the documented machine-readable form.
  This is the step that fails loudly if the stack is not healthy.
- **Create the test user** with a `curl` to the local GoTrue `/auth/v1/signup` carrying the captured
  anon key and the `E2E_USERNAME`/`E2E_PASSWORD` values. Works without the app running, and
  `supabase/config.toml:209` (`enable_confirmations = false`) makes the account immediately
  sign-in-able. `curl --fail` so a non-2xx fails this step rather than surfacing later as a login
  failure — this is what closes research gap #9.
- `npx playwright install --with-deps chromium` — only Chromium; `playwright.config.ts` configures
  no other browser.
- `npm run test:e2e`, with `E2E_USERNAME`/`E2E_PASSWORD` and the captured Supabase URL/key in `env`.
  Note what this actually gates: the **whole** `tests/e2e/` suite, not just the loop spec —
  `auth.setup.ts`, `seed.spec.ts` and `protected-routes.guest.spec.ts` all become merge-blocking the
  moment `e2e` is a required check. That is the intended scope (a red guest-route spec should block
  a merge too), but it means `seed.spec.ts` — kept as a didactic example — now carries production
  weight and must be maintained accordingly. Record it in §5 rather than leaving it implicit.
  Playwright's own `webServer` block starts `astro dev`; in dev, `astro:env` secrets resolve through
  `process.env`, so job-level `env:` reaches the app. Keep `ASTRO_DEV_BACKGROUND=0` — a no-op on a
  runner but load-bearing locally and for agent-driven runs.
- `actions/upload-artifact@v4` with `if: failure()` for `playwright-report/` and traces —
  `playwright.config.ts:24-26` already emits `trace: "on-first-retry"` and
  `screenshot: "only-on-failure"`, which are useless without an upload step.
- `supabase stop` with `if: always()`.

Do **not** fold these steps into `db-tests`: a pgTAP failure would then hide the e2e result and a red
job would no longer name the broken layer.

#### 2. An env guard where the running app is observable

**File**: `tests/e2e/auth.setup.ts`

**Intent**: The job's named steps cover provisioning, but not the one failure mode this phase calls
unprovable locally — whether job-level `env:` actually reaches `astro dev`. `astro.config.mjs:32-33`
declares `SUPABASE_URL`/`SUPABASE_KEY` **optional**, so a missing value does not crash the app:
`src/lib/supabase.ts:7-10` returns `null`, `POST /api/auth/signin` answers **503**
(`src/pages/api/auth/signin.ts:9-12`), and `Layout.astro:5` renders the
`Supabase nie jest skonfigurowany` banner from `src/lib/config-status.ts:14`. Playwright then
reports a failed login — the app-vs-environment confusion the Desired End State rules out. No CI
step can catch this, because the dev server is started by Playwright's `webServer`, not by the job;
the guard has to live where the running app is observable.

**Contract**: Before filling the sign-in form, `auth.setup.ts` asserts the app is configured — the
`Supabase nie jest skonfigurowany` banner is absent on `/auth/signin` — and fails with a message
naming the environment, not the credentials. Shared test infrastructure, so the edit is deliberately
one assertion with no change to the existing skip/throw logic at `auth.setup.ts:15-22`.

#### 3. Credentials as repository secrets

**File**: repository settings (no file change)

**Intent**: `auth.setup.ts:15-22` hard-fails under CI with no saved-state fallback, so the
credentials must exist as secrets.

**Contract**: `E2E_USERNAME` and `E2E_PASSWORD` added as repository secrets, matching the names in
`.env.example:5-7`. Any values — the user is created fresh per run against a throwaway local stack,
so these are not real credentials to anything.

#### 4. Required status check

**File**: repository settings (no file change)

**Intent**: `context/foundation/test-plan.md:122` promises the gate is required after this phase
lands; an advisory gate is one people learn to ignore.

**Contract**: `e2e` added to `master`'s required status checks in Settings → Branches, following the
`db-tests` precedent. If the team declines, the plan's end state softens to "runs on every PR" and
the gap is recorded as an explicit §7 deferral in Phase 4.

### Success Criteria:

#### Automated Verification:

- The `e2e` job completes green on a real pull request
- `ci` and `db-tests` still pass unchanged
- Workflow YAML is valid: `gh workflow view` resolves the new job
- On an induced failure, the report artifact is present and contains a trace

#### Manual Verification:

- Deliberate break on a scratch branch: revert the Phase 2 deliberate-break edit and confirm the
  `e2e` job goes red on the PR, not just locally
- A forced failure of the anon-key capture step turns *that step* red with its own name, not the
  Playwright step — the gap #9 check
- `e2e` appears in `master`'s required status checks and the merge button is blocked while it is red
- Total job wall time is acceptable next to `db-tests` (~1-2 min of that is Docker image pull)
- Locally, with `SUPABASE_URL` emptied, the `setup` project fails naming the **environment** (the
  `Supabase nie jest skonfigurowany` banner), not the credentials — the app-side half of gap #9

**Implementation Note**: Pause after this phase for manual confirmation that a real PR ran green
before proceeding — the `.dev.vars` precedence footgun means CI env plumbing cannot be proven
locally.

---

## Phase 4: Documentation reconciliation

### Overview

Correct the claims research disproved, fill the cookbook from the landed spec, and record honestly
what this gate does not prove.

### Changes Required:

#### 1. Stack table — the e2e row

**File**: `context/foundation/test-plan.md`

**Intent**: The §4 e2e row says "none yet — see §3 Phase 4" and names `page.route` as the mechanism
for simulating provider failure classes. The second half is not merely stale, it is the single most
expensive wrong turn in this phase — the call is server-side and `page.route` provably cannot reach
it.

**Contract**: The `e2e` row states Playwright `1.63.0`, the `setup` + `storageState` pattern,
Chromium-only, and an explicit note that `page.route` **cannot** intercept the OpenRouter call
because it originates server-side — with the `src/lib/openrouter/client.ts:6` anchor. Refresh the
`checked:` date. The `API mocking` row's Phase 1 resolution is left alone.

Also correct the **Stack grounding tools** note at `context/foundation/test-plan.md:106`, which says
Playwright MCP is unavailable and therefore locators must be written from reading code. Half of that
is still true (no MCP), but the Playwright **CLI** is present and used, so the browser-driven path
*is* available and Phase 2 took it.

#### 2. §6.6 — the e2e cookbook entry

**File**: `context/foundation/test-plan.md`

**Intent**: §6.6 is `TBD — see §3 Phase 4`; it now has a landed spec to describe.

**Contract**: Fills the three items the TBD names — reused login state (`setup` project +
`storageState`, and why the real form is used rather than a client-side API shortcut), provider
response substitution (the honest answer: not done in e2e, and why), and the "e2e instead of
integration" criterion. Plus the patterns this spec establishes: region scoping, the retryable
hydration block, own-text-not-counters, asserting the response status where the UI swallows errors,
`page.request` + `Origin` for cleanup, and cleanup in a hook rather than inline (with the
`seed.spec.ts` inline shape kept as the simpler case and the condition that separates them: whether
a stranded record poisons the next run). The empty-queue precondition and the reasoning behind it
(`due` ascending + only `queue[0]` rendered) belongs here too — it is the trap the next
review-touching spec will otherwise rediscover.

#### 3. §3 rollout status and §5 gate

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect that Phase 4 landed and the gate is live.

**Contract**: Phase 4's Status cell moves to `complete` (from the fixed vocabulary at
`context/foundation/test-plan.md:87-88`), and its `Risks covered` cell is narrowed from
`#1, #2, #3, #4 (przekrojowo)` to what the split loop actually proves, with the attribution stated.
The §5 `e2e krytycznej pętli` gate row reflects its real enforcement status **and its real scope** —
the check runs the whole `tests/e2e/` suite, so `seed.spec.ts` and
`protected-routes.guest.spec.ts` block merges too, not only the loop spec.

#### 4. §6.7 — phase notes

**File**: `context/foundation/test-plan.md`

**Intent**: The 2–3 lines each prior phase left for the next contributor.

**Contract**: A `Faza 4` block recording the three findings that cost the most to establish: the
server-side provider call and why the loop was split; the 409 swallow and the response-status
assertion it forces; and the CI provisioning shape (local stack, `status -o env`, GoTrue signup,
`astro dev` as the target with the workerd gap deferred).

#### 5. §7 — deliberate exclusions

**File**: `context/foundation/test-plan.md`

**Intent**: What this gate does not prove must be recorded where the next contributor looks, in the
established format (claim · rationale · what would reverse it · source).

**Contract**: Entries for: the generation leg in-browser (no server-side seam exists; revisit if one
is added); risk #1 attributed to Phase 1's boundary tests, not to e2e; risk #2 attributed to pgTAP,
with the single-account e2e infra as the blocker; risk #3 limited to the observable outcome by the
oracle rule; the missing `/generate` anchors; and the workerd-runtime gap covered by the optional
pre-prod smoke gate. If the team declined the required status check in Phase 3, an entry for that
too.

#### 6. How to run the suite locally

**File**: `README.md`

**Intent**: Phase 2 makes a green local run the gate before any CI work, and Phase 3 makes the suite
merge-blocking — but the requirements for running it are written down only in a comment in
`playwright.config.ts:4-8`. `README.md` does not mention e2e at all, and `test-plan.md` is a strategy
document, not the place a contributor looks for a command.

**Contract**: A short section covering: `npm run test:e2e`; the `.env.test` file with
`E2E_USERNAME`/`E2E_PASSWORD` (copied from `.env.example:5-7`) and that the account must exist in
whichever Supabase `.env` points at; the empty-review-queue precondition and what a precondition
failure means; and `npm run test:e2e:report` for the trace after a failure. Half a screen, not a
guide — §6.6 keeps the patterns, README keeps the commands.

### Success Criteria:

#### Automated Verification:

- Linting and formatting pass on the changed markdown: `npm run lint`
- No occurrence of `TBD` remains in §6.6
- Phase 4's Status cell uses a literal from the fixed vocabulary

#### Manual Verification:

- A reader who has never seen this change can tell from §4 alone that `page.route` will not reach
  the provider, and why
- Every §7 entry names what would cause it to be reconsidered
- No claim in the document asserts coverage the landed spec does not deliver
- The Freshness Ledger dates are updated
- A contributor with a clean checkout can get `npm run test:e2e` running from the README section
  alone, without reading `playwright.config.ts`

---

## Testing Strategy

### Unit Tests:

- `ReviewSession.test.tsx` — the named region is present (Phase 1). Guards the E2E locator with a
  fast test so a dropped attribute fails in seconds, not in a browser run.

### Integration Tests:

- None added. Every server contract this loop touches is already pinned: `POST /api/flashcards` and
  `POST /api/reviews` by Phase 1 and Phase 3 of the rollout, the queue by
  `supabase/tests/review_queue.test.sql`, and the access gate by
  `tests/e2e/protected-routes.guest.spec.ts`.

### E2E Tests:

- `tests/e2e/critical-loop.spec.ts` — the single new spec. One test, one risk: the main user path
  still connects after a change.

### Manual Testing Steps:

1. Run `npm run test:e2e` locally twice in succession; both runs pass and `/deck` is left clean.
2. Break the `Powtórki` nav href in `src/lib/navigation.ts`; confirm the spec fails at navigation,
   not 30 s later on an unrelated locator. Revert.
3. Force `POST /api/reviews` to return 409; confirm the spec fails. This is the assertion that
   distinguishes a real grade from `ReviewSession.tsx:167`'s swallowed advance — if it passes, the
   test is meaningless and must be re-worked before the phase closes.
4. Open a scratch PR with the nav break in place; confirm the `e2e` check goes red and the merge
   button is blocked.
5. On a scratch branch, corrupt the anon-key capture step; confirm *that* step names the failure
   rather than Playwright reporting a login error.

## Performance Considerations

The `e2e` job pays a Docker image pull for `supabase start` (~1-2 min), the same cost `db-tests`
already accepted and documented. Running it as a separate job keeps that cost off the Docker-free
`ci` job. Chromium-only keeps the browser install to one download. `workers: 1` under CI
(`playwright.config.ts:22`) trades parallelism for stability on a shared account — correct for a
single-spec suite and worth revisiting only when the suite grows.

`retries: 2` means a genuinely flaky spec runs three times. With the generation leg excluded this
costs only time; with it included it would have cost three unreclaimable quota rows, which is the
strongest single argument for the split.

## Migration Notes

None. No schema change, no data migration, no change to any existing test. The `/review` markup
change is additive at the accessibility layer and visually inert.

Two manual repo-settings actions are required and cannot be committed: adding the `E2E_USERNAME` /
`E2E_PASSWORD` secrets, and adding `e2e` to `master`'s required status checks.

## References

- Related research: `context/changes/testing-e2e-critical-loop/research.md`
- Rollout phase definition: `context/foundation/test-plan.md:80`
- Seed pattern this spec inherits: `tests/e2e/seed.spec.ts`
- CI job precedent: `.github/workflows/ci.yml:28-43`
- Anchor pattern: `src/components/deck/FlashcardCollection.tsx:224`
- Recorded lessons applied: `context/foundation/lessons.md:37-49`, `:59-63`, `:65-77`
- Prior CI-gate precedent and its escape hatch:
  `context/archive/2026-09-03-testing-access-gate-data-isolation/plan.md:249-258`
- Oracle rule: `context/foundation/test-plan.md:239-244`
- Anti-pattern checklist: `.claude/skills/10x-e2e/references/e2e-anti-patterns.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Anchor `/review` with a named region

#### Automated

- [ ] 1.1 Type checking passes: `npx astro check`
- [ ] 1.2 Linting passes, including `eslint-plugin-jsx-a11y`: `npm run lint`
- [ ] 1.3 Unit and integration tests pass: `npm test`
- [ ] 1.4 The new region assertion in `ReviewSession.test.tsx` passes

#### Manual

- [ ] 1.5 `/review` renders unchanged visually — no layout shift from `div` → `section`
- [ ] 1.6 Browser devtools accessibility pane shows a `region` named `Sesja powtórkowa`
- [ ] 1.7 The existing sr-only announcer still announces `Karta {n} z {m}` on card change

### Phase 2: The critical-loop spec

#### Automated

- [ ] 2.1 The spec passes: `npx playwright test tests/e2e/critical-loop.spec.ts`
- [ ] 2.2 The full suite passes: `npm run test:e2e`
- [ ] 2.3 Linting passes on the new file: `npm run lint`
- [ ] 2.4 Type checking passes: `npx astro check`
- [ ] 2.5 The spec contains no `waitForTimeout`, no `.first()`/`.nth()`, no CSS or XPath selectors
- [ ] 2.6 Re-running the spec immediately twice in a row passes both times

#### Manual

- [ ] 2.7 Reviewed against all five anti-patterns in `e2e-anti-patterns.md`
- [ ] 2.8 Deliberate break: `Powtórki` nav href — spec goes red, revert, green
- [ ] 2.9 Deliberate break: `POST /api/reviews` returns 409 — spec goes red, not green on the swallowed advance
- [ ] 2.10 After a full run, `/deck` contains no leftover `E2E`-tagged cards
- [ ] 2.11 With a leftover due card, the spec fails at the precondition naming the non-empty queue
- [ ] 2.12 A deliberately failed run still leaves `/deck` clean — cleanup runs on the failure path

### Phase 3: The CI gate

#### Automated

- [ ] 3.1 The `e2e` job completes green on a real pull request
- [ ] 3.2 `ci` and `db-tests` still pass unchanged
- [ ] 3.3 Workflow YAML is valid: `gh workflow view` resolves the new job
- [ ] 3.4 On an induced failure, the report artifact is present and contains a trace

#### Manual

- [ ] 3.5 Deliberate break confirms the `e2e` job goes red on the PR, not just locally
- [ ] 3.6 A forced anon-key capture failure turns that step red with its own name (gap #9 check)
- [ ] 3.7 `e2e` is in `master`'s required status checks and blocks the merge button while red
- [ ] 3.8 Total job wall time is acceptable next to `db-tests`
- [ ] 3.9 With `SUPABASE_URL` emptied, `setup` fails naming the environment, not the credentials

### Phase 4: Documentation reconciliation

#### Automated

- [ ] 4.1 Linting and formatting pass on the changed markdown: `npm run lint`
- [ ] 4.2 No occurrence of `TBD` remains in §6.6
- [ ] 4.3 Phase 4's Status cell uses a literal from the fixed vocabulary

#### Manual

- [ ] 4.4 A fresh reader can tell from §4 alone that `page.route` will not reach the provider, and why
- [ ] 4.5 Every §7 entry names what would cause it to be reconsidered
- [ ] 4.6 No claim in the document asserts coverage the landed spec does not deliver
- [ ] 4.7 The Freshness Ledger dates are updated
- [ ] 4.8 A contributor can run `npm run test:e2e` from the README section alone
