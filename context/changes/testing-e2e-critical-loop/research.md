---
date: 2026-09-07T13:16:33+02:00
researcher: Sebastian Urbański
git_commit: 5411df426b5315b97ef6d87c4ef7b123063c5f4d
branch: master
repository: 10xCards
topic: "Test rollout Phase 4 — E2E of the critical loop (login → generate → accept → collection → review)"
tags: [research, codebase, e2e, playwright, astro-islands, openrouter, ci, quality-gates]
status: complete
last_updated: 2026-09-07
last_updated_by: Sebastian Urbański
---

# Research: Test rollout Phase 4 — E2E of the critical loop

**Date**: 2026-09-07T13:16:33+02:00
**Researcher**: Sebastian Urbański
**Git Commit**: 5411df426b5315b97ef6d87c4ef7b123063c5f4d
**Branch**: master
**Repository**: 10xCards (github.com/sebast82/10xCards)

References below are local repo paths, matching the precedent set by
`context/archive/2026-09-04-testing-schedule-counter-integrity/research.md` — the consumers of
this document (`/10x-plan`, `/10x-e2e`) work against the local checkout. The commit above is
pushed, so any reference can be turned into a permalink with the base
`https://github.com/sebast82/10xCards/blob/5411df426b5315b97ef6d87c4ef7b123063c5f4d/`.

## Research Question

Rollout Phase 4 of `context/foundation/test-plan.md:80` — "E2E krytycznej pętli". Goal as
stated: *"Jedna ścieżka logowanie → generowanie → akceptacja → kolekcja → sesja przechodzi
automatycznie na każdym PR"*, covering risks **#1, #2, #3, #4 cross-cuttingly**, test types
**e2e + gates**.

Scope decided with the user before research:

- **Provider boundary**: stub at the network boundary via `page.route` rather than calling the
  real provider — ground the exact seam and the shapes.
- **CI**: full grounding of the gate `context/foundation/test-plan.md:122` promises
  ("e2e krytycznej pętli / CI on PR / required after §3 Phase 4") — where the database, the test
  account and the secrets come from.
- **Focus**: the loop's anchors and seams (per-step roles, accessible names, hydration
  boundaries, endpoints and response shapes).

## Summary

**The loop is fully built and every step is reachable.** No feature work blocks Phase 4 in the
sense `.claude/skills/10x-e2e/SKILL.md:62` cares about. But three findings change what the phase
can honestly deliver, and one of them contradicts the mechanism the test plan assumed.

1. **`page.route` cannot stub OpenRouter — the call is server-side.** The chain is browser →
   `POST /api/generations` → `createGeneration` → `generateFlashcards` →
   `fetch("https://openrouter.ai/api/v1/chat/completions")` in the Astro server runtime
   (`src/lib/openrouter/client.ts:6`, verified). The browser never issues that request, so a
   `page.route("**/openrouter.ai/**")` never fires. This directly contradicts
   `context/foundation/test-plan.md:98` and the skill's own worked example
   (`.claude/skills/10x-e2e/references/e2e-prompt-template.md:63-65`), and matches the caveat at
   `.claude/skills/10x-e2e/SKILL.md:246`. **There is no injectable client and no base-URL env
   var** — only `apiKey` is threaded through as a parameter. The only browser-visible seam is the
   app's *own* endpoint, and stubbing that has a sharp consequence (§3).

2. **The generation leg consumes a bounded, unreclaimable resource.** `DAILY_GENERATION_LIMIT = 20`
   over a **rolling 24 h**, counted across **all** statuses including `pending` and `failed`
   (`src/lib/generations/service.ts:9,50-66`, verified). There is no DELETE endpoint for
   `generations`. With `retries: 2` in CI (`playwright.config.ts:21`), one flaky generate-based
   spec burns 3 of 20 — roughly **6–7 PR runs per 24 h** before the shared test account starts
   failing with our own 429.

3. **The `/deck` → `/review` half is free and deterministic.** A card created via
   `POST /api/flashcards` is due immediately: creation stamps `due = now` via
   `createScheduler().createNewCard(new Date())` (`src/lib/flashcards/service.ts:84,125`,
   verified), and the queue predicate is a non-strict `.lte("due", now)` with `now` minted
   server-side (`src/lib/reviews/service.ts:62-70`, verified). No clock faking, no seeded
   schedule columns.

4. **CI has none of what the gate needs.** `.github/workflows/ci.yml` references exactly two
   secrets (`SUPABASE_URL`, `SUPABASE_KEY`), passed only to `npm run build`. There is no e2e job,
   no `E2E_USERNAME`/`E2E_PASSWORD`, no OpenRouter secret, no `supabase/seed.sql`, and **no
   login-capable user in a fresh local Supabase** — while `tests/e2e/auth.setup.ts:15-22`
   deliberately hard-fails under CI rather than falling back to a saved state.

