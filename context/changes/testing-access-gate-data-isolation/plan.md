# Bramka dostępu i izolacja danych w CI — Implementation Plan

## Overview

Rollout Phase 2 of `context/foundation/test-plan.md`. Two risks, one change folder:

- **#2 (IDOR / record ownership)** — a request authenticated as user B must not read or
  modify user A's `flashcards` / `generations`, and this must hold **even if the application
  layer fails to scope the query**. The enforcing mechanism is RLS in Postgres; the proof
  must come from real Postgres (pgTAP), not from a stubbed client.
- **#4 (session gate)** — a request without a valid session must never return user data or a
  protected screen. Pages redirect to `/auth/signin`; `/api/**` handlers self-deny (401).

The through-line of this phase: **the pgTAP suite stops being a gate nobody runs.** Today
`supabase test db` is an ad-hoc bump-in-the-night from Phase 1. This phase wires it into CI
as a required-on-PR gate, then closes the documented gaps in what it asserts, then adds the
missing hermetic coverage for the session gate and route-level authz, and finally hardens
the one isolation gap RLS structurally cannot cover (`authenticated` still holds `TRUNCATE`).

## Current State Analysis

**Session gate (#4)** lives entirely in `src/middleware.ts`:

- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard", "/generate", "/deck", "/review"]`.
- `src/middleware.ts:6-17` — per-request Supabase client (anon key, from cookies);
  `supabase.auth.getUser()` validates the JWT with the auth server, so expired / forged /
  revoked tokens all collapse to `locals.user = null`.
- `src/middleware.ts:19-23` — `pathname.startsWith(route)` **and** `!locals.user` →
  `context.redirect("/auth/signin")`. Blocklist model: anything not matching a prefix passes.
- **There is no `src/middleware.test.ts`.** The gate has zero direct test coverage today.
- `/api/**` is **not** covered by middleware — each domain handler re-checks `locals.user`
  and returns **401 JSON** (never a redirect). This asymmetry is a binding contract
  (`docs/reference/contract-surfaces.md:50`).

**Data isolation (#2)** lives in the database:

- 8 textbook-correct RLS policies (`supabase/migrations/20260824202259_flashcards_schema.sql:109-157`),
  all `to authenticated`, `(select auth.uid()) = user_id`, `with check` on INSERT and UPDATE.
- The app connects **only** with the anon key bound to the user's session — never
  `service_role`. `.eq("user_id", …)` filters in code are defense-in-depth / index targeting,
  **not** the security boundary (documented in code comments and the schema-isolation plan).
- **Two real exposure points if RLS vanished** (everything else has a redundant `.eq("user_id")`):
  - `src/pages/deck.astro:11-17` — SSR collection list with **no ownership filter at all**.
  - `src/lib/flashcards/service.ts:64-69` — generation-existence lookup on AI-create with
    **no `.eq("user_id")`**. Without `generations_select_own`: confirms other users' generation
    UUIDs exist, lets a flashcard attach to someone else's `generation_id`, and pollutes that
    generation's KPI counters via `recount_generation_acceptance`.

**CI gap (the heart of the phase):** `.github/workflows/ci.yml` runs `astro sync` → `astro
check` → `lint` → `vitest run` → `build`. **No `supabase test db` step. No Supabase CLI
setup, no `supabase start`, no Docker service.** Pre-commit runs only `lint-staged`.
`test-plan.md:120` makes the DB-policy gate "required after §3 Phase 2" — this change is
what flips it on.

**Existing pgTAP quality** (`supabase/tests/rls_flashcards.test.sql`, `plan(10)`): solid
after the F1 fix (UPDATE/DELETE assertions count *changed* rows via `returning 1` CTEs), but
with documented gaps — see "Key Discoveries".

## Desired End State

1. Every PR to `master` runs the pgTAP suite in CI as a **required** gate. A regression that
   drops or weakens any RLS policy turns the PR red.
2. The pgTAP suite proves `generations` cross-account isolation (untested today), proves
   `flashcards` write isolation **independently of the SELECT policy** (F1 conflation gone),
   exercises `WITH CHECK` on UPDATE, and includes positive write assertions.
3. `authenticated` can no longer `TRUNCATE` / `TRIGGER` / `REFERENCES` on `public.flashcards`
   or `public.generations`; a pgTAP assertion pins this.
4. `src/middleware.test.ts` exists and exercises **our** gating decision with the session
   supplied as a fixture (present / absent / invalid) for every protected route and a
   representative set of public routes.
5. The four `src/pages/api/*.test.ts` files assert unauthenticated denial and cross-account
   denial at the route layer, with the exact status/body pinned as a labeled contract guard.
6. `src/lib/flashcards/service.ts:64-69` carries `.eq("user_id", userId)` — the last record
   path with zero app-layer scoping is brought in line with every other path.
7. `test-plan.md §6.3`, `§6.4`, `§6.7` are filled; `§3` Phase 2 status is advanced; the
   deferred items are logged in `§7` and the research open-questions file.

**Verification**: `npm run lint && npx astro check && npm test` green; `npm run db:test`
green locally against `supabase start`; the new `db-tests` CI job green on a PR; mutating one
RLS policy (locally or on a scratch PR) turns `db:test` / the CI job red.

### Key Discoveries

- **No `src/middleware.test.ts` today** — `src/pages/api/*.test.ts` is the only test surface
  touching auth. `SupabaseStub` (`src/lib/test-support/supabase-stub.ts`) has **no `auth`
  property** — it models `.from()` / `.rpc()` only. The middleware test needs its own auth
  stub or a `vi.mock("@/lib/supabase", …)` returning `{ auth: { getUser } }`.
- **The `context()` helper is copied per-file, by convention** (`test-plan.md:194`,
  research §F.1) — `flashcards.test.ts:12-27`, `flashcards/[id].test.ts:9-21`,
  `reviews.test.ts:27-43`, `generations.test.ts:29-44` are near-identical. Do not extract it.
- **`vi.mock("astro:env/server")` is needed only for `generations.ts`** — the only route
  importing it. `flashcards.ts` / `[id].ts` / `reviews.ts` tests do not need it.
- **Ownership-filter assertion pattern already exists** — `reviews.test.ts:107-111` asserts
  `supabase.queries[1].filters` equals `[["id", …], ["user_id", …], ["reps", …]]`.
  `flashcards/[id].test.ts:73-91` ("maps inaccessible cards") does **not** assert
  `["user_id", …]` — this is the gap Phase 3 closes.
- **F1 conflation** (`context/archive/2026-08-24-flashcards-schema-isolation/reviews/impl-review.md:55`):
  `rls_flashcards.test.sql` assertions 5/6 stay green even if `flashcards_update_own` /
  `flashcards_delete_own` are dropped, because `flashcards_select_own` hides B's rows from A
  first. Write policies are not independently proven.
- **pgTAP gaps** (research §C.4): `generations` cross-account write untested entirely; no
  `WITH CHECK`-on-UPDATE test; no positive write assertions; SRS columns covered only
  transitively; `anon` assertions test grant state, not RLS; no empty-claims case; anon
  cannot-`EXECUTE`-RPC unasserted.
- **F2 residual** (research §C.2): `20260825120802_revoke_anon_table_privileges.sql` revoked
  `TRUNCATE`/`TRIGGER`/`REFERENCES` from `anon` **after** the schema shipped to prod — but
  the same privileges were **never revoked from `authenticated`**. RLS does not stop
  `TRUNCATE`. Research calls this "najbardziej materialna luka rezydualna".
- **CI runners have Docker** — `ubuntu-latest` can run `supabase start`. Standard shape is a
  separate job (image pull is ~1–2 min; the Docker-free `ci` job must not pay that cost).
- **Oracle statements** live in `research.md` §"Oracle Statements" (O4-1…O4-10, O2-1…O2-14).
  Every assertion in this plan traces to one; none is derived from implementation shape.

## What We're NOT Doing

- **Not authoring a CI pipeline from scratch.** We add one job to the existing
  `.github/workflows/ci.yml`. Wiring the *existing* pgTAP gate into CI is explicitly this
  phase's job (`change.md:14`, `test-plan.md:120`, research §D).
- **Not closing the FK same-user gap at the DB level.** `flashcards.generation_id` gets no
  new trigger/constraint binding it to the generation's `user_id`. We add the missing
  `.eq("user_id")` app filter and prove RLS already blocks the cross-account case. (Q4.)
- **Not adding an ownership filter to `src/pages/deck.astro`.** The RLS-only doctrine
  ("filtr `user_id` to wygoda, nie zabezpieczenie") is intentional; we prove it holds
  instead of contradicting it. (Q5.)
- **Not building a local↔cloud grant-parity check.** No CI mechanism to diff cloud grants
  without a new cloud secret and tooling; logged as a follow-up in `test-plan.md §6.4`. (Q8.)
- **Not testing or hardening path-normalization** of the `startsWith` gate (case, percent
  encoding, `//`, `/deck/../x`). No source resolves the expected behaviour; logged as a
  research follow-up. (Q9.)
- **Not asserting client-island behaviour on mid-session 401.** `GenerateView` /
  `ReviewSession` render the error string inline and do not navigate to `/auth/signin`; no
  source resolves whether "redirected to login" covers SPA XHR (research Ambiguity B).
  Flagged, not asserted.
- **Not the single e2e pass for #4.** `test-plan.md §3` assigns e2e to Phase 4 (which covers
  #2/#4 cross-cuttingly). Out of scope here.
- **Not touching the provider auth mechanism** (registration, login, session expiry as such)
  — `test-plan.md §7`. We test our gating decision with the session state as a fixture.
- **Not re-running `/10x-test-plan`** to change strategy. `§3` status advance is a mechanical
  sync, not a strategy change.

## Implementation Approach

Environment first, then the assertions that depend on it, then the hermetic layer, then the
doc sync — the ordering `test-plan.md §3` prescribes.

- **Phase 1** wires `db:test` into CI against the suite as it stands today. Landing this
  first means every pgTAP assertion added in Phase 2 is immediately gated, and the
  red→green transition is visible in CI (the F4 lesson: "zmutuj politykę → czerwony test"
  is load-bearing).
- **Phase 2** closes the pgTAP gaps and ships the `TRUNCATE` hardening migration together —
  both are DB-policy work in the same test-file family, and the migration's proof *is* a
  pgTAP assertion.
- **Phase 3** is the Vitest layer: a new `src/middleware.test.ts` for the session gate, plus
  ownership/denial assertions bolted onto the four existing route test files, plus the
  one-line `.eq("user_id")` addition to the AI-create generation lookup.
- **Phase 4** fills the cookbook, advances the rollout status, and writes down every
  deferred item so nothing is lost silently.

**Two-layer strategy per `test-plan.md`:** the real cross-account signal for #2 comes from
pgTAP (real Postgres). The hermetic route-level tests are a **cheap regression guard** that
the scoping filter did not disappear — they are labeled as such and never presented as the
isolation proof (avoids the mirror-test trap, research §F.2 / O2-14).

## Critical Implementation Details

**Middleware test — no `auth` in `SupabaseStub`.** `src/middleware.ts` calls
`createClient()` from `@/lib/supabase` and then `supabase.auth.getUser()`. `SupabaseStub`
models only `.from()`/`.rpc()`. The middleware test must `vi.mock("@/lib/supabase", …)` so
`createClient` returns `{ auth: { getUser: async () => ({ data: { user } }) } }` — with
`user` a fixture (an object for "present", `null` for "absent" and for "invalid/expired",
since `getUser()` collapses all three), and `createClient` returning `null` for the
misconfig branch. Astro's `context` (`context.url.pathname`, `context.redirect`,
`context.locals`, `next`) is a hand-built literal cast `as never`, mirroring the route
`context()` convention.

**F1 conflation — the SELECT policy must be out of the path before the write assertion.**
Postgres enforces the SELECT policy on the `WHERE` / `RETURNING` column reads of an
`UPDATE` / `DELETE`. `flashcards_select_own` and `flashcards_update_own` / `_delete_own`
carry the **identical** predicate, so a cross-account `UPDATE … WHERE user_id = <A>` run as
B changes 0 rows *whether or not the write policy exists or has been weakened to
`using (true)`* — the SELECT policy alone hides A's rows from B's `WHERE` read. Asserting "0
changed rows" plus "target row unchanged" therefore does **not** isolate the write policy;
it is still the F1 tautology (green after `flashcards_delete_own` is dropped or weakened).

To genuinely de-conflate, each write-isolation assertion must run inside the test
transaction (everything rolls back) with the SELECT policy temporarily replaced by a
permissive one so the acting role can *see* the target row:

```sql
alter policy "flashcards_select_own" on public.flashcards using (true);  -- or drop + create _test_visible
-- now, as B with valid claims:
with attempted as (
  update public.flashcards set front = 'tampered' where user_id = '<A>' returning 1
)
select is((select count(*)::int from attempted), 0,
  'write policy (not the select policy) blocks cross-account update');
```

With the SELECT policy neutralised, the assertion goes red the moment
`flashcards_update_own` / `flashcards_delete_own` (or the `generations` equivalents) is
dropped **or** its `using` clause is weakened. Pair each such assertion with a separate
check — re-entering as the row's owner or the seeding superuser after `reset role` — that
the target row is byte-for-byte unchanged. Restore the real SELECT policy (or rely on
`rollback`) before the read-isolation assertions. This is the O2-13 contract. `supabase test
db` runs the file as `postgres`, which can `alter` / `drop` / `create policy`.

**`TRUNCATE` migration ordering.** The revoke migration is a new timestamped file in
`supabase/migrations/`. Like the F2 walk-back (`20260825120802_…`), it must be pushed to the
linked cloud project after merge — note this in the phase's manual-verification and in the
migration's own comment. `supabase start` in CI applies all migrations from scratch, so the
CI assertion covers the local/migration path only (the cloud-parity gap is the Q8 deferral).

## Phase 1: CI gate for DB policy tests

### Overview

Add a separate `db-tests` job to the existing CI workflow that boots a local Supabase stack
and runs `supabase test db`, gated on pull requests to `master`. Establishes the gate;
asserts nothing new yet.

### Changes Required:

#### 1. CI workflow — new `db-tests` job

**File**: `.github/workflows/ci.yml`

**Intent**: Run the pgTAP suite on every PR without slowing the existing Docker-free `ci`
job. New job runs in parallel, sets up the Supabase CLI, starts the local stack, runs
`supabase test db`, and stops the stack.

**Contract**: New top-level job `db-tests` under `jobs:`, `runs-on: ubuntu-latest`,
triggered by the existing `on.pull_request` (not `on.push`). Steps: `actions/checkout` →
Supabase CLI available (`supabase/setup-cli` action pinned to a version, or `npx supabase`
using the pinned `supabase` devDependency already in `package.json:65`) → `supabase start`
→ `supabase test db` (equivalently `npm run db:test`) → `supabase stop` (always-run). No new
repository secrets — the local stack uses CLI-generated local keys. The existing `ci` job is
unchanged.

### Success Criteria:

#### Automated Verification:

- Workflow file parses: `npx astro check` unaffected; `yamllint`/CI lints pass if configured
- `npm run db:test` passes locally against `supabase start` (baseline, unchanged suite)
- On a draft PR, the `db-tests` job completes green

#### Manual Verification:

- On a scratch branch, comment out one `USING` clause in an RLS policy migration, push a
  PR → the `db-tests` job turns red; revert → green (the F4 "mutate → red" check)
- `db-tests` runs in parallel with `ci` (not serialized) and does not extend `ci` wall time
- Job does not run on direct pushes to `master` (PR-only, per Q7)
- **`db-tests` is added to the branch's required status checks for `master`** (repo Settings →
  Branches, or a ruleset) — a red `db-tests` now blocks the merge button, not just shows a
  red X. This is the step that turns the End State #1 "required gate" from a job into an
  enforced gate; it is a repo-settings action, not a file. If the team declines to gate
  merges here, this becomes an explicit `§7` deferral instead (see Phase 4 change #5) and
  End State #1 / the brief are softened to "runs on every PR".

**Implementation Note**: After this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: Close the RLS pgTAP gaps and revoke residual `authenticated` privileges

### Overview

Bring the pgTAP suite up to the O2 oracle: `generations` cross-account isolation, `flashcards`
write isolation proven independently of SELECT, `WITH CHECK` on UPDATE, positive write
assertions, SRS-column tampering, anon-cannot-`EXECUTE`. Then ship the migration that revokes
`TRUNCATE`/`TRIGGER`/`REFERENCES` from `authenticated` and pin it with an assertion.

**`plan(N)` bookkeeping**: changes #2, #3, #5 all add assertions to
`rls_flashcards.test.sql` and change #1 creates `rls_generations.test.sql`. Set each file's
`select plan(N)` **last**, after all assertions for that file are written, then record the
final counts in the Progress section (e.g. "`rls_flashcards` `plan(10)` → `plan(19)`"). A
mismatch fails `pg_prove` loudly, so this is a bookkeeping step, not a risk.

### Changes Required:

#### 1. `generations` cross-account policy test

**File**: `supabase/tests/rls_generations.test.sql` (new)

**Intent**: `generations` has four correct RLS policies but **zero** cross-account test
coverage today. Assert B cannot read, update, or delete A's generation rows, and cannot
insert a row impersonating A. Mirror the structure of `rls_flashcards.test.sql` (seed two
`auth.users`, one generation each, switch role via the two-statement `set local role` +
`set local request.jwt.claims` idiom).

**Contract**: `begin; select plan(N); … select * from finish(); rollback;`. Assertions:
B sees only own `generations` rows (`results_eq` count). **Write-isolation block** (with
`generations_select_own` temporarily permissive — `alter policy … using (true)`, rolled back
with the transaction; see "Critical Implementation Details"): as B, cross-account UPDATE
without a `user_id` predicate → 0 changed rows (`returning 1` CTE) **and** A's row unchanged;
cross-account DELETE → 0 changed rows **and** A's row still present — go red if
`generations_update_own` / `generations_delete_own` is dropped or its `using` clause is
weakened. Then restore the real SELECT policy. With SELECT policy intact: `insert into
generations (… user_id = <A> …)` as B → `throws_like '%row-level security%'` (O2-4, error
42501); A updating own row to set `user_id = <B>` → `throws_like` (O2-5, `WITH CHECK` on
UPDATE); positive: A can insert/update/delete own generation row (guards against
`using(false)`).

#### 2. `flashcards` write-isolation — independent of SELECT policy

**File**: `supabase/tests/rls_flashcards.test.sql`

**Intent**: Assertions 5/6 today survive dropping the write policies (F1 conflation) because
the SELECT policy hides B's rows from A's `WHERE` read regardless of the write policy. Add a
write-isolation block that runs with the SELECT policy temporarily made permissive so the
write policy is the only thing that can block the cross-account write; pair each blocked
write with a target-row-unchanged check; add a `WITH CHECK`-on-UPDATE case and positive write
cases. Raise `plan(10)` accordingly.

**Contract**: Keep the existing 10 assertions. Add a **write-isolation block** that runs
with `flashcards_select_own` temporarily made permissive (`alter policy … using (true)`, or
drop + create a `_test_visible` policy; rolled back with the transaction — see "Critical
Implementation Details"): as B with valid claims, `update flashcards … where user_id = <A>`
→ 0 changed rows and `delete from flashcards where user_id = <A>` → 0 changed rows
(`returning 1` CTEs), each paired with a separate check (as A / after `reset role`) that A's
target row is byte-for-byte unchanged / still present (`results_eq` on the row's columns).
Because the SELECT policy is neutralised for this block, these go red if
`flashcards_update_own` / `flashcards_delete_own` is dropped **or** its `using` clause is
weakened (O2-13). Also inside this block: as B, `update flashcards set due = …, stability =
…, state = …, reps = … where user_id = <A>` → 0 changed rows (O2 SRS-column tampering — SRS
state is columns on `flashcards`). Then restore the real SELECT policy (or rely on
`rollback`). Add (SELECT policy intact): as A, `update flashcards set user_id = <B> where id
= <A's card>` → `throws_like '%row-level security%'` (O2-5). Add: as A, positive
insert/update/delete of own row succeeds (O2 positive). Add: empty-claims — the file already
ran `set local request.jwt.claims = '{…}'` at `:94`, so first `set local request.jwt.claims
to default` (or `reset request.jwt.claims`), then `set local role authenticated` with **no**
claims → `select count(*) from flashcards` yields 0 (O4 DB-level face of "expired session";
`auth.uid()` returns `null`, no row matches).

#### 3. `anon` / RPC execute-privilege assertions

**File**: `supabase/tests/rls_flashcards.test.sql` (or `rls_generations.test.sql`)

**Intent**: Assert `anon` cannot `EXECUTE recount_generation_acceptance` (O2-9), complementing
the existing `recount_generation_acceptance.test.sql:131-144` cross-account invoker check.

**Contract**: `set local role anon; select throws_like($$ select recount_generation_acceptance('…') $$, '%permission denied%', …)`.

#### 4. Revoke `TRUNCATE` / `TRIGGER` / `REFERENCES` from `authenticated`

**File**: `supabase/migrations/<timestamp>_revoke_authenticated_destructive_privileges.sql` (new)

**Intent**: F2 revoked these from `anon` but never from `authenticated`. RLS does not stop
`TRUNCATE`. Revoke them on both user-data tables. Header comment must note this needs a
`supabase db push` to the linked cloud project after merge (like `20260825120802_…`).

**Contract**: `revoke truncate, trigger, references on public.flashcards from authenticated;`
and the same for `public.generations`. Do **not** revoke `select/insert/update/delete` —
those are the grants RLS sits on top of. One migration, forward-only, no data change.

#### 5. `authenticated` cannot `TRUNCATE` — assertion

**File**: `supabase/tests/rls_flashcards.test.sql` (or `rls_generations.test.sql`)

**Intent**: Pin the migration's effect so a future `grant` regression is caught.

**Contract**: as `authenticated` with valid claims, `throws_like($$ truncate public.flashcards
$$, '%permission denied%', 'authenticated cannot truncate flashcards')`; same for
`generations`. Keep an assertion that `authenticated` still *can* `select`/`insert` own rows
(don't over-revoke).

### Success Criteria:

#### Automated Verification:

- `npm run db:test` passes: `supabase/tests/rls_flashcards.test.sql`,
  `supabase/tests/rls_generations.test.sql`, and the three pre-existing suites
- New migration applies cleanly on `supabase db reset`
- `db-tests` CI job green on the PR

#### Manual Verification:

- Drop `generations_update_own` **or weaken its `using` clause to `true`** locally →
  `rls_generations.test.sql` goes red on the write-isolation assertion specifically (not only
  on a SELECT-count assertion)
- Drop `flashcards_delete_own` **or weaken its `using` clause to `true`** locally →
  `rls_flashcards.test.sql` goes red on the delete-isolation assertion (F1 conflation is
  gone — the write-isolation block runs with the SELECT policy neutralised)
- Re-add `truncate` grant to `authenticated` locally → the TRUNCATE assertion goes red
- After merge, `supabase db push` applies the revoke migration to the linked cloud project;
  confirm via `supabase db diff` (or a one-off `\dp public.flashcards` in the cloud SQL
  editor) that `authenticated` no longer holds `TRUNCATE`

**Implementation Note**: After this phase and all automated verification passes, pause for
manual confirmation (especially the cloud `db push`) before proceeding.

---

## Phase 3: Session-gate hermetic tests and route-level authz

### Overview

Add the missing `src/middleware.test.ts` (risk #4), bolt unauthenticated-denial and
cross-account-denial assertions onto the four route test files (risk #2 + #4 at the API
layer), and add the one missing `.eq("user_id")` filter to the AI-create generation lookup.

### Changes Required:

#### 1. Middleware session-gate test

**File**: `src/middleware.test.ts` (new); `src/lib/auth/protected-routes.ts` (new — extracted
constant); `src/middleware.ts` (import the extracted constant, no behaviour change)

**Intent**: Exercise **our** gating decision with the session as a fixture. Cover: present
session on a protected route passes through; absent session on **each** of `/dashboard`,
`/generate`, `/deck`, `/review` → 302 redirect to `/auth/signin`; invalid/expired session
(`getUser` → `null`) treated identically (O4-3/O4-4); public routes (`/`, `/auth/signin`,
`/auth/signup`, `/auth/confirm-email`, `/api/auth/signin`) pass through with no session
(O4-8); missing Supabase client (`createClient` → `null`) → `locals.user = null` → redirect
on protected routes (O4 misconfig face).

**O4-7 route-set guard (revised — no Markdown parsing).** First extract the list out of
`src/middleware.ts` into a shared module `src/lib/auth/protected-routes.ts`
(`export const PROTECTED_ROUTES = [...] as const`); `middleware.ts` imports it, so the gate
and the test share one source. Then `middleware.test.ts` pins that constant to an explicit
expected array — `expect(PROTECTED_ROUTES).toEqual(["/dashboard", "/generate", "/deck",
"/review"])` — with a comment: `// mirror of docs/reference/contract-surfaces.md rule #4
("Ochrona" == chroniona page rows); update both together`. That is a real regression guard
(nobody silently adds/removes a protected route) without parsing the doc's table or
maintaining a second hard-coded copy. Keeping it in sync with the doc stays a review
responsibility, as `contract-surfaces.md` rule #4 already prescribes.

**Contract**: `vi.mock("@/lib/supabase", …)` supplying `createClient` → `{ auth: { getUser:
async () => ({ data: { user: <fixture> } }) } }` or `null`. Hand-built `context` literal:
`{ url: new URL(path, "http://localhost"), request: new Request(...), cookies: <stub>,
locals: {}, redirect: (loc) => new Response(null, { status: 302, headers: { Location: loc } }) }`
cast `as never`; `next = () => new Response("ok")`. Assert on the returned `Response.status`
/ `headers.get("location")` and on `context.locals.user`. `onRequest` is imported and called
directly, matching the route-handler convention.

#### 2. Unauthenticated denial — route layer

**File**: `src/pages/api/generations.test.ts`, `src/pages/api/flashcards.test.ts`,
`src/pages/api/flashcards/[id].test.ts`, `src/pages/api/reviews.test.ts`

**Intent**: Each file already has a "rejects unauthenticated and unavailable" test pinning
401/503. Extend it to also assert **no side effect**: on the `user: null` path, the
`SupabaseStub` recorded no `insert`/`update`/`delete` and no `rpcCalls` (O4-6 — the handler
denies before touching data). Keep the pinned 401 as the documented contract guard (Q2).

**Contract**: `expect(supabase.queries.every(q => q.operation === "select")).toBe(true)` or
`expect(supabase.queries).toHaveLength(0)` as fits each route, plus
`expect(supabase.rpcCalls).toHaveLength(0)`, alongside the existing
`expect(response.status).toBe(401)`.

#### 3. Cross-account denial — `flashcards/[id]` PATCH & DELETE

**File**: `src/pages/api/flashcards/[id].test.ts`

**Intent**: The "maps inaccessible cards" test (`:73-91`) simulates the RLS miss with
`{ data: null }` and checks the 404 mapping but does **not** assert the query was scoped.
Add: (a) behavioural — response is non-2xx, body carries no card fields, and the
`SupabaseStub` shows the mutation matched 0 rows (already implied by `data: null`); (b)
pinned contract guard — status `404` and body `{ error: "Nie znaleziono fiszki." }`, with a
comment "contract-surface regression guard, not the isolation oracle — see
`supabase/tests/rls_flashcards.test.sql`" (Q1).

**Contract**: extend the existing test or add a sibling; assertions as above. No new stub
results needed beyond the existing `{ data: null, error: null }`.

#### 4. Ownership-filter regression guard — PATCH / DELETE / AI-create

**File**: `src/pages/api/flashcards/[id].test.ts`, `src/pages/api/flashcards.test.ts`

**Intent**: Assert the scoping filter is present in the recorded query, mirroring
`reviews.test.ts:107-111`. Labeled as a regression guard, not proof of isolation (Q6).

**Contract**: for PATCH/DELETE, `expect(supabase.queries[<n>].filters).toContainEqual(["user_id",
USER_ID])` (or `.toEqual([...])` matching the full filter list). For the AI-create path in
`flashcards.test.ts`, assert the `generations` lookup query's `filters` now contains
`["user_id", USER_ID]` (depends on change #5). Each assertion carries a one-line comment:
"regression guard that scoping did not disappear — cross-account proof is pgTAP".

**Also update the existing assertion this breaks**: `flashcards.test.ts` "preserves the
accepted AI proposal request branch" (~`:114-120`) currently pins
`supabase.queries[0].filters` to exactly `[["id", GENERATION_ID], ["status", "succeeded"]]`
via `toMatchObject` — which requires equal array length, so change #5's third filter fails
it. Extend that expected array to the three-entry list (`["user_id", USER_ID]` appended in
the order the `.eq()` calls run in `service.ts`).

#### 5. Scope the AI-create generation lookup

**File**: `src/lib/flashcards/service.ts`

**Intent**: The generation-existence lookup at `:64-69` is the only record path with no
`.eq("user_id")`. Add it — defense-in-depth consistent with every other path (Q4). RLS
already blocks the cross-account case; this makes the code uniform and the intent explicit.

**Contract**: add `.eq("user_id", userId)` to the `.from("generations").select("id")…`
chain. `userId` is already in scope (the insert below it uses it). Behaviour is unchanged
under live RLS; the change is belt-and-suspenders. Update the comment at `:62` to reflect
that the filter is now present.

### Success Criteria:

#### Automated Verification:

- `npm test` passes, including the new `src/middleware.test.ts`
- `npx astro check` passes (types for the hand-built middleware `context`)
- `npm run lint` passes
- `db-tests` CI job still green (no DB change in this phase)

#### Manual Verification:

- Remove one entry from `PROTECTED_ROUTES` (now in `src/lib/auth/protected-routes.ts`)
  locally → `middleware.test.ts` goes red on both the per-route redirect test and the
  explicit route-set guard (`toEqual([...])`)
- Change the middleware to use `getSession()` instead of `getUser()` locally → the
  invalid/expired-session test goes red (the gate no longer validates the token)
- Remove `.eq("user_id")` from a service mutation locally → the corresponding route-level
  filter-guard assertion goes red
- Manual smoke: log in, hit `/deck`; log out, hit `/deck` → redirected to `/auth/signin`;
  hit `POST /api/flashcards` with no session cookie → 401 JSON, no row created

**Implementation Note**: After this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 4: Cookbook, quality-gate sync, and deferred-item register

### Overview

Fill the cookbook sections this phase is responsible for, advance the rollout status, and
write down every deferred item so nothing is lost.

### Changes Required:

#### 1. Cookbook §6.3 — access gating and record ownership

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the "TBD — see §3 Phase 2" stub with the pattern established here: the
middleware hermetic test (`vi.mock("@/lib/supabase")`, session as fixture, per-route
redirect + the explicit `PROTECTED_ROUTES` route-set guard against
`src/lib/auth/protected-routes.ts`), and the route-level denial + filter-guard pattern
(pinned 401/404 as labeled contract guards, `filters` assertions as regression guards, the
real cross-account proof living in pgTAP).

**Contract**: prose + file references (`src/middleware.test.ts`,
`src/pages/api/flashcards/[id].test.ts`), 15–25 lines matching the density of §6.1/§6.2.

#### 2. Cookbook §6.4 — DB policy / procedure tests

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the stub: location (`supabase/tests/*.test.sql`), naming
(`rls_<table>.test.sql`, `<procedure>.test.sql`), the `begin/plan/finish/rollback` +
two-statement role-switch idiom, run command (`npm run db:test` locally against
`supabase start`), the CI gate (`db-tests` job, PR-only, **listed in `master` required status
checks** so a red run blocks merge), and the O2-13 rule (a cross-account UPDATE/DELETE
assertion must run with the SELECT policy neutralised — `alter policy … using (true)`,
rolled back — or it stays green when the write policy is dropped *or weakened*; pair each
blocked write with a separate target-row-unchanged check). Note the deferred local↔cloud
grant-parity check as a known gap.

**Contract**: prose + references, 15–25 lines.

#### 3. Cookbook §6.7 — Phase 2 notes

**File**: `context/foundation/test-plan.md`

**Intent**: 2–3 lines on what this phase taught — e.g. the `db-tests` job shape and image-pull
cost, `SupabaseStub` has no `auth` so middleware tests mock the module, the F1 conflation
pattern and how the new assertions avoid it.

**Contract**: new "**Faza 2 — …**" block under §6.7 matching the Phase 1 block's format.

#### 4. Quality-gate and rollout status sync

**File**: `context/foundation/test-plan.md`

**Intent**: `§3` Phase 2 row status `researched` → `implementing` (then `complete` once
Phases 1–3 land and are confirmed). `§5` "testy polityk bazy" gate — confirm the row reads
"required after §3 Phase 2" **and** that `db-tests` is actually in `master`'s required status
checks (Phase 1 step 1.7). The gate is "live" only when both the job exists and the branch
rule references it; if step 1.7 was deferred, say so here and in `§7`.

**Contract**: table-cell edits only; status vocabulary is fixed (`§3` parser literals).

#### 5. Deferred-item register

**File**: `context/foundation/test-plan.md` §7 and
`context/changes/testing-access-gate-data-isolation/research.md` (Open Questions)

**Intent**: Record the four deferrals with their rationale: (a) local↔cloud grant parity —
no CI mechanism without a cloud secret; (b) path-normalization of the `startsWith` gate — no
source resolves expected behaviour; (c) client-island 401 navigation — no source resolves
whether SPA XHR is covered; (d) DB-level FK same-user predicate — app filter + RLS deemed
sufficient. Mark research Open Questions 1–9 as resolved with the decisions from this plan.

**Contract**: `§7` gets bullets for (a)–(d) in the "What We Deliberately Don't Test" format
(claim + rationale + "revisit if"). `research.md` Open Questions section gets a short
"Resolved in plan.md (<date>)" note per item.

#### 6. `change.md` and progress sync

**File**: `context/changes/testing-access-gate-data-isolation/change.md`

**Intent**: `status: preparing` → `implemented` (or per the repo's convention at close);
`updated:` to today.

**Contract**: frontmatter edits only.

### Success Criteria:

#### Automated Verification:

- `npx prettier --check context/foundation/test-plan.md` passes (or `--write` applied)
- No `TBD — see §3 Phase 2` string remains in `test-plan.md` §6.3 / §6.4
- `test-plan.md §3` Phase 2 status is a valid parser literal

#### Manual Verification:

- A contributor who reads only §6.3 + §6.4 can write a new access/ownership test and a new
  pgTAP policy test without re-deriving conventions
- §7 lists the four deferrals; each has a "revisit if" trigger
- research.md Open Questions 1–9 each carry a resolution note

**Implementation Note**: This phase is documentation; no runtime behaviour changes. Confirm
the rollout status is consistent with what actually landed.

---

## Testing Strategy

### Unit / hermetic:

- `src/middleware.test.ts` — session gate: present / absent / invalid session × every
  protected route; public routes pass through; explicit `PROTECTED_ROUTES` route-set guard
  (shared constant in `src/lib/auth/protected-routes.ts`, comment-linked to contract-surfaces
  rule #4).
- Route test files — unauthenticated denial asserts no side effect; cross-account PATCH/DELETE
  asserts behaviour + pinned 404; `filters` regression guards.

### Integration (real Postgres, pgTAP):

- `rls_generations.test.sql` (new) — full cross-account read/write/insert/`WITH CHECK` +
  positive writes.
- `rls_flashcards.test.sql` (extended) — write-isolation independent of SELECT, `WITH CHECK`
  on UPDATE, positive writes, SRS-column tampering, empty-claims, `authenticated` cannot
  `TRUNCATE`, `anon` cannot `EXECUTE` the RPC.

### Manual testing steps:

1. `supabase start && npm run db:test` — all five `.test.sql` suites green.
2. Locally comment out one `USING` / one write policy / one `WITH CHECK` in turn → confirm
   the *specific* new assertion goes red (not just a SELECT-count assertion).
3. Re-add `truncate` grant to `authenticated` → TRUNCATE assertion red.
4. Remove a `PROTECTED_ROUTES` entry → middleware test red on redirect + route-set guard.
5. Swap `getUser()` → `getSession()` in middleware → invalid-session test red.
6. Push a draft PR → `db-tests` job runs, green, in parallel with `ci`.
7. App smoke: logged-out access to `/deck` redirects; `POST /api/flashcards` with no session
   → 401 JSON, no row.
8. Post-merge: `supabase db push` → confirm cloud `authenticated` lost `TRUNCATE`.

## Performance Considerations

`db-tests` adds a job that pulls Supabase Docker images (~1–2 min) and boots a local stack.
It runs in parallel with `ci`, PR-only, so it does not extend the `ci` critical path and
does not run on `master` pushes. No runtime/app performance impact.

## Migration Notes

One new migration: `<timestamp>_revoke_authenticated_destructive_privileges.sql`. Forward-only,
no data change. Must be `supabase db push`ed to the linked cloud project after merge (the F2
walk-back set the precedent — a privilege migration that shipped after the schema was already
in prod). `supabase start` in CI and `supabase db reset` locally apply it from scratch.

## References

- Research (oracle source): `context/changes/testing-access-gate-data-isolation/research.md`
  — §"Oracle Statements" (O4-1…O4-10, O2-1…O2-14), §C.4 (pgTAP gaps), §D (CI gap), §F (conventions)
- Test plan: `context/foundation/test-plan.md` §2 (risks #2/#4), §5 (gate), §6.3/§6.4/§6.7, §7
- Session gate: `src/middleware.ts:4-25`
- RLS policies: `supabase/migrations/20260824202259_flashcards_schema.sql:100-157`
- F2 walk-back precedent: `supabase/migrations/20260825120802_revoke_anon_table_privileges.sql`
- Existing pgTAP: `supabase/tests/rls_flashcards.test.sql`,
  `supabase/tests/recount_generation_acceptance.test.sql:131-144` (only cross-account assertion today)
- Route test conventions: `src/pages/api/reviews.test.ts:27-43,107-111`,
  `src/pages/api/flashcards/[id].test.ts:9-21,73-91`
- Stub: `src/lib/test-support/supabase-stub.ts` (no `auth` — models `.from()`/`.rpc()` only)
- Contract surfaces: `docs/reference/contract-surfaces.md:12,16-25,50`
- CI: `.github/workflows/ci.yml`
- Prior phase: `context/archive/2026-09-02-testing-generation-error-contract/` (pgTAP + Stryker as ad-hoc gates)
- Historical: `context/archive/2026-08-24-flashcards-schema-isolation/reviews/impl-review.md:43-74` (F1, F2)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do
> not rename step titles. See `references/progress-format.md`.

### Phase 1: CI gate for DB policy tests

#### Automated

- [x] 1.1 Workflow file parses; existing lints pass
- [x] 1.2 `npm run db:test` passes locally against `supabase start` (baseline suite)
- [x] 1.3 `db-tests` job completes green on a draft PR

#### Manual

- [x] 1.4 Mutating one RLS `USING` clause on a scratch PR turns `db-tests` red; revert → green
- [x] 1.5 `db-tests` runs in parallel with `ci`, no `ci` wall-time increase
- [x] 1.6 `db-tests` does not run on direct pushes to `master`
- [x] 1.7 `db-tests` added to `master` required status checks (or logged as a `§7` deferral + End State #1 softened)

### Phase 2: Close the RLS pgTAP gaps and revoke residual `authenticated` privileges

#### Automated

- [ ] 2.1 `npm run db:test` passes: `rls_flashcards`, new `rls_generations`, + 3 pre-existing suites
- [ ] 2.2 New revoke migration applies cleanly on `supabase db reset`
- [ ] 2.3 `db-tests` CI job green on the PR

#### Manual

- [ ] 2.4 Dropping `generations_update_own` or weakening its `using` to `true` reddens the write-isolation assertion specifically
- [ ] 2.5 Dropping `flashcards_delete_own` or weakening its `using` to `true` reddens the delete-isolation assertion (F1 conflation gone)
- [ ] 2.6 Re-adding `truncate` grant to `authenticated` reddens the TRUNCATE assertion
- [ ] 2.7 Post-merge `supabase db push` applied; cloud `authenticated` confirmed to have lost `TRUNCATE`

### Phase 3: Session-gate hermetic tests and route-level authz

#### Automated

- [ ] 3.1 `npm test` passes including new `src/middleware.test.ts`
- [ ] 3.2 `npx astro check` passes
- [ ] 3.3 `npm run lint` passes
- [ ] 3.4 `db-tests` CI job still green

#### Manual

- [ ] 3.5 Removing a `PROTECTED_ROUTES` entry (in `src/lib/auth/protected-routes.ts`) reddens both the redirect test and the explicit route-set guard
- [ ] 3.6 Swapping `getUser()` → `getSession()` reddens the invalid/expired-session test
- [ ] 3.7 Removing a service `.eq("user_id")` reddens the matching route-level filter guard
- [ ] 3.8 App smoke: logged-out `/deck` redirects; `POST /api/flashcards` with no session → 401, no row

### Phase 4: Cookbook, quality-gate sync, and deferred-item register

#### Automated

- [ ] 4.1 `prettier --check` passes on `test-plan.md`
- [ ] 4.2 No `TBD — see §3 Phase 2` string remains in §6.3 / §6.4
- [ ] 4.3 `test-plan.md §3` Phase 2 status is a valid parser literal

#### Manual

- [ ] 4.4 A contributor can write a new access test and a new pgTAP test from §6.3 / §6.4 alone
- [ ] 4.5 §7 lists all four deferrals with "revisit if" triggers
- [ ] 4.6 research.md Open Questions 1–9 each carry a resolution note
