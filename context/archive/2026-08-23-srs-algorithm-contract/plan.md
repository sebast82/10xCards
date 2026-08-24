# Kontrakt algorytmu powtórek i stanu harmonogramu — plan wdrożenia

## Overview

F-01 domyka niewiadomą „jakiego stanu wymaga fiszka, żeby dało się ją zaplanować", zanim jakikolwiek użytkownik zapisze pierwszą fiszkę. Biblioteka jest już wybrana i zweryfikowana empirycznie (`ts-fsrs@5.4.1`, FSRS-6.0, potwierdzone na `workerd` — `research.md` §1). Ta zmiana zamienia wynik researchu w **kontrakt wiążący dwie kolejne zmiany**: F-02 przepisuje go na kolumny migracji, S-05 wywołuje go bez modyfikacji.

Kontrakt powstaje w dwóch postaciach naraz, bo żadna z osobna nie wystarcza:

- **wykonywalny moduł TypeScript** (`src/lib/srs/`) — przechodzi `astro check` i `eslint`, więc nie da się go zinterpretować na trzy sposoby;
- **wpis w `docs/reference/contract-surfaces.md`** — bo tam mieszkają nazwy nośne, a rejestr wprost zobowiązuje ten plan do ich uzupełnienia.

## Current State Analysis

**Co jest gotowe (potwierdzone empirycznie, nie założeniowo):**

- `ts-fsrs@5.4.1` jest w [package.json](package.json), działa na `workerd` (HTTP 200, `navigator.userAgent === "Cloudflare-Workers"`), 0 zależności runtime, ~1,25 µs na przeliczenie karty. Ryzyko `engines: node >=20` zdjęte.
- Stan jest **wyłącznie per fiszka** — scheduler jest bezstanowy i czysty. To odpowiedź na jedyną `Unknowns` z F-01 w [roadmap.md](context/foundation/roadmap.md).
- Konfiguracja projektu nie wymaga ani jednej zmiany pod tę bibliotekę ([astro.config.mjs](astro.config.mjs), [wrangler.jsonc](wrangler.jsonc), `tsconfig.json`).

**Czego nie ma:**

- Warstwa danych nie istnieje — zero plików `.sql`, zero migracji, zero typów bazy, `createServerClient` wołany bez generyka `Database` ([src/lib/supabase.ts](src/lib/supabase.ts)). To zakres F-02, nie tej zmiany.
- Brak frameworka testowego w repo i w CI ([ci.yml](.github/workflows/ci.yml)), mimo że PRD stawia twardy warunek brzegowy „mechanizm powtórek nie może zawieść" ([prd.md](context/foundation/prd.md)).
- Brak `zod`, mimo że deklarują go [tech-stack.md](context/foundation/tech-stack.md) i `CLAUDE.md.scaffold`.
- [contract-surfaces.md](docs/reference/contract-surfaces.md) nie zawiera ani jednej nazwy kolumny — tylko dwa opisy ról po polsku i zobowiązanie: „Konkretne nazwy kolumn i typy ustala `/10x-plan` przy F-01 i F-02 — i zapisuje je tutaj."

**Trzy nieścisłości `ts-fsrs-api-doc.md` wobec zainstalowanej wersji** (`research.md` §3), z których jedna zmienia kształt rozwiązania:

- `FSRSValidationError` **nie jest eksportowany** w 5.4.1 — nie da się oprzeć walidacji odczytu na `instanceof`.
- `elapsed_days` i `last_elapsed_days` są oba `@deprecated` z usunięciem w 6.0.0 — żadne nie wchodzi do kontraktu.
- Wersja pakietu (`5.4.1`) to nie wersja algorytmu (`FSRS-6.0`) — przypinamy pakiet.

## Desired End State

Po tej zmianie w repo istnieje moduł `src/lib/srs/`, który:

1. **nazywa dziewięć pól stanu** w kształcie 1:1 z przyszłymi kolumnami (snake_case), więc F-02 generuje z niego DDL bez tłumaczenia nazw;
2. **waliduje wiersz odczytany z bazy** schematem Zod i odrzuca niepoprawny, zanim trafi do schedulera;
3. **udostępnia trzy operacje**, których potrzebuje S-05: utworzenie stanu nowej fiszki, podgląd czterech interwałów przed oceną, zastosowanie oceny;
4. **jest pokryty testami**, które wykonują się w CI.

