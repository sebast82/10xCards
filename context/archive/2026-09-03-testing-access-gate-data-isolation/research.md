---
date: 2026-09-03T23:56:17+02:00
researcher: Sebastian Urbański
git_commit: 48167cd36bc15f5d9ba628b29aaa3ad79b13e8c1
branch: master
repository: 10xCards
topic: "Oracle dla bramki dostępu (#4) i izolacji danych między kontami (#2) — rollout Phase 2 test-planu"
tags: [research, codebase, rls, access-control, idor, middleware, pgtap, ci]
status: complete
last_updated: 2026-09-03
last_updated_by: Sebastian Urbański
---

# Research: Bramka dostępu i izolacja danych między kontami (rollout Phase 2)

**Date**: 2026-09-03T23:56:17+02:00
**Researcher**: Sebastian Urbański
**Git Commit**: 48167cd36bc15f5d9ba628b29aaa3ad79b13e8c1
**Branch**: master
**Repository**: 10xCards

## Research Question

Rollout Phase 2 test-planu ("Bramka dostępu i izolacja danych w CI") pokrywa dwa ryzyka:

- **#2 (IDOR / własność rekordu)** — użytkownik odczytuje albo modyfikuje fiszkę innego
  konta, bo sprawdzane jest „czy zalogowany", a nie „czy właściciel".
- **#4 (bramka sesji)** — wylogowany / niezalogowany użytkownik dosięga chronionego ekranu
  lub endpointu zamiast przekierowania na logowanie.

Research ma wyprodukować **oracle** — co kod *powinien* robić wg źródeł (PRD, docs Supabase,
kontrakt warstwy danych), nie wg kształtu implementacji — plus mapę punktów egzekwowania,
lukę w CI i konwencje testowe, na których oprze się `/10x-plan`.

Ustalenia zakresu (AskUserQuestion): oba ryzyka równo; **pełny audyt RLS**; powierzchnia
chroniona zawężona do fiszek + generacji + przeglądu + kolekcji.

## Summary

**Architektura egzekwowania jest dwupoziomowa i celowo asymetryczna:**

1. **Bramka sesji (`#4`)** żyje w **jednym miejscu** — `src/middleware.ts`. Middleware
   buduje per-request klienta Supabase (klucz **anon**, z ciasteczek), woła
   **`supabase.auth.getUser()`** (waliduje JWT z serwerem auth — expired/forged token → `user: null`),
   zapisuje `locals.user` / `locals.supabase`, po czym dla `PROTECTED_ROUTES = ["/dashboard",
   "/generate", "/deck", "/review"]` przekierowuje brak sesji na `/auth/signin`. **`/api/**`
   NIE jest objęte** — każdy endpoint domenowy sam sprawdza `locals.user` i zwraca `401` JSON
   (nigdy redirect). Ta asymetria jest udokumentowana jako wiążąca reguła
   (`docs/reference/contract-surfaces.md:50`).

2. **Izolacja danych (`#2`)** żyje w **bazie** — 8 poprawnych polityk RLS
   (`<tabela>_<operacja>_own`, wszystkie `to authenticated`, `(select auth.uid()) = user_id`,
   `with check` na INSERT i UPDATE). Aplikacja łączy się **wyłącznie kluczem anon z sesją
   użytkownika**, nigdy `service_role`. Filtry `.eq("user_id", …)` w kodzie są **defense-in-depth
   / celowaniem w indeks, nie zabezpieczeniem** (udokumentowane w komentarzach kodu i planie
   schema-isolation).

**Dwa realne punkty ekspozycji, gdyby RLS zniknęło** (wszystko inne ma redundantny filtr `.eq("user_id")`):

- `src/pages/deck.astro:11-17` — lista kolekcji czytana w SSR **bez żadnego filtra własności**
  (czysty zakład na RLS). Bez `flashcards_select_own` strona renderuje fiszki wszystkich kont.
- `src/lib/flashcards/service.ts:64-69` — lookup istnienia generacji przy AI-create **bez
  `.eq("user_id")`**. Bez `generations_select_own`: potwierdzenie istnienia cudzych UUID +
  podpięcie własnej fiszki pod cudze zlecenie + zanieczyszczenie liczników KPI cudzego zlecenia
  przez `recount_generation_acceptance`.

**Luka w CI (sedno tej fazy):** jedyny workflow `.github/workflows/ci.yml` uruchamia
`astro check` / `lint` / `vitest run` / `build`. **Nie ma kroku `supabase test db`.** pgTAP
(`supabase/tests/*.test.sql`, `npm run db:test`) jest bramką ad hoc od Fazy 1 — zależy od tego,
czy deweloper pamięta ją odpalić. Zadanie Fazy 2: dodać job CI (oddzielny, wymaga Dockera +
`supabase start`) i udokumentować konwencję w `test-plan.md §6.3/§6.4`.

**Jakość istniejących testów pgTAP (`rls_flashcards.test.sql`, `plan(10)`):** solidna po
naprawie F1 (asercje UPDATE/DELETE liczą *zmienione* wiersze przez CTE `returning 1`), ale
z lukami — patrz sekcja "Luki pgTAP". `generations` cross-account write jest **niesprawdzone
w ogóle**.

**Historia ostrzega:** przegląd implementacji schema-isolation
(`context/archive/2026-08-24-flashcards-schema-isolation/`) miał 8 ustaleń, w tym:
- **F1** — asercje RLS były tautologiczne (przechodziły nawet po usunięciu polityk update/delete),
- **F2** — migracja `20260825120802_revoke_anon_table_privileges.sql` cofająca `anon` przywileje
  (`TRUNCATE`/`TRIGGER`/`REFERENCES`, których RLS nie chroni) **już po wdrożeniu na produkcję**.
  Te same przywileje **wciąż ma rola `authenticated`** — nie zostały odebrane.

## Detailed Findings

### A. Bramka sesji — `#4`

#### A.1 Punkt wejścia: `src/middleware.ts` (jedyny)

Nie ma `src/middleware/`, nie ma per-route guardów, nie ma `onRequest` gdzie indziej.

- `src/middleware.ts:4` — `const PROTECTED_ROUTES = ["/dashboard", "/generate", "/deck", "/review"];`
- `src/middleware.ts:6-8` — `createClient(context.request.headers, context.cookies)` →
  `context.locals.supabase = supabase` (klient albo `null`).
- `src/lib/supabase.ts:6-25` — `createServerClient<Database>` z `@supabase/ssr`; cookies z
  nagłówka `Cookie` przez `parseCookieHeader` (`getAll`), zapis odświeżonych cookies przez
  `AstroCookies.set` (`setAll`). Zwraca `null`, gdy brak `SUPABASE_URL` / `SUPABASE_KEY`.
- `src/middleware.ts:10-17` — `await supabase.auth.getUser()` → `context.locals.user = user ?? null`;
  `null`, gdy klient nie istnieje.
- `src/middleware.ts:19-23` — bramka: `PROTECTED_ROUTES.some(route => pathname.startsWith(route))`
  **oraz** `!locals.user` → `return context.redirect("/auth/signin")`.
- `src/middleware.ts:25` — w każdym innym przypadku `next()` (**model blocklist, nie allowlist**).
- `src/env.d.ts:1-6` — `App.Locals = { user: User | null; supabase: SupabaseClient<Database> | null }`.

**`getUser()` vs `getSession()`** (potwierdzone w docs `@supabase/ssr`, `/supabase/ssr`):
`getSession()` czyta wyłącznie ciasteczko — **zero wywołań sieciowych**; `getUser()` robi
`GET /user` do serwera auth i waliduje token. Kod używa `getUser()` — expired / tampered /
revoked token daje `locals.user = null`. To jest właściwe zachowanie serwerowe i pokrywa
face „wygasła sesja" ryzyka #4 bez dotykania mechanizmu dostawcy.

