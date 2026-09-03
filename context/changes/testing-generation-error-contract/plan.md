# Kontrakt błędów generowania — Implementation Plan

## Overview

Rollout Phase 1 z [`context/foundation/test-plan.md` §3](../../foundation/test-plan.md). Dowodzimy dwóch
kontraktów, które dziś nie mają pokrycia:

- **Ryzyko #1** — każda klasa awarii dostawcy (sieć, timeout, limit dostawcy, błąd upstream, zły kształt,
  obcięcie, brak propozycji) kończy się **rozróżnialnym, nie-pustym** komunikatem, a do kolekcji nie
  trafia żadna propozycja.
- **Ryzyko #5** — po zakończeniu żądania wklejony tekst źródłowy nie istnieje w żadnym trwałym zapisie,
  logu ani treści błędu.

Faza jest **wyłącznie testowa**: żadnych zmian zachowania produkcyjnego. Cztery pakiety testów (P1–P4)
plus selektywny przebieg Stryker plus aktualizacja cookbooka. Substrat i obejścia techniczne są
zweryfikowane empirycznie w [research.md](research.md) — plan je konsumuje, nie odkrywa na nowo.

## Current State Analysis

**Co istnieje:**

- `src/lib/openrouter/parse.test.ts` — 11 przypadków, 8 negatywnych, bez mirror testów; zawiera już jedną
  asercję ryzyka #5 ([:91](../../../src/lib/openrouter/parse.test.ts#L91)).
