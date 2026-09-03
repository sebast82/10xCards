# Bramka dostępu i izolacja danych w CI — Plan Brief

> Full plan: `context/changes/testing-access-gate-data-isolation/plan.md`
> Research: `context/changes/testing-access-gate-data-isolation/research.md`

## What & Why

Rollout Phase 2 of `test-plan.md`. Two risks: a user reading/modifying another account's
flashcards because the check is "logged in?" not "owner?" (#2, IDOR), and a logged-out user
reaching a protected screen or endpoint instead of being redirected (#4). The enforcement
already exists — 8 correct RLS policies, a middleware session gate — but the pgTAP suite
that proves isolation **is not a CI step**, so it only runs when a developer remembers.
This phase makes the DB-policy tests a required-on-PR gate, closes the documented gaps in
what they assert, adds the missing middleware and route-authz coverage, and revokes the one
destructive privilege RLS cannot contain.

## Starting Point

Session gate: `src/middleware.ts` only — `getUser()` validates the JWT, `PROTECTED_ROUTES`
redirects pages, `/api/**` handlers self-check `locals.user` → 401. **No `src/middleware.test.ts`
exists.** Isolation: RLS in Postgres, anon key only, never `service_role`; app-layer
`.eq("user_id")` filters are defense-in-depth, not the boundary. `.github/workflows/ci.yml`
runs lint / type / vitest / build — **no `supabase test db`**. The pgTAP suite
(`rls_flashcards.test.sql`, `plan(10)`) is solid post-F1 but has gaps: `generations`
cross-account write untested entirely, `flashcards` write isolation conflated with the SELECT
policy, no `WITH CHECK`-on-UPDATE test. F2 left `authenticated` holding `TRUNCATE` on both
tables.

## Desired End State

Every PR runs the pgTAP suite in CI as a required gate; a weakened RLS policy turns the PR
red. The suite proves `generations` cross-account isolation and `flashcards` write isolation
*independently of SELECT*. `authenticated` can no longer `TRUNCATE` the user-data tables.
`src/middleware.test.ts` exercises the gate for every protected route with the session as a
fixture. The four route test files assert unauthenticated and cross-account denial with the
status/body pinned as a labeled contract guard. The one record path with no app-layer
scoping (`service.ts:64-69`) carries `.eq("user_id")` like every other path.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| `authenticated` holds `TRUNCATE` (O2-8) | Fix in this phase | Revoke migration + pgTAP assertion; RLS structurally can't cover `TRUNCATE` | Plan |
| FK same-user gap (O2-10) | App filter + test RLS | Add `.eq("user_id")` to `service.ts:64-69`; no DB FK predicate — RLS is the real gate | Plan |
| `deck.astro` unscoped list (Q5) | RLS-only, prove it | Doctrine says the filter is convenience not security; prove RLS holds instead of contradicting it | Plan |
| Cross-account response code (Q1) | Behaviour + pinned contract | Assert non-2xx/no-mutation/no-leak (oracle) *plus* pin 404+message as labeled guard | Plan |
| Unauthenticated endpoint (Q2) | Denial + pinned 401 | Oracle is "no data + denial"; 401 pinned as contract-surface guard | Plan |
| Hermetic `.eq("user_id")` filter assertion (Q6) | Include, labeled as guard | Cheap regression guard; real proof is pgTAP; closes the `[id].test.ts` gap | Plan |
| CI job shape (Q7) | Separate `db-tests` job, PR-only | Matches research §D; keeps Docker-free `ci` job fast; nothing merges unreviewed | Plan |
| Local↔cloud grant parity (Q8) | Out of scope, documented | No CI mechanism without a cloud secret + tooling; logged as follow-up | Plan |
| Path-normalization of the gate (Q9) | Out of scope, follow-up | No source resolves expected behaviour for encoded / `//` / `..` variants | Plan |

## Scope

**In scope:** `db-tests` CI job (PR-only); new `rls_generations.test.sql`; extended
`rls_flashcards.test.sql` (write-isolation independent of SELECT, `WITH CHECK` on UPDATE,
positive writes, SRS-column tampering, empty-claims, `authenticated` no `TRUNCATE`, `anon` no
`EXECUTE`); revoke-`authenticated`-destructive-privileges migration; new `src/middleware.test.ts`;
denial + filter-guard assertions in the four route test files; `.eq("user_id")` on the
AI-create generation lookup; cookbook §6.3/§6.4/§6.7 + status sync + deferral register.

**Out of scope:** CI pipeline from scratch; DB-level FK same-user constraint; ownership filter
on `deck.astro`; local↔cloud grant-parity check; path-normalization test/hardening;
client-island 401 navigation assertions; the Phase 4 e2e pass; provider auth mechanism.

## Architecture / Approach

Environment first, then dependent assertions, then the hermetic layer, then doc sync.
Phase 1 wires `db:test` into CI against today's suite so every assertion added in Phase 2 is
immediately gated and the red→green transition is visible in CI. Phase 2 closes the pgTAP
gaps and ships the `TRUNCATE` hardening migration together (both DB-policy work; the
migration's proof *is* a pgTAP assertion). Phase 3 is the Vitest layer. Phase 4 is docs.
The real cross-account signal for #2 is pgTAP (real Postgres); hermetic route tests are a
labeled regression guard, never the isolation proof (avoids the mirror-test trap).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. CI gate for DB policy tests | `db-tests` job runs pgTAP on every PR, required | Docker image-pull cost; job must stay parallel to `ci` |
| 2. Close pgTAP gaps + revoke `authenticated` privileges | `generations` isolation tests, SELECT-independent write proofs, `TRUNCATE` migration | F1 conflation recurring; cloud migration needs post-merge `db push` |
| 3. Middleware + route-authz hermetic tests | `src/middleware.test.ts`, denial + filter guards, scoped AI-create lookup | `SupabaseStub` has no `auth` — needs module mock; pinned codes must be labeled |
| 4. Cookbook, status sync, deferral register | §6.3/§6.4/§6.7 filled, §3 status advanced, 4 deferrals logged | Deferrals lost silently if not written down |

**Prerequisites:** Docker + Supabase CLI locally (`supabase start`); ability to `supabase db
push` to the linked cloud project after Phase 2 merges.
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- The Supabase CLI action / `supabase start` in CI is assumed reliable on `ubuntu-latest`;
  if image pulls flake, the job needs a cache or retry (Phase 1 manual check).
- The `TRUNCATE` revoke migration must reach the linked cloud project; local pgTAP proves
  the migration path only. The local↔cloud parity gap is a known, accepted deferral.
- Reading `PROTECTED_ROUTES` ↔ `contract-surfaces.md` parity in a test assumes the doc's
  route table stays machine-readable; a hard-coded copy with a pointer comment is the fallback.

## Success Criteria (Summary)

- A PR that weakens any RLS policy, drops a `PROTECTED_ROUTES` entry, or removes an
  ownership filter turns CI red.
- `npm run db:test` proves B cannot read/update/delete/impersonate A on **both** tables, and
  the write proofs stay red when only the write policy is dropped.
- `authenticated` cannot `TRUNCATE` `flashcards` or `generations`.
- A contributor can add a new access test or pgTAP policy test from the cookbook alone.