#### A.2 Strony vs endpointy — asymetria zamierzona

| Powierzchnia | Brak / wygasła / nieprawidłowa sesja | Źródło w kodzie |
|---|---|---|
| Chroniona strona (`/dashboard`, `/generate`, `/deck`, `/review`) | `context.redirect("/auth/signin")` — domyślny status Astro (302), `Location: /auth/signin`. Oryginalna ścieżka **nie** jest zachowywana (brak `?redirect=`). | `src/middleware.ts:20-22` |
| Endpoint domenowy (`/api/generations`, `/api/flashcards`, `/api/flashcards/:id`, `/api/reviews`) | HTTP **401** z ciałem `{"error": "<stały polski komunikat>"}`, `Content-Type: application/json`. Bez redirectu, bez danych. | `generations.ts:36-38`, `flashcards.ts:47-49`, `flashcards/[id].ts:38`, `reviews.ts:45-47` |
| Brak klienta Supabase (misconfig, nie stan auth) | Strony: `user=null` → redirect. Endpointy: **503** `{"error": "…brakuje konfiguracji serwera."}` | `src/middleware.ts:15-17`; gałęzie 503 endpointów |
| Strona publiczna (`/`, `/auth/*`) | Renderowana normalnie. | poza `PROTECTED_ROUTES` |

- Żadnej dedykowanej gałęzi „expired" nie ma — `getUser()` skleja „brak cookie" / „zepsute
  cookie" / „wygasły token po nieudanym refresh" / „revoked user" w `locals.user = null`.
- `docs/reference/contract-surfaces.md:46` nazywa JSON dla endpointów „świadomy rozjazd,
  nie niespójność".
- Wszystkie chronione endpointy re-sprawdzają `locals.user` same:
  `src/pages/api/generations.ts:36-38`, `src/pages/api/flashcards.ts:47-49`,
  `src/pages/api/flashcards/[id].ts:33-51` (helper `getRequestContext` → 401/503/400),
  `src/pages/api/reviews.ts:41-53` (`getRequestContext` → 401/503).
- Endpointy `/api/auth/*` (`signin.ts`, `signup.ts`, `signout.ts`) **nie** używają `locals` —
  budują własnego klienta i są częścią flow auth, nie „chronione".

#### A.3 Wyspy klienckie na wygasłej sesji (candidate edge case, nie defekt wg źródeł)

`GenerateView`, `ReviewSession`, `FlashcardCollection` robią `fetch("/api/…")` i na
`!response.ok` renderują zwrócony string `error` **inline** — nie czytają `response.status`,
**nie przekierowują** na `/auth/signin` (`src/components/generate/GenerateView.tsx:99-113`;
`src/components/review/ReviewSession.tsx:104-112`). `GenerateView.test.tsx:10` wprost notuje
„GenerateView.tsx never reads `response.status`". Mid-session expiry pokazuje więc komunikat
„Zaloguj się, aby…" wewnątrz strony zamiast nawigacji do logowania. **Żadne źródło nie
rozstrzyga**, czy „przekierowywany na stronę logowania" obejmuje XHR w SPA (Ambiguity B).

#### A.4 Pełna powierzchnia chroniona (zakres: fiszki + generacje + przegląd + kolekcja)

**Strony** (bramkowane wyłącznie przez `src/middleware.ts:4` + `:19-22`):

| Ścieżka | Plik | Chroniona? | Dotyka danych użytkownika |
|---|---|---|---|
| `/dashboard` | `src/pages/dashboard.astro:5` | tak (prefix) | czyta `locals.user.email` tylko do wyświetlenia |
| `/generate` | `src/pages/generate.astro` | tak (prefix) | wyspa → `POST /api/generations`, `POST /api/flashcards` |
| `/deck` | `src/pages/deck.astro:11-17` | tak (prefix) | **SSR frontmatter** `supabase.from("flashcards").select(...)` + wyspa → `/api/flashcards/:id` |
| `/review` | `src/pages/review.astro` | tak (prefix) | wyspa → `GET/POST /api/reviews` |