5. **The honest risk claim is narrower than "#1, #2, #3, #4".** Risk #2's real signal is owned by
   pgTAP by prior decision, and cross-account coverage would need a second account the e2e infra
   has no provision for. Risk #3's oracle rule forbids recomputing `due` in a test. What the loop
   genuinely proves is *the path still connects end to end* — see §6.

6. **Two screens are under-anchored.** `/deck` has `aria-label="Kolekcja fiszek"`; `/generate`
   and `/review` have no named landmark, and the per-proposal `Zapisz` / `Edytuj` / `Odrzuć`
   buttons repeat N times with nothing to scope to. Selecting "the Zapisz belonging to proposal
   X" today requires `.nth(i)` or DOM traversal — both forbidden by `CLAUDE.md:10-13`.

## Detailed Findings

### 1. The loop, step by step — anchors and network seams

Every accessible name below is quoted verbatim (Polish). Roles are as exposed, not as intended.

#### Step 1 — Login (`/auth/signin`)

| Element | Role | Accessible name | Note |
| --- | --- | --- | --- |
| Heading | `heading` | `Zaloguj się` | string occurs 3× in the document (`<title>`, `<h1>`, `<button>`) — role-scope always |
| Email | `textbox` | `Email` | unique |
| Password | *(none — `type="password"` exposes no role)* | `Hasło` | `getByRole("textbox")` will **not** find it |
| Password toggle | `button` | `Pokaż hasło` / `Ukryj hasło` | collides with the password label on substring |
| Submit | `button` | `Zaloguj się` → `Logowanie…` | |
| Server error | `alert` | — | `src/components/ui/alert.tsx:23` |

- `src/pages/auth/signin.astro:11`, `src/components/auth/FormField.tsx:37-55`,
  `src/components/auth/PasswordToggle.tsx:14`, `src/components/auth/SubmitButton.tsx:15-26`.
- **The `Hasło` collision is already solved** by `{ exact: true }` in
  `tests/e2e/auth.setup.ts:26-28`. Playwright's `getByLabel` is case-insensitive substring by
  default, so `getByLabel("Hasło")` otherwise matches both the input and the toggle
  (`aria-label="Pokaż hasło"`). A third carrier is `placeholder="Twoje hasło"`
  (`src/components/auth/SignInForm.tsx:73`).
- **Login lands on `/`, not `/dashboard`** (`src/pages/api/auth/signin.ts:19`). `/` renders
  `Welcome.astro` + `Topbar.astro` — English strings, and **not** the `AppNavigation` bar. So a
  loop test must `page.goto()` into the app, or navigate to a protected page first and then use
  the nav.
- Failure path redirects to `/auth/signin?error=<supabase message>` — the message text comes from
  Supabase, not this codebase. Do not hard-code it.
- The signin form is a native `<form method="POST">`, which is why `auth.setup.ts` needs no
  hydration retry; client validation only *blocks* submit (`SignInForm.tsx:42-46`).
- No landmark: `Layout.astro` has a bare `<body><slot/></body>`; `<main>` only exists in
  `AppLayout.astro:14`, which signin does not use.

#### Step 2 — Generate (`/generate`)

| Element | Role | Accessible name |
| --- | --- | --- |
| Nav landmark | `navigation` | `Główna nawigacja` |
| Heading | `heading` | `Generuj fiszki` (also `<title>` — 3 occurrences) |
| Source textarea | `textbox` | `Tekst źródłowy` |
| Generate | `button` | `Generuj fiszki` → `Generuję…` while pending |
| Proposals heading | `heading` | `Propozycje` |
| Per-proposal actions | `button` ×N | `Zapisz`, `Edytuj`, `Odrzuć`, `Anuluj` |
| Edit textareas | `textbox` | `Przód fiszki`, `Tył fiszki` |
| Saved marker | *(none)* | text `Zapisano w kolekcji` |
| Counter | *(none)* | text `zapisano {n} z {m}` |
| Error alert | `alert` | title text `Nie udało się wygenerować fiszek` + `Spróbuj ponownie` button |

`src/components/generate/GenerateView.tsx:180,188-201,210-219,246-249,265,273,283-304,322-354`;
`src/components/AppNavigation.astro:13`.

Traps specific to this screen:

- **`Spróbuj ponownie` is both a button name and the tail of most server error messages** (e.g.
  `Model nie odpowiedział na czas. Spróbuj ponownie.`, `src/lib/openrouter/client.ts:31`). Assert
  errors on the **full** message string; click retry by role.
- **The generate button is SSR'd `disabled`** because `lengthOk` is false for empty input
  (`GenerateView.tsx:86,212`). So the pre-hydration hazard is not a dead click here — it is the
  **controlled textarea**: filling before hydration sets the DOM value, React reconciles it back
  to `""`, and the button never enables. The retryable wrapper from
  `context/foundation/lessons.md:37-49` belongs around the **fill**, with
  `expect(generateBtn).toBeEnabled()` as the state proof.