- `src/lib/generations/service.test.ts` — 6 przypadków hermetycznych na `SupabaseStub`; **mockuje wewnętrzny
  moduł** `@/lib/openrouter/client` (uzasadnione na poziomie serwisu, ale niezgodne z wymogiem
  [test-plan.md §4](../../foundation/test-plan.md) „mockowanie wyłącznie na granicy sieci" dla tej fazy).
- `src/pages/api/flashcards.test.ts` — konwencja testu trasy: handler wołany jako zwykła funkcja, `locals`
  jako goły literał, `context()` **kopiowany do pliku** (udokumentowana konwencja, nie zaniedbanie), rzut
  `as never`.
- `src/components/review/ReviewSession.test.tsx` — wzorzec `jsonResponse` + `stubFetch` +
  `vi.unstubAllGlobals()` w `afterEach`; `// @vitest-environment jsdom` jako pragma per-plik.
- `supabase/tests/*.test.sql` — dwa testy pgTAP (`begin; select plan(N); … rollback;`), uruchamiane przez
  `npm run db:test`; **nie są krokiem CI**.
- `src/lib/test-support/supabase-stub.ts` — rejestrator wywołań: kolejka wyników **pozycyjna i współdzielona
  między `from()` a `rpc()`**, brak modelowania constraintów/RLS/kaskad, `rpc` to no-op.

**Czego brakuje (uporządkowane wg wartości, z [research.md §7](research.md)):**

1. `src/lib/openrouter/client.ts` — **zero testów.** Cała granica HTTP: klasyfikacja awarii, fallback ZDR,
   współdzielony budżet timeoutu, nowy kod `rate_limited`.
2. `src/pages/api/generations.ts` — **zero testów.** Cała drabina statusów i wszystkie stałe ciała błędu.
3. `src/components/generate/GenerateView.tsx` — **zero testów.** W szczególności pusta tablica propozycji
   i „komunikat dociera do DOM".
4. Oba CHECK-i anty-wyciekowe (`generations_source_text_hash_format`, `generations_error_code_shape`) —
   **zero pokrycia.**
5. Brak asercji, że przy awarii **żadne zapytanie nie dotyka `flashcards`**.

**Blokada techniczna (zweryfikowana, tania):** import `src/pages/api/generations.ts` pod Vitestem pada na
`astro:env/server`. Gołe `vi.mock("astro:env/server", () => ({ OPENROUTER_API_KEY: "test-key" }))` na górze
pliku testowego wystarcza — bez zmian w `vitest.config.ts`, bez aliasu, bez fixture. Sparowane z
`vi.hoisted` daje mutowalny klucz (gałąź 503 „brak konfiguracji" testowalna).

## Desired End State

Po tej fazie:

- `npx vitest run` obejmuje `client.test.ts`, `generations.test.ts`, `GenerateView.test.tsx` i przechodzi
  w CI (bramka `unit + integration` z [test-plan.md §5](../../foundation/test-plan.md)).
- Każda z klas awarii A–J z [research.md §2](research.md) ma asercję na co najmniej jednej warstwie wg
  matrycy w [§Pokrycie klas awarii](#pokrycie-klas-awarii-traceability) (E/G/H w istniejącym `parse.test.ts`,
  J poza zakresem jako nie-awaria). Asercja jest **behawioralna** (konkretny tekst / `code` / `status`, nie
  „istnieje alert"); klasy niosące instrukcję (`timeout`, `network`, `rate_limited`, `truncated`,
  `no_proposals`) są rozróżnialne **wzajemnie** — egzekwowane jednym `it.each` w P2.
- Istnieje asercja, że przy dowolnej awarii dostawcy `supabase.queries.every(q => q.table !== "flashcards")`.
- Istnieje asercja, że dla każdej klasy awarii `JSON.stringify` błędu i treść odpowiedzi HTTP **nie zawiera**
  sentinela wstawionego jako tekst źródłowy.
- `npm run db:test` obejmuje pięć nowych asercji pgTAP: kształt `source_text_hash`, kształt `error_code`,
  obie strony biwarunku `error_code ⟺ status='failed'`, plus wiersz kanoniczny (kontrola pozytywna).
  Pozostaje **bramką ad hoc** (CI wpina Faza 2).
- Jeden przebieg Stryker na `client.ts` + `generations.ts` jest wykonany, a każdy przeżywający mutant jest
  albo zabity nową asercją, albo świadomie zignorowany z jednozdaniowym uzasadnieniem w `## Progress`.
- [test-plan.md §6.1 i §6.2](../../foundation/test-plan.md) są wypełnione; §6.7 ma notatkę per fazę;
  §3 Phase 1 Status = `complete`.

### Key Discoveries:

- **Oracle jest prescriptywny i kompletny** — drabina statusów, koperta `{ error: string }`, zakaz
  `error.issues`, stałe komunikaty: [`context/archive/2026-08-25-first-gated-generation/plan.md` §Phase 3–4](../../archive/2026-08-25-first-gated-generation/plan.md), tekst napisany **przed** kodem.
- **`OpenRouterError` niesie prawdziwy status HTTP** ([client.ts:41](../../../src/lib/openrouter/client.ts#L41)),
  ale trasa czyta wyłącznie `caught.message` — rozróżnialność `rate_limited` jest w komunikacie, nie w statusie
  (mapowanie zostaje 502).
- **Fallback ZDR: `data_collection: "deny"` przeżywa** ([client.ts:114-117](../../../src/lib/openrouter/client.ts#L114-L117));
  usuwany jest wyłącznie klucz `zdr`. Oba żądania dzielą **ten sam** `AbortSignal`
  ([client.ts:123](../../../src/lib/openrouter/client.ts#L123)).
- **404 ZDR-route-missing jest zakotwiczony**: `/^no allowed providers are available/i`
  ([client.ts:14](../../../src/lib/openrouter/client.ts#L14)); `"Resource not found"` **nie** ponawia.
- **`GenerateView` nigdy nie sprawdza `response.status`** ([GenerateView.tsx:109-113](../../../src/components/generate/GenerateView.tsx#L109-L113)):
  komunikaty serwera **są całym kontraktem rozróżnialności** po stronie UI.
- **Na trasie `/api/generations` „zero zapisów fiszek" jest prawdziwe trywialnie** — moduł nie referuje
  `flashcards`. Asercja i tak jest tania (`SupabaseStub` ją daje) i chroni przed regresją.
- **`SupabaseStub` kolejka jest pozycyjna** — dorzucenie zapytania w serwisie przesuwa wszystkie późniejsze
  indeksy `supabase.queries[n]`.

## What We're NOT Doing

- **Nie zmieniamy zachowania produkcyjnego.** Żadnej obrony klienta przed `proposals: []`, żadnej naprawy
  `markFailed`, żadnego eksportu stałej `REQUEST_TIMEOUT_MS`. Faza jest testowa.
- **Nie naprawiamy osieroconego wiersza `pending`** (Q3 z [research.md](research.md)) — gdy `markFailed`
  sam zawiedzie, wiersz zostaje `pending` na zawsze i liczy się do limitu dobowego. Żadne źródło nie mówi,
  co powinno się stać; asercja fixuje wyłącznie **obserwowalny** kontrakt (oryginalny błąd przerzucony,
  użytkownik dostaje 502). Naprawa → kandydat do Fazy 2 / `lessons.md`.
- **Nie piszemy pakietu „`POST /api/flashcards` odrzuca `generationId` generowania `failed`/`pending`"** —
  strażnik jest aplikacyjny i splata się z własnością rekordu (ryzyko #2), które jest tematem Fazy 2.
  Odłożone świadomie ([research.md §Rekomendacja](research.md)).
- **Nie wpinamy pgTAP do CI** — to [test-plan.md §5](../../foundation/test-plan.md) „required after §3 Phase 2".
  P4 zostaje bramką ad hoc.
- **Nie testujemy literalnej wartości 45 000 ms** — `AbortSignal.timeout` używa timera nieprzechwytywanego
  przez fake timers Vitesta, a stała nie jest eksportowana. Świadome wyłączenie, nie luka. Testujemy
  wyłącznie **rozróżnienie** `timeout` vs `network` po `error.name`.
- **Nie oceniamy odwracalności hasha SHA-256** — litera PRD („nie pozostaje w storage") jest spełniona;
  dolny limit długości wejścia (`SOURCE_TEXT_MIN = 200`) jest przyjętą mitygacją.
- **Nie zmieniamy `service.test.ts`** — jego mock wewnętrznego modułu jest uzasadniony na poziomie serwisu;
  nowe testy tej fazy stubują `fetch`.
- **`docs/reference/contract-surfaces.md`**: w Fazie 6 dopisujemy **wyłącznie** tabelę kolumn
  `public.generations` (`status`, `error_code` + CHECK-i) — to powierzchnia, którą ta faza czyni
  wykonywalną specyfikacją. Reszta dryfu rejestru (`/api/flashcards/:id` jako „proponowane", martwa
  linia S-06) zostaje poza zakresem.

## Implementation Approach

**Dwie warstwy, od najtańszej.** [research.md §Rekomendacja](research.md) rozstrzyga substrat: realne
lokalne Supabase **nie jest potrzebne** — trasa pisze wyłącznie do `generations`, a jedyne asercje, przy
których stub kłamie (constrainty bazy), wyrażają się taniej i mocniej bezpośrednio w pgTAP.

Kolejność faz: **hermetyczny unit → integracja trasy → komponent → pgTAP → mutacja → cookbook.** P1 zakłada
wzorzec `stubFetch`, który reużywa P2 i P3. P2 zależy od obejścia `astro:env/server`. Stryker wymaga P1 i P2
zielonych. Cookbook zbiera wnioski na końcu.

**Rozróżnialność jest własnością end-to-end.** Informacja o klasie awarii powstaje w `client.ts`
(gdzie `status: 429` istnieje), jest redukowana do `code` w `service.ts`, do `message` w `generations.ts`
i do jednego Alertu w `GenerateView`. Każda warstwa gubi trochę — stąd trzy warstwy testów, nie jedna.

**Fixture'y budujemy z cytowanych ciał, nie z kształtu implementacji.** Dla `client.ts` źródłem prawdy są
[docs OpenRoutera](https://openrouter.ai/docs/api_reference/errors-and-debugging) cytowane w
[research.md §Zmiany wprowadzone w trakcie researchu](research.md). Dla trasy i UI — drabina z planu S-02.

### Pokrycie klas awarii (traceability)

Klasy wg [research.md §2](research.md). Każda ma asercję na co najmniej jednej warstwie; kolumna „Asercja"
mówi, co konkretnie jest dowodzone.

| Klasa | Wyzwalacz | Warstwa / plik | Asercja |
|---|---|---|---|
| A `network` | `fetch` odrzuca (`name` ≠ `TimeoutError`/`AbortError`) | P1 `client.test.ts`; P2 `generations.test.ts` | `code: "network"`; komunikat ≠ `timeout`/`rate_limited`; nie-pusty |
| B `timeout` | `fetch` odrzuca `TimeoutError` / `AbortError` | P1; P2 | `code: "timeout"`; B ≠ A; nie-pusty |
| C1 `rate_limited` | HTTP 429 **lub** `error_type === "rate_limit_exceeded"` | P1 (oba sygnały); P2 | `code: "rate_limited"`; ≠ C2; niesie instrukcję „odczekaj" |
| C2 `upstream` | 401 / 5xx / 404 spoza kontraktu ZDR | P1 (401 i 503 dzielą komunikat); P2 | `code: "upstream"`; C2 ≠ C1 |
| D `upstream` (200 + nie-JSON) | HTTP 200, body nie-JSON | P1 | `code: "upstream"`, `status: 200` (jedyne odróżnienie od C2 — świadome, [research Q1](research.md)) |
| E `malformed_response` | brak `choices` / zły kształt koperty | **istniejący** `parse.test.ts` (bez zmian); P2 (jedna ścieżka) | `code: "malformed_response"`; nie-pusty |
| F `truncated` | `finish_reason === "length"` | `parse.test.ts`; P2 | `code: "truncated"`; ≠ pozostałe klasy z instrukcją |
| G/H `malformed_response` | `content` nie parsuje się / brak tablicy `flashcards` | **istniejący** `parse.test.ts` (bez zmian) | zbiorczo z E — ten sam `code`, świadomie |
| I `no_proposals` | ani jedna propozycja nie przeszła walidacji | `parse.test.ts`; P2; P3 (tripwire `proposals: []`) | `code: "no_proposals"`; ≠ pozostałe klasy z instrukcją |
| J (część OK, część nie) | mieszane propozycje → **200, nie rzuca** | **poza zakresem** — nie jest ścieżką awarii; ciche odrzucenie zgodne z planem S-02, pokryte w `parse.test.ts` |

Wzajemna różność jest wymagana dla klas niosących instrukcję (`timeout`, `network`, `rate_limited`,
`truncated`, `no_proposals`) i egzekwowana jednym `it.each` w P2 — warstwie, na której wszystkie się
pojawiają. Klasy „wina operatora" (`upstream`, `malformed_response`) dzielą komunikat świadomie; ich
asercja to nie-pustość plus różność od klas z instrukcją.

## Critical Implementation Details

- **`SupabaseStub` kolejka jest pozycyjna i współdzielona `from()`/`rpc()`.** `createGeneration` robi
  sekwencję: `select` (limit) → `insert` (rezerwacja, `.select("id").single()`) → `update` (sukces LUB
  `markFailed`). Dla ścieżki awarii dostawcy trzeci wynik w kolejce to update `markFailed`. Asercje na
  `supabase.queries[n]` muszą liczyć tę sekwencję; dorzucenie zapytania w serwisie je przesunie.
- **Współdzielony `AbortSignal` sprawdza się przez tożsamość referencji**: `calls[0][1].signal ===
  calls[1][1].signal` na dwóch wywołaniach `fetch` w ścieżce fallbacku ZDR. To nazwany kontrakt
  ([client.ts:122](../../../src/lib/openrouter/client.ts#L122)), nie szczegół implementacji.
- **`privacyMode` przełącza się na `"standard"` w momencie wysłania drugiego żądania**
  ([client.ts:128-130](../../../src/lib/openrouter/client.ts#L128-L130)) — asercja „nie przełączył się, gdy
  404 nie pasował" wymaga przypadku z 404 typu `"Resource not found"`.
- **`vi.hoisted` + `vi.mock("astro:env/server")`**: mutowalny obiekt klucza pozwala jednym plikiem pokryć
  gałąź 503 „brak `OPENROUTER_API_KEY`" i gałęzie z kluczem obecnym. `supabase: null` w `locals` pokrywa
  drugą przyczynę 503. **Zweryfikowane w researchu**: `vi.mock` odblokowuje import, a ścieżki 401/503
  (`supabase: null`)/400 przechodzą. **Nie** zweryfikowano tam mutacji klucza między testami — jeśli żywe
  wiązanie importu `OPENROUTER_API_KEY` nie odzwierciedli podmiany właściwości obiektu z `vi.hoisted`,
  fallback: fabryka `vi.mock` czyta moduł-zmienną `let` resetowaną w `beforeEach`, **albo** gałąź pustego
  klucza idzie do osobnego pliku z własnym `return` fabryki (bez mutacji). Wybór fallbacku nie zmienia
  asercji ani kontraktu — tylko mechanikę.
- **pgTAP: `error_code` biwarunek.** CHECK `generations_error_code_only_when_failed` to
  `(status = 'failed') = (error_code is not null)` — test musi sprawdzić **obie** strony: `failed` bez kodu
  odrzucone, `pending`/`succeeded` z kodem odrzucone.
- **jsdom timeout klienta**: `GENERATE_TIMEOUT_MS = 60_000` i `AbortSignal.timeout`
  ([GenerateView.tsx:104](../../../src/components/generate/GenerateView.tsx#L104)) — odrzucenie `fetch`
  przez `AbortError` wpada w `catch` i daje **ten sam** komunikat co offline. To zachowanie do
  **przypięcia** (regresja byłaby zmianą na gorsze), nie do naprawy w tej fazie.

---

## Phase 1: P1 — `client.test.ts` (hermetyczny, stub `fetch`)

### Overview

Pierwszy test `src/lib/openrouter/client.ts`. Pokrywa klasyfikację awarii, kompletny kontrakt fallbacku ZDR
i brak wycieku tekstu źródłowego. Zakłada wzorzec `stubFetch` reużywany przez P2/P3. Pokrywa zmianę
wprowadzoną w trakcie researchu (`rate_limited`, zakotwiczony 404).

### Changes Required:

#### 1. Nowy plik testowy

**File**: `src/lib/openrouter/client.test.ts`

**Intent**: Udowodnić, że każde wyjście z `generateFlashcards` niesie rozróżnialny sygnał klasy awarii i że
żaden `OpenRouterError` nie przenosi tekstu źródłowego. Fixture'y odpowiedzi budowane z ciał cytowanych w
researchu / docach OpenRoutera, nie z kształtu `client.ts`.

**Contract**: `generateFlashcards(apiKey: string, sourceText: string): Promise<GenerationOutcome>`.
Steruje wyłącznie `vi.stubGlobal("fetch", …)` (wzorzec `stubFetch` z
[ReviewSession.test.tsx:18-25](../../../src/components/review/ReviewSession.test.tsx#L18-L25)),
`vi.unstubAllGlobals()` w `afterEach`. Przypadki:

- **Klasa A (network)** — `fetch` odrzuca `Error` z `name: "TypeError"` (albo dowolnym ≠ `TimeoutError`/`AbortError`) → `OpenRouterError` z `code: "network"`, komunikat `"Nie udało się połączyć z dostawcą modelu…"`.
- **Klasa B (timeout)** — `fetch` odrzuca `Error` z `name: "TimeoutError"` **oraz** osobno `name: "AbortError"` → `code: "timeout"`, komunikat `"Model nie odpowiedział na czas…"`. Asercja: B ≠ A na poziomie komunikatu.
- **Klasa C1 (rate_limited) — dwa sygnały.** (a) HTTP 429 z dowolnym ciałem → `code: "rate_limited"`, `status: 429`. (b) HTTP **inny niż 429** (np. 500) z ciałem `{ error: { code: 429, message: "Rate limit exceeded", metadata: { error_type: "rate_limit_exceeded" } } }` → `code: "rate_limited"`. Komunikat `"…chwilowo ogranicza liczbę żądań. Odczekaj chwilę…"`, rozróżnialny od C2.
- **Klasa C2 (upstream)** — HTTP 401 oraz osobno HTTP 503, ciała bez sygnału limitu → `code: "upstream"`. Asercja: 401 i 503 **dzielą** komunikat (świadomie, [research.md Q1](research.md)), ale C2 ≠ C1.
- **Klasa D (upstream, 200 + nie-JSON)** — HTTP 200, body `"<html>502 Bad Gateway</html>"` → `OpenRouterError` `code: "upstream"`, `status: 200`.
- **Fallback ZDR — ścieżka pozytywna.** Pierwszy `fetch`: HTTP 404, body `{ error: { message: "No allowed providers are available for the selected model. …" } }`. Drugi `fetch`: HTTP 200 z poprawną kopertą. Asercje: (1) dokładnie dwa wywołania `fetch`; (2) ciało drugiego żądania **nie zawiera** klucza `zdr`; (3) ciało drugiego żądania **zawiera** `data_collection: "deny"` i `require_parameters: true`; (4) `calls[0][1].signal === calls[1][1].signal`; (5) wynik ma `privacyMode: "standard"`.
- **Fallback ZDR — brak ponowienia.** HTTP 404, body `{ error: { message: "Resource not found" } }` → dokładnie jedno wywołanie `fetch`, `OpenRouterError` `code: "upstream"`, `status: 404`, `privacyMode` **nie** zmienione (wynik nie powstaje — asercja na to, że drugi `fetch` nie padł).
- **Fallback ZDR — 404 z ciałem nie-JSON** — HTTP 404, body `"not json"` → brak ponowienia, `code: "upstream"`.
- **Brak wycieku (ryzyko #5).** `sourceText` = `"SEKRET-" + "x".repeat(300)`. Dla **każdej** klasy awarii powyżej: `error.message` i `JSON.stringify(error)` **nie zawiera** `"SEKRET-"`. Parametryzacja `it.each` po klasach.
- **Model fallback** — HTTP 200 z kopertą bez pola `model` → wynik `model === MODEL` (`"google/gemini-2.5-flash"`).

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `npx astro check`
- Lint przechodzi: `npm run lint`
- `npx vitest run src/lib/openrouter/client.test.ts` — wszystkie przypadki zielone
- Pełny `npm test` bez regresji
- `it.each` po klasach awarii dowodzi braku sentinela w `JSON.stringify(error)` dla każdej klasy

#### Manual Verification:

- Przegląd: asercje pierwszorzędne są **behawioralne** — wzajemna różność i nie-pustość komunikatów klas
  niosących instrukcję (`timeout`, `network`, `rate_limited`), porównywane **między sobą**, nie równość do
  importu z `client.ts`. Dozwolony najwyżej **jeden** lekki test „stała przekazana bez zmiany" na warstwę;
  kształty ciał odpowiedzi dostawcy pochodzą z cytatu docs w komentarzu przy fixture, nie z `client.ts`
- Przegląd: asercja współdzielonego sygnału testuje tożsamość referencji, nie liczbę timerów
- Fixture 404 ZDR używa dokładnego zdania z [docs router-metadata](https://openrouter.ai/docs/guides/features/router-metadata)

**Implementation Note**: Po zielonym automacie i przeglądzie — pauza na potwierdzenie manualne przed Phase 2.

---

## Phase 2: P2 — `generations.test.ts` (integracja trasy, hermetyczna)

### Overview

Pierwszy test `src/pages/api/generations.ts`. Pełna drabina statusów, wszystkie stałe ciała błędu, zakaz
`error.issues`, brak dotknięcia `flashcards`, obserwowalny kontrakt Q3, brak wycieku tekstu do zapisów i
ciał błędu.

### Changes Required:

#### 1. Nowy plik testowy

**File**: `src/pages/api/generations.test.ts`

**Intent**: Udowodnić, że trasa tłumaczy każdą klasę awarii na przewidziany status + **stałe** ciało
`{ error: string }`, że nic z wejścia ani z odpowiedzi dostawcy nie wychodzi w odpowiedzi HTTP, i że przy
awarii żadne zapytanie nie idzie do `flashcards`.

**Contract**: `POST: APIRoute` importowany jako funkcja i wołany bezpośrednio; `context()` kopiowany do
pliku wg konwencji [flashcards.test.ts:12-27](../../../src/pages/api/flashcards.test.ts#L12-L27) (`locals`
goły literał, prawdziwy `Request`, rzut `as never`). Na górze pliku:
`vi.mock("astro:env/server", () => keyModule)` gdzie `keyModule` z `vi.hoisted` — mutowalny, by pokryć 503.
`SupabaseStub` dla efektów ubocznych, `vi.stubGlobal("fetch", …)` dla granicy dostawcy. Przypadki:

- **401** — `user: null` → status 401, ciało `{ error: "Zaloguj się, aby generować fiszki." }`.
- **503 (dwie przyczyny)** — (a) `supabase: null`; (b) `OPENROUTER_API_KEY` pusty przez mutację
  `keyModule`. Oba → 503, ciało `{ error: "Generowanie fiszek jest chwilowo niedostępne — brakuje konfiguracji serwera." }`.
- **400** — (a) body nie-JSON (`request` z ciałem `"{"`); (b) `sourceText` za krótki (< 200);
  (c) `sourceText` za długi (> 10 000). Wszystkie → 400, **jedno** stałe ciało; **nigdy** pole `issues`
  w odpowiedzi (`JSON.parse(body)` ma klucze dokładnie `["error"]`).
- **429 (limit dobowy)** — `SupabaseStub` zwraca `count: DAILY_GENERATION_LIMIT` → 429, ciało zaczyna się
  od `"Wyczerpano dobowy limit"`. Asercja: to **nasze** 429, rozróżnialne od `rate_limited` dostawcy
  (który daje 502).
- **502 — klasy awarii dostawcy.** Stub `fetch` odtwarza klasy A/B/C1/C2/E/F/I z
  [research.md §2](research.md). Każda → status 502, ciało = **stały** komunikat odpowiedniego
  `OpenRouterError`/`GenerationParseError`. Asercja rozróżnialności: komunikaty `timeout`, `network`,
  `rate_limited`, `truncated`, `no_proposals` są **wzajemnie różne** w ciałach odpowiedzi.
- **500 — `quota_check_failed` / `persist_failed`.** `SupabaseStub` zwraca `error` na kroku limitu / na
  insercie rezerwacji → 500, stałe ciało serwisu.
- **Zero dotknięcia `flashcards` (ryzyko #1 + #5).** Dla ścieżki 502 (awaria dostawcy po rezerwacji):
  `supabase.queries.every(q => q.table !== "flashcards")` **oraz** `supabase.rpcCalls` jest puste.
- **Q3 — obserwowalny kontrakt.** Awaria dostawcy **i** `markFailed` zwraca `error` (trzeci wynik w
  kolejce stubu = `{ error: {...} }`): trasa nadal zwraca **502 z oryginalnym** komunikatem
  `OpenRouterError` (błąd update'u połknięty, [service.ts:77-79](../../../src/lib/generations/service.ts#L77-L79)),
  a nie 500. Komentarz w teście: osierocony wiersz `pending` to znany dług, patrz „What We're NOT Doing".
- **Brak wycieku do zapisów (ryzyko #5).** `sourceText` z sentinelem `"SEKRET-…"` (≥ 200 znaków).
  Po ścieżce 502: `JSON.stringify(supabase.queries)` **nie zawiera** `"SEKRET-"`; `payload` rezerwacji ma
  `source_text_hash` pasujący do `/^[0-9a-f]{64}$/` i `source_text_length` = długość, **bez** pola z prozą.
- **Brak wycieku do ciała błędu (ryzyko #5).** Dla 400 (zły `sourceText` z sentinelem) i dla 502
  (dostawca zwraca ciało echa promptu z sentinelem): treść odpowiedzi HTTP **nie zawiera** `"SEKRET-"`.

### Success Criteria:

#### Automated Verification:

- Typecheck: `npx astro check`
- Lint: `npm run lint`
- `npx vitest run src/pages/api/generations.test.ts` — zielone
- Pełny `npm test` bez regresji
- Asercja „`queries.every(q => q.table !== 'flashcards')`" obecna na ścieżce awarii
- Asercja **wzajemnej różności** ciał błędu dla `timeout`/`network`/`rate_limited`/`truncated`/`no_proposals`
  (porównanie **między sobą**) plus nie-pustości; najwyżej jeden lekki test „stała przekazana bez zmiany"
  ze stałą z importu (`MESSAGES` / `ERROR_MESSAGES`), literały drabiny (statusy, koperta, zakaz `issues`)
  cytowane inline z planu S-02
- Asercja „odpowiedź 400 ma klucze dokładnie `['error']`" (zakaz `issues`)

#### Manual Verification:

- Przegląd: `vi.hoisted` + `vi.mock("astro:env/server")` faktycznie pozwala zmutować klucz między testami
- Przegląd: indeksy `supabase.queries[n]` zgadzają się z sekwencją `createGeneration` (select → insert → update)
- Przegląd: sentinel `"SEKRET-"` jest jedynym markerem i nie występuje w żadnym fixture jako część stałej

**Implementation Note**: Po zielonym automacie i przeglądzie — pauza na potwierdzenie manualne przed Phase 3.

---

## Phase 3: P3 — `GenerateView.test.tsx` (komponent, jsdom)

### Overview

Pierwszy test `src/components/generate/GenerateView.tsx`. Dowodzi, że **dokładny** komunikat serwera
dociera do DOM i różni się między klasami awarii, oraz przypina dzisiejsze zachowanie dla `proposals: []`
jako regresyjny tripwire.

### Changes Required:

#### 1. Nowy plik testowy

**File**: `src/components/generate/GenerateView.test.tsx`

**Intent**: Udowodnić, że warstwa UI nie zwija rozróżnialności serwera do jednego komunikatu, oraz że
tekst źródłowy nie ląduje w DOM po błędzie. Przypiąć znane luki (pusta tablica, timeout = „brak
połączenia") testem, który **pęknie**, gdy serwer zacznie się zachowywać inaczej.

**Contract**: `// @vitest-environment jsdom` pragma; `render(<GenerateView />)` z
`@testing-library/react`; `userEvent` do wpisania tekstu i kliknięcia „Generuj fiszki"; `stubFetch` +
`jsonResponse` wg [ReviewSession.test.tsx:14-30](../../../src/components/review/ReviewSession.test.tsx#L14-L30);
`cleanup()` + `vi.unstubAllGlobals()` w `afterEach`. Wejście: `sourceText` ≥ 200 znaków, by przycisk był
aktywny. Przypadki:

- **Dokładny komunikat serwera w DOM.** Dla odpowiedzi `502 { error: "Model nie odpowiedział na czas. Spróbuj ponownie." }`: `screen.getByText(...)` na **pełnym** tekście (nie `queryByRole("alert")`). Osobny przypadek dla `502 { error: "Dostawca modelu chwilowo ogranicza liczbę żądań. Odczekaj chwilę i spróbuj ponownie." }`. Asercja: dwa różne teksty w DOM dla dwóch różnych odpowiedzi — dowód rozróżnialności.
- **Fallback przy ciele bez `error`.** `502 {}` oraz `502 { error: "" }` → w DOM tekst `"Coś poszło nie tak. Spróbuj ponownie."` (`FALLBACK_ERROR`). Przypięcie: pusty/brakujący `error` degraduje do fallbacku, ale **nadal jest błąd**, nie pusty ekran.
- **200 o złym kształcie → alert ogólny.** `200 { proposals: "nie-tablica" }` → `FALLBACK_ERROR` w DOM, brak ekranu review (`queryByRole("heading", { name: "Propozycje" })` jest `null`). Zły kształt nie zamienia się w pustkę — **dobrze**.
- **Tripwire: `200 { generationId, privacyMode: "zdr", proposals: [] }`** → **dziś** renderuje się nagłówek „Propozycje" i licznik „zapisano 0 z 0", **bez** błędu. Test asertuje ten stan z komentarzem: „regresja serwera przepuszczająca pustą tablicę odtworzy scenariusz ryzyka #1 — ten test wtedy pęknie; obrona klienta = Faza 2+". Patrz „What We're NOT Doing".
- **Tripwire: klientowy timeout = „brak połączenia".** `fetch` odrzuca `DOMException("", "AbortError")` → w DOM `"Nie udało się połączyć z serwerem. Spróbuj ponownie."` (ten sam co offline). Komentarz: timeout etykietowany jako awaria sieci — przypięte, nie naprawiane.
- **Ostrzeżenie trybu standard.** `200 { …, privacyMode: "standard", proposals: [ {front,back} ] }` → w DOM zdanie `"To generowanie wykonano bez trybu Zero Data Retention…"`. Osobno: `privacyMode: "smiec"` → **brak** tego ostrzeżenia (koercja do `"zdr"`), asercja bez przepisywania ternary — po prostu „ostrzeżenia nie ma".
- **Brak wycieku (ryzyko #5).** `sourceText` z sentinelem `"SEKRET-…"`; po odpowiedzi `502` z ciałem błędu: `document.body.textContent` **nie zawiera** `"SEKRET-"`. (Tekst jest w `<textarea value>`, nie w `textContent` — asercja na to, że nie przeciekł do Alertu ani nigdzie indziej poza polem wejścia.)

### Success Criteria:

#### Automated Verification:

- Typecheck: `npx astro check`
- Lint: `npm run lint`
- `npx vitest run src/components/generate/GenerateView.test.tsx` — zielone
- Pełny `npm test` bez regresji
- Asercje komunikatów używają `getByText` na pełnym stringu, nie `queryByRole("alert")`
- Przypadek `proposals: []` jest obecny i zielony (przypina obecne zachowanie)

#### Manual Verification:

- Przegląd: dowód rozróżnialności to **dwa różne teksty w DOM dla dwóch różnych odpowiedzi** (porównanie między sobą), nie równość do importu; `FALLBACK_ERROR` zacytowany jako stała UI
- Przegląd: komentarze przy tripwire'ach jasno mówią „przypięcie, nie kontrakt docelowy"
- Uruchomienie w trybie watch: test pęka po ręcznej zmianie komunikatu serwera (dowód, że asercja jest na tekst)

**Implementation Note**: Po zielonym automacie i przeglądzie — pauza na potwierdzenie manualne przed Phase 4.

---

## Phase 4: P4 — pgTAP: CHECK-i anty-wyciekowe

### Overview

Pięć asercji pgTAP na trzy CHECK-i, które strukturalnie blokują wyciek tekstu źródłowego do bazy.
Bramka **ad hoc** (`npm run db:test`), bez wpięcia do CI (to Faza 2).

### Changes Required:

#### 1. Nowy plik testowy pgTAP

**File**: `supabase/tests/generations_error_contract.test.sql`

**Intent**: Udowodnić, że baza fizycznie odrzuca (a) prozę w `source_text_hash`, (b) komunikat zamiast
kodu w `error_code`, (c) niespójność `error_code` ↔ `status`. Bez tych testów pierwsza migracja tknąca
`generations` może po cichu zdjąć CHECK.

**Contract**: `begin; select plan(5); … rollback;` wg konwencji
[recount_generation_acceptance.test.sql](../../../supabase/tests/recount_generation_acceptance.test.sql).
Seed: jeden `auth.users`, kolumny NOT NULL bez defaultu — `user_id`, `model`, `source_text_length`,
`source_text_hash`, `generation_duration` (wzór z pliku recount). **Dokładnie pięć** asercji, po jednej na
`throws_ok` / `lives_ok`:

1. **`throws_ok`** — `insert` z `source_text_hash = 'To jest wklejony akapit tekstu źródłowego.'`
   (proza, nie 64 hex) → naruszenie `generations_source_text_hash_format`.
2. **`throws_ok`** — `insert … status='failed', error_code='Model nie odpowiedział na czas. Spróbuj ponownie.'`
   (spacje, wielkie litery, kropka) → naruszenie `generations_error_code_shape` (`^[a-z_]{1,40}$`).
3. **`throws_ok`** — biwarunek `generations_error_code_only_when_failed`, strona (a): `status='failed'`
   z `error_code=null` → odrzucone.
4. **`throws_ok`** — biwarunek, strona (b): `status='pending'` z `error_code='timeout'` → odrzucone.
5. **`lives_ok`** — wiersz kanoniczny: `status='failed'`, `error_code='rate_limited'`,
   `source_text_hash = repeat('a', 64)` → przechodzi (kontrola pozytywna, że CHECK nie jest za wąski).

### Success Criteria:

#### Automated Verification:

- `npm run db:test` przechodzi lokalnie (wymaga `supabase start`)
- `select plan(5)` zgadza się z liczbą asercji w pliku
- Nowy plik nie psuje istniejących dwóch testów pgTAP

#### Manual Verification:

- Przegląd: `error_code='rate_limited'` jest w kontroli pozytywnej — kod wprowadzony w trakcie researchu
  faktycznie mieści się w CHECK `^[a-z_]{1,40}$`
- Odnotowane w `## Progress`, że to bramka ad hoc — CI wpina Faza 2
- `rollback` na końcu; test nie zostawia wierszy

**Implementation Note**: Po zielonym `db:test` i przeglądzie — pauza na potwierdzenie manualne przed Phase 5.

---

## Phase 5: Selektywny przebieg Stryker (`client.ts` + `generations.ts`)

### Overview

Jeden świadomy przebieg mutacyjny na dwóch plikach niosących logikę rozróżnialności, po zazielenieniu
P1 i P2. Nie bramka CI, nie pogoń za 100%.

### Changes Required:

#### 1. Jednorazowy przebieg Stryker — bez devDependency, bez zacommitowanej konfiguracji

**File**: brak trwałego artefaktu. Konfiguracja efemeryczna (`stryker.conf.json` w `.gitignore` albo
usunięta po przebiegu); żadnego wpisu w `package.json`.

**Intent**: Uruchomić Stryker **przez `npx`, jednorazowo**, z zakresem zawężonym do
`src/lib/openrouter/client.ts` i `src/pages/api/generations.ts`, runner Vitest. CLAUDE.md wprost chce
tej bramki jako selektywnej i ad hoc — commitowanie konfiguracji i dwóch devDependencies to scope creep.

**Contract**: dokładna komenda —
`npx --yes @stryker-mutator/core run --testRunner vitest --mutate "src/lib/openrouter/client.ts,src/pages/api/generations.ts"`
(runner Vitest pobierany przez `npx` w tym samym wywołaniu; jeśli Stryker wymaga pliku, tworzy się
minimalny `stryker.conf.json` i dopisuje do `.gitignore` w tym samym kroku, albo usuwa po przebiegu).
Raport HTML w `reports/mutation/` — również efemeryczny, dopisany do `.gitignore`.

#### 2. Triage przeżywających mutantów

**File**: `context/changes/testing-generation-error-contract/plan.md` (sekcja `## Progress`)

**Intent**: Dla każdego przeżywającego mutanta odpowiedzieć „czy ta zmiana zaszkodziłaby użytkownikowi
lub biznesowi": TAK → asercja do P1/P2, która go zabija; NIE (mutant równoważny / kosmetyczny) →
świadome zignorowanie z jednozdaniowym uzasadnieniem.

**Contract**: Lista w `## Progress` — mutant (plik:linia, operacja), werdykt, akcja. Nowe asercje trafiają
do istniejących plików P1/P2, nie do nowych.

### Success Criteria:

#### Automated Verification:

- `npx --yes @stryker-mutator/core run …` kończy się bez błędu wykonania, a po nim `git status` nie
  pokazuje `stryker.conf.json` w indeksie, wpisu w `package.json` ani niezignorowanego `reports/`
- Po dołożeniu asercji: `npm test` zielony
- Raport HTML wygenerowany (`reports/mutation/`, efemeryczny — w `.gitignore`)

#### Manual Verification:

- Każdy przeżywający mutant w `client.ts`/`generations.ts` ma zapisany werdykt w `## Progress`
- Żadna dołożona asercja nie przypina kosmetycznego szczegółu tylko po to, by podnieść wynik
  (sama byłaby vibe testem)
- Mutanty w logice `upstreamCode` / `isZdrRouteMissing` / drabinie statusów są zabite (to serce rozróżnialności)

**Implementation Note**: Po przeglądzie triage'u — pauza na potwierdzenie manualne przed Phase 6.

---

## Phase 6: Cookbook + synchronizacja

### Overview

Zebranie wzorców tej fazy do `test-plan.md §6` i przesunięcie statusów.

### Changes Required:

#### 1. Cookbook §6.1 — test jednostkowy

**File**: `context/foundation/test-plan.md`

**Intent**: Zastąpić „TBD — see §3 Phase 1" wzorcem dla parsowania odpowiedzi dostawcy i translacji awarii:
`vi.stubGlobal("fetch")`, fixture z cytowanego ciała docs (nie z kształtu kodu), `it.each` po klasach awarii,
asercja braku sentinela w `JSON.stringify(error)`. **Asercje pierwszorzędne są behawioralne** — wzajemna
różność i nie-pustość komunikatów, porównywane między sobą, nie równość do importu z modułu testowanego;
najwyżej jeden lekki test „stała przekazana bez zmiany" na warstwę.

**Contract**: Sekcja §6.1, 5–10 linii + odnośnik do `src/lib/openrouter/client.test.ts` jako wzorca.

#### 2. Cookbook §6.2 — test integracyjny trasy API

**File**: `context/foundation/test-plan.md`

**Intent**: Zastąpić „TBD" wzorcem „awaria dostawcy → rozróżnialny błąd, zero zapisów, tekst źródłowy nie
przeżywa żądania": `vi.mock("astro:env/server")` + `vi.hoisted`, `context()` kopiowany do pliku,
`SupabaseStub` + stub `fetch`, asercja `queries.every(q => q.table !== 'flashcards')`, asercja kluczy
odpowiedzi = `['error']`. Rozróżnialność dowodzona przez **wzajemną różność** ciał błędu (porównanie
między sobą), nie przez równość do importu ze modułu trasy.

**Contract**: Sekcja §6.2 + odnośnik do `src/pages/api/generations.test.ts`.

#### 3. Notatka per faza §6.7

**File**: `context/foundation/test-plan.md`

**Intent**: 2–3 linie: gdzie wylądował wzorzec `stubFetch` (zduplikowany, nie współdzielony — konwencja
projektu), że obejście `astro:env/server` jest jednolinijkowe, że pgTAP dla `generations` jest bramką ad hoc.

**Contract**: Wpis w §6.7 z datą.

#### 4. Przesunięcie statusów

**File**: `context/foundation/test-plan.md` §3 (Status → `complete`), `context/changes/testing-generation-error-contract/change.md` (`status: complete`, `updated: <data>`)

**Intent**: Odzwierciedlić wylądowanie fazy. **Nie** dotykać §1–§5 strategii ani Risk Map.

**Contract**: §3 wiersz Phase 1 kolumna Status = `complete`. `change.md` frontmatter.

#### 5. Rejestr `contract-surfaces.md` — kolumny `public.generations`

**File**: `docs/reference/contract-surfaces.md` (§Nazwy w danych)

**Intent**: Dopisać tabelę kolumn `public.generations` (`status public.generation_status`,
`error_code text` + dwa CHECK-i: `generations_error_code_shape` `^[a-z_]{1,40}$` i
`generations_error_code_only_when_failed` `(status='failed') = (error_code is not null)`) plus istniejące
`source_text_length` / `source_text_hash` z CHECK `^[0-9a-fA-F]{64}$`. Ta faza czyni te kolumny
wykonywalną specyfikacją (P2 + P4) — rejestr ma je odzwierciedlać. **Reszta** dryfu rejestru
(`/api/flashcards/:id` jako „proponowane", martwa linia S-06) zostaje poza zakresem.

**Contract**: Nowa podsekcja „### Tabela `public.generations`" w §Nazwy w danych, format tabeli jak
`public.flashcards`. Kolumna „Wprowadza" = S-02.

#### 6. Rejestr `lessons.md` — kandydat (opcjonalnie)

**File**: `context/foundation/lessons.md`

**Intent**: Jeśli triage Stryker albo pisanie testów ujawni regułę wartą utrwalenia (np. „osierocony
wiersz `pending` po podwójnej awarii" jako klasa błędu do Fazy 2), dopisać wpis. Jeśli nic — pominąć.

**Contract**: Append-only wpis wg formatu pliku, albo świadome pominięcie odnotowane w `## Progress`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` (obejmuje markdown? jeśli nie — pominąć) i `npx astro check` bez regresji
- `git grep -n "TBD — see §3 Phase 1" context/foundation/test-plan.md` nie zwraca §6.1 ani §6.2
- `npm test` zielony (pełny pakiet)

#### Manual Verification:

- §6.1 i §6.2 są konkretne (nazwy plików, komendy), nie ogólnikowe
- §3 Phase 1 Status = `complete`; `change.md` zsynchronizowane
- `contract-surfaces.md` §Nazwy w danych ma podsekcję `public.generations` z `status`, `error_code` i trzema CHECK-ami; reszta dryfu nietknięta
- Roadmap: brak elementu z Change ID `testing-generation-error-contract` (potwierdzone) — `roadmap.md` nietknięty
- Przegląd: strategia §1–§5 test-planu bez zmian

**Implementation Note**: Po zielonym automacie — pauza na końcowe potwierdzenie manualne.

---

## Testing Strategy

### Unit Tests:

- `client.test.ts` — klasy awarii A–D, `rate_limited` z obu sygnałów, kompletny kontrakt fallbacku ZDR
  (bez `zdr`, z `data_collection: "deny"`, jeden sygnał, brak ponowienia dla `"Resource not found"`),
  brak sentinela w każdym błędzie, model fallback.
- Istniejący `parse.test.ts` pozostaje źródłem prawdy dla klas E–I (bez zmian).

### Integration Tests:

- `generations.test.ts` — pełna drabina 401/503/400/429/500/502; stałe ciała; zakaz `issues`;
  `queries.every(q => q.table !== 'flashcards')`; Q3 obserwowalny; brak sentinela w zapisach i ciałach błędu.
- `GenerateView.test.tsx` — dokładny komunikat w DOM różny między klasami; tripwire `proposals: []`;
  tripwire timeout=sieć; ostrzeżenie trybu standard; brak sentinela w `textContent`.
- pgTAP `generations_error_contract.test.sql` — pięć asercji: kształt hasha, kształt kodu, obie strony biwarunku, kontrola pozytywna.

### Manual Testing Steps:

1. `npm test` — 3 nowe pliki zielone, 0 regresji w pozostałych 15.
2. `supabase start && npm run db:test` — 3 pliki pgTAP zielone.
3. `npx --yes @stryker-mutator/core run --testRunner vitest --mutate "src/lib/openrouter/client.ts,src/pages/api/generations.ts"`
   — otworzyć raport HTML, przejść przeżywające mutanty. Bez instalacji devDependency, bez commitu konfiguracji.
4. Ręczna zmiana jednego komunikatu w `client.ts` → `vitest --watch` pokazuje pęknięty test w P1 i P3
   (dowód asercji na tekst, nie na obecność alertu). Cofnąć zmianę.
5. Ręczne usunięcie CHECK `generations_error_code_shape` z migracji → `db:test` czerwony. Cofnąć.

## Performance Considerations

Brak. Testy hermetyczne, bez I/O sieciowego. Stryker jednorazowo — kilka minut na dwóch plikach,
poza CI.

## Migration Notes

Brak migracji. P4 dodaje wyłącznie plik testowy `supabase/tests/`. Stryker (P5) nie wchodzi do
`package.json` ani jako zacommitowana konfiguracja — przebieg jest przez `npx`, artefakty efemeryczne.

## References

- Research: [context/changes/testing-generation-error-contract/research.md](research.md)
- Change identity: [context/changes/testing-generation-error-contract/change.md](change.md)
- Oracle: [context/archive/2026-08-25-first-gated-generation/plan.md](../../archive/2026-08-25-first-gated-generation/plan.md) §Phase 3–4
- Test plan: [context/foundation/test-plan.md](../../foundation/test-plan.md) §3 Phase 1, §4, §5, §6
- Wzorzec stub `fetch`: [src/components/review/ReviewSession.test.tsx:14-30](../../../src/components/review/ReviewSession.test.tsx#L14-L30)
- Konwencja testu trasy: [src/pages/api/flashcards.test.ts:12-27](../../../src/pages/api/flashcards.test.ts#L12-L27)
- pgTAP: [supabase/tests/recount_generation_acceptance.test.sql](../../../supabase/tests/recount_generation_acceptance.test.sql)
- OpenRouter errors: https://openrouter.ai/docs/api_reference/errors-and-debugging
- OpenRouter router metadata: https://openrouter.ai/docs/guides/features/router-metadata

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: P1 — client.test.ts (hermetyczny, stub fetch)

#### Automated

- [x] 1.1 Typecheck przechodzi: `npx astro check` — 99585e1
- [x] 1.2 Lint przechodzi: `npm run lint` — 99585e1
- [x] 1.3 `npx vitest run src/lib/openrouter/client.test.ts` — wszystkie przypadki zielone — 99585e1
- [x] 1.4 Pełny `npm test` bez regresji — 99585e1
- [x] 1.5 `it.each` po klasach awarii dowodzi braku sentinela w `JSON.stringify(error)` dla każdej klasy — 99585e1

#### Manual

- [x] 1.6 Przegląd: asercje pierwszorzędne są behawioralne (wzajemna różność + nie-pustość, porównanie między sobą), nie równość do importu z `client.ts` — 99585e1
- [x] 1.7 Przegląd: asercja współdzielonego sygnału testuje tożsamość referencji — 99585e1
- [x] 1.8 Fixture 404 ZDR używa dokładnego zdania z docs router-metadata — 99585e1

### Phase 2: P2 — generations.test.ts (integracja trasy, hermetyczna)

#### Automated

- [x] 2.1 Typecheck: `npx astro check` — 52ab8c7
- [x] 2.2 Lint: `npm run lint` — 52ab8c7
- [x] 2.3 `npx vitest run src/pages/api/generations.test.ts` — zielone — 52ab8c7
- [x] 2.4 Pełny `npm test` bez regresji — 52ab8c7
- [x] 2.5 Asercja „`queries.every(q => q.table !== 'flashcards')`" obecna na ścieżce awarii — 52ab8c7
- [x] 2.6 Asercja wzajemnej różności ciał błędu (porównanie między sobą) + nie-pustości; ≤1 lekki test „stała przekazana bez zmiany" — 52ab8c7
- [x] 2.7 Asercja „odpowiedź 400 ma klucze dokładnie `['error']`" (zakaz `issues`) — 52ab8c7

#### Manual

- [x] 2.8 Przegląd: `vi.hoisted` + `vi.mock("astro:env/server")` pozwala zmutować klucz między testami — 52ab8c7
- [x] 2.9 Przegląd: indeksy `supabase.queries[n]` zgadzają się z sekwencją `createGeneration` — 52ab8c7
- [x] 2.10 Przegląd: sentinel `"SEKRET-"` nie występuje w żadnym fixture jako część stałej — 52ab8c7

### Phase 3: P3 — GenerateView.test.tsx (komponent, jsdom)

#### Automated

- [x] 3.1 Typecheck: `npx astro check` — b6a4d34
- [x] 3.2 Lint: `npm run lint` — b6a4d34
- [x] 3.3 `npx vitest run src/components/generate/GenerateView.test.tsx` — zielone — b6a4d34
- [x] 3.4 Pełny `npm test` bez regresji — b6a4d34
- [x] 3.5 Asercje komunikatów używają `getByText` na pełnym stringu, nie `queryByRole("alert")` — b6a4d34
- [x] 3.6 Przypadek `proposals: []` jest obecny i zielony — b6a4d34

#### Manual

- [x] 3.7 Przegląd: dowód rozróżnialności to dwa różne teksty w DOM dla dwóch różnych odpowiedzi, nie równość do importu — b6a4d34
- [x] 3.8 Przegląd: komentarze przy tripwire'ach mówią „przypięcie, nie kontrakt docelowy" — b6a4d34
- [x] 3.9 Test pęka po ręcznej zmianie komunikatu serwera (watch) — b6a4d34

### Phase 4: P4 — pgTAP: CHECK-i anty-wyciekowe

#### Automated

- [x] 4.1 `npm run db:test` przechodzi lokalnie — afb322f
- [x] 4.2 `select plan(5)` zgadza się z liczbą asercji w pliku — afb322f
- [x] 4.3 Nowy plik nie psuje istniejących dwóch testów pgTAP — afb322f

> Faza ad hoc: `supabase/tests/generations_error_contract.test.sql` uruchamiany wyłącznie przez
> `npm run db:test` (wymaga `supabase start`). NIE jest krokiem CI — wpięcie to Rollout Phase 2
> (`test-plan.md §5` „required after §3 Phase 2"). Przebieg z tej fazy: `Files=3, Tests=24, Result: PASS`.

#### Manual

- [x] 4.4 Przegląd: `error_code='rate_limited'` w kontroli pozytywnej — afb322f
- [x] 4.5 Odnotowane w `## Progress`, że to bramka ad hoc — afb322f
- [x] 4.6 `rollback` na końcu; test nie zostawia wierszy — afb322f

### Phase 5: Selektywny przebieg Stryker (client.ts + generations.ts)

#### Automated

- [x] 5.1 `npx --yes @stryker-mutator/core run …` kończy się bez błędu; `git status` czysty z artefaktów Stryker (brak `stryker.conf.json` w indeksie, brak wpisu w `package.json`) — 9332702
- [x] 5.2 Po dołożeniu asercji: `npm test` zielony — 9332702
- [x] 5.3 Raport HTML wygenerowany — 9332702

> **Przebieg Stryker (ad hoc, poza CI).** Komenda: `npx --yes -p @stryker-mutator/core -p @stryker-mutator/vitest-runner stryker run`
> z efemeryczną `stryker.conf.json` (gitignored, usunięta po przebiegu). Środowisko Windows wymagało trzech obejść w konfiguracji:
> `tsconfigFile` wskazujący nieistniejący plik (preprocessor tsconfig szukał `typescript` w cache npx), `ignorePatterns`
> na `.claude`/`context`/`supabase`/… (EPERM na kopiowaniu symlinków do sandboxa), `vitest.related=false` + zawężony
> `stryker-vitest.config.ts` z `include` na dwa pliki testowe (runner nie kojarzył testów z mutowanymi plikami; zawężenie
> omija też `flashcards/[id].test.ts`, który w sandboxie pada na wirtualnych modułach Astro).
>
> **Wynik: 85.37% → 95.12%** (client.ts 96.34%, generations.ts 92.68%). 12 mutantów zabitych 7 nowymi asercjami:
> 4 przypadki brzegowe `isZdrRouteMissing` + 1 test kształtu żądania HTTP w `client.test.ts`; 1 test walidacji po `trim`
> + 1 test „nie-typowany błąd → 500 bez wycieku" w `generations.test.ts`.
>
> **Triage 18 przeżywających mutantów pierwszego przebiegu:**
>
> | Mutant | Werdykt | Akcja |
> |---|---|---|
> | `client.ts:14` regex — usuwa kotwicę `^` z `/^no allowed providers/i` | **szkodzi** — prefiks w komunikacie fałszywie wyzwala fallback ZDR | ZABITY: test „404 z komunikatem NIE na początku zdania NIE ponawia" |
> | `client.ts:76:7` + `76:31` — usuwa strażnik `if (status !== 404)` w `isZdrRouteMissing` | **szkodzi** — dowolny status z pasującym komunikatem ponawia | ZABITE: test „status inny niż 404 z komunikatem 'no allowed providers' NIE ponawia" |
> | `client.ts:80:19` MethodExpression — usuwa `.trim()` przed dopasowaniem | **szkodzi** — komunikat z białymi znakami nie ponawia (użytkownik traci udane ponowienie) | ZABITY: test „komunikat otoczony białymi znakami PONAWIA" |
> | `client.ts:80:19` OptionalChaining — `.message?.trim()` → `.message.trim()` | **szkodzi** — 404 z kopertą bez `message` rzuca TypeError → 500 zamiast 502 | ZABITY: test „404 z kopertą błędu bez pola message NIE rzuca TypeError" |
> | `client.ts:6` URL, `client.ts:97` method, `client.ts:98/99/100` nagłówki | **szkodzi** — złe żądanie = totalna awaria u wszystkich użytkowników | ZABITE: 1 test „POST na endpoint OpenRoutera z nagłówkami Authorization i Content-Type" (dozwolony jeden lekki test „stała bez zmiany" na warstwę) |
> | `generations.ts:70` `instanceof … \|\| instanceof …` → `true` | **szkodzi (ryzyko #5)** — `caught.message` dowolnego błędu przecieka do ciała 502 | ZABITY: test „nie-typowany błąd → 500 ze stałym ciałem, bez wycieku" |
> | `generations.ts:19` MethodExpression — usuwa `.trim()` z walidacji `sourceText` | **szkodzi** — walidacja `min`/`max` na nieprzyciętej wartości; whitespace-padding omija minimum | ZABITY: test „sourceText krótszy niż minimum dopiero po przycięciu → 400" |
> | `client.ts:43:17` `this.name = "OpenRouterError"` → `""` | **nie szkodzi** — `.name` etykietuje tylko stack trace; konsumenci rozgałęziają na `instanceof`, nigdy na `.name` | świadomie zignorowany (mutant równoważny behawioralnie) |
> | `client.ts:69:11` `catch { return null }` → `catch {}` | **nie szkodzi** — jedyny wołający używa `?.`, `undefined` i `null` skracają identycznie | świadomie zignorowany (mutant równoważny) |
> | `client.ts:80:77` `?? ""` → `?? "Stryker was here!"` | **nie szkodzi** — oba stringi zastępcze nie pasują do zakotwiczonego regexa | świadomie zignorowany (mutant równoważny) |
> | `generations.ts:25:14/25:32` — usuwa/zeruje nagłówek `Content-Type` odpowiedzi | **nie szkodzi** — klienci wołają `response.json()`, które parsuje bez tego nagłówka | świadomie zignorowany (kosmetyczny) |
> | `generations.ts:47:11` `catch { return error(invalidBody, 400) }` → `catch {}` | **nie szkodzi** — przelot do `safeParse(undefined)` zwraca identyczne 400 + identyczne ciało | świadomie zignorowany (mutant równoważny) |
>
> **Pozostałe 6 przeżywających po drugim przebiegu** to dokładnie mutanty z werdyktem „nie szkodzi" powyżej — żadna
> dołożona asercja nie przypina kosmetyki tylko dla wyniku.

#### Manual

- [x] 5.4 Każdy przeżywający mutant w `client.ts`/`generations.ts` ma zapisany werdykt w `## Progress` — 9332702
- [x] 5.5 Żadna dołożona asercja nie przypina kosmetycznego szczegółu — 9332702
- [x] 5.6 Mutanty w `upstreamCode` / `isZdrRouteMissing` / drabinie statusów są zabite — 9332702

### Phase 6: Cookbook + synchronizacja

#### Automated

- [x] 6.1 `npx astro check` bez regresji
- [x] 6.2 `git grep "TBD — see §3 Phase 1"` nie zwraca §6.1 ani §6.2
- [x] 6.3 `npm test` zielony (pełny pakiet)

#### Manual

- [x] 6.4 §6.1 i §6.2 konkretne (nazwy plików, komendy)
- [x] 6.5 §3 Phase 1 Status = `complete`; `change.md` zsynchronizowane (`status: implemented` — „complete" w planie to słownik §3 rolloutu, nie change.md)
- [x] 6.6 `contract-surfaces.md` §Nazwy w danych ma podsekcję `public.generations` (`status`, `error_code`, trzy CHECK-i); reszta dryfu nietknięta
- [x] 6.7 Roadmap potwierdzony bez elementu o tym Change ID — `roadmap.md` nietknięty
- [x] 6.8 Przegląd: strategia §1–§5 test-planu bez zmian