Żadna z chronionych stron **nie re-sprawdza** auth — ufają middleware.
`src/layouts/AppLayout.astro` też nie (per plan app-shell: „te obowiązki pozostają w middleware").

**Endpointy API** (NIE bramkowane przez middleware — self-check `locals.user` → 401):

| Endpoint | Metody | Plik | Bramka |
|---|---|---|---|
| `/api/generations` | POST | `src/pages/api/generations.ts:33` | `:36-38` → 401; `:40-42` → 503 |
| `/api/flashcards` | POST | `src/pages/api/flashcards.ts:44` | `:47-49` → 401; `:51-53` → 503 |
| `/api/flashcards/[id]` | PATCH, DELETE | `src/pages/api/flashcards/[id].ts:61,86` | `getRequestContext` → 401/503/400-bad-uuid |
| `/api/reviews` | GET, POST | `src/pages/api/reviews.ts:55,70` | `getRequestContext` → 401/503 |

- **`GET /api/flashcards` nie istnieje** — `docs/reference/contract-surfaces.md:42` oznacza
  „proponowane" (S-03). Dziś kolekcję czyta SSR w `deck.astro`.

**Publiczne** (blocklist — cokolwiek nie `startsWith` prefiksu przechodzi):
`/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email`, `/api/auth/*`, statyczne assety.
`docs/reference/contract-surfaces.md:18-25`. **Nie ma `/auth/callback`** — link potwierdzenia
maila obsługuje hostowany flow Supabase (terytorium dostawcy, §7 test-planu).

### B. Izolacja danych — `#2`

#### B.1 Klient Supabase w handlerach — SEDNO

`locals.supabase` to **per-request klient związany z ciasteczkiem, na kluczu anon** — RLS jest
realną bramką, nie ma bypassu service-role.

- `src/lib/supabase.ts:6-25` — `createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {...})`.
- `astro.config.mjs:32-33` — `SUPABASE_URL` / `SUPABASE_KEY` to jedyne sekrety Supabase.
- `context/archive/2026-08-17-deployment/deployment-plan.md:62` — produkcyjny `SUPABASE_KEY` =
  „klucz **anon public** (NIE `service_role`)".
- **Nie ma klienta service-role nigdzie** — grep `service_role` / `SUPABASE_SERVICE` trafia
  tylko w linie `grant` SQL i odwołania w docs.
- `src/middleware.ts:6-17` — ten **sam** instancja klienta idzie do `getUser()` i do handlerów,
  więc każde `.from(...)` niesie JWT użytkownika i `auth.uid()` w RLS to caller.

**Wniosek:** RLS (`20260824202259_flashcards_schema.sql:109-157`) jest mechanizmem
egzekwującym. Filtry `.eq("user_id", …)` są wygodą / celowaniem w indeks
(komentarze: `src/lib/generations/service.ts:53`, `src/lib/reviews/service.ts:63`,
`src/pages/deck.astro:10`).

#### B.2 Ścieżki odczytu fiszki

| Ścieżka | Lokalizacja | Filtr własności w app? | Zapytanie |
|---|---|---|---|
| Lista kolekcji (SSR) | `src/pages/deck.astro:11-17` | **NIE — brak filtra** | `.from("flashcards").select("id, front, back, source, created_at").order("created_at",{ascending:false}).range(0, 49)` |
| `GET /api/flashcards` | niezaimplementowane | — | contract-surfaces „proponowane" |
| Kolejka przeglądu | `src/lib/reviews/service.ts:64-70` | tak (DiD) | `.eq("user_id", userId).lte("due", now)...` |
| Grade read-before-write | `src/lib/reviews/service.ts:105-110` | tak | `.eq("id", flashcardId).eq("user_id", userId)` |
| AI-create lookup generacji | `src/lib/flashcards/service.ts:64-69` | **NIE** (patrz B.4) | `.from("generations").select("id").eq("id", generationId).eq("status","succeeded").maybeSingle()` |
| Delete lookup | `src/lib/flashcards/service.ts:175-180` | tak | `.eq("id", flashcardId).eq("user_id", userId)` |

`src/pages/deck.astro` to jedyna ścieżka odczytu fiszki z **zerowym** zakresowaniem w app.

#### B.3 Ścieżki modyfikacji fiszki

Wszystkie przez `src/lib/flashcards/service.ts`, wołane z `src/pages/api/flashcards.ts` (POST)
i `src/pages/api/flashcards/[id].ts` (PATCH/DELETE). `user.id` zawsze z sesji
(`flashcards.ts:76,82`; `[id].ts:50`), **nigdy z body/params**.

| Operacja | Lokalizacja | Egzekwowanie własności |
|---|---|---|
| create manual | `service.ts:124-135` | `.insert({ user_id: userId, … })` — właściciel z sesji; RLS `flashcards_insert_own` `with check` broni przed podszyciem |
| create AI | `service.ts:83-94` | jw. + niezakresowany lookup generacji `:64-69` (B.4) |
| update | `service.ts:151-157` | `.update({front,back}).eq("id", flashcardId).eq("user_id", userId).select("id").maybeSingle()` → `null` ⇒ `flashcard_not_found` ⇒ **404** (`[id].ts:54-56`) |
| delete | `service.ts:190-196` | `.delete().eq("id").eq("user_id").select("id").maybeSingle()` → `null` ⇒ **404** |

`front`/`back` trimowane i re-walidowane pod limity CHECK przed zapisem (`flashcards.ts:16-19`,
`[id].ts:17-20`). `source` / `user_id` nigdy w payloadzie update; `source` niezmienne też przez
trigger `flashcards_prevent_source_change` (`20260824202259_flashcards_schema.sql:81-98`).

#### B.4 Gdzie kończy się app, a zaczyna baza

- **PATCH / DELETE / reviews GET+POST**: belt-and-suspenders — `.eq("user_id", userId)`
  **oraz** RLS. Usunięcie RLS **nie** przeciekłoby przez te ścieżki.
- **`src/pages/deck.astro:11-17` (lista)**: **tylko RLS**. Bez `flashcards_select_own` →
  pełny odczyt między kontami.
- **`src/lib/flashcards/service.ts:64-69` (lookup generacji przy AI-create)**: **tylko RLS**.
  Komentarz `:62`: „Klucz obcy nie przechodzi przez RLS — bez tego zapytania cudze
  `generationId` przeszłoby bez przeszkód". Z RLS: cudze ID → `null` → `generation_not_found`
  → 404. Bez RLS: (a) potwierdzenie istnienia dowolnego UUID generacji, (b) insert własnej
  fiszki pod cudze `generation_id` (`flashcards_insert_own` sprawdza tylko `user_id`),
  (c) `recount_generation_acceptance(p_generation_id)` przelicza liczniki KPI **cudzego** zlecenia.
  - `recount_generation_acceptance` jest `SECURITY INVOKER`, `grant execute` tylko
    `authenticated` (`20260825143000...sql:6,28-29`, redefinicja `20260826141500...sql`), więc
    pod żywym RLS jej wewnętrzne `UPDATE`/`SELECT ... FOR UPDATE` też są związane politykami.
    To znów RLS to powstrzymuje.

**Endpointy, które przeciekłyby / zmodyfikowałyby cudzy wiersz, gdyby polityka DB zniknęła:**
1. `src/pages/deck.astro` — odczyt fiszek wszystkich kont.
2. `POST /api/flashcards` gałąź AI (`service.ts:64-106`) — ujawnienie istnienia cudzej generacji
   + zanieczyszczenie liczników KPI cudzego zlecenia.

Reszta ma redundantny `.eq("user_id")`.

#### B.5 Rekordy generacji — inwentarz

- Brak endpointu list/detail/GET (`generations.ts` jest POST-only).
- Odczyty: `generations/service.ts:54-58` (count limitu dobowego, zakresowany po `user_id`)
  i `flashcards/service.ts:64-69` (lookup AI-create, **niezakresowany**).
- Zapisy: `service.ts:94-105` insert (`user_id: userId`), `:120-129` update po własnym `id`,
  `:77-79` markFailed po własnym `id`; + RPC `recount_generation_acceptance` (invoker, po `generation_id`).

#### B.6 Endpointy przeglądu

`src/pages/api/reviews.ts` — `getRequestContext:41-53` (401/503), `now` zawsze w handlerze
(`:63,:93`), nigdy z żądania. `src/lib/reviews/service.ts:62-96` (kolejka) i `:98-160` (grade)
oba `.eq("user_id", userId)`; grade write niesie też `.eq("reps", previousReps)`
(optimistic concurrency) → `grade_conflict` / 409. DiD obecne; RLS dodatkowo egzekwuje.

### C. Pełny audyt RLS

#### C.1 Tabele i polityki

Dokładnie **dwie** tabele danych użytkownika. **Nie ma osobnej tabeli stanu przeglądu/SRS** —
stan harmonogramu FSRS (`due`, `stability`, `difficulty`, `scheduled_days`, `learning_steps`,
`reps`, `lapses`, `state`, `last_review`) to **kolumny na `public.flashcards`**
(`20260824202259_flashcards_schema.sql:43-51`). `review_logs` celowo nie utworzono.

| Tabela | RLS? | Gdzie |
|---|---|---|
| `public.generations` | **ENABLED** | `20260824202259_flashcards_schema.sql:100` |
| `public.flashcards` | **ENABLED** | `20260824202259_flashcards_schema.sql:101` |

**8 polityk — wszystkie PERMISSIVE, `to authenticated`, `(select auth.uid()) = user_id`**
(sub-query to celowa optymalizacja `InitPlan` per-statement):

| # | Tabela | Polityka | Cmd | USING | WITH CHECK | Linia |
|---|---|---|---|---|---|---|
| 1 | generations | `generations_select_own` | SELECT | `(select auth.uid()) = user_id` | — | `:109-113` |
| 2 | generations | `generations_insert_own` | INSERT | — | `(select auth.uid()) = user_id` | `:115-119` |
| 3 | generations | `generations_update_own` | UPDATE | `… = user_id` | `… = user_id` | `:121-126` |
| 4 | generations | `generations_delete_own` | DELETE | `… = user_id` | — | `:128-132` |
| 5 | flashcards | `flashcards_select_own` | SELECT | `… = user_id` | — | `:134-138` |
| 6 | flashcards | `flashcards_insert_own` | INSERT | — | `… = user_id` | `:140-144` |
| 7 | flashcards | `flashcards_update_own` | UPDATE | `… = user_id` | `… = user_id` | `:146-151` |
| 8 | flashcards | `flashcards_delete_own` | DELETE | `… = user_id` | — | `:153-157` |

**Werdykt:** żadna polityka nie używa `true`; oba UPDATE mają `WITH CHECK` (wymóg planu:
„bez `with check` da się przepisać cudzy `user_id`"); INSERT mają `WITH CHECK`. Zestaw jest
podręcznikowo poprawny dla izolacji właściciela.

#### C.2 Granty i migracja walk-back

- `20260824202259:103-107` — `grant select,insert,update,delete` do `authenticated`
  i `service_role`. **Żadnego `revoke` przeciwko `anon`** (to defekt F2).
- `20260825120802_revoke_anon_table_privileges.sql` (3 linie):
  ```sql
  revoke all on public.flashcards from anon;
  revoke all on public.generations from anon;
  alter table public.flashcards drop constraint flashcards_due_required;
  ```
  `REVOKE ALL` = `SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER` od `anon`.
  Trzecia linia niepowiązana (usuwa redundantny CHECK, F8).

**Dlaczego po fakcie** (F2, `context/archive/2026-08-24-flashcards-schema-isolation/reviews/impl-review.md:57-74`):
oryginalna migracja nadała DML `authenticated`/`service_role`, ale **nie odebrała nic `anon`**.
Lokalnie `anon` trzymał defaultowe `TRUNCATE`/`TRIGGER`/`REFERENCES`. **RLS nie chroni przed
`TRUNCATE`.** Dodatkowo asercja pgTAP dla `anon` sprawdzała stan grantów jednej instancji, nie
gwarancję RLS — cloud z klasycznym `alter default privileges … grant all … to anon` dałby
`anon` działający `SELECT` przy zielonym teście lokalnym. Zespół wybrał **Fix A** (nowa
migracja) i wypchnął ją na produkcję **2026-08-25** — po tym, jak schema migracja poszła na
prod 2026-08-24.

Per docs Supabase (`/supabase/supabase`): *„Postgres evaluates table grants before applying RLS
policies: missing grants return permission errors, whereas unmatched RLS policies return empty
results."* — revoke to realna warstwa **przed** RLS.

**Wciąż otwarte (z decyzji F2/F8):**
- Te same `TRUNCATE`/`TRIGGER`/`REFERENCES` **wciąż ma rola `authenticated`** — nigdy nie
  odebrane. `authenticated` może dziś `TRUNCATE public.flashcards`; RLS tego nie zatrzyma.
  **To najbardziej materialna luka rezydualna.**
- Revoke jest per-tabela. Brak `REVOKE … FROM anon` na poziomie schematu / `ALTER DEFAULT
  PRIVILEGES` — każda przyszła tabela w `public` może po cichu odziedziczyć defaulty.
- Brak automatycznego sprawdzenia parytetu grantów lokalne ↔ cloud.
- FK `flashcards.generation_id → generations.id` (`:39`) `on delete set null`, **bez predykatu
  wiążącego oba wiersze z tym samym `user_id`**. RLS nie powstrzyma inserta wskazującego fiszkę
  na cudzą generację (INSERT `WITH CHECK` waliduje tylko `flashcards.user_id`). Dziś broni tego
  tylko app (`service.ts:66-68`).
- `service_role` ma `BYPASSRLS` + pełne granty — nietestowane założenie zaufania (app nigdy nie
  używa tego klucza).

#### C.3 Istniejące testy pgTAP

Komenda: **`npm run db:test`** → `supabase test db` (`package.json:16`), `pg_prove` w
kontenerze CLI, każdy plik w transakcji + `rollback`. CLI 2.23. **Nie jest krokiem CI.**

**`supabase/tests/rls_flashcards.test.sql` — `plan(10)`:**
Seeduje dwóch użytkowników do `auth.users` (`1111…` A, `2222…` B), po jednej generacji i fiszce
każdy — jako superuser przed przełączeniem roli. Przełączenie: idiom dwóch instrukcji
(`:93-94`): `set local role authenticated; set local request.jwt.claims = '{"sub":"…","role":"authenticated"}';`.

1. `relrowsecurity = true` dla `generations` (`:82-86`)
2. `relrowsecurity = true` dla `flashcards` (`:87-91`)
3. jako A: `count(*) from generations` = 1 (`:96-100`)
4. jako A: `count(*) from flashcards` = 1 (`:102-106`)
5. CTE `update flashcards … where user_id = <B> returning 1`, zmienione wiersze = 0 (`:108-114`)
6. CTE `delete from flashcards where user_id = <B> returning 1`, zmienione wiersze = 0 (`:116-121`)
7. `throws_like` — `insert into flashcards (… user_id = <B> …)` → `%row-level security policy%` (`:123-150`)
8. `throws_like` — `update flashcards set source='manual' where user_id = <A>` → `%flashcard source is immutable%` (trigger, nie RLS) (`:152-156`)
9. `throws_like` — jako `anon`, `select … flashcards` → `%permission denied%` (`:158-163`)
10. `throws_like` — jako `anon`, `select … generations` → `%permission denied%` (`:164-168`)

Asercje 5/6 przepisane z tautologicznej formy podczas F1 — teraz liczą *zmienione* wiersze
(zgodne ze wzorcem docs Supabase dla testu klauzuli `USING`).

**`supabase/tests/generations_error_contract.test.sql` — `plan(5)`** (artefakt Fazy 1, ryzyko
#5): CHECK-i anty-wyciekowe (`source_text_hash` odrzuca prozę, `error_code` kształt, biconditional
`error_code ⟺ status='failed'`). **Bez przełączania roli.** Dla #2 nierelewantny wprost;
wartość strukturalna: przypina CHECK-i, żeby przyszła migracja ich nie zdjęła.

**`supabase/tests/recount_generation_acceptance.test.sql` — `plan(9)`** (ryzyko #6): asercja **8**
(`:132-144`) to **jedyna prawdziwa asercja cross-account w całej suite** — po tym jak user B woła
`recount_generation_acceptance` na generacji usera A, liczniki A są niezmienione (bo funkcja jest
`security invoker`, `for update` i `update` matchują 0 wierszy pod RLS B).

#### C.4 Luki pgTAP (do zaadresowania w tej fazie)

- **`generations` cross-account write — niesprawdzone w ogóle.** Brak asercji, że B nie może
  `UPDATE`/`DELETE` wiersza generacji A; brak `throws_like` dla `insert into generations`
  z cudzym `user_id`. A generacje niosą liczniki akceptacji zasilające kryterium 75% PRD.
- **`flashcards` UPDATE/DELETE izolacja zlana z polityką SELECT.** Nota decyzji F1
  (`impl-review.md:55`): „update na cudzym wierszu jest odcinany najpierw przez politykę select…
  sama asercja nie rozróżnia, która polityka zadziałała". Asercje 5/6 przejdą nawet po usunięciu
  `flashcards_update_own` / `flashcards_delete_own`, dopóki stoi `flashcards_select_own`.
  Polityki zapisu nie są niezależnie dowiedzione.
- **Brak testu `WITH CHECK`-na-UPDATE.** Nigdy: A aktualizuje swój widoczny wiersz i próbuje
  ustawić `user_id = <B>`. Klauzula `WITH CHECK` na UPDATE nie jest ćwiczona.
- **Brak asercji pozytywnych zapisu.** Brak testu, że A *może* insert/update/delete własnego
  wiersza (tylko negatywy + widoczność odczytu). Polityka przypadkiem `using (false)` dla
  zapisu nie zostałaby złapana.
- **Kolumny stanu SRS** — pokryte tylko tranzytywnie przez polityki wiersza `flashcards`. Brak
  jawnej asercji, że B nie zmieni `due`/`stability`/`state`/`reps` na karcie A.
- **Asercje `anon` testują stan grantów, nie RLS** (`permission denied`). Świadomy wybór po F2,
  ale zachowanie *polityki* dla hipotetycznie-grantowanego `anon` jest niedowiedzione.
- **Brak testu, że `authenticated` trzyma `TRUNCATE`** (otwarty punkt F2).
- **Brak przypadku pustych/wygasłych claims:** `set local role authenticated` bez
  `request.jwt.claims` → powinno widzieć 0 wierszy. Nietestowane (face „wygasła sesja" #4 na
  poziomie DB).
- **FK cross-account:** brak asercji, że fiszka nie może wskazać cudzego `generation_id`.
- **`anon` nie-może-`EXECUTE`-RPC** — nigdzie nie asertowane.

### D. Luka w CI — sedno fazy

**Jedyny workflow:** `.github/workflows/ci.yml`. Job `ci` (push + PR do `master`), kroki:
`checkout` → `setup-node@24` → `npm ci` → `npx astro sync` → `npx astro check` → `npm run lint`
→ `npm test` (= `vitest run`) → `npm run build` (z sekretami `SUPABASE_URL` / `SUPABASE_KEY`).

**Brak `supabase test db` / `npm run db:test`. Brak setupu Supabase CLI, `supabase start`,
usługi Docker, pgTAP.** Pre-commit uruchamia tylko `lint-staged` (`package.json:72-79`) —
testy nie biegną też lokalnie przed commitem.

`test-plan.md §5` (`:120`): *„testy polityk bazy (`supabase test db`) — CI on PR — required
after §3 Phase 2 — Catches: regresje izolacji danych między kontami."* Bramka staje się
egzekwowana **dokładnie gdy ta faza wyląduje**.

**Gdzie wpiąć:** runnery `ubuntu-latest` mają Docker → CLI może odpalić lokalny stack w CI.
Standardowy kształt: **oddzielny job** (równoległy do `ci`), np. `db-tests`:
`supabase/setup-cli` (albo `npx supabase`) → `supabase start` → `supabase test db` →
`supabase stop`; gate na `pull_request`. **Nie** składać do `ci` — `supabase start` ściąga
obrazy (~1-2 min), reszta `ci` nie potrzebuje Dockera. Nota cookbook Fazy 1
(`test-plan.md:197-198`) już to zapowiada: „Wpięcie do CI to §3 Faza 2."

### E. Wzorzec „bramki ad hoc" z Fazy 1 (do promocji)

Faza 1 (`context/archive/2026-09-02-testing-generation-error-contract/`) dodała
`generations_error_contract.test.sql` jako Phase 4 („P4 — pgTAP"). Wprost:

- `plan.md:105`: „Nie wpinamy pgTAP do CI — to `test-plan.md §5` 'required after §3 Phase 2'.
  P4 zostaje bramką ad hoc."
- `plan.md:687-689` (Progress): „Faza ad hoc: … uruchamiany wyłącznie przez `npm run db:test`
  (wymaga `supabase start`). NIE jest krokiem CI — wpięcie to Rollout Phase 2. Przebieg:
  `Files=3, Tests=24, Result: PASS`."

Mechanizm do promocji: **plik `*.test.sql` w `supabase/tests/`, `begin; select plan(N); … select
* from finish(); rollback;`, użytkownicy wprost w `auth.users`, `npm run db:test` lokalnie
przeciw `supabase start`**. Zadanie Fazy 2 (`change.md:14`): „testy polityk bazy (pgTAP)
**wpięte w CI** + quality gates" — dodać job CI i wypełnić `test-plan.md §6.4`
(„lokalizacja, konwencja nazw, komenda uruchomienia i miejsce bramki w CI").

Faza 1 uruchomiła też **Stryker** jako oddzielną selektywną bramkę ad hoc (efemeryczna config,
`npx`, bez devDependency, 3 obejścia pod Windows, 85%→95%). To *inna* bramka, świadomie **nie**
CI.

### F. Konwencje testowe (dla `/10x-plan`)

#### F.1 Test integracyjny trasy API — wzorzec ustalony (§6.2 cookbook)

- **Handler jako zwykła funkcja:** `import { PATCH, DELETE } from "./[id]"`, wołane bezpośrednio.
- **`context()` kopiowany do pliku** (nie współdzielony — udokumentowana konwencja):
  ```js
  function context({ user = { id: USER_ID }, supabase = new SupabaseStub([]).asClient(), body, params } = {}) {
    return { locals: { user, supabase }, request, params } as never;
  }
  ```
  Identyczny w `flashcards.test.ts:12-27`, `flashcards/[id].test.ts:9-21`, `reviews.test.ts:27-43`,
  `generations.test.ts:29-44`.
- **`SupabaseStub`** (`src/lib/test-support/supabase-stub.ts`): rejestrator wywołań, **nie baza**.
  Konstruktor bierze **pozycyjną** tablicę `StubResult`; każde `.from(table)` / `.rpc()` shiftuje
  następny wynik. `StubQuery` zapisuje `{ table, operation, payload?, filters: [col,val][], … }`.
  `.eq()` pushuje `[column, value]` do `filters`. **Nie egzekwuje niczego** — nie zna RLS, nie
  robi constraintów ani kaskad, `rpc` jest no-opem.
- **`vi.mock("astro:env/server", …)`** z `vi.hoisted` — **tylko** dla `generations.ts` (jedyna
  trasa importująca `astro:env/server`). `flashcards.ts` / `[id].ts` / `reviews.ts` tego nie
  importują — ich testy nie potrzebują `vi.mock`.
- **Wzorzec asercji własności już w repo** — `reviews.test.ts:107-111`:
  ```js
  expect(supabase.queries[1].filters).toEqual([
    ["id", FLASHCARD_ID], ["user_id", USER_ID], ["reps", REVIEW_ROW.reps],
  ]);
  ```
  `flashcards/[id].test.ts` **nie** asertuje dziś obecności `["user_id", …]` w filtrach
  update/delete — jego test „maps inaccessible cards" (`:73-91`) tylko podaje `{ data: null }`
  i sprawdza mapowanie 404. **To luka, którą test route-level ownership powinien domknąć.**
- **Konwencja 401:** `context({ user: null })` → `expect(response.status).toBe(401)`
  (`flashcards.test.ts:81-87`). `supabase: null` → 503.

#### F.2 Granica: test hermetyczny NIE dowodzi RLS

`test-plan.md:62` — antywzorzec: „zamockowanie klienta bazy tak, że polityka nigdy się nie
wykonuje". Realny sygnał cross-account **musi** przyjść z pgTAP (real Postgres) wpiętego w CI.
Test route-level asertujący `.eq("user_id")` w filtrach to **tylko tania straż regresyjna**, że
filtr nie zniknął — nie dowód izolacji (i ryzyko mirror-testu — Ambiguity #2 poniżej).

## Code References

- `src/middleware.ts:4` — `PROTECTED_ROUTES` (cała lista tras chronionych; strony, nie `/api/**`)
- `src/middleware.ts:6-17` — per-request klient anon; `getUser()` → `locals.user`
- `src/middleware.ts:19-23` — bramka: `pathname.startsWith(route)` + `!locals.user` → `redirect("/auth/signin")`
- `src/lib/supabase.ts:6-25` — `createServerClient<Database>` + `parseCookieHeader`; `null` bez env
- `src/env.d.ts:1-6` — `App.Locals`
- `src/pages/deck.astro:10-17` — **odczyt listy fiszek w SSR bez filtra `user_id` (tylko RLS)**
- `src/pages/api/generations.ts:33-42` — POST; 401 gdy `!user`, 503 gdy `!supabase || !OPENROUTER_API_KEY`
- `src/pages/api/flashcards.ts:44-93` — POST; guard `:47-53`; `userId` z `user.id` `:76,:82`
- `src/pages/api/flashcards/[id].ts:33-51,61,86` — `getRequestContext` 401/503/400; PATCH/DELETE
- `src/pages/api/reviews.ts:41-53,55,70` — `getRequestContext` 401/503; GET/POST
- `src/lib/flashcards/service.ts:62-77` — **lookup generacji AI-create bez `.eq("user_id")` (tylko RLS)**
- `src/lib/flashcards/service.ts:83-94,124-135` — inserty z `user_id: userId`
- `src/lib/flashcards/service.ts:104-106` — RPC `recount_generation_acceptance`
- `src/lib/flashcards/service.ts:151-157,190-196` — update/delete `.eq("id").eq("user_id")` → 404
- `src/lib/reviews/service.ts:64-70,105-110,132-149` — `.eq("user_id", userId)` (+ `.eq("reps", …)`)
- `src/lib/generations/service.ts:50-67` — count limitu `.eq("user_id", userId)`; komentarz `:53`
- `src/components/generate/GenerateView.tsx:99-113` — na `!ok` inline error, nie czyta `status`, nie redirectuje
- `src/components/review/ReviewSession.tsx:104-112` — jw., special-case tylko 409
- `supabase/migrations/20260824202259_flashcards_schema.sql:43-51` — stan SRS jako kolumny `flashcards`
- `supabase/migrations/20260824202259_flashcards_schema.sql:81-98` — trigger `prevent_flashcard_source_change`
- `supabase/migrations/20260824202259_flashcards_schema.sql:100-101` — `enable row level security`
- `supabase/migrations/20260824202259_flashcards_schema.sql:103-107` — granty (bez revoke `anon` — defekt F2)
- `supabase/migrations/20260824202259_flashcards_schema.sql:109-157` — 8 polityk RLS
- `supabase/migrations/20260825120802_revoke_anon_table_privileges.sql:1-3` — walk-back: `revoke all … from anon`
- `supabase/migrations/20260825143000_recount_generation_acceptance.sql:3-30` — RPC `security invoker`, grant `authenticated`
- `supabase/migrations/20260826141500_clamp_generation_acceptance.sql` — `create or replace` (granty zachowane implicit)
- `supabase/tests/rls_flashcards.test.sql:82-168` — `plan(10)`; `:108-121` asercje zmienionych wierszy (po F1); `:158-168` `anon` `permission denied`
- `supabase/tests/recount_generation_acceptance.test.sql:131-144` — jedyna prawdziwa asercja cross-account w suite
- `supabase/tests/generations_error_contract.test.sql:1-119` — 5 CHECK-ów anty-wyciekowych, bez przełączania roli
- `.github/workflows/ci.yml:12-26` — cała lista kroków CI; brak `db:test`
- `package.json:9,15-16,72-79` — `test`=`vitest run`, `db:reset`/`db:test`, husky/`lint-staged`
- `src/lib/test-support/supabase-stub.ts:26-120` — `SupabaseStub` (rejestrator, nie egzekutor)
- `src/pages/api/reviews.test.ts:107-111` — wzorzec asercji filtrów własności
- `src/pages/api/flashcards/[id].test.ts:73-91` — test „maps inaccessible cards" bez asercji `user_id` (luka)
- `docs/reference/contract-surfaces.md:11-12,18-25,35-50` — wiążący rejestr tras + reguła „PROTECTED_ROUTES nie chroni `/api/**`"
- `context/foundation/prd.md:98-102` — §Access Control (oracle)
- `context/foundation/test-plan.md:44,46,62,64,78,120,197-198,210` — wiersze ryzyk #2/#4, response guidance, faza 2, bramka CI, §7

## Architecture Insights

- **Dwie warstwy, dwa ryzyka, jeden folder zmiany.** #4 (bramka sesji) = middleware, jedno
  miejsce, `getUser()`. #2 (izolacja) = RLS w bazie, klucz anon, nigdy service_role. Testy #4 są
  hermetyczne (fixture sesji: present / absent / invalid). Testy #2 wymagają realnego Postgresa
  (pgTAP) + opcjonalnie integracji na realnej bazie; hermetyczny test trasy to tylko straż
  regresyjna filtra.
- **„Filtr `user_id` w kodzie to wygoda, nie zabezpieczenie"** — doktryna z
  `flashcards-schema-isolation/plan.md:13`, powtórzona w komentarzach 3 plików. Konsekwencja:
  test #2 musi celować w RLS, a nie w filtr aplikacyjny — inaczej jest mirror-testem.
- **Asymetria strony/endpointy jest kontraktem, nie bugiem** (`contract-surfaces.md:46`).
  Oracle dla stron: redirect 3xx na login. Oracle dla endpointów: „brak danych + odmowa"
  (kod 401 to wybór implementacji, nie wymóg PRD — Ambiguity A).
- **`getUser()` (nie `getSession()`) to właściwy wybór serwerowy** — walidacja tokenu z serwerem
  auth. To pokrywa face „wygasła sesja" bez ćwiczenia mechanizmu wygasania dostawcy (§7 granica).
- **RLS chroni wiersze, nie DDL/`TRUNCATE` i nie referencje FK.** Trzy luki rezydualne z tego
  wynikające: `authenticated` ma `TRUNCATE`, FK bez predykatu same-user, brak revoke na poziomie
  schematu.
- **Tautologia w teście izolacji jest łatwa do popełnienia** (F1): asercja odczytu po zapisie
  biegnie pod polityką SELECT asertującego, która i tak ukrywa cudze wiersze. Wzorzec docs
  Supabase: liczyć **zmienione** wiersze (`RETURNING` + CTE) i **osobno** sprawdzić, że wiersz-cel
  jest nietknięty, zakresowo do tego wiersza.
- **pgTAP jako bramka: ad hoc → CI to jednorazowa promocja.** Mechanizm istnieje od Fazy 1;
  Faza 2 dokłada job CI (oddzielny, Docker) i domyka `test-plan.md §6.3/§6.4`.

## Oracle Statements

Wszystkie wywiedzione ze źródeł (PRD §Access Control `prd.md:100`: *„Każdy użytkownik widzi
i zarządza wyłącznie swoimi fiszkami. Niezalogowany użytkownik jest przekierowywany na stronę
logowania."*; `test-plan.md` wiersze/guidance #2/#4; docs Supabase RLS + `@supabase/ssr`) —
**nie** z kształtu implementacji.

### Bramka sesji (#4)

- **O4-1.** Żądanie chronionego ekranu bez ważnej sesji nie renderuje tego ekranu — kieruje
  użytkownika na stronę logowania (redirect 3xx na trasę logowania). *(PRD §Access Control;
  test-plan #4.)*
- **O4-2.** Żądanie chronionego endpointu bez ważnej sesji nie zwraca ani danych użytkownika,
  ani chronionego zasobu — zwraca przekierowanie **albo** jawną odmowę. *(test-plan.md:64;
  change.md:13-17. Kod realizuje odmowę jako 401 JSON — konkretny kod to wybór implementacji,
  patrz Ambiguity A.)*
- **O4-3.** Bramka traktuje „brak sesji", „wygasłą sesję" i „nieprawidłową/sfałszowaną sesję"
  identycznie — wszystkie trzy odmawiają dostępu. *(test-plan.md:64 „zachowanie przy wygasłej
  sesji"; change.md:16; reguła domenowa: wygasły poświadczenie nie jest ważnym poświadczeniem.)*
- **O4-4.** Bramka decyduje z uwierzytelnionej tożsamości, nie z samej obecności ciasteczka —
  żądanie z ciasteczkiem, którego token jest wygasły/naruszony/odwołany, jest traktowane jako
  nieuwierzytelnione. *(Wiedza domenowa: server-side auth waliduje token; wskazówka `@supabase/ssr`
  by używać `getUser()`, nie `getSession()`.)*
- **O4-5.** Każdy ekran czytający lub zapisujący własne dane użytkownika (kolekcja, generowanie,
  sesja przeglądu, dashboard po zalogowaniu) jest za bramką. *(PRD §Access Control;
  `contract-surfaces.md:22-25`; US-01 zakłada „zalogowany użytkownik".)*
- **O4-6.** Każdy endpoint API dotykający danych użytkownika (`POST /api/generations`,
  `POST /api/flashcards`, `PATCH`/`DELETE /api/flashcards/:id`, `GET`/`POST /api/reviews`,
  przyszły `GET /api/flashcards`) **niezależnie** odmawia nieuwierzytelnionemu wywołującemu —
  nie polega na middleware stron. *(`contract-surfaces.md:35-50`; test-plan #4 założenie do
  podważenia: „ekran renderuje login, więc endpoint też jest chroniony".)*
- **O4-7.** Zbiór tras egzekwowanych przez bramkę dokładnie pokrywa się ze zbiorem tras
  udokumentowanych jako chronione — żaden chroniony ekran nie jest osiągalny przez pominięcie
  na liście, żaden endpoint dotykający danych nie jest niebramkowany. *(`contract-surfaces.md:11-12`
  „Rozjazd między tabelą a kodem to błąd"; test-plan.md:64 „pełna lista tras".)*
- **O4-8.** Strona logowania, rejestracji, powrotu z potwierdzenia maila, landing publiczny,
  endpointy `/api/auth/*` i statyczne assety pozostają osiągalne bez sesji. *(`contract-surfaces.md:18-25`;
  FR-001/FR-002; konieczność funkcjonalna.)*
- **O4-9.** Po zniszczeniu sesji przez użytkownika (wylogowanie) kolejne żądanie dowolnego
  chronionego ekranu znów kieruje na logowanie. *(FR-002; manual check app-shell `plan.md:154`.)*
- **O4-10.** Testy tego ryzyka ćwiczą **naszą** decyzję bramkującą ze stanem sesji podanym jako
  fixture (present / absent / invalid) — nie napędzają realnej rejestracji, logowania, refresh
  ani wygasania dostawcy. *(test-plan.md:210 §7; antywzorzec #4.)*

### Izolacja danych (#2)

- **O2-1 (Read).** Żądanie uwierzytelnione jako użytkownik B zwraca **zero** wierszy `flashcards`
  i `generations` należących do A — dla każdej ścieżki odczytu (lista, pojedynczy wiersz,
  filtrowany, złączony). *(PRD §Access Control; test-plan #2.)*
- **O2-2 (Write — UPDATE).** Żądanie jako B próbujące zaktualizować dowolny wiersz `flashcards`
  lub `generations` należący do A zmienia **zero wierszy**, a wiersz A jest bajt-w-bajt
  niezmieniony. Musi to obowiązywać niezależnie od polityki SELECT (tj. nawet gdy aplikacja
  wyśle UPDATE bez predykatu `user_id`). *(PRD „zarządza wyłącznie swoimi"; test-plan #2 „także
  wtedy, gdy warstwa aplikacji zawiedzie"; docs Supabase.)*
- **O2-3 (Write — DELETE).** Jak O2-2 dla DELETE. *(jw.)*
- **O2-4 (Insert impersonation).** INSERT do `flashcards` lub `generations` z `user_id` innym niż
  `auth.uid()` wywołującego jest **odrzucony błędem 42501** (naruszenie `WITH CHECK`). *(PRD;
  docs Supabase.)*
- **O2-5 (Ownership niezmienne).** UPDATE przez A własnego wiersza zmieniający `user_id` na innego
  użytkownika jest **odrzucony** (`WITH CHECK` na polityce UPDATE). *(docs Supabase — UPDATE
  potrzebuje USING i WITH CHECK; `flashcards-schema-isolation/plan.md:139`.)*
- **O2-6 (RLS enabled, default-deny).** RLS jest `ENABLED` na obu tabelach; z kluczem
  anon/publishable i bez pasującej polityki API nie wystawia żadnych wierszy. *(docs Supabase.)*
- **O2-7 (`anon` bez dostępu i bez destrukcji).** Rola `anon` nie może ani czytać, ani pisać,
  ani `TRUNCATE` żadnej z tabel. *(PRD; docs Supabase — granty przed RLS, RLS nie chroni
  `TRUNCATE`; impl-review F2.)*
- **O2-8 (`authenticated` bez destrukcji table-wide).** Żaden uwierzytelniony użytkownik nie może
  `TRUNCATE public.flashcards` ani `public.generations`. **⚠ Ambiguity #1** — dziś `authenticated`
  prawdopodobnie trzyma `TRUNCATE` (F2 potwierdził lokalnie, nigdy nie odebrano). **Zatrzymać
  się i potwierdzić**, czy O2-8 obowiązuje, czy jest świadomie odroczone, przed pisaniem testu.
- **O2-9 (izolacja przeżywa `SECURITY INVOKER`).** `recount_generation_acceptance` wołane przez B
  na generacji A nie czyta ani nie modyfikuje wiersza A. `anon` nie może w ogóle `EXECUTE`.
  *(asercja 8 recount jako executable spec; semantyka `security invoker`.)*
- **O2-10 (integralność referencyjna nie przekracza kont).** Fiszka A nie może referować wiersza
  `generations` B przez `generation_id`. **⚠ Ambiguity #3** — FK nie ma predykatu same-user, RLS
  tego nie egzekwuje, dziś broni tylko app (`service.ts:66-68`). **Potwierdzić zakres** przed
  asercją na poziomie DB.
- **O2-11 (`service_role` poza ścieżką żądania).** Aplikacja uwierzytelnia się do Postgresa
  wyłącznie jako `anon`/`authenticated` (klucz sesji), nigdy `service_role`. *(deployment-plan.md:62;
  `flashcards-schema-isolation/plan.md:13`.)* Warunek brzegowy, nie testowalny oracle DB.
- **O2-12 (regresja bramkowana w CI).** Suite pgTAP polityk biegnie na **każdym PR** (nie tylko
  `npm run db:test` na maszynie dewelopera). *(test-plan.md §5 „required after §3 Phase 2";
  ta zmiana.)*
- **O2-13 (dowód mierzy zmienione wiersze).** Test pgTAP mierzy **zmienione** wiersze, nie
  wiersze widoczne dla asertującego — test, który zostaje zielony po usunięciu testowanej
  polityki `update`/`delete`, nie spełnia tego ryzyka; każdy zablokowany zapis jest sparowany
  z osobnym sprawdzeniem, że wiersz-cel jest nietknięty. *(impl-review F1; docs Supabase;
  antywzorzec #2 test-planu.)*
- **O2-14 (test hermetyczny nie stubuje RLS na wylot).** Hermetyczny test trasy dla tego ryzyka
  nie stubuje klienta DB tak, że żadna polityka się nie wykonuje — sygnał cross-account
  przychodzi z realnej bazy (pgTAP w CI). *(test-plan.md:62 antywzorzec.)*

## Historical Context (from prior changes)

- **`context/archive/2026-08-24-flashcards-schema-isolation/`** — powstanie schematu + RLS.
  Przegląd implementacji: **8 ustaleń, 8/8 naprawionych** (0 critical, 5 warnings, 3 obs).
  - **F1** (`reviews/impl-review.md:43-55`) — asercje RLS `update`/`delete` tautologiczne;
    przechodziły nawet po usunięciu polityk. Naprawa: CTE `returning 1` liczące zmienione wiersze.
  - **F2** (`:57-74`, HIGH) — `anon` zachował `TRUNCATE`/`TRIGGER`/`REFERENCES`; pgTAP dla `anon`
    testował stan grantów instancji, nie RLS. Naprawa: migracja
    `20260825120802_revoke_anon_table_privileges.sql` **wypchnięta na produkcję 2026-08-25** —
    to „migracja cofająca przywileje już po wdrożeniu" z `test-plan.md:44`. **Otwarte:**
    `authenticated` wciąż trzyma te przywileje; stan cloud nieweryfikowany automatycznie.
  - **F3** — `expectTypeOf` **nie jest egzekwowane przez `npm test`** (Vitest bez `--typecheck`),
    tylko przez `astro check` w CI.
  - **F4** — `status: done` przy 6 niepotwierdzonych krokach manualnych; krok „zmutuj politykę →
    czerwony test" był load-bearing (F1 pokazał empirycznie koszt pominięcia).
  - RLS policy contract: `plan.md:129-141` — wszystkie `to authenticated`, wzorzec nazw
    `<tabela>_<operacja>_own`, „bez `with check` da się przepisać cudzy `user_id`".
- **`context/archive/2026-08-25-first-gated-generation/`** — pierwszy endpoint domenowy ustalił
  konwencję: JSON zamiast redirectu, jawne `locals.user` → 401, walidacja Zodem, `{ error: string }`.
  `research.md:64`: „`PROTECTED_ROUTES = ["/dashboard"]` … każdy endpoint domenowy musi sam
  sprawdzić `locals.user` i zwrócić 401." `research.md:313`: „FK `generation_id` **nie** przechodzi
  przez RLS — tam izolację trzeba dopisać ręcznie" (kod wysłany opiera się jednak na RLS przez
  filtrowany SELECT, nie na jawnym `.eq("user_id")` — Ambiguity #3).
- **`context/archive/2026-08-26-app-shell-navigation/`** — APPROVED, 0 findings. `AppLayout`
  „nie wykonuje własnego pobierania użytkownika ani przekierowania; te obowiązki pozostają
  w middleware". Manual check (passed): „ponowne wejście bez sesji na każdą chronioną trasę
  prowadzi do logowania".
- **`context/archive/2026-09-02-testing-generation-error-contract/`** (Faza 1 rolloutu) —
  dwuwarstwowa strategia (hermetyczny unit → integracja trasy → komponent → pgTAP → mutacja →
  cookbook). Wzorzec `context()` kopiowany do pliku, `SupabaseStub` pozycyjny, `vi.mock("astro:env/server")`
  jednolinijkowy. pgTAP i Stryker jako bramki **ad hoc** — „wpięcie do CI to §3 Faza 2".
- **`context/foundation/lessons.md`** — „Metryka deklarowana przez klienta nie jest metryką"
  (`edited`/`source` z ciała żądania zasilają liczniki KPI, których serwer nie potrafi podważyć).
  „Osierocony wiersz `pending` po podwójnej awarii generowania" (placeholder — reguła niedomknięta).
  Kontekst dla O2-6/O2-9: integralność liczników `generations` to instrument pomiaru kryterium 75%.

## Related Research

- `context/archive/2026-09-02-testing-generation-error-contract/research.md` — Faza 1; substrat
  testowy, blokada `astro:env/server`, granice `SupabaseStub`, pgTAP jako bramka ad hoc.
- `context/archive/2026-08-25-first-gated-generation/research.md` — geneza bramki dostępu,
  `App.Locals`, „izolacja żyje w bazie", FK poza RLS.

## Open Questions

Do rozstrzygnięcia z właścicielem **przed** `/10x-plan` (oracle rules: gdy źródła nie
rozstrzygają — zatrzymać się i zapytać):

1. **Kod odpowiedzi dla próby cross-account.** PRD nie mówi 403 vs 404. Kod zwraca **404**
   (`"Nie znaleziono fiszki"`), zgodnie z normą „nie ujawniaj istnienia" i
   `manual-card-edit-delete/plan.md:67`. Potwierdzić, że to zamierzone, nie przypadkowe —
   i czy oracle ma asertować konkretny kod.
   *Resolved in plan.md (2026-09-04):* 404 + `{ error: "Nie znaleziono fiszki." }` przypięte jako
   kontraktowa straż powierzchni (Q1), z jawnym komentarzem „nie oracle izolacji".
2. **Status endpointu bez sesji: 401 vs redirect.** PRD §Access Control mówi tylko
   „przekierowywany na stronę logowania" i nie wspomina API/XHR. test-plan sankcjonuje
   „przekierowanie **albo** odmowę". Oracle może asertować „brak danych + odmowa"; **nie** może
   asertować „musi być redirect" ani „musi być dokładnie 401" z samego PRD.
   *Resolved in plan.md (2026-09-04):* oracle to „brak danych + odmowa" (O4-2/O4-6); 401 przypięte
   jako kontraktowa straż (Q2), nie jako wymóg PRD.
3. **`authenticated` trzyma `TRUNCATE` (O2-8)** — bug do naprawy (dodać `revoke`) czy stan
   zaakceptowany? F2 zostawił to otwarte.
   *Resolved in plan.md (2026-09-04):* bug do naprawy — Faza 2 change #4 dodaje migrację
   `revoke truncate,trigger,references … from authenticated`, pinowaną asercją pgTAP.
4. **Same-user `flashcard ↔ generation` (O2-10)** — gwarancja DB czy egzekwowanie app-layer
   wystarcza? first-gated-generation research mówił „dopisać ręcznie", kod opiera się na RLS.
   Czy oracle wymaga dodania `.eq("user_id", userId)` do lookupu `service.ts:64-69`
   (defense-in-depth, spójne z każdą inną ścieżką mutacji)?
   *Resolved in plan.md (2026-09-04):* app-layer + RLS wystarcza; Faza 3 change #5 dodaje
   `.eq("user_id", userId)` do lookupu; predykat same-user na FK → §7 deferral.
5. **`src/pages/deck.astro` bez filtra własności w app** — jeśli doktryna to ściśle „RLS jedynym
   mechanizmem", jest spójne; jeśli zespół chce jednolitości belt-and-suspenders, to rozjazd
   do zgłoszenia. Który standard trzyma oracle?
   *Resolved in plan.md (2026-09-04):* doktryna „RLS jedynym mechanizmem" trzyma — `deck.astro`
   zostaje bez filtra; pgTAP dowodzi, że RLS to pokrywa.
6. **Czy testy route-level (hermetyczne) mają asertować obecność `.eq("user_id", …)`** w filtrach
   (jak `reviews.test.ts:107-111` dla grade)? To przypina detal implementacji — ale wg O2-13/O2-14
   realny sygnał to pgTAP + integracja na realnej bazie, a asercja hermetyczna to tylko tania
   straż regresyjna. Czy ta straż należy do oracle, czy jest jawnie poza (ryzyko mirror-testu)?
   *Resolved in plan.md (2026-09-04):* tak, ale wyłącznie jako etykietowana straż regresyjna
   (komentarz „cross-account proof is pgTAP"), nie jako oracle izolacji (Q6, O2-14).
7. **Zachowanie wysp klienckich na 401 (mid-session expiry)** — dziś inline error, brak nawigacji
   na `/auth/signin`. Żadne źródło nie mówi, czy „przekierowywany na stronę logowania" obejmuje
   XHR w SPA. Flag, nie asercja.
   *Resolved in plan.md (2026-09-04):* nie asertowane — §7 deferral (żadne źródło nie rozstrzyga SPA XHR).
8. **Parytet grantów lokalne ↔ cloud** — brak automatycznego sprawdzenia, że pushnięty projekt
   cloud ma te same granty `anon`/`authenticated` co migracje. Faza 2 może chcieć check albo
   jawną notę „poza zakresem".
   *Resolved in plan.md (2026-09-04):* poza zakresem — §7 deferral (brak sekretu cloud w CI);
   migracje przywilejów wypychane ręcznie `supabase db push`.
9. **Robustność dopasowania ścieżki** — bramka to surowe `pathname.startsWith(prefix)` bez
   normalizacji (case, encoded, `//`). Żadne źródło nie mówi, czy warianty muszą też być
   bramkowane. Kandydat na edge case, nie wywiedziony oracle.
   *Resolved in plan.md (2026-09-04):* nie testowane ani hardenowane — §7 deferral.