- **Source text must be ≥ 200 characters** or the button stays disabled
  (`src/lib/limits.ts:3-4`: `SOURCE_TEXT_MIN = 200`, `SOURCE_TEXT_MAX = 10_000`).
- **There is no `aria-live` for generation progress** — unlike `/review`, which has one
  (`ReviewSession.tsx:250`). The only in-flight signal is the button label swapping to `Generuję…`.

#### Step 3 — Acceptance

Per-proposal, **not batch** — there is no "accept all" control (`GenerateView.tsx:291-357`).

- `POST /api/flashcards`, body
  `{"generationId": "<uuid>", "front": "…", "back": "…", "edited": <boolean>}`
  (`GenerateView.tsx:154-158`). Schema is a `.strict()` union
  (`src/pages/api/flashcards.ts:21-31`) — extra fields are rejected, and `generationId` must be a
  **real UUID**.
- `edited` compares *content*, not whether edit mode was entered (`GenerateView.tsx:145-149`);
  entering and leaving edit mode unchanged still sends `edited: false`. `source` is derived
  server-side (`src/lib/flashcards/service.ts:83`) and frozen by the trigger
  `flashcards_prevent_source_change`.
- Success: **201 `{"id": "<uuid>"}`** — the only identifier available for cleanup, and
  `GenerateView` discards it, so a test must capture it via `page.waitForResponse`.
- `Odrzuć` fires **no request** — pure client state.
- Visible outcome: the card footer collapses to `Zapisano w kolekcji` and the counter becomes
  `zapisano 1 z {N}`. The counter is unique per page and is the safer assertion target.

#### Step 4 — Collection (`/deck`)

- **`<section aria-label="Kolekcja fiszek">`** (`src/components/deck/FlashcardCollection.tsx:224`)
  — role `region`, the canonical scope, already used by `tests/e2e/seed.spec.ts:16`.
- Names: `Dodaj fiszkę`, `Nowa fiszka` (h2), `Przód nowej fiszki` / `Tył nowej fiszki`,
  `Zapisz fiszkę` → `Zapisuję…`, `Anuluj`, per card `Edytuj` / `Usuń`, edit textareas
  `Przód fiszki` / `Tył fiszki`, counter `{n} fiszek` (+ ` (najnowsze)` at pageSize 50), empty
  state `Nie masz jeszcze żadnych fiszek.`
- Delete dialog is **portaled to `document.body`** (`src/components/ui/alert-dialog.tsx:9,17-26`):
  `role="alertdialog"`, title `Usunąć tę fiszkę?`, buttons `Anuluj` / `Usuń trwale`. **A test that
  scopes everything to the `Kolekcja fiszek` region will time out on the confirm button.**
- Substring collisions needing `exact: true`: `Usuń` ⊂ `Usuń trwale`, `Zapisz` ⊂ `Zapisz fiszkę`.
  `Anuluj` is a three-way collision (create form / edit form / dialog) with no distinguishing
  attribute.
- **No `GET /api/flashcards` exists** — `src/pages/api/flashcards.ts` exports `POST` only, and
  `/deck` reads Supabase directly server-side (`src/pages/deck.astro:11-17`). A test cannot
  enumerate its own leftovers over HTTP.
- Never assert the per-card date badge (`FlashcardCollection.tsx:310`) — `Intl` renders it with
  the server TZ during SSR and the browser TZ after hydration.

#### Step 5 — Review session (`/review`)

- **No landmark, no named region.** `src/pages/review.astro:6-7` renders a bare island;
  `ReviewSession.tsx:248` is a plain `<div>`. The scoping fix that
  `context/foundation/lessons.md:59-63` prescribes — and which explicitly names *"karty na
  `/review`"* — has nothing to attach to here.
- `role="status" aria-live="polite"` sr-only announcer (`ReviewSession.tsx:250-252`) carrying
  `Karta {n} z {m}` and `Odpowiedź odsłonięta`. This is a **stable state oracle**, added
  deliberately for testability (`context/archive/2026-09-01-srs-review-session/plan.md:211`).
- **`Karta N z M` renders twice** — the visible span (`:297-299`) and the announcer — with
  byte-identical text during the question phase. `getByRole("status")` reaches the announcer; the
  visible counter has **no** unique handle. The unit test works around it with `findAllByText`
  (`ReviewSession.test.tsx:81,85`).
- Grade buttons: names are `{label} · {interval}` with `·` = U+00B7 — e.g. `Znowu · za 1 min`,
  `Dobrze · za 3 dni` (`ReviewSession.tsx:318-331`, labels at `:22-27`). **The interval half is
  dynamic FSRS output** — match on the label substring, never the full name.
