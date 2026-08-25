# S-02 `first-gated-generation` — plan implementacji

## Overview

Pionowa slice od wklejonego tekstu do fiszki w kolekcji użytkownika: sekret i adapter OpenRoutera, dwa endpointy JSON, wyspa przeglądu propozycji z bramką akceptacji, lista kolekcji renderowana serwerowo.

To jest gwiazda przewodnia MVP — jedyny przepływ weryfikujący główne kryterium sukcesu PRD („75% fiszek wygenerowanych przez AI jest akceptowane bez istotnych zmian"). Kryterium mierzą trzy liczniki w `public.generations`, więc ich poprawność nie jest szczegółem implementacyjnym, tylko sensem całej zmiany.

Po drodze slice spłaca dwa długi zapisane jawnie w „What We're NOT Doing" poprzednich zmian (`App.Locals` z klientem Supabase, pierwsza warstwa serwisów) i ustala cztery konwencje obowiązujące S-03…S-06: kształt endpointu JSON, warstwę serwisów, komunikację wyspa ↔ API oraz system stylów ekranów domenowych.

## Current State Analysis

**Gotowe i wykorzystywane bez zmian:**

- SSR na Cloudflare Workers — [astro.config.mjs](astro.config.mjs) (`output: "server"`, `adapter: cloudflare()`); brak `prerender` gdziekolwiek w `src/`.
- Typowany dostęp do sekretów przez `astro:env/server` — [astro.config.mjs](astro.config.mjs#L17-L22). `import.meta.env` i `locals.runtime` nie są używane nigdzie.
- Klient Supabase per żądanie — [src/lib/supabase.ts](src/lib/supabase.ts); zwraca `null` bez konfiguracji, typowany `Database`, bez `service_role`.
- Sesja w `locals.user` na każdym żądaniu, również `/api/**` — [src/middleware.ts](src/middleware.ts).
- Silnik SRS — [src/lib/srs/scheduler.ts](src/lib/srs/scheduler.ts#L18-L20): `createNewCard(now)` zwraca 9 pól 1:1 z kolumnami.
- Schemat i RLS — [supabase/migrations/20260824202259_flashcards_schema.sql](supabase/migrations/20260824202259_flashcards_schema.sql); komplet czterech polityk na obu tabelach, `anon` odcięty osobną migracją.
- shadcn/ui skonfigurowane — [components.json](components.json), ale w `src/components/ui/` jest wyłącznie `button.tsx`.

**Nie istnieje — S-02 tworzy jako pierwszy:**

- Endpoint zwracający JSON, ustawiający kod statusu inny niż redirect, albo sprawdzający `locals.user`. Wszystkie trzy endpointy w [src/pages/api/auth/](src/pages/api/auth/) zwracają `context.redirect(...)`.
- Jakakolwiek walidacja wejścia po stronie serwera. [src/pages/api/auth/signin.ts](src/pages/api/auth/signin.ts#L6-L7) rzutuje `formData()` przez `as string` bez sprawdzenia. Zod `4.4.3` jest w zależnościach, ale użyty wyłącznie w [src/lib/srs/schedule-state.ts](src/lib/srs/schedule-state.ts).
- Ani jednego `fetch(` i ani jednego `console.*` w całym `src/`.
- Ochrona `/api/**` — [src/middleware.ts](src/middleware.ts#L4) obejmuje wyłącznie `/dashboard`.
- Wzorzec komunikacji wyspa React → API. Dziś jedyny wzorzec to natywny `<form method="POST">` + redirect — [src/components/auth/SignInForm.tsx](src/components/auth/SignInForm.tsx#L41).
- `OPENROUTER_API_KEY` — brak w [astro.config.mjs](astro.config.mjs), w [.env.example](.env.example), w `worker-configuration.d.ts` i na produkcji.
- Komponenty `textarea`, `card`, `alert`. Katalog `src/hooks/` nie istnieje.

**Ograniczenia, w których trzeba się zmieścić:**

- Bramki CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)): `npm ci` → `astro sync` → `astro check` → `npm run lint` → `npm test` → `npm run build`.
- ESLint: `strictTypeChecked` + `stylisticTypeChecked`, `react-compiler` jako `error`, Prettier jako reguła. **`no-console` to `"warn"`, a CI nie używa `--max-warnings 0`** — [eslint.config.js](eslint.config.js#L24).
- Vitest: `environment: "node"`, brak testing-library — [vitest.config.ts](vitest.config.ts). Cokolwiek ma być pokryte testem, musi być czystą funkcją bez DOM i bez sieci.
- Cloudflare Workers Free: 10 ms CPU na żądanie, 50 subrequestów, 6 równoczesnych połączeń wychodzących, limit rozmiaru Workera 3 MB.

## Desired End State

Zalogowany użytkownik wchodzi na `/generate`, wkleja tekst (200–10 000 znaków), zleca generowanie i po kilkunastu sekundach widzi listę propozycji w formacie pytanie+odpowiedź. Każdą kartę może zapisać, poprawić przed zapisem albo odrzucić. Zapisane fiszki znajduje na `/deck`. Odrzucone nie istnieją nigdzie poza pamięcią przeglądarki. Wklejony tekst nie istnieje nigdzie po zakończeniu żądania — w bazie zostaje wyłącznie jego długość i skrót SHA-256.

**Weryfikacja końcowa:** na wdrożonej instancji przejść pełny przepływ, następnie odczytać wiersz z `public.generations` w Dashboardzie Supabase i sprawdzić, że `generated_count` odpowiada liczbie propozycji, a `accepted_unedited_count + accepted_edited_count` — liczbie faktycznie zapisanych fiszek, z właściwym rozbiciem na edytowane i nieedytowane.

### Key Discoveries:

- **`generated_count` ma default `0` i jest opcjonalny w wygenerowanych typach** — [src/db/database.types.ts](src/db/database.types.ts#L94-L106). CHECK `generations_accepted_total_leq_generated` ([migracja](supabase/migrations/20260824202259_flashcards_schema.sql#L33)) wywali pierwszą akceptację błędem `23514`, jeśli insert go pominie. TypeScript tego nie złapie.
- **FK `flashcards_generation_id_fkey` nie przechodzi przez RLS** — RLS filtruje wiersze w `select`/`insert`, nie referencje klucza obcego. `generation_id` przychodzi od klienta, więc bez jawnej weryfikacji własności użytkownik podepnie własną fiszkę pod cudze zlecenie.
- **`supabase-js` nie wyraża `set x = x + 1`** — inkrementacja liczników wymaga funkcji w Postgresie albo odczytu-modyfikacji-zapisu z wyścigiem.
- **Workers Logs zapisują metodę i URL każdego wywołania, ale nie ciało żądania** ([Cloudflare — Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)). Tekst w ciele POST jest bezpieczny; ten sam tekst w query stringu wylądowałby w logach na 3 dni.
- **`strict: true` w `response_format` nie jest gwarancją na każdym endpoincie** ([OpenRouter — Structured Outputs](https://openrouter.ai/docs/features/structured-outputs)) — odpowiedź i tak musi przejść przez Zoda. `choices[0].message.content` to string wymagający `JSON.parse`.
- **Limity bazy są niższe niż intuicja** — `front ≤ 500`, `back ≤ 2000`, liczone po `btrim` ([migracja](supabase/migrations/20260824202259_flashcards_schema.sql#L54-L57)). Walidacja musi używać dokładnie tych progów na przyciętym stringu.
- **Trigger `flashcards_prevent_source_change`** blokuje zmianę `source` na UPDATE — decyzja `ai` vs `ai_edited` zapada raz, przy zapisie.
- **F-02 pozostawiło jedno ustalenie otwarte**: rola `authenticated` nadal ma domyślne `TRUNCATE` / `TRIGGER` / `REFERENCES` na obu tabelach ([impl-review F-02](context/archive/2026-08-24-flashcards-schema-isolation/reviews/impl-review.md), ustalenie F2). Poza zakresem S-02, ale warto o tym wiedzieć przy dotykaniu uprawnień w fazie 2.

## What We're NOT Doing

- **Strumieniowania i widocznego postępu generowania** — to jest S-06 (`streaming-generation-progress`). S-02 dostarcza generowanie zbiorcze, które spełnia FR-003, tylko gorzej się go używa.
- **`GET /api/flashcards`** — `/deck` czyta kolekcję w SSR. Endpoint powstanie w S-03, gdy będzie znał swoje wymagania (paginacja, filtry).
- **Edycji i usuwania **zapisanych** fiszek** — to S-03. S-02 pozwala poprawić wyłącznie propozycję przed zapisem; po zapisie karta jest zamknięta.
- **Ręcznego tworzenia fiszek** — to S-04. `POST /api/flashcards` w S-02 obsługuje wyłącznie `source ∈ {ai, ai_edited}` z wymaganym `generation_id`.
- **Utrwalania propozycji ani sesji przeglądu** — żadnego `sessionStorage`, żadnej tabeli roboczej. Odświeżenie strony gubi niezapisany przegląd i to jest świadomy kompromis: skoro propozycje nigdzie nie są utrwalane, twarde ograniczenie „odrzucone nie trafiają do bazy" spełnia się z definicji, a nie przez czyszczenie.
- **Dzielenia długiego tekstu na kawałki** — powyżej 10 000 znaków użytkownik dzieli materiał sam.
- **Testów komponentów React** — brak testing-library i `environment: "node"` w [vitest.config.ts](vitest.config.ts). Dokładanie DOM-owego środowiska testowego to osobna decyzja, nie przemycona w gwieździe przewodniej.
- **Bindingów KV / D1 / R2** — [wrangler.jsonc](wrangler.jsonc) nie ma żadnego i tak ma zostać. Cache i stan „trwającego generowania" nie mają gdzie mieszkać, i dobrze.
- **Retry po stronie serwera przy błędzie modelu** — jedna próba, błąd wraca do użytkownika z przyciskiem ponowienia. Automatyczne ponowienie w środowisku z limitem 10 ms CPU i płatnym wywołaniem to podwojony koszt bez zysku.

## Implementation Approach

Kolejność faz wynika z jednej zasady: **wszystko, co da się zweryfikować automatycznie, powstaje przed czymkolwiek, co wymaga oczu.**

Fazy 1–2 przygotowują grunt (sekret, `Locals`, reguła lintu, funkcja w bazie) i są w całości weryfikowalne przez `astro check`, `npm run lint` i `supabase test db`. Faza 3 wyciąga budowę promptu i parsowanie odpowiedzi do czystych funkcji w `src/lib/` — bez tego S-02 nie ma jak dołożyć ani jednego testu do bramki `npm test`, bo reszta to sieć i DOM. Fazy 4–5 składają endpointy z gotowych, przetestowanych klocków. Dopiero fazy 6–7 dokładają interfejs.

Faza 8 (ujednolicenie stylów) stoi na końcu celowo: dotyka zweryfikowanego na produkcji przepływu auth, nie przybliża żadnego kryterium sukcesu i jest pierwszym kandydatem do odcięcia, jeśli termin 2026-08-31 zacznie napierać.

Faza 9 to weryfikacja na `workerd`. `astro dev` nie jest `workerd` — [context/foundation/infrastructure.md](context/foundation/infrastructure.md) mówi to wprost, a S-01 potwierdziło empirycznie, że różnice bywają istotne.

**Integracja z OpenRouterem idzie przez czysty `fetch`**, nie przez SDK: limit rozmiaru Workera 3 MB, SDK OpenAI ciągnie zależności zakładające Node, a API to jeden POST z JSON-em. `fetch` jest natywny na `workerd`.

## Critical Implementation Details

**Kolejność w `POST /api/generations` jest wiążąca.** Wiersz w `generations` powstaje **po** udanym wywołaniu modelu, nie przed — `generation_duration` i `generated_count` są znane dopiero wtedy, a `generated_count` musi być ustawiony przy inserie (patrz Key Discoveries). Sprawdzenie limitu dobowego idzie **przed** wywołaniem modelu, bo inaczej nie chroni przed niczym.

**Skrót SHA-256 liczy `crypto.subtle.digest("SHA-256", …)`** — dostępne na `workerd` bez `nodejs_compat`, zwraca `ArrayBuffer` wymagający konwersji na 64-znakowy hex, którego pilnuje CHECK `generations_source_text_hash_format`.

**Redakcja błędów to trzy konkretne wycieki, każdy realny:**
1. Zod v4 potrafi zawrzeć wartość wejściową w `issues[].received`. Nie zwracać `error.issues` surowo i nie umieszczać ich w `throw`.
2. Odpowiedź błędu z OpenRoutera bywa echem żądania — nie przekazywać jej ciała dalej bez filtrowania.
3. Nieprzechwycony wyjątek trafia do Workers Logs ze stack trace. Tekst źródłowy nie może pojawić się w komunikacie `Error(...)`.

**Budżet CPU.** Czekanie na sieć nie liczy się do 10 ms; `JSON.parse` odpowiedzi i mapowanie fiszek — tak. Jeden `JSON.parse` na payloadzie ~20 KB mieści się bezpiecznie, ale zero transformacji per-znak i zero rekurencyjnego przechodzenia po tekście źródłowym. Przekroczenie limitu ma kod błędu `1102`.

---

## Phase 1: Fundament serwerowy

### Overview

Sekret OpenRoutera, klient Supabase w `App.Locals`, mechaniczne wymuszenie zakazu logowania w ścieżkach serwerowych. Nic jeszcze nie widać, ale bez tego reszta nie ma się o co oprzeć.

### Changes Required:

#### 1. Deklaracja sekretu

**File**: `astro.config.mjs`

**Intent**: Udostępnić `OPENROUTER_API_KEY` przez `astro:env/server` tą samą drogą co `SUPABASE_*`, żeby dostęp do sekretu był typowany i nie wymagał `import.meta.env`.

**Contract**: `envField.string({ context: "server", access: "secret", optional: true })` w `env.schema`. `optional: true` — a nie `false` — świadomie: zachowuje wzorzec „brak sekretu → czytelny banner, nie wywalony build" z [src/lib/config-status.ts](src/lib/config-status.ts).

#### 2. Sekret w dokumentacji środowiska

**File**: `.env.example`

**Intent**: Dopisać `OPENROUTER_API_KEY=###` obok istniejących dwóch wpisów.

**Contract**: Trzy linie w pliku, ten sam format `###`.

#### 3. Status konfiguracji i banner

**File**: `src/lib/config-status.ts`

**Intent**: Dołożyć drugi wpis do `configStatuses`, żeby brak klucza dawał komunikat w bannerze zamiast błędu 500 przy pierwszym generowaniu.

**Contract**: Obiekt `ConfigStatus` z `name: "OpenRouter"`, `configured: Boolean(OPENROUTER_API_KEY)` i komunikatem po polsku, spójnym z istniejącym wpisem Supabase. `missingConfigs` i [src/layouts/Layout.astro](src/layouts/Layout.astro#L22-L36) podchwytują to bez zmian.

#### 4. Klient Supabase w `App.Locals`

**File**: `src/env.d.ts`, `src/middleware.ts`

**Intent**: Spłacić dług zapisany jawnie przez F-01 i F-02 — middleware już tworzy klienta na każdym żądaniu, a każdy endpoint domenowy tworzyłby drugi. Przeniesienie instancji do `locals` eliminuje duplikat i ustala konwencję dla S-03…S-06.

**Contract**: `App.Locals` zyskuje `supabase: SupabaseClient<Database> | null` (typ importowany, nie `any` — `strictTypeChecked` odrzuci resztę). Middleware przypisuje tę samą instancję, której już używa do `auth.getUser()`. Istniejące endpointy auth zostają na `createClient(...)` bez zmian — ich przepływ jest zweryfikowany na produkcji i nie ma powodu go ruszać w tej zmianie.

#### 5. Mechaniczne wymuszenie zakazu logowania

**File**: `eslint.config.js`

**Intent**: Zamienić zasadę z dokumentu w regułę, którą łamie się dopiero świadomie. Dziś `console.log(body)` w endpointcie przechodzi przez wszystkie bramki CI i trafia do Workers Logs — czyli gwarancja nietrwałości tekstu jest obietnicą, a obietnice nie przechodzą code review za trzy miesiące.

**Contract**: Nowy blok `tseslint.config()` z `files: ["src/pages/api/**/*.ts", "src/lib/openrouter/**/*.ts", "src/lib/generations/**/*.ts", "src/lib/flashcards/**/*.ts"]` i `rules: { "no-console": "error" }`, dołączony na końcu eksportowanej tablicy, żeby nadpisał `baseConfig`. Globalne `no-console: "warn"` zostaje bez zmian.

### Success Criteria:

#### Automated Verification:

- Typy się zgadzają: `npx astro sync && npx astro check`
- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`
- Nowa reguła działa: tymczasowe `console.log("x")` w `src/pages/api/auth/signin.ts` daje błąd, nie ostrzeżenie (sprawdzić i cofnąć)

#### Manual Verification:

- Bez `OPENROUTER_API_KEY` w `.dev.vars` strona pokazuje banner o braku konfiguracji OpenRoutera i nadal działa
- Po dodaniu klucza banner znika

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się i poczekaj na potwierdzenie ręcznej weryfikacji.

---

## Phase 2: Funkcja przeliczająca liczniki akceptacji

### Overview

Trzy liczniki w `public.generations` są jedynym instrumentem pomiaru obu kryteriów sukcesu PRD. Zapis per fiszka wymaga podbijania ich przy każdej akceptacji, a `supabase-js` nie wyraża inkrementacji. Rozwiązaniem jest funkcja w Postgresie, która **przelicza** liczniki z `flashcards`, a nie dodaje jedynkę — dzięki czemu podwójny klik ani ponowione żądanie nie zawyżają pomiaru.

### Changes Required:

#### 1. Migracja z funkcją przeliczającą

**File**: `supabase/migrations/<timestamp>_recount_generation_acceptance.sql`

**Intent**: Dostarczyć atomową, idempotentną operację aktualizacji liczników `accepted_unedited_count` i `accepted_edited_count` dla wskazanego zlecenia, wywoływalną przez `supabase.rpc()`.

**Contract**: Funkcja `public.recount_generation_acceptance(p_generation_id uuid) returns void`, `language plpgsql`, `security invoker`, `set search_path = ''`. Ustawia oba liczniki wartościami z `count(*) filter (where source = 'ai')` i `count(*) filter (where source = 'ai_edited')` po `public.flashcards` dla danego `generation_id`. `grant execute` dla roli `authenticated`.

`security invoker` jest tu wiążące, nie stylistyczne: funkcja działa z uprawnieniami wołającego, więc RLS obowiązuje wewnątrz niej i cudze `generation_id` nie zaktualizuje niczego. `security definer` obszedłby izolację i zamienił tę funkcję w furtkę.

Idempotencja wynika z tego, że wartość jest **przeliczana**, nie inkrementowana — to jest cała różnica względem naiwnego `+ 1` i powód, dla którego ten wariant został wybrany.

**Blokada wiersza zlecenia jest wiążąca, nie optymalizacją.** Pierwszą instrukcją w ciele funkcji musi być `perform 1 from public.generations where id = p_generation_id for update;`. Idempotencja chroni przed powtórzeniem tego samego żądania, ale **nie** przed dwoma różnymi żądaniami naraz — a zapis per fiszka (faza 5) przy liście do 25 kart czyni je normą, nie skrajnością. Bez blokady, w `read committed`:

```
T_A: insert karta1 · count → 1
T_B: insert karta2 · count → 2 · update = 2 (commit)
T_A: update = 1 (commit)          ← licznik pokazuje 1 przy dwóch fiszkach
```

`count(*)` wykonuje się **przed** pobraniem blokady wiersza `generations`, więc sama blokada wierszowa na `update` tego nie serializuje. Kierunek błędu to zaniżenie — czyli cicha degradacja dokładnie tej liczby, dla której pomiaru cała slice powstała. `for update` na początku funkcji ustawia całą sekwencję count→update pod jedną blokadą.

#### 2. Test funkcji

**File**: `supabase/tests/recount_generation_acceptance.test.sql`

**Intent**: Udowodnić, że funkcja liczy właściwie, jest idempotentna i respektuje izolację — obok istniejących testów RLS.

**Contract**: pgTAP w konwencji [supabase/tests/rls_flashcards.test.sql](supabase/tests/rls_flashcards.test.sql). Cztery asercje: (a) po dodaniu fiszek `ai` i `ai_edited` liczniki mają właściwe wartości; (b) drugie wywołanie na tym samym zleceniu nie zmienia wyniku; (c) wywołanie przez innego użytkownika nie zmienia liczników właściciela; (d) wynik nie łamie CHECK `generations_accepted_total_leq_generated`.

**Uwaga metodyczna z przeglądu F-02**: test, który przechodzi po usunięciu testowanego mechanizmu, nie jest testem. Asercja (c) musi zawieść, jeśli funkcja zostanie zmieniona na `security definer` — sprawdzić to jawnie, wykonując tę zmianę lokalnie i obserwując czerwony wynik, zanim się ją cofnie.

**Czego ten test nie udowodni**: pgTAP wykonuje asercje sekwencyjnie w jednej sesji, więc żadna z czterech nie wykryje braku `for update`. Asercja (b) przejdzie również dla wersji z wyścigiem. Obecność blokady weryfikuje się przez odczytanie ciała funkcji — stąd osobny punkt w weryfikacji ręcznej.

#### 3. Regeneracja typów

**File**: `src/db/database.types.ts`

**Intent**: Udostępnić sygnaturę funkcji w typach, żeby `supabase.rpc("recount_generation_acceptance", …)` był typowany.

**Contract**: Wygenerowane przez `npm run db:types`, nie pisane ręcznie. Plik jest wyłączony spod lintera w [eslint.config.js](eslint.config.js#L71-L74).

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się czysto: `npm run db:reset`
- Testy bazy przechodzą: `npm run db:test`
- Typy przeładowane: `npm run db:types`
- Typy zgodne ze schematem: `npx astro check`
- Lint przechodzi: `npm run lint`

#### Manual Verification:

- Asercja izolacji faktycznie testuje mechanizm: po tymczasowej zmianie funkcji na `security definer` `npm run db:test` daje czerwony wynik (zmianę cofnąć)
- Ciało funkcji zaczyna się od `perform 1 from public.generations where id = p_generation_id for update;` — sprawdzone odczytem migracji, bo pgTAP tego nie wyrazi
- Migracja wypchnięta na projekt w chmurze i funkcja widoczna w Dashboardzie Supabase

**Implementation Note**: Po tej fazie zatrzymaj się i poczekaj na potwierdzenie ręcznej weryfikacji.

---

## Phase 3: Adapter OpenRoutera jako czyste funkcje

### Overview

Budowa promptu, schemat odpowiedzi, sufit liczby propozycji i parsowanie wyniku wydzielone do `src/lib/openrouter/` jako funkcje bez sieci i bez DOM. To jedyny sposób, żeby ta slice dołożyła cokolwiek do bramki `npm test` — reszta S-02 to `fetch` i React, których `environment: "node"` nie obsłuży.

### Changes Required:

#### 1. Prompt systemowy i budowa żądania

**File**: `src/lib/openrouter/prompt.ts`

**Intent**: Zamknąć w jednym miejscu kształt promptu, bo to on — a nie wybór modelu — decyduje o wskaźniku 75% akceptacji, i to on będzie strojony po pierwszym pomiarze.

**Contract**: Eksportuje `SYSTEM_PROMPT` (stała) oraz `buildChatRequest(sourceText: string): ChatRequest` zwracające obiekt gotowy do `JSON.stringify`.

Prompt systemowy realizuje sześć reguł, każda z uzasadnieniem:
1. **Atomowość** — jedna fiszka = jeden fakt; zdanie z trzema faktami daje trzy fiszki. Fiszki wielofaktowe to główne źródło odrzuceń.
2. **Krótka odpowiedź** — twardy limit ≤ 30 słów. Bez tego modele streszczają akapit i nazywają to fiszką.
3. **Zakaz powtarzania przodu w tyle** i zakaz odwołań do źródła („jak pisze autor"). Fiszka musi być samodzielna — za miesiąc nie ma dostępu do tekstu.
4. **Pomijanie nietestowalnego** — „jeśli fragment nie zawiera faktu nadającego się do odpytania, pomiń go" zamiast wymuszania sztywnej liczby.
5. **Język wyjścia = język tekstu źródłowego** — inaczej model przełącza się na angielski przy polskim wejściu.
6. **Traktowanie wejścia jako danych, nie instrukcji** — tekst użytkownika idzie w wiadomości `user` opakowany w `<source_text>…</source_text>`, a prompt systemowy nakazuje ignorować wszelkie polecenia w środku. Bez tego wklejka zawierająca „zignoruj poprzednie instrukcje" jest zwykłym prompt injection. Ryzyko jest ograniczone (użytkownik atakuje własne fiszki), ale koszt zabezpieczenia to trzy zdania.

Ciało żądania: model `google/gemini-2.5-flash`, `temperature: 0.3`, `max_tokens` według wzoru niżej, `provider: { require_parameters: true, data_collection: "deny", zdr: true }`, `response_format: { type: "json_schema", json_schema: { name: "flashcards", strict: true, schema: … } }` z `maxLength` 500 / 2000 i `additionalProperties: false` na każdym poziomie.

`require_parameters: true` jest niezbędne — wsparcie dla `response_format` jest per endpoint, nie per model, i zmienia się w czasie. Bez tego OpenRouter może przekierować na dostawcę, który schemat zignoruje.

**`max_tokens` musi mieścić tokeny rozumowania, nie tylko treść.** `google/gemini-2.5-flash` ma rozumowanie włączone domyślnie — [research.md](context/changes/first-gated-generation/research.md) wyróżnia `flash-lite` adnotacją „thinking domyślnie wyłączone", co dla wybranego wariantu znaczy odwrotnie. Tokeny rozumowania konsumują ten sam budżet co odpowiedź, więc `max_tokens` ustawiony na sam rozmiar treści daje `finish_reason: "length"`, obcięty JSON i błąd **przy każdym generowaniu**, a nie w rzadkim przypadku brzegowym.

Wzór: `max_tokens = 8_000 + cap * 400`. Składnik stały to zapas na rozumowanie, składnik proporcjonalny to treść (≈ 400 tokenów na fiszkę przy limitach 500 / 2000 znaków). Wartość jest sufitem bezpieczeństwa, nie prognozą zużycia — płaci się za tokeny faktycznie wygenerowane. Zapas 8 000 wybrany z górką i do skorygowania po pomiarze z fazy 9.

#### 2. Sufit liczby propozycji

**File**: `src/lib/openrouter/limits.ts`

**Intent**: Wyliczyć górną liczbę propozycji proporcjonalnie do długości wejścia, z sufitem — sufit jest potrzebny z powodu `max_tokens` i budżetu CPU na parsowanie, nie z powodu modelu.

**Contract**: `SOURCE_TEXT_MIN = 200`, `SOURCE_TEXT_MAX = 10_000`, `MAX_FLASHCARDS = 25`; funkcja `proposalCap(length: number): number` zwracająca `Math.min(MAX_FLASHCARDS, Math.ceil(length / 400))`. Te stałe są jedynym źródłem prawdy dla walidacji w fazie 4 i dla komunikatów w interfejsie w fazie 6.

`MAX_FLASHCARDS = 25`, a nie 30, bo `⌈SOURCE_TEXT_MAX / 400⌉ = 25` — przy górnym limicie 10 000 znaków wyższy sufit byłby nieosiągalny, a zatem nietestowalny i mylący dla każdego, kto później będzie stroił te liczby. Obie wartości trzeba zmieniać razem.

#### 3. Parsowanie i walidacja odpowiedzi

**File**: `src/lib/openrouter/parse.ts`

**Intent**: Zamienić surową odpowiedź OpenRoutera na listę propozycji albo na jawny, zredagowany błąd. `strict: true` nie jest gwarancją na każdym endpoincie, więc Zod jest tu ostatnią linią obrony, nie ozdobnikiem.

**Contract**: `parseGenerationResponse(raw: unknown): FlashcardProposal[]`, gdzie `FlashcardProposal = { front: string; back: string }`. Kroki: walidacja koperty (`choices[0].message.content` jako string), `JSON.parse`, walidacja Zodem tablicy z `front` i `back` przyciętymi przez `.trim()` i ograniczonymi do 500 / 2000 znaków, odrzucenie pustych, przycięcie do `proposalCap`.

Odrzucone elementy **nie** powodują błędu całego generowania — model bywa nadgorliwy, a lista krótsza o jedną pozycję jest lepsza niż komunikat o awarii. Błąd rzucany jest tylko wtedy, gdy po walidacji nie zostaje ani jedna propozycja.

**`finish_reason: "length"` obsługiwany osobno, przed `JSON.parse`.** Obcięta odpowiedź jest nieprawidłowym JSON-em i bez tego rozpoznania dałaby ten sam komunikat co awaria modelu — czyli mylący, bo przyczyną jest wyczerpany budżet tokenów (najpewniej przez rozumowanie), a nie dostawca. Osobny typ błędu, mapowany w fazie 4 na `502`, z komunikatem wskazującym na skrócenie tekstu źródłowego jako obejście.

Rzucany błąd nie może zawierać tekstu źródłowego ani surowej treści odpowiedzi — patrz „Critical Implementation Details". Stały komunikat, bez interpolacji.

#### 4. Wywołanie sieciowe z fallbackiem ZDR

**File**: `src/lib/openrouter/client.ts`

**Intent**: Wykonać jeden POST do OpenRoutera, a w razie braku trasy spełniającej Zero Data Retention — ponowić bez tego ograniczenia i **zaraportować, że to zrobiono**.

**Contract**: `generateFlashcards(apiKey: string, sourceText: string): Promise<{ proposals: FlashcardProposal[]; model: string; privacyMode: "zdr" | "standard" }>`.

Pierwsza próba: żądanie z fazy 1 tej listy (`zdr: true`). Jeśli OpenRouter odpowie brakiem dostępnego endpointu — druga próba z `zdr` usuniętym, `data_collection: "deny"` zachowanym, i `privacyMode: "standard"` w wyniku. Każdy inny błąd (401, 429, 5xx, timeout) leci dalej bez ponowienia.

**Timeout musi być ustanowiony jawnie.** `fetch` na `workerd` nie ma domyślnego limitu po stronie aplikacji, a limit 10 ms CPU nie obejmuje czekania na sieć — zawieszony dostawca zostawia użytkownika przy spływającym spędzie w nieskończoność, wprost wbrew wymaganiu „pierwsze fiszki w ciągu 30 sekund". Oba wywołania (pierwsza próba i fallback) dostają `signal: AbortSignal.timeout(45_000)`. Wartość leży powyżej budżetu 30 s celowo: timeout ma sygnalizować awarię, nie ucinać wolnego, ale poprawnego generowania. `AbortError` mapuje się w fazie 4 na `502`.

Fallback jest **jawny w kontrakcie zwracanym z funkcji** — nie jest logowany (Z2 zakazuje `console.*` na tej ścieżce) i nie jest zapisywany w bazie. Informacja żyje tyle, co odpowiedź, i trafia do interfejsu w fazie 6. To rozstrzyga jedyną wadę fallbacku: gdyby pula ZDR okazała się trwale pusta, aplikacja działałaby miesiącami z nieobowiązującą gwarancją prywatności i nikt by się nie dowiedział.

Rozpoznanie „brak trasy" wymaga sprawdzenia empirycznego przy pierwszym uruchomieniu — OpenRouter sygnalizuje to kodem `404` z komunikatem o braku dostępnego dostawcy. Dopóki nie potwierdzone na żywym kluczu, warunek ma obejmować `404` z ciałem zawierającym wzmiankę o dostawcy, a nie dowolny `404`.

#### 5. Testy jednostkowe

**File**: `src/lib/openrouter/parse.test.ts`, `src/lib/openrouter/limits.test.ts`

**Intent**: Pokryć testami dokładnie to, co da się pokryć bez sieci — parsowanie i arytmetykę sufitu.

**Contract**: Vitest w konwencji [src/lib/srs/scheduler.test.ts](src/lib/srs/scheduler.test.ts). Przypadki dla `parse`: poprawna odpowiedź; `content` niebędący JSON-em; `finish_reason: "length"` (osobny typ błędu, nie ten sam co uszkodzony JSON); brakujące `back`; `front` dłuższy niż 500 znaków (odrzucony, reszta zachowana); `front` z samych spacji (odrzucony); pusta tablica po walidacji (rzuca); więcej propozycji niż sufit (przycięte). Przypadki dla `limits`: 200 znaków → 1, 10 000 → 25, wartość na granicy sufitu (9 601 → 25, 9 600 → 24).

Dodatkowy test, który pilnuje wymagania niefunkcjonalnego: komunikat błędu rzucanego przez `parse` nie zawiera fragmentu wejścia. Bez niego zakaz z „Critical Implementation Details" jest komentarzem, nie kontraktem.

### Success Criteria:

#### Automated Verification:

- Testy przechodzą: `npm test`
- Typy się zgadzają: `npx astro check`
- Lint przechodzi: `npm run lint`
- Nowe pliki nie odwołują się do `console` ani do `astro:env` (adapter dostaje klucz argumentem, żeby był testowalny)

#### Manual Verification:

- Prompt sprawdzony ręcznie na jednym własnym tekście przez interfejs OpenRoutera lub `curl` — propozycje są atomowe, w języku wejścia i mieszczą się w limitach długości

**Implementation Note**: Po tej fazie zatrzymaj się i poczekaj na potwierdzenie ręcznej weryfikacji. To pierwszy moment, w którym da się ocenić jakość promptu — a to jest główne ryzyko produktowe całej slice.

---

## Phase 4: `POST /api/generations`

### Overview

Pierwszy endpoint domenowy w projekcie. Ustala konwencję dla S-03…S-06: JSON zamiast redirectu, jawne sprawdzenie `locals.user`, walidacja Zodem, kody statusu.

### Changes Required:

#### 1. Serwis generowania

**File**: `src/lib/generations/service.ts`

**Intent**: Wydzielić logikę zlecenia z warstwy HTTP — spłata długu „warstwa serwisów, pierwszy konsument decyduje o jej kształcie" z F-02. Endpoint zostaje cienki: parsuje, waliduje, deleguje, serializuje.

**Contract**: `createGeneration({ supabase, userId, sourceText, apiKey }): Promise<GenerationResult>`. Kolejność kroków jest wiążąca:
1. Sprawdzenie limitu dobowego — `count` po `generations` z `created_at >= now() - 24h`, korzystające z istniejącego indeksu `(user_id, created_at desc)`. Przekroczenie → wyjątek domenowy mapowany na 429.
2. `crypto.subtle.digest("SHA-256", …)` na tekście → 64-znakowy hex.
3. Pomiar czasu i wywołanie `generateFlashcards`.
4. Insert do `generations` z **jawnie ustawionym `generated_count`** (patrz Key Discoveries — pominięcie daje błąd `23514` przy pierwszej akceptacji, i to dopiero na produkcji), `model`, `source_text_length`, `source_text_hash`, `generation_duration`.
5. Zwrot `{ generationId, model, privacyMode, proposals }`.

`model` zapisywany jest jako slug OpenRoutera i to jest jedyne miejsce, w którym da się później zmierzyć, który model dawał jaką akceptację — czyli instrument pomiarowy, nie ozdobnik.

Stała limitu dobowego: `DAILY_GENERATION_LIMIT = 20`. Wartość wybrana „z sufitu" i jawnie oznaczona jako do skorygowania po pierwszym tygodniu — jej sens polega na zamianie nieograniczonego kosztu w policzalny, nie na precyzji.

#### 2. Endpoint

**File**: `src/pages/api/generations.ts`

**Intent**: Wystawić serwis pod `POST /api/generations` z jawną kontrolą sesji i walidacją wejścia.

**Contract**: `export const POST: APIRoute`. Kolejno: `locals.user` — brak → `401`; `locals.supabase` — brak → `503`; brak `OPENROUTER_API_KEY` → `503`; `request.json()` walidowane Zodem (`{ sourceText: string }` z `.trim()`, `.min(SOURCE_TEXT_MIN)`, `.max(SOURCE_TEXT_MAX)`) — niepowodzenie → `400` ze **stałym** komunikatem, nigdy z `error.issues`; limit dobowy → `429`; błąd modelu → `502`.

Odpowiedź `200`: `{ generationId, model, privacyMode, proposals: [{ front, back }] }`.

**Tekst źródłowy przychodzi wyłącznie w ciele POST.** Nigdy w query stringu — Workers Logs zapisują URL każdego wywołania, ciała nie. To zamyka też pokusę „a może GET z parametrem do debugowania".

Kształt ciała błędu (`{ error: string }`) obowiązuje wszystkie kolejne endpointy domenowe. Nie ma tu wariantów per endpoint.

#### 3. Rejestr powierzchni

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Przestawić `/api/generations` z `proponowane` na `istnieje`.

**Contract**: Jedna komórka w tabeli „Endpointy API". Wpis oznaczony `istnieje` staje się wiążący.

### Success Criteria:

#### Automated Verification:

- Typy się zgadzają: `npx astro check`
- Lint przechodzi, w tym reguła `no-console: "error"` na tej ścieżce: `npm run lint`
- Build przechodzi: `npm run build`
- Testy przechodzą: `npm test`

#### Manual Verification:

- `curl -X POST` bez ciasteczka sesji zwraca `401`, nie `500`
- Wywołanie z tekstem 100 znaków zwraca `400` z komunikatem o długości, a komunikat **nie zawiera** wysłanego tekstu
- Wywołanie z sensownym tekstem zwraca listę propozycji i `generationId`
- W `public.generations` powstał wiersz z niezerowym `generated_count`, poprawnym 64-znakowym `source_text_hash` i długością zgodną z wejściem — a **kolumny z tekstem nie ma i nie przybyła**
- W Workers Logs (`wrangler tail` bez logowania ciał) nie widać fragmentu wklejonego tekstu

**Implementation Note**: Po tej fazie zatrzymaj się i poczekaj na potwierdzenie ręcznej weryfikacji.

---

## Phase 5: `POST /api/flashcards`

### Overview

Zapis pojedynczej zaakceptowanej propozycji. Dwie rzeczy, których nie widać w wymaganiach, a które przesądzają o poprawności: weryfikacja własności `generation_id` i wywołanie funkcji przeliczającej liczniki.

### Changes Required:

#### 1. Serwis fiszek

**File**: `src/lib/flashcards/service.ts`

**Intent**: Złożyć zapis fiszki z trzech ortogonalnych wymiarów — treści, pochodzenia i stanu harmonogramu — i zaktualizować pomiar.

**Contract**: `createAiFlashcard({ supabase, userId, generationId, front, back, edited }): Promise<{ id: string }>`. Kolejno:
1. **Weryfikacja własności zlecenia** — `select id from generations where id = ?`. Zapytanie jest filtrowane przez RLS, więc cudze ID zwróci zero wierszy. Brak wiersza → wyjątek mapowany na `404`. Bez tego kroku użytkownik podepnie własną fiszkę pod cudze zlecenie, bo **FK nie przechodzi przez RLS**.
2. Insert do `flashcards` z `source: edited ? "ai_edited" : "ai"` i rozwinięciem `createScheduler().createNewCard(new Date())` — 9 pól harmonogramu 1:1 z kolumnami. Nie ustawiać `id`, `created_at`, `updated_at`.
3. `supabase.rpc("recount_generation_acceptance", { p_generation_id: generationId })`.

Kontrakt SRS jest ortogonalny wobec pochodzenia fiszki — `createNewCard()` nie wie i nie musi wiedzieć, skąd fiszka pochodzi. Serwis składa oba wymiary samodzielnie i to jest dokładnie to, co F-01 miało dostarczyć.

Decyzja `ai` vs `ai_edited` zapada tutaj, raz — trigger `flashcards_prevent_source_change` zablokuje późniejszą zmianę.

**Ograniczenie pomiaru, warte odnotowania przy interpretacji liczb w fazie 9**: `edited` przychodzi od klienta i serwer nie ma czym go zweryfikować — propozycje nigdzie nie są utrwalane, co jest tą samą decyzją, na której stoi twarde ograniczenie „odrzucone nie trafiają do bazy". Podział na `accepted_unedited_count` i `accepted_edited_count` jest więc deklarowany, nie zmierzony. Dla pomiaru na własnym materiale to bez znaczenia; przy porównywaniu modeli albo prezentowaniu wskaźnika 75% na zewnątrz — nie.

#### 2. Endpoint

**File**: `src/pages/api/flashcards.ts`

**Intent**: Wystawić zapis pod `POST /api/flashcards`, w konwencji ustalonej w fazie 4.

**Contract**: `export const POST: APIRoute`. `locals.user` — brak → `401`. Ciało walidowane Zodem: `{ generationId: uuid, front: string, back: string, edited: boolean }`, gdzie `front` i `back` są przycinane przez `.trim()` i sprawdzane przeciwko **dokładnie tym samym progom co CHECK w bazie** (niepuste, ≤ 500 i ≤ 2000). Rozjazd o jeden znak daje `500` zamiast czytelnego komunikatu.

Odpowiedź `201`: `{ id }`. Błędy: `400` walidacja, `404` nieznane lub cudze zlecenie, `401` brak sesji.

Metoda `GET` **nie powstaje** w tej fazie — `/deck` czyta w SSR.

#### 3. Rejestr powierzchni

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Odnotować, że `/api/flashcards` istnieje w wariancie `POST`, a `GET` pozostaje proponowany dla S-03.

**Contract**: Rozdzielić wiersz na stan metody: `POST` → `istnieje` (S-02), `GET` → `proponowane` (S-03). Zasada 2 rejestru wymaga aktualizacji w tym samym przebiegu, w którym nazwa się zmienia.

### Success Criteria:

#### Automated Verification:

- Typy się zgadzają: `npx astro check`
- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`
- Testy przechodzą: `npm test`

#### Manual Verification:

- Zapis fiszki z poprawnym `generationId` zwraca `201`, a wiersz jest widoczny w `public.flashcards` z 9 wypełnionymi polami harmonogramu i `due` w przyszłości lub teraz
- Zapis z `generationId` należącym do innego konta zwraca `404` i **nie** tworzy wiersza — sprawdzone na dwóch kontach testowych
- Po zapisie dwóch fiszek (jednej edytowanej) liczniki w `generations` pokazują `1` i `1`
- Ponowne wysłanie tego samego żądania nie zawyża liczników ponad liczbę faktycznych fiszek
- Zapis fiszki z `front` o długości 501 znaków zwraca `400`, nie `500`

**Implementation Note**: Po tej fazie zatrzymaj się i poczekaj na potwierdzenie ręcznej weryfikacji. Przepływ jest kompletny po stronie serwera — dobry moment na przejście `curl`-em od generowania do zapisu.

---

## Phase 6: Ekran `/generate`

### Overview

Pierwsza wyspa React wołająca JSON API. Ustala wzorzec komunikacji dla S-03…S-06 — do tej pory jedyną drogą był natywny `<form method="POST">` z redirectem, a ten nie obsłuży listy propozycji: `?error=` niesie jeden globalny komunikat na stronę, a „nie udało się zapisać propozycji #3" wymaga błędu przypiętego do elementu listy.

### Changes Required:

#### 1. Komponenty bazowe

**File**: `src/components/ui/textarea.tsx`, `src/components/ui/card.tsx`, `src/components/ui/alert.tsx`

**Intent**: Dołożyć brakujące prymitywy shadcn — dziś w `src/components/ui/` jest wyłącznie `button.tsx`.

**Contract**: Dodane przez CLI shadcn (`components.json` jest już skonfigurowany), bez ręcznych modyfikacji. Korzystają z tokenów z `src/styles/global.css`.

#### 2. Wyspa przeglądu

**File**: `src/components/generate/GenerateView.tsx`

**Intent**: Objąć cały przepływ generowania i przeglądu w jednym komponencie stanowym: formularz → żądanie → lista kart → akcje per karta.

**Contract**: Domyślny eksport bez propsów. Stan lokalny: `sourceText`, `status` (`idle | generating | reviewing | error`), `generationId`, `privacyMode`, `proposals` z per-elementowym stanem (`pending | editing | saving | saved | rejected | error`).

Zachowanie formularza: licznik znaków z progami `SOURCE_TEXT_MIN` / `SOURCE_TEXT_MAX` (importowanymi z `src/lib/openrouter/limits.ts`, nie przepisanymi), przycisk nieaktywny poza zakresem, komunikat o powodzie.

Zachowanie listy: każda propozycja to karta z przyciskami **Zapisz / Edytuj / Odrzuć**. „Edytuj" zamienia treść w dwa pola z **Zapisz** i **Anuluj**; `edited` w żądaniu jest `true` wtedy i tylko wtedy, gdy zapisana treść różni się od wygenerowanej — porównanie treści, nie fakt wejścia w tryb edycji, bo inaczej wejście i wyjście bez zmian fałszuje pomiar `accepted_unedited_count`. Zapisana karta przechodzi w stan `saved` i nie daje się już zmienić — edycja po zapisie to S-03.

Nad listą licznik postępu („zapisano 4 z 17"), bo przy suficie 25 kart lista jest długa i bez tego użytkownik gubi orientację.

Przy `privacyMode === "standard"` nad listą pojawia się dyskretna adnotacja, że to generowanie wykonano bez trybu Zero Data Retention. Bez niej fallback z fazy 3 byłby niewidoczny, a niewidoczne obniżenie gwarancji prywatności jest gorsze niż jej brak.

Błąd generowania: komunikat z przyciskiem ponowienia, tekst źródłowy zachowany w polu. Błąd zapisu pojedynczej karty: komunikat przy tej karcie, reszta listy nietknięta. Żądanie do `/api/generations` dostaje własny `AbortSignal.timeout(60_000)` — powyżej 45 s z adaptera, żeby serwerowy komunikat błędu zdążył dotrzeć przed przerwaniem po stronie klienta; zerwane połączenie ma kończyć się tym samym stanem `error`, a nie wiecznym `generating`.

**Odrzucenie usuwa kartę wyłącznie ze stanu komponentu.** Żadnego żądania, żadnego zapisu — twarde ograniczenie „odrzucone propozycje nie trafiają do bazy" spełnia się z definicji.

`react-compiler/react-compiler` jest ustawione na `"error"` w [eslint.config.js](eslint.config.js#L58) — mutowanie stanu w miejscu nie przejdzie lintu.

#### 3. Strona

**File**: `src/pages/generate.astro`

**Intent**: Osadzić wyspę na chronionej stronie, w konwencji [src/pages/auth/signin.astro](src/pages/auth/signin.astro).

**Contract**: `.astro` z `<Layout>` i jedną wyspą `client:load`. Bez logiki w frontmatterze poza tytułem — sesji pilnuje middleware.

#### 4. Ochrona trasy

**File**: `src/middleware.ts`

**Intent**: Objąć `/generate` i `/deck` przekierowaniem dla niezalogowanych.

**Contract**: `PROTECTED_ROUTES = ["/dashboard", "/generate", "/deck"]`. Zasada 4 z [docs/reference/contract-surfaces.md](docs/reference/contract-surfaces.md) wymaga, żeby kolumna „Ochrona" w rejestrze zgadzała się z tą stałą — rozjazd jest błędem.

#### 5. Rejestr powierzchni

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Przestawić `/generate` na `istnieje`.

**Contract**: Jedna komórka w tabeli „Trasy".

### Success Criteria:

#### Automated Verification:

- Typy się zgadzają: `npx astro check`
- Lint przechodzi, w tym `react-compiler`: `npm run lint`
- Build przechodzi: `npm run build`

#### Manual Verification:

- Niezalogowany na `/generate` trafia na `/auth/signin`
- Wklejenie tekstu i zlecenie generowania daje listę propozycji; pierwsze fiszki widoczne w rozsądnym czasie
- Zapis, edycja i odrzucenie działają per karta; odrzucona znika bez śladu w bazie
- Karta zapisana bez edycji daje `source = 'ai'`; karta zapisana po zmianie treści — `'ai_edited'`; wejście w edycję i wyjście bez zmian daje `'ai'`
- Licznik postępu zgadza się z liczbą zapisanych
- Odświeżenie strony w trakcie przeglądu gubi niezapisane propozycje — zachowanie oczekiwane, nie błąd
- Błąd generowania pokazuje komunikat z ponowieniem i zachowuje wpisany tekst

**Implementation Note**: Po tej fazie zatrzymaj się i poczekaj na potwierdzenie ręcznej weryfikacji. To pierwszy moment, w którym da się zmierzyć kryterium 75% na własnym materiale.

---

## Phase 7: Ekran `/deck` i nawigacja

### Overview

Domknięcie przepływu: zaakceptowane fiszki muszą być gdzieś widoczne, inaczej wymaganie S-02 („zobaczyć zaakceptowane w kolekcji") nie jest spełnione.

### Changes Required:

#### 1. Strona kolekcji

**File**: `src/pages/deck.astro`

**Intent**: Wyrenderować kolekcję użytkownika serwerowo, bez endpointu i bez wyspy — mniej kodu i zero nowych konwencji, a `/deck` działa bez JavaScriptu.

**Contract**: Odczyt w frontmatterze przez `Astro.locals.supabase`: `select id, front, back, source, created_at from flashcards order by created_at desc`. Filtrowanie po `user_id` **nie jest potrzebne dla bezpieczeństwa** — RLS jest jedynym mechanizmem izolacji i on to załatwia; filtr w zapytaniu byłby wyłącznie wygodą. Renderowanie listy kart z widocznym znacznikiem pochodzenia. Stan pusty z odnośnikiem do `/generate`.

#### 2. Nawigacja

**File**: `src/pages/dashboard.astro`

**Intent**: Dać wejście do obu nowych ekranów — bez tego są nieosiągalne inaczej niż przez wpisanie adresu.

**Contract**: Dwa odnośniki: „Generuj fiszki" → `/generate`, „Moja kolekcja" → `/deck`.

#### 3. Rejestr powierzchni

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Przestawić `/deck` na `istnieje`.

**Contract**: Jedna komórka w tabeli „Trasy".

### Success Criteria:

#### Automated Verification:

- Typy się zgadzają: `npx astro check`
- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`

#### Manual Verification:

- Zapisane w fazie 6 fiszki są widoczne na `/deck` z właściwym znacznikiem pochodzenia
- Konto bez fiszek widzi stan pusty z odnośnikiem do `/generate`
- Drugie konto testowe nie widzi cudzych fiszek
- Odnośniki z `/dashboard` prowadzą do obu ekranów

**Implementation Note**: Po tej fazie zatrzymaj się i poczekaj na potwierdzenie ręcznej weryfikacji. **Tu kończy się zakres konieczny S-02** — faza 8 jest odcinalna.

---

## Phase 8: Ujednolicenie systemu stylów

### Overview

Aplikacja ma dziś dwa systemy stylów: tokeny shadcn w `src/styles/global.css` i zahardkodowany glassmorphism (`bg-cosmic`, `bg-white/10 backdrop-blur-xl`) w warstwie auth i na `/dashboard`. Nowe ekrany używają tokenów, więc bez tej fazy rozjazd staje się trwały.

**Ta faza jest odcinalna i stoi ostatnia świadomie**: dotyka zweryfikowanego na produkcji przepływu auth, nie przybliża żadnego kryterium sukcesu PRD i jest pierwszym kandydatem do odłożenia, jeśli termin 2026-08-31 zacznie napierać. Odłożenie nie zostawia długu technicznego — zostawia dług estetyczny, a to nie to samo.

### Changes Required:

#### 1. Ekrany auth i dashboard na tokenach

**File**: `src/pages/dashboard.astro`, `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`, `src/components/auth/*.tsx`

**Intent**: Zastąpić zahardkodowane klasy tokenami z `global.css`, żeby cała aplikacja miała jeden system stylów.

**Contract**: Wyłącznie zmiany w atrybutach `class` / `className` i ewentualne podmiany na komponenty shadcn. **Zero zmian w logice**: `<form method="POST" action="/api/auth/signin">`, walidacja klienta w [src/components/auth/SignInForm.tsx](src/components/auth/SignInForm.tsx#L18-L32) i przepływ redirectów zostają nietknięte. Każda zmiana wykraczająca poza warstwę prezentacji jest sygnałem, że faza wyszła poza zakres.

### Success Criteria:

#### Automated Verification:

- Typy się zgadzają: `npx astro check`
- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`
- `git diff` na tej fazie nie zawiera zmian poza atrybutami klas i importami komponentów

#### Manual Verification:

- Rejestracja, logowanie i wylogowanie działają bez zmian
- Komunikat błędu z `?error=` nadal się wyświetla
- Banner braku konfiguracji nadal się wyświetla
- Wszystkie ekrany wyglądają spójnie

**Implementation Note**: Po tej fazie zatrzymaj się i poczekaj na potwierdzenie ręcznej weryfikacji. Regresja w auth jest tu jedynym realnym ryzykiem — przetestować pełen cykl, nie samo logowanie.

---

## Phase 9: Weryfikacja na wdrożonej instancji

### Overview

`astro dev` nie jest `workerd` — [context/foundation/infrastructure.md](context/foundation/infrastructure.md) mówi to wprost, a S-01 potwierdziło empirycznie, że różnice bywają istotne. Ta faza nie jest formalnością.

### Changes Required:

#### 1. Sekret na produkcji

**File**: — (czynność operacyjna)

**Intent**: Ustawić `OPENROUTER_API_KEY` w środowisku produkcyjnym. Samo `.dev.vars` da `undefined` na produkcji.

**Contract**: `wrangler secret put OPENROUTER_API_KEY`, następnie `wrangler types` i przegląd `worker-configuration.d.ts` pod kątem spójności ze wzorcem `SUPABASE_*`. Plik jest generowany i wyłączony spod lintera — nie edytować ręcznie.

#### 2. Ustawienia konta OpenRouter

**File**: — (czynność operacyjna, do odhaczenia przez człowieka)

**Intent**: Domknąć gwarancję prywatności po stronie, której kod nie kontroluje.

**Contract**: W panelu OpenRoutera potwierdzić, że logowanie promptów jest wyłączone (domyślnie jest) i że routing do dostawców trenujących na promptach jest zablokowany ([OpenRouter — Privacy and Logging](https://openrouter.ai/docs/features/privacy-and-logging)). To ustawienie konta, nie kodu — stąd osobny punkt zamiast wpisu w pliku.

#### 3. Migracja w chmurze

**File**: — (czynność operacyjna)

**Intent**: Wypchnąć migrację z fazy 2 na projekt Supabase w chmurze.

**Contract**: `supabase db push`, następnie potwierdzenie w Dashboardzie, że funkcja istnieje i ma `security invoker`.

### Success Criteria:

#### Automated Verification:

- Build produkcyjny przechodzi: `npm run build`
- Uruchomienie na `workerd` startuje bez błędów: `npx wrangler dev`
- Pełny zestaw bramek CI zielony na `master`

#### Manual Verification:

- Na `https://10x-cards.sebger82.workers.dev` przepływ od wklejenia do `/deck` działa od początku do końca
- `privacyMode` zwracany przez API — odnotować, czy pula ZDR jest dostępna dla `google/gemini-2.5-flash`; jeśli fallback włącza się zawsze, podjąć decyzję o zmianie modelu (to jedyne pytanie, którego nie dało się rozstrzygnąć bez żywego klucza)
- `usage.completion_tokens_details.reasoning_tokens` odnotowane dla dwóch generowań — to jedyny moment, w którym da się zweryfikować zapas w `max_tokens`, przeliczyć rzeczywisty koszt i sprawdzić, czy przewaga latencyjna, dla której wybrano ten model, faktycznie obowiązuje przy włączonym rozumowaniu. Ani jedno generowanie nie kończy się `finish_reason: "length"`
- Wiersz w `public.generations` ma poprawne wszystkie trzy liczniki po przejściu przez przegląd
- `wrangler tail` w trakcie generowania **nie** pokazuje fragmentu wklejonego tekstu — ani w logach wywołań, ani w komunikatach błędów
- Pierwszy pomiar kryterium: `accepted_unedited_count / generated_count` odnotowany dla przynajmniej dwóch własnych tekstów

**Implementation Note**: To ostatnia faza. Po jej zakończeniu zmiana jest gotowa do `/10x-impl-review`, a następnie do `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- `src/lib/openrouter/parse.test.ts` — poprawna odpowiedź, `content` niebędący JSON-em, brakujące pole, przekroczone limity długości, treść z samych spacji, pusta lista po walidacji, przycięcie do sufitu, brak wejścia w komunikacie błędu
- `src/lib/openrouter/limits.test.ts` — arytmetyka `proposalCap` na granicach zakresu

Testów jednostkowych nie piszemy dla endpointów ani komponentów — pierwsze wymagałyby atrapy sieci i Supabase, drugie środowiska DOM, którego [vitest.config.ts](vitest.config.ts) nie ma. To świadome ograniczenie, nie przeoczenie: obie luki są pokryte weryfikacją ręczną w fazach 4–7.

### Integration Tests:

- `supabase/tests/recount_generation_acceptance.test.sql` — poprawność zliczania, idempotencja, izolacja między użytkownikami, zgodność z CHECK
- Istniejące `supabase/tests/rls_flashcards.test.sql` musi nadal przechodzić po migracji z fazy 2

### Manual Testing Steps:

1. Zalogować się i wejść na `/generate`.
2. Wkleić tekst krótszy niż 200 znaków — przycisk nieaktywny, komunikat o powodzie.
3. Wkleić tekst ~3 000 znaków i zlecić generowanie — propozycje w rozsądnym czasie.
4. Zapisać jedną propozycję bez zmian, jedną po edycji, jedną odrzucić.
5. Wejść w edycję czwartej i wyjść bez zmian, potem zapisać — sprawdzić `source = 'ai'`.
6. Wejść na `/deck` — trzy zapisane fiszki widoczne z właściwym pochodzeniem.
7. W Dashboardzie Supabase sprawdzić wiersz `generations`: `generated_count` = liczba propozycji, `accepted_unedited_count` = 2, `accepted_edited_count` = 1.
8. Powtórzyć generowanie ponad limit dobowy — `429` z czytelnym komunikatem.
9. Zalogować się na drugie konto — `/deck` puste, a próba zapisu z `generationId` pierwszego konta zwraca `404`.
10. `wrangler tail` w trakcie generowania — brak fragmentów tekstu w logach.

## Performance Considerations

**Limit 10 ms CPU na Cloudflare Workers Free** to jedyne realne ryzyko wydajnościowe. Czekanie na odpowiedź modelu nie liczy się do budżetu; `JSON.parse` i mapowanie propozycji — tak. Mitygacja jest wbudowana w decyzje: górny limit 10 000 znaków, sufit 25 propozycji, jeden `JSON.parse` na payloadzie ~20 KB, zero transformacji per-znak. Przekroczenie objawia się kodem `1102`.

**50 subrequestów i 6 równoczesnych połączeń wychodzących.** Generowanie zużywa: 1 zapytanie o limit dobowy + 1 POST do OpenRoutera + 1 insert = 3. Zapis fiszki: 1 select własności + 1 insert + 1 RPC = 3 na fiszkę, ale w osobnych żądaniach HTTP, więc limit dotyczy każdego z osobna. Zapas jest duży.

**Koszt.** Tekst 10 000 znaków ≈ 3 000 tokenów wejścia, 20 fiszek ≈ 2 000 tokenów wyjścia — przy cenie `google/gemini-2.5-flash` (0,30 $ / 2,50 $ za 1M) to ~0,006 $ za generowanie. Limit dobowy 20 daje sufit ~0,12 $ na użytkownika na dobę. **Ten szacunek nie obejmuje tokenów rozumowania**, które w tym modelu są włączone domyślnie i rozliczane po stawce wyjścia — rzeczywisty koszt jest więc wyższy o nieznany dziś mnożnik. Pomiar w fazie 9 (`reasoning_tokens`) jest warunkiem, żeby ta liczba — i wynikająca z niej wartość `DAILY_GENERATION_LIMIT` — miała pokrycie.

**Latencja.** Wybór `google/gemini-2.5-flash` zamiast tańszego `flash-lite` czy równie drogiego `gpt-5-mini` jest podyktowany wymaganiem „pierwsze fiszki w ciągu 30 sekund": 0,57 s do pierwszego tokenu i 63 tps mieszczą 20 fiszek w budżecie z zapasem, podczas gdy `gpt-5-mini` startuje po 3,79 s przy tej samej cenie. **Zastrzeżenie**: 0,57 s to czas do pierwszego tokenu bez rozumowania. Faza rozumowania poprzedza pierwszy token treści, więc przy włączonym rozumowaniu przewaga względem `gpt-5-mini` może się skurczyć albo zniknąć. Jeśli pomiar z fazy 9 to potwierdzi, otwarte są dwa wyjścia: `reasoning: { enabled: false }` albo zejście na `flash-lite`, gdzie rozumowanie jest wyłączone domyślnie.

## Migration Notes

Jedna migracja (faza 2), wyłącznie dodająca funkcję — bez zmian w tabelach, bez przenoszenia danych, bez ryzyka dla istniejących wierszy. Wycofanie to `drop function public.recount_generation_acceptance(uuid)`.

Cykl obowiązujący przy każdej zmianie schematu, ustalony w F-02: `npm run db:reset` → `npm run db:test` → `npm run db:types` → `npx astro check`. Pominięcie ostatniego kroku daje typy starsze niż schemat, i to jest dokładnie ten błąd, który F-02 popełniło raz.

`generated_count` w istniejących wierszach nie wymaga niczego — tabela `generations` jest dziś pusta.

## References

- Research: [context/changes/first-gated-generation/research.md](context/changes/first-gated-generation/research.md)
- Tożsamość zmiany: [context/changes/first-gated-generation/change.md](context/changes/first-gated-generation/change.md)
- Roadmapa (S-02): [context/foundation/roadmap.md](context/foundation/roadmap.md)
- Rejestr nazw nośnych: [docs/reference/contract-surfaces.md](docs/reference/contract-surfaces.md)
- Kontrakt SRS (F-01): [context/archive/2026-08-23-srs-algorithm-contract/plan.md](context/archive/2026-08-23-srs-algorithm-contract/plan.md)
- Schemat i izolacja (F-02): [context/archive/2026-08-24-flashcards-schema-isolation/plan.md](context/archive/2026-08-24-flashcards-schema-isolation/plan.md)
- Lekcje z przeglądu F-02: [context/archive/2026-08-24-flashcards-schema-isolation/reviews/impl-review.md](context/archive/2026-08-24-flashcards-schema-isolation/reviews/impl-review.md)
- Ograniczenia środowiska: [context/foundation/infrastructure.md](context/foundation/infrastructure.md)
- Wzorzec endpointu: [src/pages/api/auth/signin.ts](src/pages/api/auth/signin.ts)
- Wzorzec testu bazy: [supabase/tests/rls_flashcards.test.sql](supabase/tests/rls_flashcards.test.sql)
- Wzorzec testu jednostkowego: [src/lib/srs/scheduler.test.ts](src/lib/srs/scheduler.test.ts)

## Progress

> Konwencja: `- [ ]` oczekuje, `- [x]` zrobione. Po wylądowaniu kroku dopisz ` — <commit sha>`. Nie zmieniaj tytułów kroków.

### Phase 1: Fundament serwerowy

#### Automated

- [x] 1.1 Typy się zgadzają: `npx astro sync && npx astro check` — 881f950
- [x] 1.2 Lint przechodzi: `npm run lint` — 881f950
- [x] 1.3 Build przechodzi: `npm run build` — 881f950
- [x] 1.4 Nowa reguła działa: `console.log` w endpointcie daje błąd, nie ostrzeżenie — 881f950

#### Manual

- [x] 1.5 Bez `OPENROUTER_API_KEY` strona pokazuje banner i nadal działa — 881f950
- [x] 1.6 Po dodaniu klucza banner znika — 881f950

### Phase 2: Funkcja przeliczająca liczniki akceptacji

#### Automated

- [x] 2.1 Migracja aplikuje się czysto: `npm run db:reset` — 3ffee55
- [x] 2.2 Testy bazy przechodzą: `npm run db:test` — 3ffee55
- [x] 2.3 Typy przeładowane: `npm run db:types` — 3ffee55
- [x] 2.4 Typy zgodne ze schematem: `npx astro check` — 3ffee55
- [x] 2.5 Lint przechodzi: `npm run lint` — 3ffee55

#### Manual

- [x] 2.6 Asercja izolacji faktycznie testuje mechanizm (próba z `security definer` daje czerwony wynik) — 3ffee55
- [x] 2.7 Migracja wypchnięta na chmurę i funkcja widoczna w Dashboardzie — 3ffee55
- [x] 2.8 Ciało funkcji zaczyna się od `for update` na wierszu zlecenia — 3ffee55

### Phase 3: Adapter OpenRoutera jako czyste funkcje

#### Automated

- [x] 3.1 Testy przechodzą: `npm test` — fd3b3a2
- [x] 3.2 Typy się zgadzają: `npx astro check` — fd3b3a2
- [x] 3.3 Lint przechodzi: `npm run lint` — fd3b3a2
- [x] 3.4 Adapter nie odwołuje się do `console` ani do `astro:env` — fd3b3a2

#### Manual

- [x] 3.5 Prompt sprawdzony ręcznie na własnym tekście — propozycje atomowe, w języku wejścia, w limitach — fd3b3a2

### Phase 4: `POST /api/generations`

#### Automated

- [x] 4.1 Typy się zgadzają: `npx astro check`
- [x] 4.2 Lint przechodzi, w tym `no-console: "error"`: `npm run lint`
- [x] 4.3 Build przechodzi: `npm run build`
- [x] 4.4 Testy przechodzą: `npm test`

#### Manual

- [x] 4.5 Żądanie bez sesji zwraca `401`, nie `500`
- [x] 4.6 Za krótki tekst zwraca `400`, a komunikat nie zawiera wejścia
- [x] 4.7 Poprawne żądanie zwraca propozycje i `generationId`
- [x] 4.8 Wiersz w `generations` ma niezerowy `generated_count` i poprawny skrót; kolumny z tekstem brak
- [x] 4.9 `wrangler tail` nie pokazuje fragmentu wklejonego tekstu

### Phase 5: `POST /api/flashcards`

#### Automated

- [ ] 5.1 Typy się zgadzają: `npx astro check`
- [ ] 5.2 Lint przechodzi: `npm run lint`
- [ ] 5.3 Build przechodzi: `npm run build`
- [ ] 5.4 Testy przechodzą: `npm test`

#### Manual

- [ ] 5.5 Zapis z poprawnym `generationId` zwraca `201` i tworzy wiersz z 9 polami harmonogramu
- [ ] 5.6 Zapis z cudzym `generationId` zwraca `404` i nie tworzy wiersza
- [ ] 5.7 Liczniki po dwóch zapisach (jeden edytowany) pokazują `1` i `1`
- [ ] 5.8 Powtórzone żądanie nie zawyża liczników
- [ ] 5.9 `front` o długości 501 znaków zwraca `400`, nie `500`

### Phase 6: Ekran `/generate`

#### Automated

- [ ] 6.1 Typy się zgadzają: `npx astro check`
- [ ] 6.2 Lint przechodzi, w tym `react-compiler`: `npm run lint`
- [ ] 6.3 Build przechodzi: `npm run build`

#### Manual

- [ ] 6.4 Niezalogowany na `/generate` trafia na `/auth/signin`
- [ ] 6.5 Generowanie daje listę propozycji w rozsądnym czasie
- [ ] 6.6 Zapis, edycja i odrzucenie działają per karta; odrzucona nie trafia do bazy
- [ ] 6.7 `source` rozróżnia `ai` i `ai_edited`, a wejście w edycję bez zmian daje `ai`
- [ ] 6.8 Licznik postępu zgadza się z liczbą zapisanych
- [ ] 6.9 Błąd generowania pokazuje komunikat z ponowieniem i zachowuje tekst
- [ ] 6.10 Odświeżenie strony w trakcie przeglądu gubi niezapisane propozycje

### Phase 7: Ekran `/deck` i nawigacja

#### Automated

- [ ] 7.1 Typy się zgadzają: `npx astro check`
- [ ] 7.2 Lint przechodzi: `npm run lint`
- [ ] 7.3 Build przechodzi: `npm run build`

#### Manual

- [ ] 7.4 Zapisane fiszki widoczne na `/deck` z właściwym pochodzeniem
- [ ] 7.5 Konto bez fiszek widzi stan pusty z odnośnikiem do `/generate`
- [ ] 7.6 Drugie konto nie widzi cudzych fiszek
- [ ] 7.7 Odnośniki z `/dashboard` prowadzą do obu ekranów

### Phase 8: Ujednolicenie systemu stylów

#### Automated

- [ ] 8.1 Typy się zgadzają: `npx astro check`
- [ ] 8.2 Lint przechodzi: `npm run lint`
- [ ] 8.3 Build przechodzi: `npm run build`
- [ ] 8.4 `git diff` nie zawiera zmian poza atrybutami klas i importami

#### Manual

- [ ] 8.5 Rejestracja, logowanie i wylogowanie działają bez zmian
- [ ] 8.6 Komunikat błędu z `?error=` nadal się wyświetla
- [ ] 8.7 Ekrany wyglądają spójnie
- [ ] 8.8 Banner braku konfiguracji nadal się wyświetla

### Phase 9: Weryfikacja na wdrożonej instancji

#### Automated

- [ ] 9.1 Build produkcyjny przechodzi: `npm run build`
- [ ] 9.2 `npx wrangler dev` startuje bez błędów
- [ ] 9.3 Pełny zestaw bramek CI zielony na `master`

#### Manual

- [ ] 9.4 Pełny przepływ działa na wdrożonej instancji
- [ ] 9.5 `privacyMode` odnotowany — czy pula ZDR jest dostępna dla wybranego modelu
- [ ] 9.6 Wszystkie trzy liczniki poprawne po przejściu przez przegląd
- [ ] 9.7 `wrangler tail` nie pokazuje wklejonego tekstu ani w logach, ani w błędach
- [ ] 9.8 Pierwszy pomiar `accepted_unedited_count / generated_count` dla dwóch własnych tekstów
- [ ] 9.9 `reasoning_tokens` odnotowane; żadne generowanie nie kończy się `finish_reason: "length"`
