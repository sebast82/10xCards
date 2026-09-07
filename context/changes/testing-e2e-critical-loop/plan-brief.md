# E2E krytycznej pętli — Plan Brief

> Full plan: `context/changes/testing-e2e-critical-loop/plan.md`
> Research: `context/changes/testing-e2e-critical-loop/research.md`

## What & Why

Phase 4 of the test rollout puts a browser-level gate on the main user path so a PR that breaks it
turns red before merge. Research disproved the mechanism the test plan assumed — `page.route` cannot
stub OpenRouter because the call is server-side — so the gate covers the quota-free, deterministic
half of the loop (`login → deck → review`) and the generation leg's real signal stays at the network
boundary where Phase 1 already pins it.

## Starting Point

The loop is fully built and every step is reachable; `playwright.config.ts` is already written for a
CI gate that doesn't exist. What's missing is the gate itself: no `e2e` job, no test credentials, no
login-capable user in a fresh local Supabase, no loop spec — and `/review` has no named landmark for
a test to scope to.

## Desired End State

A required `e2e` check runs on every PR: it starts a local Supabase, creates a test user, boots the
app, and drives one test that creates a flashcard on `/deck` through the UI, navigates to `/review`
by the app's own nav, grades that card, and confirms the server accepted the grade — then cleans up
after itself. A broken user path blocks the merge button; a broken CI environment fails a *named
provisioning step* instead, so the two are never confused.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Loop scope / provider seam | Split — gate covers `login → deck → review` | `page.route` can't reach a server-side call, and stubbing `/api/generations` 404s the next step; the generate leg would also burn ~3 unreclaimable quota rows per flaky run | Research + Plan |
| CI database | Local `supabase start` | No new cloud secrets (team already declined), full isolation per PR, mirrors the `db-tests` precedent | Plan |
| Test user provisioning | `curl` to local GoTrue `/auth/v1/signup` | Real auth path, no hand-written bcrypt to rot; `enable_confirmations = false` locally makes it instantly sign-in-able | Plan |
| `/review` anchor | Add `<section aria-label="Sesja powtórkowa">` | The lessons.md region rule names this screen but has nothing to attach to; smallest possible production change | Plan |
| Review oracle | Empty-queue precondition via `GET /api/reviews`, then the card's own text + asserted **200** on `POST /api/reviews` | The queue is `due`-ascending and only `queue[0]` renders, so a leftover hides the new card outright; the precondition names that cause, and the explicit 200 closes the 409 silent-swallow where the UI advances on a rejected grade | Research + Plan + Plan review |
| Env-failure signal | Fail fast on named provisioning steps | Falls out of the CI design for free; closes research gap #9 (broken env vs broken login) | Plan |
| Server under test | `astro dev` | Only target where `astro:env` resolves through `process.env`, so job-level `env:` reaches the app; workerd gap deferred to pre-prod smoke | Research + Plan |
| Gate enforcement | Required status check on `master` | `test-plan.md:122` promises it; `db-tests` precedent established | Plan |
| Docs | Full reconciliation, `lessons.md` placeholder left alone | §4 currently recommends a mechanism that provably cannot work; the placeholder's urgency came from CI quota burn, which the split removes | Plan |

## Scope

**In scope:** one `aria-label` anchor on `/review` + a unit assertion; `tests/e2e/critical-loop.spec.ts`;
one env-guard assertion in `tests/e2e/auth.setup.ts`; a PR-only `e2e` CI job with DB/user/secret
provisioning; required status check; reconciliation of `test-plan.md` §3, §4, §5, §6.6, §6.7, §7 plus
a short "running e2e locally" section in `README.md`.

**Out of scope:** driving `/generate` in a browser; adding a server-side provider seam; claiming
risks #1 or #2; re-asserting risk #4 (already covered); asserting `due` values; `/generate` anchors;
filling the `lessons.md` placeholder; cloud CI secrets; a built-worker target.

## Architecture / Approach

Four dependency-ordered phases. The anchor is production code and lands first via `/10x-implement`
because the spec's scoping depends on it — the `/10x-e2e` skill declines to write production code.
The spec lands second and must be green locally before any CI work, so a red CI job can only mean CI.
The gate lands third, structurally mirroring `db-tests` so a reviewer has a precedent to diff. Docs
land last, once there's a real spec to describe.

**Tool routing:** Phase 2 — the spec itself — is driven by `/10x-e2e`; phases 1, 3 and 4 by
`/10x-implement`. The split follows the skill's own contract: it writes tests, but not production
code, CI wiring, or test infrastructure. Its entry gate (Playwright 1.63.0, config, `storageState`)
is already satisfied, and since the Playwright CLI is present and used, Phase 2 takes the
browser-driven path rather than writing locators from reading code.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Anchor `/review` | `<section aria-label>` + unit assertion | `<div aria-label>` exposes no role — the element change is load-bearing, not cosmetic |
| 2. Critical-loop spec | `tests/e2e/critical-loop.spec.ts` | The 409 swallow: a UI-only assertion passes on a grade the server rejected |
| 3. CI gate | PR-only `e2e` job + required check | `.dev.vars` overrides shell env locally but is absent in CI — the plumbing is unproven until a real PR runs |
| 4. Docs | `test-plan.md` §3–§7 reconciled | Overstating coverage; every narrowed claim must name the layer that actually owns it |

**Prerequisites:** Docker available on the runner (already true for `db-tests`); repo-settings access
for two secrets and one required check.
**Estimated effort:** ~3–4 sessions; Phase 3 needs a real PR to verify and can't be proven locally.

## Open Risks & Assumptions

- CI env plumbing genuinely can't be validated before the first real PR run — expect one round of
  fixes there.
- This is the project's first browser-level required check; the flake budget is unproven. If it
  proves flaky, the fallback is the documented §7 deferral rather than loosening assertions.
- The narrowed risk claim (`the path still connects`, not `#1–#4 przekrojowo`) must survive review —
  if the team wants the literal original goal, that reopens the provider-seam decision.
- Phase 1 is production code inside a testing phase. Small, but it needs its own commit and review.

## Success Criteria (Summary)

- Breaking the deck→review navigation link turns a PR red and blocks the merge button.
- Forcing `POST /api/reviews` to 409 turns the spec red — proving the test isn't passing on the
  silently swallowed advance.
- A broken CI environment fails a named provisioning step, not the login.