- Other names: `Pokaż odpowiedź`, `Wróć do talii`, empty `Nie masz dziś nic do powtórki.`,
  finished `` To na dziś wszystko — powtórzono {n} fiszek. ``, error alert title
  `Coś poszło nie tak` + `Spróbuj ponownie`.
- **The loading state is textless** (`:254-258`) — spinner only, no `role="status"`, no
  `aria-busy`. The only wait signal is `page.waitForResponse(/\/api\/reviews/)` or one of the
  three terminal states.
- Network: `GET /api/reviews` → `{"cards":[{id, front, back, intervals}]}`; grade is
  `POST /api/reviews` `{"flashcardId","grade":1|2|3|4}` → 200 `{"id"}`. **409
  `Ta fiszka została już oceniona.` is treated as success and the queue advances anyway**
  (`ReviewSession.tsx:167`) — a silent-swallow path that can produce a green-looking but
  meaningless assertion.
- One full single-card loop is `GET → POST → GET` (`:180`).

#### Navigation between steps

**Every step-to-step move is a full page load** — plain `<a href>`, no `ClientRouter`, no view
transitions, `output: "server"`. Every island re-hydrates from scratch on every step.

- `/generate` → `/deck`: **only** via the nav link `Kolekcja`. `GenerateView` has no success link
  or redirect after saving.
- `/deck` → `/review`: **only** via the nav link `Powtórki`. The deck has no "start review"
  affordance.
- Nav names from `src/lib/navigation.ts:1-6`: `Start` → `/dashboard`, `Generowanie` → `/generate`,
  `Kolekcja` → `/deck`, `Powtórki` → `/review`. Active link carries `aria-current="page"`.

### 2. Island hydration and the two DOM traps

| Page | Island | Directive | Serialized props |
| --- | --- | --- | --- |
| `/auth/signin` | `SignInForm` | `client:load` | `serverError` |
| `/deck` | `FlashcardCollection` | `client:load` | `flashcards[]` (≤50 rows), `pageSize` |
| `/generate` | `GenerateView` | `client:load` | **none** (`props="{}"`) |
| `/review` | `ReviewSession` | `client:load` | **none** |

**Trap (a) — pre-hydration interaction** applies on all three app screens, but takes a different
shape per screen: a dead click on `/deck` (`Dodaj fiszkę`), a reconciled-away fill on `/generate`
(the controlled textarea), a dead click on `/review` (`Pokaż odpowiedź`). The prescribed fix is
the retryable `expect(async () => {…}).toPass()` block from `context/foundation/lessons.md:37-49`,
implemented at `tests/e2e/seed.spec.ts:21-24`.

**Trap (b) — duplicated text: the recorded lesson is right about the symptom, and the mechanism is
narrower than it looks.** Two agents traced this independently and the accounts reconcile: Astro
serializes island props into a `props=` **attribute** on `<astro-island>` (invisible to Playwright
text matching), and the `<code>` node the lesson describes is produced by the **Astro dev-toolbar
"Inspect"/xray app**, which builds a `<pre><code>` tooltip of the props for every island on page
load (`node_modules/astro/dist/runtime/client/dev-toolbar/apps/xray.js:104-119`). Playwright
pierces the toolbar's shadow DOM, hence the strict-mode violation.

Two consequences the plan must absorb:

- The duplication exists **only under `npm run dev`** (what `playwright.config.ts:49` starts) and
  **only for islands with non-empty props**. Under a preview build it silently disappears. A test
  that "fixed" the violation with `.first()`/`.nth()` would therefore change behavior between the
  two server targets — a second, independent reason the `.first()` reflex is wrong.
- **`/generate` and `/review` are not affected at all** (zero props). On `/review` the ambiguity
  is not island serialization but the sr-only announcer (§1). `/deck` is the only screen where
  region scoping is load-bearing for this reason.

### 3. The provider seam — the crux of the phase

**Verified**: `src/lib/openrouter/client.ts:6` hardcodes the endpoint as a module-level `const`.
The call chain is `src/pages/api/generations.ts:57` → `src/lib/generations/service.ts:114` →
`src/lib/openrouter/client.ts:96`, all in the server runtime.

What exists as a seam, exhaustively:

1. **`page.route("**/api/generations", …)`** — the only browser-visible interception point.
2. **`OPENROUTER_API_KEY`** (`astro.config.mjs:34`, optional) — unsetting it produces the **503**
   path and nothing else. Useful only for "misconfigured server".
3. **`apiKey` as a parameter**, threaded route → service → client. The only injectable value.

What does **not** exist (checked): no injectable/DI provider client (static imports throughout),
no base-URL or endpoint env var, no fake-provider flag, no MSW, no test-mode branch anywhere in
the request path. `scripts/try-prompt.ts` is a manual CLI, not a seam.

#### The sharp consequence of stubbing `/api/generations`