Równolegle [contract-surfaces.md](docs/reference/contract-surfaces.md) zawiera konkretne nazwy kolumn, typy PostgreSQL, enum pochodzenia i indeks wymuszony przez kolejkowanie.

**Weryfikacja:** `npm run lint`, `npx astro check`, `npm test` i `npm run build` przechodzą; `git grep` w `contract-surfaces.md` znajduje każdą z dziewięciu nazw kolumn.

### Key Discoveries:

- Kolejkowanie sesji to **zwykłe zapytanie SQL**, nie API biblioteki — `ts-fsrs` nie ma „daj następną fiszkę" (`ts-fsrs-api-doc.md` §6). To wymusza indeks `(user_id, due)`, którego rejestr nie przewidywał.
- `TypeConvert.card` robi round-trip ISO string → `Date` i number → `State`; potwierdzone empirycznie (`research.md` §1).
- Znacznik pochodzenia jest **ortogonalny** wobec stanu FSRS — algorytm nie zna źródła fiszki. Warunek brzegowy PRD „niezależnie od źródła fiszek" jest spełniony strukturalnie, a nie przez warunek w kodzie.
- `verbatimModuleSyntax: true` — typy z `ts-fsrs` muszą być importowane jako `import type`.
- ESLint działa w trybie `strictTypeChecked`, a CI wywala się na `npm run lint` — kod modułu przeszedł już weryfikację bez wyłączania reguł (`research.md` §2).

## What We're NOT Doing

- **Nie tworzymy migracji ani tabeli** — to zakres F-02 (`flashcards-schema-isolation`). Ten plan dostarcza kształt, nie DDL.
- **Nie tworzymy endpointów ani UI** — `/api/reviews` i `/review` należą do S-05.
- **Nie utrwalamy `ReviewLog`** — decyzja zapadła (patrz Implementation Approach). Bez logu tracimy `rollback()` i `reschedule()`; żadne kryterium sukcesu PRD ich nie wymaga.
- **Nie rozszerzamy `App.Locals` o klienta Supabase** — zmiana dotyka [middleware.ts](src/middleware.ts) obsługującego działający na produkcji przepływ auth, a w F-01 nie ma konsumenta, który by ją zweryfikował. Wchodzi w S-02, przy pierwszym endpoincie domenowym.
- **Nie trenujemy własnych wag FSRS** — PRD §Non-Goals; `@open-spaced-repetition/binding` nie wspiera edge runtime.
- **Nie dodajemy parametrów FSRS per użytkownik** — w MVP są stałe i żyją w kodzie.

## Implementation Approach

Decyzje podjęte w tym przebiegu planowania, w kolejności wpływu na schemat F-02:

| #   | Decyzja                   | Rozstrzygnięcie                                                                                                                                                                             |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Utrwalanie `ReviewLog`    | **Nie w MVP.** Najmniejsza migracja i najkrótsza droga do S-05 przy terminie 2026-08-31. Log to tabela doklejana, nie kolumna — dodanie później nie wymaga przeróbki istniejących rekordów. |
| 2   | `due`, `last_review`      | **`timestamptz`.** Kolejkowanie `WHERE due <= now() ORDER BY due` jest natywnie indeksowalne bez konwersji.                                                                                 |
| 3   | `state`                   | **`smallint`** + CHECK 0–3. `State` mapuje 1:1; PG enum wymagałby mapowania string ↔ liczba przy każdym odczycie.                                                                           |
| 4   | `stability`, `difficulty` | **`double precision`.** Wartości runtime FSRS to zwykłe floaty — `decimal.js` jest wyłącznie dev-dependency `ts-fsrs`.                                                                      |
| 5   | Znacznik pochodzenia      | **Enum `ai` / `ai_edited` / `manual`.** Jedyny wariant mierzący **oba** kryteria sukcesu PRD — `boolean` nie odróżni propozycji AI przyjętej bez zmian od poprawionej przed zapisem.        |
| 6   | Parametry FSRS            | **Stałe w kodzie**, wartości domyślne biblioteki (potwierdzone empirycznie).                                                                                                                |
| 7   | Artefakt F-01             | **Dokument + wykonywalny kontrakt w kodzie.** Sama proza nie obroni dziewięciu pól liczbowych przed pomyłką `stability` ↔ `difficulty`.                                                     |
| 8   | Runner testów             | **Vitest teraz, wąski zakres.** Między F-01 a S-05 leżą cztery zmiany — pod presją terminu runner odłożony nie powstałby wcale.                                                             |

