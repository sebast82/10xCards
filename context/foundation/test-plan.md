# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-07

## 1. Strategy

Testy w tym projekcie podlegają trzem nienegocjowalnym zasadom:

1. **Koszt × sygnał.** Wygrywa najtańszy test, który daje realny sygnał dla
   danego ryzyka. Nie awansuj testu do e2e dlatego, że e2e „wydaje się
   bezpieczniejsze". Nie stawiaj modelu wizyjnego nad deterministycznym
   porównaniem, które łapie tę samą regresję.
2. **Obawy użytkownika są dowodem pierwszej kategorii.** Ryzyko zakotwiczone
   w „zespół obawia się X, a awaria wypłynęłaby gdzieś w obszarze Y" waży
   tyle samo, co linia PRD czy dane o churnie.
3. **Ryzyka to scenariusze, nie lokalizacje w kodzie.** Ten plan opisuje
   _co może zawieść_ i _dlaczego uważamy to za prawdopodobne_ — na podstawie
   dokumentów, wywiadu i _sygnału_ z bazy kodu (churn, struktura, stan bazy
   testów). Nie twierdzi, że wie, która linia odpowiada za awarię. Tę wiedzę
   produkuje `/10x-research` w ramach każdej fazy rolloutu. Jeśli plan i
   research nie zgadzają się co do tego, gdzie mieszka awaria, prawdą
   gruntową jest research.

Zakres hot-spot użyty do ważenia prawdopodobieństwa: `src/` (wykluczone:
`docs/`, `context/`, `dist/`, `node_modules/`, lockfile).

## 2. Risk Map

Najważniejsze scenariusze porażki, przed którymi projekt musi się bronić,
uporządkowane wg ryzyka = impact × likelihood. Ryzyka są opisane w kategoriach
użytkownika i biznesu, nie jako nazwy testów. Kolumna Source cytuje _dowód,
który wyniósł to ryzyko na wierzch_ — nigdy konkretnego pliku jako „miejsca,
gdzie mieszka awaria" (to zadanie researchu, patrz §1 zasada #3).