A stubbed `generationId` never creates a `generations` row. The follow-up
`POST /api/flashcards` then **404s** with `Nie znaleziono zlecenia generowania.`
(`src/lib/flashcards/service.ts:66-80`) because the service requires a row owned by the user with
`status = 'succeeded'`. So the options are, and the plan must pick one explicitly:

- **(a) Stub `/api/generations` only** → the acceptance step must also be stubbed, at which point
  the "generate → accept" half stops exercising any server integration and becomes a UI-wiring
  test. Cheap, deterministic, but it does not prove the thing the phase goal claims.
- **(b) Stub `/api/generations` and reuse a real `generationId`** from a prior succeeded
  generation → acceptance stays real, but the test now depends on pre-existing account state,
  which is exactly the shared-state anti-pattern
  (`.claude/skills/10x-e2e/references/e2e-anti-patterns.md:30-36`).
- **(c) Let the real provider run** → real end-to-end, but non-deterministic, up to 45 s
  (`client.ts:9`), costs money, needs an `OPENROUTER_API_KEY` secret CI does not have, and burns
  quota (§4). Note `context/foundation/test-plan.md:333` forbids asserting content quality
  anyway, so the *value* of a real call is only "the pipeline connects".
- **(d) Add a server-side seam** (endpoint env var or injectable client) in a separate
  `/10x-implement` step, then intercept at the real network boundary as
  `context/foundation/test-plan.md:97` requires. This is production code, which
  `.claude/skills/10x-e2e/SKILL.md:61-65` explicitly declines to write.
- **(e) Split the loop**: cover login → deck → review with a real, quota-free path (§4), and cover
  the generation leg's failure classes where they already live (Phase 1's Vitest boundary tests).
  Narrower claim, near-zero cost, no new production code.

#### Response shapes for whichever stub is chosen

`POST /api/generations` success: `{"generationId","model","privacyMode","proposals":[{"front","back"}]}`
(`src/pages/api/generations.ts:64`). Errors are uniformly `{"error": "<message>"}`. Full ladder:
401 (not signed in), 503 (missing config), 400 (schema — `sourceText` 200–10 000), **429** daily
limit, 500 quota/persist, and six distinct **502** provider classes (timeout, network, upstream
error, rate limit, bad shape, truncated, zero usable proposals) with constant Polish messages
pinned in Phase 1 (`context/archive/2026-09-02-testing-generation-error-contract/plan.md:146,215,272-278`).
`GenerateView` never reads `response.status` (`:109-113`) — **the error string is the entire UI
contract**.

### 4. Data lifecycle of one loop run, and the quota ceiling

**Rows written**: `public.flashcards` (one insert per accepted card, including the nine schedule
columns), `public.flashcards` UPDATE per grade (schedule columns, optimistic `.eq("reps", …)`),
`public.generations` (one row per generate click, inserted `pending` *before* the model call),
and a `recount_generation_acceptance` RPC after every AI insert and after every delete of a card
with a `generation_id`. There is no `reviews`/`review_log` table — grade history is not persisted.

**Cleanable**: flashcards, via `DELETE /api/flashcards/:id` → 200 `{id}`, with the two rules from
`context/foundation/lessons.md:65-77` — use `page.request` (shares the tab's refreshed Supabase
cookie) and pass `headers: { Origin: … }` or Astro's origin gate returns 403.

**Not cleanable**: `public.generations`. Only `POST` exists; there is no DELETE route.
**Every CI run that touches `/generate` leaves a permanent row on the test account.**

**The quota, verified at `src/lib/generations/service.ts:9,50-66`**: 20 per rolling 24 h, counted
with `.gte("created_at", now - 24h)` and **no status filter** — `pending` and `failed` rows count.
`context/foundation/lessons.md:20-34` documents the orphaned-`pending` amplification (and leaves
its Rule/Applies-to fields as `[PLACEHOLDER]` — still unresolved). Breach → 429 with a message
that must stay distinguishable from the provider's `rate_limited` 502
(`context/archive/2026-09-02-testing-generation-error-contract/plan.md:277-278`).

**Arithmetic for the gate**: `retries: 2` means one flaky generate spec costs 3 rows.
≈ 6–7 PR runs per 24 h exhausts the account, and nothing reclaims it — the rows are undeletable
and the window is purely time-based. This is the strongest single argument for keeping the
generation leg out of the per-PR loop test.

**By contrast, the quota-free path**: `POST /api/flashcards` with `{front, back}` (manual branch)
creates a card that is **immediately due**, costs no quota, leaves no `generations` row, and is
fully cleanable.

**Non-determinism on a shared account**: `getReviewQueue` returns *every* due card for the user,
capped at 50 (`src/lib/reviews/service.ts:33,62-70`). Leftovers from previous runs are also due —
and grade `1` schedules only ~1 minute out — so `Karta 1 z 1` and
`To na dziś wszystko — powtórzono 1 fiszek.` are **not** deterministic assertions. Assert on the
card's own `front` text instead. Note also that the comment at `src/lib/reviews/service.ts:32`
("karty ocenione »Znowu« wracają jako wymagalne") is misleading for the default short-term
scheduler: ~1 minute in the future is *not* due on the immediately following `GET`.