## Critical Implementation Details

**Kolizja nazw `learning_steps`.** To pole występuje w bibliotece dwa razy w dwóch różnych znaczeniach: w `Card` jako `number` (indeks aktualnego kroku fazy nauki), a w `FSRSParameters` jako `Steps` (tablica `["1m", "10m"]`). Do kontraktu stanu i do kolumny wchodzi **wyłącznie wariant liczbowy**. Pomylenie ich daje błąd typu przy kompilacji, ale w rejestrze kontraktów i w rozmowie o schemacie jest to realne źródło nieporozumień.

**Granica walidacji nie może opierać się na bibliotece.** `TypeConvert.card` rzuca `FSRSValidationError` przy niepoprawnym wejściu, ale ten typ **nie jest eksportowany** w 5.4.1 — kod wywołujący nie ma jak go rozpoznać. Dlatego Zod waliduje **surowy wiersz** przed przekazaniem czegokolwiek do `TypeConvert.card`, a nie po. Odwrotna kolejność daje nierozpoznawalny wyjątek zamiast kontrolowanego błędu.

**Przypięcie wersji pakietu.** Numeracja pakietu (`5.4.1`) i numeracja algorytmu (`FSRS-6.0`) są niezależne — `FSRSVersion` zwraca `"v5.4.1 using FSRS-6.0"`. Domyślne wagi `w` (21 liczb) są częścią pakietu, więc minor bump może po cichu zmienić wyznaczane terminy na fiszkach już zaplanowanych. Zakres `^5.4.1` w [package.json](package.json) zostaje zawężony do dokładnej wersji.

---

## Phase 1: Wykonywalny kontrakt stanu

### Overview

Powstaje moduł `src/lib/srs/` — jedyne miejsce w kodzie, które wie, jak wygląda stan harmonogramu. F-02 czyta z niego nazwy kolumn, S-05 wywołuje jego operacje.

### Changes Required:

#### 1. Zależności

**Files**: `package.json`, `package-lock.json`

**Intent**: Dołożyć `zod` jako granicę walidacji odczytu (zastępuje nieeksportowany `FSRSValidationError`) i zawęzić `ts-fsrs` do dokładnej wersji, żeby minor bump nie ruszył domyślnych wag algorytmu.

**Contract**: `dependencies` zyskuje `zod`; wpis `"ts-fsrs": "^5.4.1"` zmienia się na `"ts-fsrs": "5.4.1"`; `package-lock.json` jest zaktualizowany przez `npm install`. Bez zmian w `devDependencies`.

#### 2. Kształt wiersza i granica walidacji

**File**: `src/lib/srs/schedule-state.ts`

**Intent**: Nazwać dziewięć pól stanu w kształcie 1:1 z przyszłymi kolumnami, zwalidować surowy wiersz odczytany z bazy i przetłumaczyć go w obie strony na `Card` z `ts-fsrs`.

**Contract**: Eksportuje schemat Zod dla surowego wiersza, wyprowadzony z niego typ `ScheduleStateRow` oraz dwie funkcje mapujące — wiersz → `Card` (walidacja Zodem, potem `TypeConvert.card`) i `Card` → wiersz (daty na ISO, `last_review` na `null` gdy nieobecne).

Kształt wiersza — nazwy pól są **wiążące** dla F-02:

| Pole             | Typ TS                 | Typ PG (dla F-02)                                 | Uwagi                                  |
| ---------------- | ---------------------- | ------------------------------------------------- | -------------------------------------- |
| `due`            | `string` (ISO)         | `timestamptz not null`                            | po tym polu filtruje sesja             |
| `stability`      | `number`               | `double precision not null`                       |                                        |
| `difficulty`     | `number`               | `double precision not null`                       | skala 1–10                             |
| `scheduled_days` | `number`               | `integer not null`                                |                                        |
| `learning_steps` | `number`               | `smallint not null`                               | indeks kroku, **nie** tablica kroków   |
| `reps`           | `number`               | `integer not null`                                |                                        |
| `lapses`         | `number`               | `integer not null`                                |                                        |
| `state`          | `0 \| 1 \| 2 \| 3`     | `smallint not null check (state between 0 and 3)` | `New`/`Learning`/`Review`/`Relearning` |
| `last_review`    | `string \| null` (ISO) | `timestamptz`                                     | jedyne pole dopuszczające `null`       |