| #   | Ryzyko (scenariusz porażki)                                                                                                                                                                           | Impact | Likelihood | Source (dowód — nie kotwica)                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dostawca modelu zwraca zły kształt odpowiedzi, timeout albo limit, a użytkownik widzi pustą listę propozycji zamiast rozróżnialnego błędu — nie wie, czy problem jest w jego tekście, czy w aplikacji | High   | High       | interview Q1 (główna obawa), interview Q4; PRD §User Stories US-01, §Functional Requirements FR-003; hot-spot dir `src/lib/openrouter/` (9 commits/30d)                                                                                                                     |
| 2   | Użytkownik odczytuje albo modyfikuje fiszkę należącą do innego konta — sprawdzane jest „czy zalogowany", a nie „czy właściciel" (abuse / IDOR)                                                        | High   | Medium     | PRD §Access Control; `context/archive/2026-08-24-flashcards-schema-isolation/` (przegląd implementacji: 8 ustaleń, w tym migracja cofająca przywileje już po wdrożeniu); hot-spot dir `src/pages/api/` (14 commits/30d); testy polityk bazy istnieją, ale nie są krokiem CI |
| 3   | Sesja powtórkowa gubi albo psuje stan harmonogramu — ocena nie zapisuje się lub wyznacza bezsensowny termin, a użytkownik po cichu traci postęp nauki                                                 | High   | Medium     | PRD §Success Criteria §Guardrails, FR-009; roadmap F-01 (kontrakt stanu harmonogramu); hot-spot dirs `src/lib/srs/` (8 commits/30d), `src/components/review/` (7 commits/30d)                                                                                               |
| 4   | Wylogowany albo niezalogowany użytkownik dosięga chronionego ekranu lub endpointu zamiast zostać przekierowanym na logowanie                                                                          | High   | Medium     | PRD §Access Control („niezalogowany użytkownik jest przekierowywany na stronę logowania"); hot-spot dirs `src/pages/` (17 commits/30d), `src/components/auth/` (8 commits/30d)                                                                                              |
| 5   | Wklejony tekst źródłowy przeżywa żądanie, które go przetworzyło — trafia do trwałego zapisu, logu albo treści błędu                                                                                   | High   | Low        | PRD §Non-Functional Requirements (tekst źródłowy nie pozostaje w storage po zakończeniu operacji); hot-spot dirs `src/lib/openrouter/` (9 commits/30d), `src/pages/api/` (14 commits/30d)                                                                                   |
| 6   | Liczniki akceptacji generacji rozjeżdżają się ze stanem kolekcji po edycji albo usunięciu fiszki — kryterium sukcesu „75%" raportuje liczbę, której nie da się odtworzyć z danych                     | Medium | Medium     | `context/foundation/lessons.md` §„Metryka deklarowana przez klienta nie jest metryką"; PRD §Success Criteria §Primary                                                                                                                                                       |

Ryzyko #5 jest High × Low: wysoka szkoda przy stabilnej powierzchni. Zostaje
w mapie, a nie w obserwowalności, bo jest sprawdzalne pojedynczą asercją na
efekty uboczne w tym samym teście, który i tak powstanie dla #1 — koszt
krańcowy. Awarie po stronie dostawców jako takie (niedostępność usługi
modelu czy bazy) nie mają własnego wiersza: to obserwowalność, a ich
testowalna część — czysty błąd i brak zapisu — jest już pokryta przez #1 i #5.

### Risk Response Guidance

| Risk | Co dowodzi ochrony                                                                                                                                          | Trzeba podważyć                                                                                                         | Kontekst do ugruntowania przez `/10x-research`                                                                                                   | Najtańsza prawdopodobna warstwa                            | Antywzorzec do uniknięcia                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| #1   | Dla każdej klasy awarii dostawcy użytkownik dostaje rozróżnialny, nie-pusty komunikat, a do kolekcji nie trafia żadna propozycja                            | „HTTP 200 od dostawcy znaczy poprawne fiszki"; „pusta odpowiedź znaczy, że w tekście nie było treści"                   | granica HTTP do dostawcy, translacja awarii na odpowiedź endpointu, kontrakt kształtu propozycji, źródło prawdy oczekiwanego kształtu            | integration na trasie API + unit na warstwie parsowania    | asercja przepisana z implementacji parsera zamiast z kontraktu (oracle problem); wyłącznie happy path        |
| #2   | Żądanie z sesją użytkownika B nie odczytuje ani nie zmienia rekordu użytkownika A — i pozostaje to egzekwowane także wtedy, gdy warstwa aplikacji zawiedzie | „polityka bazy jest włączona, więc endpoint nie musi sprawdzać własności"                                               | kształt sesji i klienta bazy w żądaniu, gdzie kończy się kontrola aplikacji a zaczyna polityka bazy, wszystkie ścieżki modyfikacji rekordu       | integration na trasie API + testy polityk bazy wpięte w CI | zamockowanie klienta bazy tak, że polityka nigdy się nie wykonuje                                            |
| #3   | Po ocenie stan harmonogramu fiszki zmienia się deterministycznie i trwale; powtórna ocena tej samej fiszki nie tworzy stanu sprzecznego                     | „biblioteka jest przetestowana, więc harmonogram działa" — przedmiotem testu jest własny kontrakt stanu, nie biblioteka | co dokładnie sesja zapisuje przy ocenie, jak wybierane są fiszki należne, granice czasu i strefy czasowej, zachowanie dla fiszek ręcznych i z AI | unit na kontrakcie stanu + integration na endpoint sesji   | odtworzenie wzoru biblioteki w asercji zamiast oczekiwania z kontraktu; kruche założenie o kolejności fiszek |
| #4   | Żądanie bez ważnej sesji nigdy nie zwraca danych ani chronionego ekranu — zwraca przekierowanie albo odmowę                                                 | „ekran renderuje login, więc endpoint też jest chroniony"                                                               | punkt wejścia bramkowania, zachowanie przy wygasłej sesji, pełna lista tras uznanych za chronione                                                | integration + jeden przebieg e2e                           | testowanie mechanizmu logowania dostawcy zamiast własnego bramkowania (patrz §7)                             |
| #5   | Po zakończeniu generowania żaden trwały zapis ani treść błędu nie zawiera wklejonego tekstu                                                                 | „nie zapisujemy go, bo nie ma takiej kolumny" — sprawdzić także logi i ciała odpowiedzi błędu                           | co faktycznie trafia do bazy przy generowaniu, co wchodzi w odpowiedź błędu, co jest logowane                                                    | integration z asercją na efekty uboczne                    | asercja wyłącznie na kod odpowiedzi, bez sprawdzenia stanu po operacji                                       |
| #6   | Liczniki generacji dają się odtworzyć z aktualnego stanu kolekcji także po edycji i po usunięciu fiszki                                                     | „licznik się zwiększył, więc jest poprawny"                                                                             | źródło prawdy licznika, moment jego aktualizacji, zachowanie przy usunięciu i przy edycji już zaakceptowanej fiszki                              | testy procedur bazy (recount) + integration                | asercja skopiowana z tej samej logiki, która licznik ustawia                                                 |

## 3. Phased Rollout

Każdy wiersz to odrębna faza rolloutu, która otworzy własny folder zmiany
przez `/10x-new`. Status przesuwa się od lewej do prawej po wartościach
poniżej; orchestrator aktualizuje Status w miarę pojawiania się artefaktów
na dysku.

| #   | Phase name                            | Goal (one line)                                                                                                                       | Risks covered                                                               | Test types                               | Status   | Change folder                                         |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------- | -------- | ----------------------------------------------------- |
| 1   | Kontrakt błędów generowania           | Każda klasa awarii dostawcy kończy się rozróżnialnym błędem i zerem zapisów, a tekst źródłowy nie przeżywa żądania                    | #1, #5                                                                      | unit + integration                       | complete | `context/changes/testing-generation-error-contract/`  |
| 2   | Bramka dostępu i izolacja danych w CI | Własność rekordu jest egzekwowana i na trasie API, i w polityce bazy — a testy polityk przestają być testami, których nikt nie odpala | #2, #4                                                                      | integration + testy polityk bazy + gates | complete | `context/changes/testing-access-gate-data-isolation/` |
| 3   | Integralność harmonogramu i liczników | Ocena w sesji zmienia stan deterministycznie i trwale, a liczniki generacji dają się odtworzyć ze stanu kolekcji                      | #3, #6                                                                      | unit + integration + testy procedur bazy | complete | `context/changes/testing-schedule-counter-integrity/` |
| 4   | E2E krytycznej pętli                  | Jedna ścieżka logowanie → kolekcja → sesja powtórkowa przechodzi automatycznie na każdym PR (noga generowania rozcięta — patrz §7)    | #3 (tylko obserwowalny skutek), #4 (przez `protected-routes.guest.spec.ts`) | e2e + gates                              | complete | `context/changes/testing-e2e-critical-loop/`          |

**Status vocabulary** (fixed — parser literals): `not started`, `change opened`,
`researched`, `planned`, `implementing`, `complete`.

## 4. Stack

Klasyczna baza testowa tego projektu. Rekomendacje są ugruntowane w lokalnych
manifestach i konfiguracjach oraz w MCP faktycznie wystawionych w bieżącej
sesji.

| Layer                               | Tool                                         | Version     | Notes                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | -------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration                  | Vitest                                       | 4.1         | `environment: node`, alias `@` → `src/`; testy komponentów przełączają się na jsdom dyrektywą per-plik                                                                                                                                                                                                                                                                                         |
| komponenty React                    | Testing Library + user-event                 | 16.3 / 14.6 | jsdom 30 obecny w devDependencies                                                                                                                                                                                                                                                                                                                                                              |
| walidacja wejścia                   | Zod                                          | 4.4         | schematy są częścią kodu produkcyjnego — testy asertują zachowanie przy złym wejściu, nie definicję schematu                                                                                                                                                                                                                                                                                   |
| polityki i procedury bazy           | pgTAP przez Supabase CLI (`npm run db:test`) | CLI 2.117   | 5 suit w `supabase/tests/` (w tym `review_queue.test.sql` — kolejka powtórek, dodana w Fazie 3); **krok CI** — job `db-tests` (PR-only; **required status check** gałęzi `master` od 2026-09-08), patrz §6.4. Pin `supabase/setup-cli` = `2.117.0` w obu jobach; checked: 2026-09-07                                                                                                           |
| API mocking (granica HTTP dostawcy) | none yet — see §3 Phase 1                    | —           | wybór narzędzia należy do `/10x-research` Fazy 1; wymóg: mockowanie wyłącznie na granicy sieci, nigdy modułów wewnętrznych                                                                                                                                                                                                                                                                     |
| e2e                                 | Playwright (`npm run test:e2e`)              | 1.63.0      | projekt `setup` + `storageState` (jednorazowe logowanie przez prawdziwy formularz), Chromium-only, `workers: 1`; **`page.route` NIE sięga wywołania OpenRoutera** — idzie ono z runtime'u serwera Astro, nie z przeglądarki (`src/lib/openrouter/client.ts:6`), więc klas awarii dostawcy nie da się symulować w e2e; zostają przy Fazie 1 (§6.1, §6.2, §7). Wzorce: §6.6; checked: 2026-09-07 |
| accessibility                       | brak dedykowanego runnera                    | —           | poza zakresem tego rolloutu; `eslint-plugin-jsx-a11y` działa jako bramka statyczna                                                                                                                                                                                                                                                                                                             |
| (optional) AI-native                | brak — świadomie odrzucone                   | n/a         | Kiedy NIE używać: gdy warstwa deterministyczna łapie tę samą regresję taniej i powtarzalnie. Tak jest tutaj dla przeglądu wizualnego — patrz §7                                                                                                                                                                                                                                                |

**Stack grounding tools (current session):**

- Docs: Context7 — sprawdzone: wzorzec projektu `setup` + `storageState` oraz przechwytywanie żądań przez `page.route` w Playwright; checked: 2026-09-02
- Search: WebSearch / WebFetch — dostępne, nieużyte (dokumentacja pierwotna wystarczyła); checked: 2026-09-02
- Runtime/browser: Playwright MCP — **niedostępny**; ale CLI Playwrighta jest zainstalowane i używane (`npx playwright`, `npm run test:e2e:ui`, `npm run test:e2e:report`), więc ścieżka „napędź przeglądarkę i zobacz prawdziwy DOM" jest dostępna — Faza 4 z niej skorzystała przy ustalaniu lokatorów. Nie trzeba ich zgadywać z lektury kodu; checked: 2026-09-07
- Provider/platform: brak MCP GitHub / Supabase / Cloudflare; dostępne są CLI `gh`, `supabase`, `wrangler` — bramki CI opierają się na nich, nie na MCP; checked: 2026-09-02

## 5. Quality Gates

Pełen zestaw bramek, które muszą przejść, zanim zmiana trafi na produkcję.
„Required after §3 Phase N" znaczy, że bramka jest egzekwowana od momentu,
gdy ta faza rolloutu wyląduje; wcześniej ma status planowany.

| Gate                                      | Where                    | Required?                                            | Catches                                                                                                                                                                      |
| ----------------------------------------- | ------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lint                                      | local (pre-commit) + CI  | required                                             | dryf stylu oraz reguł a11y i react-hooks                                                                                                                                     |
| typecheck (`astro check`)                 | CI                       | required                                             | dryf typów i kontraktów TS                                                                                                                                                   |
| unit + integration (`vitest run`)         | local + CI               | required                                             | regresje logiki; od §3 Fazy 1 obejmuje klasy awarii dostawcy                                                                                                                 |
| build                                     | CI                       | required                                             | błędy budowania i konfiguracji adaptera                                                                                                                                      |
| testy polityk bazy (`supabase test db`)   | CI on PR                 | **required** od §3 Fazy 2, egzekwowane od 2026-09-08 | regresje izolacji danych między kontami                                                                                                                                      |
| e2e krytycznej pętli (`npm run test:e2e`) | CI on PR                 | **required** od §3 Fazy 4, egzekwowane od 2026-09-08 | zerwana główna ścieżka użytkownika. Zakres = **cały** katalog `tests/e2e/`, nie tylko spec pętli: `seed.spec.ts` i `protected-routes.guest.spec.ts` też czerwienią tę bramkę |
| post-edit hook                            | local (pętla agenta)     | recommended — nie zastępuje CI                       | regresje w momencie edycji; konfiguracja poza zakresem tego planu                                                                                                            |
| pre-prod smoke                            | między merge a produkcją | optional                                             | awarie zależne od środowiska Workers                                                                                                                                         |

**Jak to jest egzekwowane.** Gałąź `master` ma branch protection z trzema required status checks:
`ci` (lint, typecheck, `vitest run`, build), `db-tests` i `e2e`. `enforce_admins` jest włączone,
więc czerwony przebieg blokuje przycisk merge również właścicielowi repo. Konsekwencja, o której
trzeba pamiętać: `db-tests` i `e2e` biegną wyłącznie na `pull_request`, więc commit wypchnięty
**bezpośrednio** na `master` nigdy nie dostanie tych checków i zostanie odrzucony — każda zmiana
idzie przez PR. Stan sprzed 2026-09-08 (bramki biegły, ale nic nie blokowały) opisuje §7.

## 6. Cookbook Patterns

Jak dodawać nowe testy w tym projekcie. Każda podsekcja wypełnia się, gdy
odpowiednia faza rolloutu wyląduje; wcześniej brzmi „TBD — see §3 Phase N".

### 6.1 Dodanie testu jednostkowego

Wzorzec dla granicy HTTP dostawcy i translacji awarii — patrz `src/lib/openrouter/client.test.ts`.

- **Stub tylko na granicy sieci:** `vi.stubGlobal("fetch", vi.fn())`, `vi.unstubAllGlobals()` w `afterEach`.
  Nigdy nie mockuj modułów wewnętrznych (`./parse`, `./prompt`).
- **Fixture z cytowanego ciała docs, nie z kształtu kodu:** komentarz przy fixture podaje URL docs
  (OpenRouter errors-and-debugging / router-metadata), z którego wzięty jest kształt odpowiedzi.
- **Asercje pierwszorzędne są behawioralne:** wzajemna różność i nie-pustość komunikatów klas niosących
  instrukcję, porównywane **między sobą** (`new Set(messages).size === messages.length`), nie równość do
  importu z modułu testowanego. Najwyżej **jeden** lekki test „stała przekazana bez zmiany" na warstwę
  (tu: jeden test kształtu żądania HTTP — URL + metoda + nagłówki w jednej asercji).
- **`it.each` po klasach awarii** dla własności powtarzalnej (brak sentinela ryzyka #5 w `error.message`
  i `JSON.stringify(error)`), jeden sentinel `"SEKRET-"` jako jedyny marker w pliku.
- **Mutanty brzegowe:** po zazielenieniu dodaj przypadki brzegowe wskazane przez Stryker (kotwica regexa,
  strażnik statusu, `?.` vs `.` — patrz §6.7).

### 6.2 Dodanie testu integracyjnego trasy API

Wzorzec „awaria dostawcy → rozróżnialny błąd, zero zapisów, tekst źródłowy nie przeżywa żądania" —
patrz `src/pages/api/generations.test.ts`.

- **Handler wołany jako zwykła funkcja:** `import { POST } from "./generations"`, `context()` kopiowany do
  pliku wg konwencji `src/pages/api/flashcards.test.ts` (`locals` goły literał, prawdziwy `Request`, rzut
  `as never`).
- **Obejście `astro:env/server`** to jedna linia na górze pliku: `vi.mock("astro:env/server", () => …)`
  z obiektem z `vi.hoisted` — getter zamiast stałej pozwala **zmutować klucz między testami** (gałąź 503
  „brak konfiguracji serwera"). Bez zmian w `vitest.config.ts`, bez aliasu, bez fixture.
- **`SupabaseStub` dla efektów ubocznych** (kolejka **pozycyjna**: `select` limit → `insert` rezerwacja →
  `update`), `vi.stubGlobal("fetch")` dla granicy dostawcy.
- **Zero dotknięcia `flashcards`:** `supabase.queries.every(q => q.table !== "flashcards")` **oraz**
  `supabase.rpcCalls` puste — na ścieżce awarii.
- **Zakaz `error.issues`:** `expect(Object.keys(body)).toEqual(["error"])` dla każdego 400.
- **Rozróżnialność przez wzajemną różność** ciał błędu klas niosących instrukcję (porównanie między sobą),
  nie przez równość do importu z modułu trasy.
- **Brak wycieku:** sentinel `"SEKRET-"` w `sourceText`; po ścieżce 502 `JSON.stringify(supabase.queries)`
  i treść odpowiedzi HTTP nie zawierają sentinela; rezerwacja niesie `source_text_hash ~ /^[0-9a-f]{64}$/`
  i `source_text_length`, bez pola z prozą. Osobny test: błąd spoza hierarchii typów → 500 ze stałym
  ciałem, `caught.message` nie przecieka.

### 6.3 Dodanie testu bramkowania dostępu i własności rekordu

Dwie warstwy, dwa wzorce — patrz `src/middleware.test.ts` (bramka sesji) i
`src/pages/api/flashcards/[id].test.ts` (odmowa + straż filtra na trasie).

**Bramka sesji (ryzyko #4) — test hermetyczny middleware:**

- **`SupabaseStub` nie modeluje `.auth`.** Middleware woła `createClient()` z `@/lib/supabase`,
  potem `supabase.auth.getUser()`. Test mockuje cały moduł
  (`vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getUser: … } }) }))`)
  oraz `astro:middleware` (moduł wirtualny) jako tożsamość `defineMiddleware`.
- **Sesja jako fixture, nie mechanizm.** `vi.hoisted` trzyma `{ client, user }`; test ustawia
  `user` na obiekt (obecna), `null` (brak / wygasła / sfałszowana — `getUser()` skleja wszystkie
  trzy) albo `client: "missing"` (misconfig). Nie napędzaj realnej rejestracji/logowania (§7, O4-10).
- **`context` to goły literał** rzutowany `as never`: `url` (`new URL(path, "http://localhost")`),
  `request`, `cookies`, `locals: {}`, `redirect: (loc) => new Response(null, { status: 302, headers: { Location: loc } })`;
  `next = () => new Response("ok")`. `onRequest` wołane bezpośrednio, jak handler trasy.
- **Asercje:** `status` + `headers.get("location")` odpowiedzi oraz `ctx.locals.user`. Każda trasa
  z `PROTECTED_ROUTES` przez `it.each`; reprezentatywne trasy publiczne (`/`, `/auth/*`, `/api/auth/*`,
  `/api/**`) przechodzą bez sesji.
- **Straż zbioru tras (O4-7):** `PROTECTED_ROUTES` wydzielone do `src/lib/auth/protected-routes.ts`
  (jedno źródło dla bramki i testu). Test przypina `expect(PROTECTED_ROUTES).toEqual([...])`
  z komentarzem-lustrem do `docs/reference/contract-surfaces.md` reguła #4 — zmiana idzie parami.

**Własność rekordu na trasie API (ryzyko #2) — straż regresyjna, nie dowód izolacji:**

- **Odmowa bez efektu ubocznego (O4-6):** na ścieżce `user: null` `SupabaseStub` nie zarejestrował
  żadnego `queries` ani `rpcCalls` — handler odmawia przed sięgnięciem po dane.
- **Cross-account = pudło RLS:** symulowane `{ data: null }` z zakresowanego zapytania → 404 ze stałym
  ciałem `{ error: "Nie znaleziono fiszki." }`, `Object.keys(body) === ["error"]` (żadne pole karty nie
  wycieka). Status/ciało przypięte jako **kontraktowa straż powierzchni**, z komentarzem „nie oracle
  izolacji — patrz `supabase/tests/rls_flashcards.test.sql`".
- **Straż filtra własności:** `expect(supabase.queries[n].filters).toContainEqual(["user_id", USER_ID])`
  wzorem `reviews.test.ts:107-111`, z komentarzem „regression guard że zakresowanie nie zniknęło —
  realny dowód cross-account to pgTAP". Hermetyczny stub nie zna RLS (O2-14) — to nie dowód izolacji.

### 6.4 Dodanie testu polityki lub procedury bazy

Wzorzec pgTAP — patrz `supabase/tests/rls_flashcards.test.sql` i `rls_generations.test.sql`.

- **Lokalizacja i nazwa:** `supabase/tests/*.test.sql`; `rls_<tabela>.test.sql` dla polityk RLS,
  `<procedura>.test.sql` dla funkcji.
- **Szkielet:** `begin; select plan(N); … select * from finish(); rollback;`. `plan(N)` ustaw
  **na końcu**, po napisaniu wszystkich asercji — rozjazd wywala `pg_prove` głośno.
- **Przełączenie roli — idiom dwóch instrukcji:** `set local role authenticated;` a potem
  `set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';`. Użytkownicy
  seedowani wprost do `auth.users` jako superuser przed przełączeniem.
- **Uruchomienie:** `npm run db:test` (→ `supabase test db`) lokalnie przeciw `supabase start`.
- **Bramka CI:** job `db-tests` w `.github/workflows/ci.yml`, **tylko na `pull_request`** (osobny
  job — `supabase start` ściąga obrazy ~1-2 min; job `ci` bez Dockera tego nie płaci). `db-tests`
  **jest** required status checkiem gałęzi `master` (od 2026-09-08, razem z `ci` i `e2e`), więc
  czerwony przebieg blokuje przycisk merge — także właścicielowi repo. Uwaga historyczna: między
  Fazą 2 a 2026-09-08 zapis ten był nieprawdziwy, bo branch protection była na prywatnym repo
  niedostępna; §7 opisuje ten okres. Pin `supabase/setup-cli` trzymaj zgodny z jobem `e2e` —
  oba joby czytają ten sam `supabase/config.toml`.
- **Reguła O2-13 (de-konflacja SELECT/write):** asercja cross-account UPDATE/DELETE musi biec
  z polityką SELECT **zneutralizowaną** (`alter policy … using (true)`, cofane przez `rollback`),
  inaczej zostaje zielona po usunięciu _lub osłabieniu_ polityki write (polityka SELECT i tak
  ukrywa cudze wiersze przed odczytem `WHERE`/`RETURNING`). Każdy zablokowany zapis paruj z osobnym
  sprawdzeniem, że wiersz-cel jest bajt-w-bajt nietknięty (jako właściciel / po `reset role`),
  **oraz** z pozytywną asercją „właściciel zapisuje własny wiersz". Podział pracy: _osłabienie_
  polityki write (`using (true)`) czerwieni asercję izolacji; _usunięcie_ polityki write daje
  default-deny (dalej 0 wierszy), więc czerwieni dopiero asercję pozytywną — para jest strażnikiem.
- **Znana luka:** brak automatycznego checku parytetu grantów lokalne ↔ cloud — migracje przywilejów
  (`revoke … from authenticated`) wymagają ręcznego `supabase db push` po merge (§7).

### 6.5 Dodanie testu stanu harmonogramu powtórek

Wzorzec „ocena zmienia stan deterministycznie i trwale, a liczniki dają się odtworzyć ze stanu
kolekcji" — patrz `src/lib/reviews/service.test.ts`, `supabase/tests/review_queue.test.sql`
i `supabase/tests/recount_generation_acceptance.test.sql`.

- **Oracle z własnego wrappera, nie z biblioteki i nie z inline-recompute.** Dla write-payloadu
  `applyReviewGrade` wywołaj `createScheduler().applyGrade(parsedRow, NOW, grade)` **raz** do jednego
  obiektu `expected`, potem `expect(payload).toEqual(scheduleProjection(expected))` po dziewięciu
  polach harmonogramu. Nie licz wartości oczekiwanej per pole tą samą logiką co kod testowany
  (mirror test, §1/§7). Wnętrze arytmetyki `ts-fsrs` zostaje nietknięte — pinujemy plumbing
  row→card→row i „zapisujemy dokładnie to, co policzyliśmy".
- **Fixtury SRS wyprowadzone z realnego modułu**, z nadpisaniem `state`/`reps`:
  `scheduler.applyGrade(scheduler.createNewCard(SEED_NOW), SEED_NOW, Rating.Again)` (Learning,
  `state:1`), `scheduler.applyGrade(REVIEW_ROW, SEED_NOW, Rating.Again)` (Relearning, `state:3`),
  `scheduler.createNewCard(SEED_NOW)` (`reps:0`). Nigdy nie klepiemy wiersza harmonogramu ręcznie.
- **`SupabaseStub` do kształtu**: write-payload (dokładnie 9 kluczy, brak `updated_at`), filtr
  guarda (`filters` zawiera `["reps", previousReps]`). Stub nie modeluje `WHERE due <= now()`, RLS
  ani wyścigu — tego nie asertuj na stubie.
- **pgTAP do semantyki**: `review_queue.test.sql` na realnym wierszu + indeksie `(user_id, due)` +
  RLS — selekcja `due <= now()`, porządek rosnący `due` (niezależny oracle: porządek po `id` przy
  odpowiednim seedzie), sufit 50 wierszy + wykluczenie 51., izolacja kolejki między kontami, oraz
  sekwencja guarda `reps` (świeży guard → 1 wiersz, nieaktualny → 0, legalna druga ocena → 1 wiersz +
  spójny re-parse). `plan(N)` liczony na końcu, ustawiony zaraz po `begin;`. Kotwica-komentarz do
  `src/lib/reviews/service.ts:62-96` i `:132-149` — dryf w łańcuchu `.from()/.eq()/.lte()` łapie
  przegląd, nie automat (§7).
- **`.strict()` na ciele POST** (`src/pages/api/reviews.test.ts`): ciało z dodatkowym `now` → 400,
  `Object.keys(body) === ["error"]`, zero `queries` i `rpcCalls` — serwer jest właścicielem zegara.
- **„Edycja nie rusza licznika" = `rpcCalls` puste** (`src/lib/flashcards/service.test.ts`,
  `src/pages/api/flashcards/[id].test.ts`): udana edycja robi jeden `update` i **zero** `recount`,
  bo `source` jest niezmienne, a liczniki keyują po `source`. To połowa „odtwarzalne po edycji"
  ryzyka #6 (druga połowa — klamra `least()` i krawędzie usuwania — jest w pgTAP `recount`).
- **Klamra `least()` i krawędzie usuwania w `recount_generation_acceptance.test.sql`**: więcej
  fiszek AI niż `generated_count` → `lives_ok` + suma zaklamrowana do `generated_count` (cofnięcie
  do ciała sprzed `20260826141500` czerwieni to); usunięcie ostatniej fiszki AI → `(0,0)`; recount
  na usuniętym zleceniu → `lives_ok` (no-op). Wstaw je **przed** blokiem izolacji, póki sesja jest
  `authenticated` jako właściciel — za blokiem sesja to `postgres` i utrata `security invoker`
  przeszłaby niezauważona. Świeże UUID-y — nie reużywaj generacji, których karty mutują istniejące
  przypadki.

### 6.6 Dodanie testu e2e

Wzorzec bramki dymnej na głównej ścieżce użytkownika — patrz `tests/e2e/critical-loop.spec.ts`,
`tests/e2e/auth.setup.ts` oraz `tests/e2e/seed.spec.ts` (ten sam szkielet w prostszym wydaniu).
Komendy i konfiguracja lokalna są w `README.md` §„End-to-end tests"; tutaj zostają wzorce.

**Kryterium „e2e zamiast integration".** Domyślna odpowiedź brzmi: integration. E2E płaci najwyższą
cenę za sygnał (czas bramki, flake, gorsza diagnostyka), więc bierze wyłącznie to ryzyko, którego
tańsza warstwa nie widzi z definicji — **spojenie między ekranami**: trasy, linki nawigacji,
hydracja wysp, ciasteczka sesji przechodzące przez prawdziwy formularz, i to, czy te rzeczy nadal
się ze sobą łączą. Co da się orzec na jednym handlerze albo module, zostaje w Vitest (§6.2);
własność rekordu i semantyka SQL zostają w pgTAP (§6.4). Test, który mógłby być integracyjny,
a jest e2e, nie jest „bezpieczniejszy" — jest wolniejszy i mówi mniej, gdy zczerwienieje.

**Wielokrotnie używany stan zalogowania.** Projekt `setup` (`tests/e2e/auth.setup.ts`) loguje się
raz na przebieg i zapisuje `storageState` do `playwright/.auth/user.json`; projekt `chromium`
deklaruje `dependencies: ["setup"]` i startuje z gotową sesją. Logowanie idzie **prawdziwym
formularzem**, nie skrótem przez klienta Supabase w przeglądarce: ciasteczka sesji ustawia serwer
w `POST /api/auth/signin`, więc `signInWithPassword` po stronie klienta zapisałby stan, którego
middleware nie zobaczy. Testy roli „niezalogowany" idą osobnym projektem `chromium-guest` — bez
`storageState` i bez `dependencies`, żeby biegły także tam, gdzie nie ma konta testowego.
`auth.setup.ts` niesie też **bramkę środowiska**: brak banera „Supabase nie jest skonfigurowany"
jest asertowany przed wpisaniem loginu, bo dev server startuje `webServer` Playwrighta, a nie krok
CI — żaden krok joba nie złapałby brakującego `SUPABASE_URL`, a objawem byłoby „nie udało się
zalogować" i szukanie winy w koncie testowym.

**Podstawienie odpowiedzi dostawcy — w e2e tego nie robimy.** Uczciwa odpowiedź na pytanie, które
ta sekcja miała rozstrzygnąć: `page.route` nie sięga OpenRoutera, bo wywołanie idzie z runtime'u
serwera Astro (`src/pages/api/generations.ts` → `src/lib/generations/service.ts` →
`src/lib/openrouter/client.ts:6`), a nie z przeglądarki. Podstawienie **własnego** `/api/generations`
też nie działa: sfabrykowany `generationId` nie tworzy wiersza w `generations`, więc następny krok
(`POST /api/flashcards`) dostaje 404 z `src/lib/flashcards/service.ts:66-80`. Klasy awarii dostawcy
zostają na granicy sieci pod Vitestem (§6.1, §6.2). Nie próbuj tego drugi raz — patrz §7.

Wzorce, które ta faza ustanowiła:

- **Zakres po roli, zawsze.** `page.getByRole("region", { name: "Kolekcja fiszek" })`,
  `{ name: "Sesja powtórkowa" }`. Astro serializuje propsy wyspy do `<code>` w dokumencie, więc
  gołe `getByText` na treści fiszki trafia w dwa węzły i wywala strict mode. Odpowiedzią jest
  zawężenie do kontenera po roli plus `{ exact: true }` — **nigdy** `.first()` / `.nth()`
  (`context/foundation/lessons.md` §„Tekst renderowany przez wyspę…"). Brakującą kotwicę dokłada
  się jako zmianę produkcyjną w tej samej zmianie co test (tak powstał `region` „Sesja powtórkowa"),
  a nie obchodzi selektorem CSS.
- **Pierwsza interakcja z wyspą jest ponawialna.** Po `goto()` albo po pełnym przeładowaniu SSR
  wysyła gotowy przycisk, zanim React podepnie handler — Playwright uzna go za actionable i klik
  przepadnie bez śladu, a test padnie dopiero na następnym kroku. Klik i asercja na widoczny skutek
  idą **razem** w `await expect(async () => { … }).toPass()`. Nigdy `waitForTimeout`
  (`context/foundation/lessons.md` §„Pierwsze kliknięcie w wyspę…").
- **Asercja po własnym tekście rekordu, nie po liczniku.** `Karta {n} z {m}` oraz
  `To na dziś wszystko — powtórzono {n} fiszek.` czytają stan całego konta, więc na koncie
  z zaległościami znaczą co innego, niż zakłada test. Asercje idą po `front`/`back` utworzonej
  fiszki, ze stemplem `Date.now()` w treści — to samo daje niekolidujące dane przy ponowieniach.
- **Gdy UI połyka błąd, asertuj status odpowiedzi — przed DOM-em.**
  `src/components/review/ReviewSession.tsx:167` traktuje 409 jak sukces i przesuwa kolejkę, więc
  asercja „sesja poszła dalej" jest spełnialna przez ocenę, **której serwer nie przyjął**.
  Kolejność jest częścią wzorca: `page.waitForResponse(...)` → `expect(status).toBe(200)` →
  dopiero potem asercja o DOM. Ta sama odpowiedź bywa jedynym uchwytem do `id` nowego rekordu.
- **Zapisy w setupie i sprzątaniu: `page.request` + nagłówek `Origin`.** Fixture `request` ma
  własny kontekst sieciowy i nie widzi ciasteczka odświeżonego przez Supabase w trakcie testu,
  a `APIRequestContext` nie dokłada `Origin`, więc bramka origin w Astro zwraca 403. Asercję pisz
  z opisem niosącym status i ciało odpowiedzi (`context/foundation/lessons.md` §„Zapis przez API…").
- **Sprzątanie w hooku czy inline — decyduje trwałość śmiecia.** `seed.spec.ts` sprząta na końcu
  ciała testu i to wystarcza: porzucona fiszka najwyżej zaśmieca `/deck`. `critical-loop.spec.ts`
  sprząta w `test.afterEach`, bo fiszka utworzona przez `/deck` jest wymagalna **natychmiast**
  (`src/lib/flashcards/service.ts` woła `createNewCard(new Date())`) — porzucona przez czerwony
  przebieg wchodzi do kolejki powtórek i wywala warunek wstępny każdego następnego biegu, a
  sprzątania inline nie wykona żadna wcześniejsza nieudana asercja. Reguła: **jeśli osierocony
  rekord zatruwa następny przebieg, sprzątanie idzie do hooka**; jeśli tylko zajmuje miejsce, może
  zostać w ciele testu.
- **Warunek wstępny „kolejka powtórek jest pusta".** `getReviewQueue` sortuje po `due` rosnąco
  (`src/lib/reviews/service.ts:62-70`), a wyspa renderuje wyłącznie `queue[0]`
  (`ReviewSession.tsx:96,295`). Fiszka utworzona przed chwilą ma **najpóźniejszy** `due` w kolejce,
  więc każda zaległa karta zasłania ją całkowicie i asercja padłaby na nieodnajdywalnym lokatorze,
  wskazując na zepsutą aplikację zamiast na brudne konto. Spec sprawdza `GET /api/reviews` **przed
  czymkolwiek innym** i pada z komunikatem wyliczającym zaległe karty. To jedyna kolejka w tym
  projekcie enumerowalna po HTTP — kolekcja nie ma `GET`, dlatego jej stanu spec nie weryfikuje.
- **`workers: 1` to poprawność, nie ostrożność.** Kolejka powtórek jest globalna dla konta, więc
  równoległy `seed.spec.ts` wstawia własną kartę przed kartę `critical-loop.spec.ts` już **po**
  sprawdzeniu warunku wstępnego — okna, w którym kolejka rośnie pod testem, nie da się objąć
  asercją. Suite biegnie ~10 s, więc szeregowanie nic nie kosztuje.
- **Chromium-only.** Aplikacja nie ma ryzyk specyficznych dla silnika, a każdy dodatkowy projekt
  mnoży czas bramki na każdym PR. Dołóż firefox/webkit, gdy pojawi się powód, nie „na wszelki wypadek".

### 6.7 Notatki per faza rolloutu

(Uzupełniane po każdej fazie: 2–3 linie o tym, czego faza nauczyła — np. gdzie wylądowały wspólne dane testowe i co powinno je reużywać.)

**Faza 4 — E2E krytycznej pętli (2026-09-07).**

- Wywołanie OpenRoutera jest **server-side** (`src/lib/openrouter/client.ts:6` w runtime Astro),
  więc `page.route` go nie sięga, a podstawienie własnego `/api/generations` kaskaduje w 404 na
  `POST /api/flashcards`. Pętla została **rozcięta**: e2e bierze `login → deka → powtórka`, noga
  generowania zostaje przy testach granicy sieci z Fazy 1. Zapis w §4 mówiący, że `page.route`
  symuluje klasy awarii dostawcy, był najdroższym błędnym zwrotem tej fazy — skorygowany.
- 409 z `POST /api/reviews` jest połykany przez `ReviewSession.tsx:167` (kolejka przesuwa się jak
  po sukcesie), więc asercja „sesja poszła dalej" jest zielona bez zapisu po stronie serwera. Stąd
  reguła kolejności: status odpowiedzi **przed** DOM-em. To wzorzec dla każdego ekranu, który
  połyka błąd, nie jednorazówka tej sesji.
- Provisioning w CI: lokalny stack (`supabase start`), przechwycenie adresu i klucza przez
  `supabase status -o env --override-name` (udokumentowana forma maszynowa), konto testowe zakładane
  wprost w GoTrue (`POST /auth/v1/signup` — działa, bo `supabase/config.toml:209` ma
  `enable_confirmations = false`, więc ręczny hash bcrypt jest zbędny). Celem jest `astro dev`,
  nie zbudowany worker — luka runtime'u workerd zostaje przy bramce pre-prod smoke (§7). Pin
  `supabase/setup-cli` trzeba było podnieść do `2.117.0` w **obu** jobach: `2.23.4` nie parsuje
  bieżącego `supabase/config.toml` i pada na `supabase start` — `db-tests` jest PR-only, a repo
  nie miało wcześniej żadnego PR-a, więc pin z Fazy 2 wykonał się po raz pierwszy dopiero teraz.
  I pułapka na koniec: `.dev.vars` (adapter Cloudflare, `astro:config:done`) nadpisuje env powłoki
  **lokalnie** i jest gitignorowane, więc zielony przebieg lokalny nie dowodzi podłączenia env w CI.

**Faza 3 — Integralność harmonogramu i liczników (2026-09-04).**

- Fixtury stanu harmonogramu żyją w `src/lib/reviews/service.test.ts` i wyprowadzają się z `@/lib/srs`
  (`scheduler.createNewCard` + `scheduler.applyGrade`) z nadpisaniem `state`/`reps` — Learning/
  Relearning/`reps:0` nie są klepane ręcznie. Wspólny helper `scheduleProjection` pinuje dokładnie
  dziewięć kolumn write-payloadu.
- `review_queue.test.sql` to **pierwszy pgTAP dla kolejki powtórek**. Porządek `due` weryfikuje przez
  niezależny oracle (porządek po `id` przy seedzie, w którym `due` rośnie z indeksem), a nie przez
  porównanie zapytania do samego siebie.
- Semantyka guarda `reps` wymagała realnego wiersza: `SupabaseStub` „modeluje" przegraną tylko przez
  ręcznie podane `{ data: null }` jako drugi wynik — nigdy nie sprawdza, że `reps` faktycznie się
  różni. Sekwencja świeży→nieaktualny→ponowny guard idzie do pgTAP.
- Przypadki `recount` (klamra `least()`, usunięcie ostatniej karty, usunięte zlecenie) wstawione
  **przed** blokiem izolacji w `recount_generation_acceptance.test.sql` — tam sesja jest wciąż
  `authenticated` jako właściciel, więc `security invoker` jest pod testem; za blokiem byłaby
  `postgres`.

**Faza 2 — Bramka dostępu i izolacja danych w CI (2026-09-04).**

- Job `db-tests` jest osobny od `ci` (Docker + `supabase start`, ~1-2 min na pull obrazów),
  `pull_request`-only. `ci` nie płaci kosztu Dockera. (Domknięte 2026-09-08: wpisanie `db-tests`
  w required status checks `master` nie udawało się od Fazy 2, bo branch protection jest niedostępna
  na prywatnym repo bez płatnego planu. Po przełączeniu repozytorium na publiczne bramka została
  wpięta razem z `ci` i `e2e`.)
- `SupabaseStub` nie ma `.auth` — test middleware mockuje cały moduł `@/lib/supabase`
  (`vi.mock` + `vi.hoisted` na sesję jako fixture), a `astro:middleware` jako tożsamość.
- Konflacja F1: asercja „0 zmienionych wierszy" cross-account jest tautologią, dopóki polityka
  SELECT stoi (Postgres egzekwuje ją na odczycie `WHERE`/`RETURNING` UPDATE/DELETE). Nowe asercje
  biegną z SELECT zneutralizowanym (`alter policy … using (true)`, cofane przez `rollback`), więc
  czerwienieją też po _osłabieniu_ (nie tylko usunięciu) polityki write.
- `rls_flashcards` `plan(10)` → `plan(22)`; nowy `rls_generations` `plan(13)`.
- Migracja `revoke truncate,trigger,references … from authenticated` wymaga `supabase db push`
  po merge — RLS nie chroni przed `TRUNCATE` (precedens F2, `20260825120802_…`).

**Faza 1 — Kontrakt błędów generowania (2026-09-03).**

- Wzorzec `stubFetch` + `jsonResponse` jest **zduplikowany** w każdym pliku testowym (`client.test.ts`,
  `generations.test.ts`, `GenerateView.test.tsx`), nie współdzielony — to konwencja projektu (wcześniej
  `ReviewSession.test.tsx`). Nie wyciągaj go do `test-support/` bez decyzji.
- Obejście `astro:env/server` pod Vitestem: **jedna linia** `vi.mock` z `vi.hoisted` na górze pliku.
  Żadnych zmian w `vitest.config.ts`.
- pgTAP dla `public.generations` (`supabase/tests/generations_error_contract.test.sql`) jest **bramką
  ad hoc** — `npm run db:test`, wymaga `supabase start`. Wpięcie do CI to §3 Faza 2.
- Stryker jest **selektywny i ad hoc** — bez devDependency, bez zacommitowanej konfiguracji. Przebieg:
  `npx --yes -p @stryker-mutator/core -p @stryker-mutator/vitest-runner stryker run` z efemeryczną
  `stryker.conf.json` (gitignored, usuwana po). Windows wymaga trzech obejść w konfiguracji:
  `tsconfigFile` na nieistniejący plik, `ignorePatterns` na `.claude`/`context`/`supabase`,
  `vitest.related=false` + zawężony `include` na dwa pliki. Wynik Fazy 1: 85% → 95%.

## 7. What We Deliberately Don't Test

Wyłączenia uzgodnione podczas rolloutu. Kolejni kontrybutorzy respektują je,
dopóki nie zmieni się założenie leżące u ich podstaw.

- **Mechanizm uwierzytelniania dostawcy** (rejestracja, logowanie, wygasanie sesji jako takie) — to kod dostawcy, nie nasz. Testujemy wyłącznie własne bramkowanie: czy nasze trasy odmawiają dostępu bez ważnej sesji (ryzyko #4). Przewartościować, jeśli dojdzie druga metoda logowania. (Źródło: interview Q5.)
- **Jakość merytoryczna fiszek generowanych przez AI** — bramką jest świadoma akceptacja użytkownika, nie asercja. Testujemy kształt odpowiedzi i ścieżki błędu, nie trafność treści. Przewartościować, jeśli pojawi się akceptacja bez przeglądu. (Źródło: interview Q5.)
- **Warstwa AI-native (multimodalny przegląd wizualny, sędzia LLM)** — rozważona i odrzucona pod koszt × sygnał. Deterministyczne porównanie zrzutów w warstwie e2e łapie te same regresje wizualne taniej i powtarzalnie, a jedyny obszar, w którym model dodałby sygnał — ocena treści — jest wyłączony powyżej. Przewartościować, jeśli powstanie powierzchnia nieosiągalna dla DOM albo wróci wymóg oceny treści. (Źródło: challenger pass, 2026-09-02.)
- **Kod generowany i biblioteki zewnętrzne** (wygenerowane typy bazy, wnętrze biblioteki powtórek, komponenty biblioteki UI) — generator i upstream są testem. Testujemy własny kontrakt nad nimi, nie je same. (Źródło: challenger pass, 2026-09-02.)
- **Parytet grantów lokalne ↔ cloud** — brak mechanizmu CI, który zdiffuje granty `anon`/`authenticated` na linkowanym projekcie cloud względem migracji, bez nowego sekretu cloud i narzędzia. Migracje przywilejów wypycha się ręcznie (`supabase db push`) i weryfikuje `supabase db diff`. Przewartościować, jeśli powstanie sekret CI do projektu cloud albo drugi przypadek migracji przywilejów po wdrożeniu. (Źródło: research Open Question 8; rollout Faza 2, 2026-09-04.)
- **Normalizacja ścieżki w bramce sesji** — bramka to surowe `pathname.startsWith(prefix)` bez obsługi wariantów (wielkość liter, `%2e`, `//`, `/deck/../x`). Żadne źródło nie rozstrzyga, czy warianty muszą być bramkowane. Przewartościować, jeśli pojawi się reverse-proxy przepisujący ścieżki albo trasa, której prefiks jest podłańcuchem trasy publicznej. (Źródło: research Open Question 9; rollout Faza 2, 2026-09-04.)
- **Nawigacja wysp klienckich na 401 w trakcie sesji** — `GenerateView` / `ReviewSession` renderują string błędu inline i nie nawigują na `/auth/signin` przy wygaśnięciu sesji w trakcie XHR. Żadne źródło nie mówi, czy „przekierowywany na stronę logowania" obejmuje XHR w SPA. Przewartościować, jeśli PRD doprecyzuje zachowanie SPA albo użytkownicy zgłoszą utknięcie na chronionym ekranie. (Źródło: research Ambiguity B / Open Question 7; rollout Faza 2, 2026-09-04.)
- **Predykat same-user na FK `flashcards.generation_id`** — brak triggera/constraintu wiążącego fiszkę i jej generację z tym samym `user_id` na poziomie DB. Broni tego filtr aplikacyjny (`src/lib/flashcards/service.ts` `.eq("user_id")`, dodany w Fazie 2) plus RLS na obu tabelach. Przewartościować, jeśli powstanie ścieżka zapisu fiszki omijająca `createAiFlashcard` albo audyt wykaże realne podpięcie cross-account. (Źródło: research Open Question 4 / Ambiguity #3; rollout Faza 2, 2026-09-04.)
- **Strefa czasowa w kolejce powtórek** — kolejka porównuje `due <= now()` w UTC po stronie serwera; brak obsługi strefy czasowej klienta. Żadne źródło nie precyzuje zachowania per strefa. Przewartościować, jeśli PRD wprowadzi granicę „dnia nauki" albo użytkownicy zgłoszą karty pojawiające się o złej porze lokalnej. (Źródło: research Open Question 2; rollout Faza 3, 2026-09-04.)
- **Współbieżność `recount` (`for update`)** — blokada jest obecna i przejrzana; jednosesyjny pgTAP nie odtworzy wyścigu równoległych zapisów, a asercja obecności przez `pg_get_functiondef` jest krucha i niskosygnałowa. Przewartościować, jeśli test obciążeniowy odtworzy zaniżanie licznika albo linia blokady zniknie. (Źródło: research Open Question 7; rollout Faza 3, 2026-09-04.)
- **Populacja zagregowanego kryterium „75%"** — w kodzie nie istnieje żadne zapytanie agregujące po `generations`; per użytkownik vs per generacja vs lifetime, oraz czy wiersze `pending`/`failed` się liczą, jest niezdefiniowane. Faza 3 pinuje inwariant `recount` per generacja. Przewartościować, gdy zapytanie metryki sukcesu zostanie faktycznie zaimplementowane. (Źródło: research Open Question 8; rollout Faza 3, 2026-09-04.)
- **Wykonawcza równoważność SQL `applyReviewGrade` ↔ pgTAP** — `review_queue.test.sql` odtwarza ręcznie `select … where due <= now() …` i `update … where id = ? and user_id = ? and reps = ?`, które emituje serwis; wiąże je z `src/lib/reviews/service.ts` tylko komentarz-kotwica, nie wykonanie (pgTAP nie woła TypeScriptu, a nie ma warstwy Vitest przeciw realnemu Postgresowi). Dryf w łańcuchu `.from()/.update()/.eq()`, który nadal buduje poprawny payload (zła tabela, zgubione `.eq("user_id")`, `.lte` → `.eq`), przechodzi obie warstwy — łapie go przegląd, nie automat. Przewartościować, jeśli powstanie harness integracyjny Vitest ↔ Postgres albo `db-tests` zacznie wołać kod serwisu. (Źródło: research Open Question 5; rollout Faza 3, 2026-09-04.)

- **Noga generowania w przeglądarce** — `/generate` nie jest napędzane przez e2e. Wywołanie dostawcy idzie z runtime'u serwera (`src/lib/openrouter/client.ts:6`), więc `page.route` go nie przechwyci; podstawienie własnego `/api/generations` kaskaduje w 404 na `POST /api/flashcards`, bo sfabrykowany `generationId` nie ma wiersza w `generations`. Do tego każdy przebieg zjadałby dobowy limit generacji (`DAILY_GENERATION_LIMIT`, liczony bez filtra po statusie), którego nie da się odzyskać. Przewartościować, jeśli powstanie server-side seam dostawcy — wstrzykiwalny klient, zmienna base-URL albo flaga fake-provider; wtedy noga generowania wraca do bramki. (Źródło: research + rollout Faza 4, 2026-09-07.)
- **Ryzyko #1 w warstwie e2e** — kontrakt błędów generowania dowodzą testy granicy sieci z §3 Fazy 1 (`src/lib/openrouter/client.test.ts`, `src/pages/api/generations.test.ts`), nie przeglądarka. Powstanie bramki e2e nie jest powodem, żeby awansować tam wiersz #1 z §2 — sygnał byłby ten sam, a koszt wielokrotnie wyższy (§1 zasada #1). Przewartościować razem z pozycją powyżej: te same warunki, ta sama decyzja. (Źródło: rollout Faza 4, 2026-09-07.)
- **Ryzyko #2 w warstwie e2e** — własność rekordu dowodzi pgTAP (`supabase/tests/rls_*.test.sql`) mocą decyzji z Fazy 2 (`context/archive/2026-09-03-testing-access-gate-data-isolation/plan.md:159-162`). Po stronie e2e blokerem jest infrastruktura **jednokontowa**: `auth.setup.ts` zapisuje jeden `storageState`, a CI zakłada jedno konto — cross-account wymagałby drugiego konta, drugiego projektu Playwrighta i drugiej pary sekretów. Przewartościować, jeśli pojawi się ryzyko izolacji widoczne wyłącznie w prawdziwej przeglądarce (np. wyciek przez cache po stronie klienta) — dopiero to uzasadnia ten koszt. (Źródło: rollout Faza 4, 2026-09-07.)
- **Arytmetyka harmonogramu w e2e** — spec ocenia fiszkę i asertuje wyłącznie obserwowalny skutek: `POST /api/reviews` zwrócił 200, a karta wyszła z kolejki. Żadnej asercji na `due`, `stability` czy `interval`, ani na treść przycisku oceny (`{etykieta} · {interwał}` niesie dynamiczne wyjście FSRS — dlatego dopasowanie idzie po samej etykiecie). Zabrania jej reguła oracle z §6.5: wartość przeliczona w teście byłaby lustrem implementacji. Dowód kontraktu stanu zostaje w `src/lib/reviews/service.test.ts` i `supabase/tests/review_queue.test.sql`. Przewartościować, jeśli powstanie niezależne źródło prawdy dla oczekiwanego harmonogramu (zamrożone fixtury z decyzji produktowej). (Źródło: rollout Faza 4, 2026-09-07.)
- **Kotwice dostępności na `/generate`** — `/review` dostało w Fazie 4 nazwany `region` („Sesja powtórkowa"), `/deck` miało swój wcześniej („Kolekcja fiszek"); `/generate` nie ma żadnej i teraz jej nie dostaje. Rozcięta pętla nie napędza tego ekranu, a kotwica, której żaden test nie konsumuje, to spekulacyjny dryf w kodzie produkcyjnym. Przewartościować, gdy powstanie test e2e dotykający `/generate` — kotwica idzie wtedy w tej samej zmianie co test, nie wcześniej. (Źródło: rollout Faza 4, 2026-09-07.)
- **Runtime workerd w bramce e2e** — suite biegnie przeciw `astro dev` (Node), nie przeciw zbudowanemu workerowi. Różnice runtime'u Cloudflare (dostępne API, limity, zachowanie adaptera) są poza jej zasięgiem; pokrywa je opcjonalna bramka pre-prod smoke z §5. Przewartościować, jeśli produkcja złapie awarię zależną od workerd, której `astro dev` nie odtwarza — wtedy pre-prod smoke przestaje być opcjonalny. (Źródło: rollout Faza 4, 2026-09-07.)
- **Zachowanie bramki na PR-ach z forków** — nie jest sprawdzone i świadomie nie sprawdzamy tego do pierwszego realnego forka. Job `e2e` jest zawężony do PR-ów z tego samego repozytorium (`head.repo.full_name == github.repository`), bo PR z forka nie dostaje sekretów `E2E_USERNAME`/`E2E_PASSWORD` i strażniki w kroku provisioningu i tak by go zczerwieniły. Od 2026-09-08 `e2e` jest jednocześnie required status checkiem, więc powstaje pytanie, czy GitHub potraktuje **pominięty** job jako spełniony, czy jako wiszący — w drugim przypadku PR z forka nie da się zmergować w ogóle. Nie rozstrzygamy tego z dokumentacji, bo zachowanie required checków dla `skipped` bywało zmieniane; rozstrzygnie pierwszy prawdziwy fork. Przewartościować wtedy: albo dopisać do `e2e` job-zastępnik raportujący sukces dla forków, albo świadomie przyjąć, że PR-y z forków wymagają przeniesienia gałęzi do tego repozytorium. Repozytorium jest publiczne od 2026-09-08, więc scenariusz przestał być hipotetyczny. (Źródło: rollout Faza 4 finding F6 + domknięcie 3.7, 2026-09-08.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-08 (§5 — bramki faktycznie egzekwowane, branch protection na `master`)
- Stack versions last verified: 2026-09-07 (Playwright 1.63.0, Supabase CLI 2.117.0; Vitest / Testing Library / Zod bez zmian od 2026-09-02)
- AI-native tool references last verified: 2026-09-02

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