### 5. The CI gate — what exists and what is missing

**Exists**: `playwright.config.ts` is already written for a gate that does not exist —
`forbidOnly`, `retries: 2`, `workers: 1`, `github` reporter, `trace: "on-first-retry"`,
`screenshot: "only-on-failure"`, `reuseExistingServer: !CI` (`:20-27,54`). And `db-tests`
(`.github/workflows/ci.yml:28-43`) is a working precedent for a PR-only job with
`supabase/setup-cli@v3` pinned to `2.23.4`, documenting its own required-status-check requirement
in a comment.

**Missing**, prioritized:

| # | Gap | Type | Evidence |
| --- | --- | --- | --- |
| 1 | No `e2e` job at all | config | `.github/workflows/ci.yml:9-43` |
| 2 | **No login-capable test user** in a fresh local Supabase. No migration creates one; `supabase/seed.sql` does not exist (though `config.toml:60-65` points at it); the pgTAP suites insert `auth.users` rows with **id + email only, no password**, inside a rolled-back transaction | new script or seed | `supabase/tests/*.test.sql`; `tests/e2e/auth.setup.ts:15-22` |
| 3 | `E2E_USERNAME` / `E2E_PASSWORD` unavailable in CI — they live only in gitignored `.env.test`, and `auth.setup.ts` **hard-fails under CI by design** rather than using a saved state | new secret | `.env.example:5-7`; `.gitignore:44` |
| 4 | No mechanism to feed the local Supabase anon key to the dev server. `README.md:81` says read it from `supabase status`; **the machine-readable extraction form is not settled by any source in this repo** | new script | `supabase/config.toml:7-10` |
| 5 | The critical-loop spec itself does not exist | new test | only `seed.spec.ts` + `protected-routes.guest.spec.ts` |
| 6 | No provider strategy in CI — no OpenRouter secret is referenced anywhere, so `/api/generations` returns **503** before reaching the provider | new secret or scaffolding | `src/pages/api/generations.ts:40-41` |
| 7 | `e2e` not in `master` required status checks — a repo-settings action, not a file change | repo setting | precedent at `.github/workflows/ci.yml:29-32` |
| 8 | Server-under-test target undecided: `astro dev` vs `astro build && preview` | decision | see below |
| 9 | **Silent-green hazard**: with no Supabase config the app still boots, every guest test passes, and only `setup` fails — a broken env is indistinguishable from a broken login | test/app change | `src/lib/supabase.ts:6-9` → `src/middleware.ts:18-22` |
| 10 | Docs unsynced: `context/foundation/test-plan.md:98` still says e2e stack is "none yet"; `:275` (§6.6) is still `TBD` | doc | — |