**Nie wchodzą do kontraktu:** `elapsed_days`, `last_elapsed_days` — oba `@deprecated`, usuwane w `ts-fsrs` 6.0.0.

Walidacja idzie **przed** `TypeConvert.card`, nie po — uzasadnienie w „Critical Implementation Details".

#### 3. Scheduler i operacje sesji

**File**: `src/lib/srs/scheduler.ts`

**Intent**: Zamknąć konfigurację FSRS w jednym miejscu i wystawić trzy operacje, których potrzebuje S-05, tak żeby wołający nie musiał znać `ts-fsrs`.

**Contract**: Eksportuje fabrykę schedulera z parametrami domyślnymi biblioteki (`request_retention: 0.9`, `maximum_interval: 36500`, `enable_fuzz: false`, `enable_short_term: true`, `learning_steps: ["1m","10m"]`, `relearning_steps: ["10m"]` — potwierdzone empirycznie) oraz:

- utworzenie stanu nowej fiszki → `ScheduleStateRow` (opakowuje `createEmptyCard`);
- podgląd czterech interwałów przed oceną → wynik indeksowany po ocenie (opakowuje `repeat`, nie modyfikuje stanu);
- zastosowanie oceny → nowy `ScheduleStateRow` (opakowuje `next`, `ReviewLog` jest **odrzucany** — decyzja #1).

Ocena przyjmowana jako `Grade` z `ts-fsrs` (1–4), nie jako `number` — inaczej `Rating.Manual` (0) przecieka do API modułu.

Każda z trzech operacji przyjmuje jawne `now: Date`: utworzenie przekazuje je do `createEmptyCard`, a podgląd i zastosowanie oceny do `repeat`/`next`. Moduł nie odczytuje zegara systemowego; S-05 przekazuje czas żądania, a testy używają stałej daty.

#### 4. Powierzchnia publiczna modułu

**File**: `src/lib/srs/index.ts`

**Intent**: Ustalić, co jest kontraktem dla F-02 i S-05, a co szczegółem wewnętrznym.

**Contract**: Re-eksport typu wiersza, schematu Zod, dwóch funkcji mapujących, trzech operacji sesji i typu oceny. Nic poza tym — reszta `ts-fsrs` pozostaje szczegółem implementacyjnym modułu.

### Success Criteria:

#### Automated Verification:

- Kontrola typów przechodzi: `npx astro check` (0 errors, 0 warnings)
- Lint przechodzi bez wyłączania reguł: `npm run lint`
- Build przechodzi: `npm run build`
- `package.json` zawiera `zod` oraz `"ts-fsrs": "5.4.1"` bez `^`, a `package-lock.json` jest z nim zgodny

#### Manual Verification:

- Nazwy dziewięciu pól w `schedule-state.ts` są snake_case i nadają się na kolumny bez tłumaczenia
- Moduł nie importuje niczego z `@supabase/*` ani z `astro:*` — jest czysty i wywoływalny z testu

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na potwierdzenie ręczne przed Fazą 2.

---

## Phase 2: Pokrycie guardrail-a PRD

### Overview

PRD stawia jeden twardy warunek brzegowy — „mechanizm powtórek nie może zawieść, niezależnie od źródła fiszek". Faza dokłada runner testów i wąski zestaw przypadków, które ten warunek zamieniają z deklaracji w sprawdzenie wykonywane przy każdym pushu.

### Changes Required:

#### 1. Runner testów

**Files**: `vitest.config.ts`, `package.json`, `package-lock.json`

**Intent**: Uruchomić Vitest w projekcie Astro bez zmian w konfiguracji lintera.

**Contract**: `vitest.config.ts` z aliasem `@` → `./src` (spójnym z `tsconfig.json`) i środowiskiem `node`. Skrypt `"test": "vitest run"` w `package.json`; `vitest` jako `devDependency`; `package-lock.json` zawiera jego rozwiązaną wersję. Testy importują `describe`/`it`/`expect` jawnie z `vitest` — **bez globals**, żeby [eslint.config.js](eslint.config.js) w trybie `strictTypeChecked` nie wymagał nowej sekcji dla plików testowych.

#### 2. Testy kontraktu stanu

**File**: `src/lib/srs/schedule-state.test.ts`

**Intent**: Zabezpieczyć granicę, na której dziewięć pól liczbowych przechodzi między bazą a algorytmem — tam, gdzie typy TypeScript nie pomogą, bo `stability` i `difficulty` to oba `number`.

**Contract**: Przypadki — round-trip wiersz → `Card` → wiersz zachowuje wszystkie dziewięć wartości; `due` i `last_review` wracają jako `Date` po stronie `Card` i jako ISO po stronie wiersza; `last_review: null` przechodzi w obie strony; `state` poza zakresem 0–3 jest odrzucany przez schemat; brak wymaganego pola jest odrzucany; wynik walidacji nie jest typu `any`.

#### 3. Testy cyklu życia

**File**: `src/lib/srs/scheduler.test.ts`

**Intent**: Potwierdzić, że sesja nauki wyznacza termin i aktualizuje go po ocenie — czyli dokładnie to, co roadmapa przypisuje S-05, zanim S-05 powstanie.

**Contract**: Przypadki — nowa fiszka startuje w `State.New` z zerowymi licznikami; ocena `Good` przesuwa stan do `Learning` i ustawia `last_review`; ocena `Again` po fazie `Review` zwiększa `lapses`; podgląd zwraca cztery warianty i **nie** modyfikuje wejścia. Wszystkie przypadki przekazują stałe `now`, a ponowne zastosowanie tej samej oceny do tego samego wiersza z tym samym `now` daje ten sam wynik. Test obu źródeł fiszki należy do integracji F-02/S-05: `source` nie jest częścią `ScheduleStateRow` ani API modułu SRS.

#### 4. Testy w CI

**File**: `.github/workflows/ci.yml`

**Intent**: Sprawić, żeby guardrail działał bez pamiętania o nim.

**Contract**: Krok `npm test` między `npm run lint` a `npm run build`. Bez zmian w `node-version` (24) i bez nowych sekretów — testy nie dotykają bazy.

### Success Criteria:

#### Automated Verification:

- Testy przechodzą: `npm test`
- Lint nadal przechodzi, bez nowej sekcji dla plików testowych: `npm run lint`
- Kontrola typów obejmuje pliki testowe: `npx astro check`
- Build nie zaciąga testów do bundla: `npm run build` (rozmiar `dist` bez `*.test.*`)

#### Manual Verification:

- CI na pushu do gałęzi pokazuje krok `npm test` jako osobny, zielony
- Celowe zepsucie jednego mapowania (zamiana `stability` ↔ `difficulty`) wywala test — jeżeli nie, zestaw nie pilnuje tego, po co powstał

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na potwierdzenie ręczne przed Fazą 3.

---

## Phase 3: Zapis kontraktu w rejestrze nazw nośnych

### Overview

Moduł z Fazy 1 jest kontraktem dla kodu; ta faza czyni go kontraktem dla **roadmapy** — F-02 i S-05 czytają nazwy z rejestru, nie z pamięci.

### Changes Required:

#### 1. Nazwy w danych

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Zastąpić dwa opisy ról („stan harmonogramu powtórek", „znacznik pochodzenia fiszki") konkretnymi nazwami kolumn i typami — rejestr wprost zobowiązuje ten plan do tego kroku.

**Contract**: Sekcja „Nazwy w danych" zyskuje tabelę dziewięciu kolumn stanu z typami PG z Fazy 1 (§2), a wiersze `proponowane` zmieniają się w wiążący zapis. Dodatkowo:

- **znacznik pochodzenia** → kolumna `source`, typ enum `flashcard_source` z wartościami `ai`, `ai_edited`, `manual`;
- **niezmienność `source`** — wartość zapisywana raz, przy tworzeniu fiszki. Edycja po zapisie (S-03) **nie** zmienia znacznika; kryterium PRD „akceptowane bez istotnych zmian" mierzy moment akceptacji, a nie późniejszą pielęgnację kolekcji. Bez tego zdania S-03 może w dobrej wierze zepsuć pomiar;
- **indeks `(user_id, due)`** — wymuszony przez kolejkowanie sesji, bo `ts-fsrs` nie ma API „daj następną fiszkę";
- **granica zakresu** — `@open-spaced-repetition/binding` (trenowanie wag, WASM) nie wspiera edge runtime i jest poza MVP;
- **wykluczenia** — `elapsed_days` i `last_elapsed_days` nie wchodzą do schematu; przypięta wersja `ts-fsrs` to `5.4.1` (FSRS-6.0).

#### 2. Zasada uwierzytelniania dla endpointów domenowych

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Zamknąć lukę, przez którą `/api/generations` stałoby się nieuwierzytelnionym, płatnym endpointem AI.

**Contract**: Tabela „Endpointy API" zyskuje kolumnę „Ochrona": endpointy `/api/auth/*` są opisane jako obsługujące przepływ auth, a każdy endpoint domenowy jako wymagający samodzielnej weryfikacji `locals.user` i odpowiedzi 401 bez sesji. Jednoznaczne zdanie pod tabelą wyjaśnia, że `PROTECTED_ROUTES` w [middleware.ts](src/middleware.ts) obejmuje wyłącznie trasy stron, więc nie ochroni `/api/**`; zgodność ochrony endpointów jest widoczna w tej tabeli.

#### 3. Polityka wersji Node

**File**: `README.md`

**Intent**: Usunąć zdanie wewnętrznie sprzeczne i opisać wspólną politykę środowisk: lokalne minimum `24.19.0`, bieżące minor update w gałęzi 24.x, bez przejścia na Node 25.

**Contract**: `Node.js v22.14.0` → `Node.js v24.19.0+ (24.x only)`. `.nvmrc` pozostaje minimalnym lokalnym punktem bazowym `24.19.0`; [ci.yml](.github/workflows/ci.yml) pozostaje na `node-version: 24`, żeby pobierać bieżący minor tej samej gałęzi. Bez pola `engines` w `package.json` — Cloudflare Workers Builds i tak czyta `.nvmrc`.

#### 4. Domknięcie zmiany

**File**: `context/changes/srs-algorithm-contract/change.md`

**Intent**: Odnotować, że zakres decyzyjny F-01 jest wyczerpany — osiem decyzji z `research.md` §6 ma rozstrzygnięcia.

**Contract**: `status` i `updated` w frontmatterze; w `## Notes` odesłanie do tabeli decyzji w `plan.md` §Implementation Approach.

### Success Criteria:

#### Automated Verification:

- Każda z dziewięciu nazw kolumn występuje w `docs/reference/contract-surfaces.md`: `git grep -c "scheduled_days\|learning_steps\|last_review" docs/reference/contract-surfaces.md`
- `README.md` nie zawiera już `22.14.0`: `git grep -c "22.14.0" README.md` zwraca 0
- Lint i format przechodzą na plikach markdown: `npx prettier --check "**/*.md"`

#### Manual Verification:

- Czytając wyłącznie `contract-surfaces.md`, da się napisać `CREATE TABLE` dla F-02 bez otwierania `plan.md` ani `research.md`
- Reguła 3 rejestru („nowa trasa albo endpoint nieobecne tutaj to sygnał ostrzegawczy") nadal się broni — ta zmiana nie wprowadziła żadnej trasy ani endpointu
- `roadmap.md` pokazuje F-01 jako `planning`, a F-02 jako odblokowane

---

## Testing Strategy

### Unit Tests:

- Round-trip wiersz ↔ `Card` na wszystkich dziewięciu polach — chroni przed pomyłką `stability` ↔ `difficulty`, której typy nie złapią
- Konwersja dat w obie strony, w tym `last_review: null`
- Odrzucenie wiersza z `state` poza 0–3 i wiersza z brakującym polem
- Cykl `New → Learning → Review` i wzrost `lapses` po ocenie `Again`
- Podgląd nie modyfikuje wejścia

### Integration Tests:

Brak w tej zmianie — nie ma bazy, endpointów ani UI. Pierwsza integracja to F-02 (odczyt wiersza z Supabase przez ten moduł).

### Manual Testing Steps:

1. Zamień miejscami `stability` i `difficulty` w mapowaniu i uruchom `npm test` — zestaw musi się wywalić.
2. Podmień w teście `state` na `4` — schemat Zod musi odrzucić wiersz, a błąd musi być rozpoznawalny (nie nierozpoznawalny wyjątek z biblioteki).
3. Uruchom `npm run build` i sprawdź, że `dist` nie zawiera plików `*.test.*`.

## Performance Considerations

Pomiar z `research.md` §1.1 zamyka temat na czas MVP: **~1,25 µs na przeliczenie jednej karty**. Sesja 100 kart to ~0,2 ms, czyli 2% budżetu 10 ms CPU na free tier Cloudflare Workers. Napięcie sygnalizowane w [infrastructure.md](context/foundation/infrastructure.md) dotyczy parsowania odpowiedzi LLM w S-02, nie harmonogramowania.

Jedyny realny koszt wydajnościowy tego kontraktu leży w bazie: kolejkowanie `WHERE user_id = ? AND due <= now() ORDER BY due` bez indeksu `(user_id, due)` degraduje się liniowo z wielkością kolekcji. Dlatego indeks jest częścią kontraktu, a nie optymalizacją do rozważenia w S-05.

## Migration Notes

Brak danych do migracji — tabela fiszek jeszcze nie istnieje. To jest cały powód, dla którego F-01 stoi przed F-02.

Dwie rzeczy zabezpieczone na przyszłość:

- **`ts-fsrs` 5.x → 6.x** nie będzie wymagać migracji bazy, o ile utrzymana zostanie zasada wykluczenia `elapsed_days` i `last_elapsed_days` z kontraktu.
- **Dodanie `ReviewLog`** po MVP to nowa tabela z kluczem obcym do fiszki — nie dotyka istniejących kolumn ani zapisanych rekordów. To był warunek, pod którym decyzja #1 jest odwracalna.

## References

- Research wewnętrzny: `context/changes/srs-algorithm-contract/research.md`
- Research zewnętrzny (wybór biblioteki): `context/changes/srs-algorithm-contract/srs-library-research.md`
- Wyciąg z API: `context/changes/srs-algorithm-contract/ts-fsrs-api-doc.md`
- Rejestr nazw nośnych: `docs/reference/contract-surfaces.md`
- Roadmapa F-01/F-02/S-05: `context/foundation/roadmap.md`
- Wzorzec modułu w `src/lib/`: `src/lib/supabase.ts`, `src/lib/config-status.ts`

## Progress

> Konwencja: `- [ ]` do zrobienia, `- [x]` zrobione. Dopisz ` — <commit sha>`, gdy krok wyląduje. Nie zmieniaj tytułów kroków.

### Phase 1: Wykonywalny kontrakt stanu

#### Automated

- [x] 1.1 Kontrola typów przechodzi: `npx astro check` (0 errors, 0 warnings) — e874264
- [x] 1.2 Lint przechodzi bez wyłączania reguł: `npm run lint` — e874264
- [x] 1.3 Build przechodzi: `npm run build` — e874264
- [x] 1.4 `package.json` zawiera `zod` oraz `"ts-fsrs": "5.4.1"` bez `^`, a `package-lock.json` jest z nim zgodny — e874264

#### Manual

- [x] 1.5 Nazwy dziewięciu pól są snake_case i nadają się na kolumny bez tłumaczenia — e874264
- [x] 1.6 Moduł nie importuje niczego z `@supabase/*` ani `astro:*` — e874264

### Phase 2: Pokrycie guardrail-a PRD

#### Automated

- [x] 2.1 Testy przechodzą: `npm test` — acbbfb4
- [x] 2.2 Lint nadal przechodzi, bez nowej sekcji dla plików testowych — acbbfb4
- [x] 2.3 Kontrola typów obejmuje pliki testowe: `npx astro check` — acbbfb4
- [x] 2.4 Build nie zaciąga testów do bundla — acbbfb4

#### Manual

- [x] 2.5 CI pokazuje krok `npm test` jako osobny, zielony — acbbfb4
- [x] 2.6 Zamiana `stability` ↔ `difficulty` wywala test — acbbfb4

### Phase 3: Zapis kontraktu w rejestrze nazw nośnych

#### Automated

- [x] 3.1 Dziewięć nazw kolumn występuje w `docs/reference/contract-surfaces.md` — c49fa41
- [x] 3.2 `README.md` nie zawiera już `22.14.0` — c49fa41
- [x] 3.3 Format markdown przechodzi: `npx prettier --check "**/*.md"` — c49fa41

#### Manual

- [x] 3.4 Z samego `contract-surfaces.md` da się napisać `CREATE TABLE` dla F-02 — c49fa41
- [x] 3.5 Zmiana nie wprowadziła żadnej nowej trasy ani endpointu — c49fa41
- [x] 3.6 `roadmap.md` pokazuje F-01 jako `done`, F-02 jako odblokowane — c49fa41