**Database choice.** Local `supabase start` needs no new secrets (the `db-tests` precedent
records exactly this) but needs the anon key captured at job runtime (gap #4) and a user created
(gap #2) — and locally `enable_confirmations = false` (`supabase/config.toml:209`), so **any
signup is immediately sign-in-able**. The cloud project reuses existing secrets but means e2e
writes into the production database with no isolation between parallel PRs, and
`context/foundation/test-plan.md:336` already records the team's reluctance to add cloud CI
secrets.

**`astro dev` vs preview build.** `infrastructure.md:74` warns that `astro dev ≠ workerd`, but
that note is from 2026-08-17 and the adapter now in `node_modules` (14.1.4) applies the Cloudflare
vite plugin to the `ssr` environment in *every* command, dev included. The remaining real
difference is **env resolution**: in dev, `astro:env` secrets resolve through `process.env`, so
job-level `env:` reaches them; in the **built** worker they come from the Cloudflare binding
instead, so job-level `env:` would **not** reach them. Recommendation to carry into planning:
start on `astro dev` (zero new plumbing) and state explicitly that the workerd-runtime gap stays
covered by the existing optional "pre-prod smoke" gate (`context/foundation/test-plan.md:124`).
Keep `ASTRO_DEV_BACKGROUND=0` — it is a no-op on a GitHub runner but load-bearing for local and
agent-driven runs.

**One adapter footgun for local↔CI parity**: `@astrojs/cloudflare` reads `.dev.vars` at
`astro:config:done` and assigns into `process.env` unconditionally, so locally `.dev.vars`
**overrides** shell env. It is absent in CI (gitignored), which is why a green local run does not
prove the CI env plumbing.

### 6. What the loop can honestly claim

`context/foundation/test-plan.md:80` assigns risks #1–#4 "przekrojowo". Research narrows that:

- **#4 (access gate)** — genuinely proved, and **already covered**:
  `tests/e2e/protected-routes.guest.spec.ts` walks all four protected routes and needs no test
  account. `context/foundation/test-plan.md:64` budgets exactly *"jeden przebieg e2e"* for #4.
- **#2 (ownership / IDOR)** — **not** provable here. The real signal is pgTAP by explicit prior
  decision (`context/archive/2026-09-03-testing-access-gate-data-isolation/plan.md:159-162`:
  hermetic route tests are *"never presented as the isolation proof"*), and cross-account coverage
  needs a second account the e2e infra has no provision for (single `E2E_USERNAME`).
- **#3 (schedule integrity)** — partially. The oracle rule
  (`context/foundation/test-plan.md:239-244`) bars recomputing `due` in the test, so the e2e claim
  is limited to *the observable outcome*: the graded card leaves the queue and the session advances.
  The 409 silent-swallow (`ReviewSession.tsx:167`) is a live risk of a meaningless green.
- **#1 (provider error contract)** — depends entirely on the §3 decision. Under options (a)/(b)
  the loop tests UI wiring against a fixture, not the provider contract, which Phase 1 already
  pins at the real network boundary.

The defensible framing: **the loop test proves the path still connects end to end after a change** —
a smoke gate against a broken main path, which is precisely what
`context/foundation/test-plan.md:122` says it catches (*"zerwana główna ścieżka użytkownika"*).
Anything stronger should be attributed to the layer that actually owns it.

## Code References

- `src/lib/openrouter/client.ts:6` — `OPENROUTER_ENDPOINT` as a module-level const; the reason
  `page.route` cannot reach the provider. `:9` — 45 s timeout, deliberately above the PRD's 30 s.
- `src/lib/generations/service.ts:9,50-66` — `DAILY_GENERATION_LIMIT = 20`, rolling 24 h, no
  status filter. `:92-105` — the `pending` row is reserved *before* the model call.
- `src/lib/flashcards/service.ts:66-80` — the `generationId` must reference an owned, `succeeded`
  row, else 404. `:83` — `source` derived server-side. `:84,125` — `createNewCard(new Date())`,
  so `due = now` at creation.
- `src/lib/reviews/service.ts:33,62-70` — queue = `.eq(user_id).lte(due, now).order(due asc)`,
  batch 50, `now` server-minted. `:32` — comment that is misleading about "Znowu" cards.
- `src/pages/api/generations.ts:18-20,64` — Zod schema (200–10 000) and the success shape.
- `src/pages/api/flashcards.ts:21-31,85` — `.strict()` union, 201 `{id}`.
- `src/components/generate/GenerateView.tsx:86,109-113,145-158,212,246-249,291-357` — disabled
  gate, status-blind error handling, `edited` semantics, per-proposal actions.
- `src/components/deck/FlashcardCollection.tsx:224` — `aria-label="Kolekcja fiszek"`, the only
  named region in the loop.
- `src/components/review/ReviewSession.tsx:167,250-252,297-299,318-331` — 409 swallow, sr-only
  announcer, duplicated counter, dynamic grade-button names.
- `src/components/ui/alert-dialog.tsx:9,17-26` — the delete dialog portals outside the region.
- `src/pages/api/auth/signin.ts:19` — login redirects to `/`, not `/dashboard`.
- `src/lib/auth/protected-routes.ts:4` + `src/middleware.ts:18-22` — the gate and its route list.
- `playwright.config.ts:20-27,49-56` — CI branches already written; `webServer` on `npm run dev`.
- `tests/e2e/auth.setup.ts:15-22` — the deliberate CI hard-fail.
- `tests/e2e/seed.spec.ts:16,21-24,30-35,48-51` — the four patterns Phase 4 must inherit.
- `.github/workflows/ci.yml:24-26,28-43` — the only two secrets; the `db-tests` precedent.
- `supabase/config.toml:60-65,209` — the unused `seed.sql` slot; confirmations off locally.

## Architecture Insights

- **The app has exactly one testability seam per layer, and the provider layer has none.**
  Auth is a fixture (`storageState`), the DB is real (RLS + pgTAP), routes are real — but the
  outbound HTTP call is a hardcoded const behind a static import. Every other boundary in this
  codebase was made injectable; this one was not, and Phase 4 is where that shows up.
- **"Server owns the clock" is a consistent, load-bearing invariant.** `now` is never read from a
  request body, `.strict()` rejects an injected one, and `due` is stamped at insert. It costs the
  test the ability to fake time — and gives it, for free, a card that is due the instant it is
  created.
- **Accessible names are a deliberate, partially-completed testability investment.** The review
  screen's grade names and sr-only announcer were added *for tests*
  (`context/archive/2026-09-01-srs-review-session/plan.md:211,213`), and `/deck` got a named
  region. `/generate` and `/review` never got their landmarks, and per-item containers were never
  named anywhere — so the pattern the lessons prescribe is only actually available on one of the
  three screens.
- **Two DOM hazards on this stack look like locator problems and are not.** Pre-hydration
  interaction is a race; duplicated island text is a dev-toolbar artifact. Both have the same
  wrong reflex (`waitForTimeout`, `.first()`) and the same right answer (wait for state, scope by
  role).
- **The `pending`-before-call reservation pattern trades a correctness property for cost control**
  and leaks in two directions already recorded: orphaned rows eat the quota
  (`lessons.md:20-34`), and now, CI runs eat it too.

## Historical Context (from prior changes)

- `context/foundation/test-plan.md:98,104` — records `page.route` as the Phase 4 mechanism for
  simulating provider failure classes, "checked: 2026-09-02". **This research contradicts it**:
  the call is server-side. The stack row and §6.6 both need correcting when Phase 4 lands.
- `context/foundation/test-plan.md:106` — Playwright MCP recorded as unavailable; Phase 4 assumes
  Playwright as a project dependency. Consequence: locators are written from reading code, not
  from a live accessibility snapshot — which is why §1 above enumerates them exhaustively.
- `context/archive/2026-09-03-testing-access-gate-data-isolation/plan.md:134-137` — the single e2e
  pass for #4 was explicitly deferred *to this phase*; provider auth mechanism is out of scope
  (`test-plan.md:332`).
- `context/archive/2026-09-03-testing-access-gate-data-isolation/plan.md:249-258` — the full
  precedent for landing a CI gate: parallel PR-only job, manual "mutate → red → revert → green"
  verification, and the escape hatch if the team declines to make it required (it becomes an
  explicit §7 deferral and the end-state softens to "runs on every PR").
- `context/archive/2026-08-25-first-gated-generation/plan.md:63` — proposals are deliberately not
  persisted: *"Odświeżenie strony gubi niezapisany przegląd i to jest świadomy kompromis."*
  A loop test **cannot** reload mid-review and expect proposals to survive.
- `context/archive/2026-09-04-testing-schedule-counter-integrity/deferred.md:14` — the queue was
  deliberately not changed to exclude just-graded cards.
- `context/foundation/lessons.md` — all four recorded lessons apply directly; §1–§2 above map each
  onto the specific screens of this loop.
- Every slice plan since S-02 excluded e2e explicitly — this is the first change that does not.

## Related Research

- `context/archive/2026-09-02-testing-generation-error-contract/` — the provider error taxonomy
  (classes A–D, the 502 ladder, constant bodies). Phase 4 must not re-assert these.
- `context/archive/2026-09-03-testing-access-gate-data-isolation/` — the gate/CI precedent and the
  "pgTAP owns the isolation proof" doctrine.
- `context/archive/2026-09-04-testing-schedule-counter-integrity/` — the oracle rule and the
  `due`-assertion prohibition.
- `.claude/skills/10x-e2e/references/` — quality rules, the five anti-patterns, the seed pattern.
  Note `e2e-prompt-template.md:63-65` uses *this project* as its worked example and states the
  OpenRouter mock as a network-layer mock; that example is wrong for this codebase.

## Open Questions

1. **Which §3 option does the phase take?** (a) stub both endpoints, (b) reuse a real
   `generationId`, (c) real provider call, (d) add a server-side seam first, (e) split the loop
   and drop the generation leg from the per-PR gate. This is the single decision that determines
   the phase's scope, cost and honest claim. Research recommends (e) for the gate plus (d) as a
   separately-planned implementation step if the generation leg must eventually be covered
   in-browser.
2. **Local Supabase or cloud for the e2e job?** Local needs gaps #2 and #4 solved; cloud needs new
   secrets the team previously declined and writes to production data.
3. **How is the test user created in CI?** Three candidates exist (a direct GoTrue signup call, the
   app's own `POST /api/auth/signup`, or a new `supabase/seed.sql` with a hand-written bcrypt
   hash). Nothing in the repo settles it; the pgTAP precedent does not cover password hashes.
4. **What is the machine-readable form of `supabase status` for extracting the anon key?** Not
   settled by any source in this repo.
5. **Do the two production components get their missing anchors?** A named region on `/generate`
   and `/review` plus a per-proposal accessible name would remove the only places where the loop
   test would otherwise need `.nth()` or DOM traversal. This is production code and
   `.claude/skills/10x-e2e/SKILL.md:61-65` declines to write it — so it needs either an explicit
   plan step or a documented deferral.
6. **Is the `generations` quota burn acceptable at all for a per-PR gate**, even at one row per
   run? There is no cleanup path and the account is shared.
7. **Does the team accept `e2e` as a required status check on `master`?** Same fork in the road as
   `db-tests` — a repo-settings action, with a documented §7 deferral if declined.
8. **The `[PLACEHOLDER]` in `context/foundation/lessons.md:20-34`** (orphaned `pending` rows) is
   still unfilled and is now directly relevant to CI quota consumption.
