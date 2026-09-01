---
date: 2026-09-02T00:04:46+02:00
researcher: Sebastian Urbański
git_commit: 055796f6903570e7ee57d59c9d632db19578cf54
branch: master
repository: sebast82/10xCards
topic: "S-05 srs-review-session — wpięcie gotowego kontraktu FSRS w sesję powtórkową"
tags: [research, codebase, srs, ts-fsrs, review-session, api, react-island, testing]
status: complete
last_updated: 2026-09-02
last_updated_by: Sebastian Urbański
---

# Research: S-05 `srs-review-session`

**Date**: 2026-09-02T00:04:46+02:00
**Researcher**: Sebastian Urbański
**Git Commit**: `055796f` (zsynchronizowany z `origin/master`)
**Branch**: `master`
**Repository**: `sebast82/10xCards`

## Research Question

Co baza kodu już daje, a co trzeba zbudować, żeby dowieźć S-05 — sesję powtórkową opartą o algorytm spaced repetition? Zakres: warstwa API i danych, wyspa React i powłoka, integracja z modułem `src/lib/srs`, testy i guardrail PRD.

## Summary

**S-05 nie wymaga migracji ani backfillu.** To najważniejszy wynik tego researchu i zmienia wagę całej zmiany: F-01 i F-02 wykonały pracę przygotowawczą tak dokładnie, że warstwa danych jest kompletna, a S-05 sprowadza się do jednego endpointu, jednej wyspy i jednej strony.

Trzy fakty domykają największe niewiadome:

1. **Wszystkie fiszki mają poprawny stan harmonogramu.** Oba miejsca wstawiania fiszki — akceptacja propozycji AI (S-02) i ręczne tworzenie (S-04) — wołają `createScheduler().createNewCard(new Date())` i rozsypują dziewięć pól do `insert` ([service.ts:81](src/lib/flashcards/service.ts#L81), [service.ts:122](src/lib/flashcards/service.ts#L122)). Dziewięć kolumn jest `not null` **bez wartości domyślnych** ([20260824202259_flashcards_schema.sql:43-51](supabase/migrations/20260824202259_flashcards_schema.sql#L43-L51)), więc baza odrzuciłaby każdy insert, który je pominął. Nie może istnieć fiszka bez stanu — to gwarancja strukturalna, nie założenie.
2. **Indeks kolejkowania już istnieje** — `flashcards_user_id_due_idx (user_id, due)` ([20260824202259_flashcards_schema.sql:69](supabase/migrations/20260824202259_flashcards_schema.sql#L69)), wprowadzony przez F-01 świadomie pod S-05. RLS, grants i triggery też są na miejscu.
3. **Guardrail PRD „niezależnie od źródła fiszek" jest spełniony strukturalnie.** `source` nie występuje w `ScheduleStateRow` ani w API modułu SRS — algorytm nie wie, skąd pochodzi fiszka. F-01 zapisał jednak wprost, że **test obu źródeł należy do S-05** ([plan.md:202](context/archive/2026-08-23-srs-algorithm-contract/plan.md#L202)).

Realne ryzyko przesunęło się więc z „czy da się to zaplanować" na cztery konkretne miejsca, w których łatwo o cichy błąd:

- **Szew typów przy odczycie** (§3) — kontrakt typów trzyma tylko w kierunku zapisu. S-05 jest pierwszym przekrojem, który _czyta_ stan harmonogramu, więc pierwszym, który na to wpadnie.
- **Read-modify-write bez blokady** (§4.4) — dokładnie ta klasa błędu, która dała jedyny CRITICAL w przeglądzie S-02.
- **Sesja powtórkowa to pierwszy w tej bazie interfejs sterowany klawiaturą** (§5.4) — zero precedensów: ani jednego `useEffect`, `useRef`, `onKeyDown` czy `aria-live` w całym `src/`.
- **Czas i stan nigdy nie mogą przyjść od klienta** (§7) — zasada z `lessons.md` wiąże tu mocniej niż w S-02, bo błędna wartość nie psuje raportu, tylko zapisuje przekłamany harmonogram.

## Detailed Findings

### 1. Co już istnieje — inwentarz

| Element                        | Stan                                                               | Dowód                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Moduł `src/lib/srs/`           | gotowy, przetestowany, **nieużywany poza `flashcards/service.ts`** | [index.ts:1-5](src/lib/srs/index.ts#L1-L5)                                                                                                                   |
| Dziewięć kolumn harmonogramu   | `istnieje`, `not null`, z CHECK-ami                                | [schema:43-51](supabase/migrations/20260824202259_flashcards_schema.sql#L43-L51), [:59-65](supabase/migrations/20260824202259_flashcards_schema.sql#L59-L65) |
| Indeks `(user_id, due)`        | istnieje                                                           | [schema:69](supabase/migrations/20260824202259_flashcards_schema.sql#L69)                                                                                    |
| RLS + polityki + grants        | komplet, pokryty pgTAP (10 asercji)                                | [schema:101-157](supabase/migrations/20260824202259_flashcards_schema.sql#L101-L157), `supabase/tests/rls_flashcards.test.sql`                               |
| Trigger `updated_at`           | zarządzany bazą — **nie ustawiaj z kodu**                          | [schema:3-13](supabase/migrations/20260824202259_flashcards_schema.sql#L3-L13), [:76-79](supabase/migrations/20260824202259_flashcards_schema.sql#L76-L79)   |
| Trigger niezmienności `source` | rzuca `'flashcard source is immutable'`                            | [schema:81-98](supabase/migrations/20260824202259_flashcards_schema.sql#L81-L98)                                                                             |
| Trasa `/review`                | `proponowane`                                                      | [contract-surfaces.md:25](docs/reference/contract-surfaces.md#L25)                                                                                           |
| Endpoint `/api/reviews`        | `proponowane`                                                      | [contract-surfaces.md:44](docs/reference/contract-surfaces.md#L44)                                                                                           |
| `ts-fsrs`                      | przypięty **dokładnie** `5.4.1` (bez `^`)                          | `package.json:41`                                                                                                                                            |

**Do zbudowania jest wyłącznie:** endpoint `/api/reviews` (GET + POST), serwis sesji, strona `review.astro`, wyspa React, wpisy w nawigacji/middleware/rejestrze oraz testy.

### 2. Moduł `src/lib/srs` — powierzchnia i semantyka

Cała powierzchnia publiczna to pięć re-eksportów ([index.ts:1-5](src/lib/srs/index.ts#L1-L5)): `scheduleStateRowSchema`, `scheduleStateRowToCard`, `cardToScheduleStateRow`, `createScheduler` oraz typy `ScheduleStateRow`, `ScheduleOperations`, `SchedulePreview`, `Grade`.

Trzy operacje ([scheduler.ts:8-12](src/lib/srs/scheduler.ts#L8-L12)):

```ts
createNewCard(now: Date): ScheduleStateRow;
preview(row: ScheduleStateRow, now: Date): SchedulePreview;   // Record<Grade, ScheduleStateRow>
applyGrade(row: ScheduleStateRow, now: Date, grade: Grade): ScheduleStateRow;
```

Semantyka istotna dla planu:

- **Żadna operacja nie mutuje wejścia** i żadna nie czyta zegara systemowego — `now` jest zawsze jawnym argumentem. To celowa decyzja F-01 ([plan.md:144](context/archive/2026-08-23-srs-algorithm-contract/plan.md#L144)): _„Moduł nie odczytuje zegara systemowego; S-05 przekazuje czas żądania"_.
- **`applyGrade` jest deterministyczne** dla tej samej trójki (karta, ocena, czas) — asercja w [scheduler.test.ts:60-65](src/lib/srs/scheduler.test.ts#L60-L65). Trzyma się to, bo `enable_fuzz` jest `false`.
- **`preview` zwraca cztery pełne stany, nie interwały.** Jeśli przyciski oceny mają pokazywać „Again → 1m / Good → 10m", S-05 musi sam wyprowadzić czytelny interwał z `due`/`scheduled_days`. Funkcja jest zbudowana i przetestowana, ale **nie jest wołana z żadnego miejsca w kodzie**.
- **`Grade` to `1|2|3|4`** (`Rating.Manual = 0` jest wykluczone) — F-01 typował to świadomie, żeby zero nie przeciekło do API ([plan.md:142](context/archive/2026-08-23-srs-algorithm-contract/plan.md#L142)).
- **Parametry są w pełni nadpisywalne** — `createScheduler(parameters?)` przepuszcza `Partial<FSRSParameters>` prosto do `generatorParameters` ([scheduler.ts:15](src/lib/srs/scheduler.ts#L15)). Oba istniejące wywołania produkcyjne nie podają żadnych argumentów, więc w bazie leży stan wyliczony domyślnymi wagami. **Podanie w S-05 innych parametrów po cichu rozjedzie się z już zapisanym stanem.**

Efektywne wartości domyślne: `request_retention: 0.9`, `maximum_interval: 36500`, `enable_fuzz: false`, `enable_short_term: true`, `learning_steps: ["1m","10m"]`, `relearning_steps: ["10m"]`, algorytm FSRS-6.0.

#### 2.1 Ścieżka błędu — Zod, nie biblioteka

`FSRSValidationError` **nie jest eksportowany w 5.4.1** (zero trafień w `node_modules/ts-fsrs/dist/index.d.ts`), więc nie da się go złapać przez `instanceof`. Granicą jest Zod, i to w pierwszej linii każdej hydratacji — [schedule-state.ts:22](src/lib/srs/schedule-state.ts#L22) woła `scheduleStateRowSchema.parse(row)` zanim cokolwiek trafi do `TypeConvert.card`.

Konsekwencje dla S-05:

- Zły wiersz z bazy daje **surowy `ZodError`**. Moduł nie ma `safeParse` ani typowanej klasy błędu — S-05 musi sam opakować to w konwencję `FlashcardServiceError` ([service.ts:14-22](src/lib/flashcards/service.ts#L14-L22)) i zmapować na HTTP.
- **Ocena poza zakresem nie jest chroniona przez Zod.** `grade` równe `0` albo `5` przechodzi przez moduł i rzuca w ts-fsrs nieprzechwytywalny `FSRSValidationError`. **Walidacja oceny musi stać na granicy API** — inaczej awaria jest nie do obsłużenia.

#### 2.2 Czego moduł nie daje

Potwierdzone czytaniem wszystkich pięciu plików (~90 linii źródła):

- **Brak API „daj następną fiszkę"** — kolejkowanie to zwykły SQL, dlatego indeks `(user_id, due)` jest częścią kontraktu, a nie optymalizacją.
- **Brak utrwalania `ReviewLog`** — [scheduler.ts:34](src/lib/srs/scheduler.ts#L34) bierze `.card` i **wyrzuca `.log`**; nie ma tabeli logu w żadnej migracji. `rollback()` wymaga logu, więc **cofnięcie oceny jest strukturalnie niemożliwe**. To świadoma decyzja #1 z F-01, odwracalna tylko przez nową tabelę.
- Brak batchowania, brak `safeParse`, brak warstwy repozytorium, brak zegara.
- **`Rating` i `State` nie są re-eksportowane** — S-05 importuje enumy bezpośrednio z `ts-fsrs`, tak jak robią to testy ([scheduler.test.ts:2](src/lib/srs/scheduler.test.ts#L2)).

### 3. Szew, na którym to pęknie — `state` przy odczycie

To najważniejsze ustalenie techniczne researchu.

Kontrakt typów jest weryfikowany jedną asercją ([schema-contract.test.ts:10](src/db/schema-contract.test.ts#L10)):

```ts
expectTypeOf<ScheduleStateRow>().toExtend<Pick<FlashcardRow, keyof ScheduleStateRow>>();
```

Czyli: typ **wąski** (kontrakt) jest przypisywalny do typu **szerokiego** (baza). To wystarcza dla zapisu — dlatego `...schedule` w `insert` przechodzi kontrolę typów. **Kierunek odwrotny nie jest asercjonowany i nie zachodzi:**

| Pole             | `ScheduleStateRow`          | Wygenerowany typ DB                                             | Werdykt         |
| ---------------- | --------------------------- | --------------------------------------------------------------- | --------------- |
| `state`          | `0 \| 1 \| 2 \| 3`          | `number` ([database.types.ts:28](src/db/database.types.ts#L28)) | **niezgodność** |
| `due`            | `string` ISO z offsetem     | `string` (format nieegzekwowany)                                | tolerowalne     |
| pozostałe siedem | `number` / `string \| null` | zgodne                                                          | OK              |

Wiersz wyjęty z Supabase ma `state: number` i **nie jest przypisywalny do `ScheduleStateRow`**. Wszystkie dotychczasowe przekroje tylko _zapisywały_ stan harmonogramu; **S-05 jest pierwszym, który go czyta**, więc pierwszym, który uderzy w ten szew.

**Wniosek wiążący dla planu:** wyniku `select` nie wolno podać do `preview`/`applyGrade` bezpośrednio ani przez `as ScheduleStateRow`. Rzutowanie skompiluje się i wybuchnie dopiero w runtime na złym wierszu. Jedyne poprawne wejście to `scheduleStateRowSchema.parse(row)` (albo `safeParse`) na każdym odczytanym wierszu — co przy okazji zwęża `number` → `0|1|2|3`.

Dwie uwagi poboczne:

- **`elapsed_days` celowo nie jest utrwalane** — [schedule-state.ts:25](src/lib/srs/schedule-state.ts#L25) wpisuje na sztywno `0`, a ts-fsrs i tak przelicza je z `last_review` względem `now`. To jest poprawne; nie „naprawiaj" tego kolumną.
- `cardToScheduleStateRow` emituje ISO z sufiksem `Z`, Postgres oddaje `+00:00`. Oba przechodzą schemat; nierówność stringów między zapisem a odczytem jest oczekiwana.

### 4. Warstwa API i danych

#### 4.1 Anatomia endpointu — sześć części w stałej kolejności

Wzorzec jest identyczny w `flashcards.ts`, `flashcards/[id].ts` i `generations.ts`:

1. **Zamrożona tablica polskich komunikatów** z twardą zasadą, że `error.issues` nigdy nie trafia do klienta — [flashcards.ts:7-13](src/pages/api/flashcards.ts#L7-L13): _„Komunikaty są stałe. Wstawienie `error.issues` wypuściłoby treść fiszki w odpowiedzi."_
2. **Schematy Zod na poziomie modułu, w pliku trasy** — nie w serwisie.
3. **Lokalne helpery `json()` i `error()`, powielone dosłownie w każdym z trzech plików** ([flashcards.ts:33-42](src/pages/api/flashcards.ts#L33-L42)). **Nie ma współdzielonego modułu odpowiedzi** — skopiowanie ich do `reviews.ts` jest konwencją, nie zaniedbaniem.
4. **Sekwencja bramek.** Przy wielu metodach w jednym pliku stosuje się wydzielony `getRequestContext`, który zwraca albo kontekst, albo `Response`, a handler robi `if (context instanceof Response) return context;` ([\[id\].ts:33-51](src/pages/api/flashcards/[id].ts#L33-L51), [:62-65](src/pages/api/flashcards/[id].ts#L62-L65)). **`/api/reviews` ma GET i POST, więc idzie tą ścieżką.**
5. **Parsowanie ciała zawsze w `try/catch`**, a błąd parsowania mapuje się na _ten sam_ komunikat co błąd walidacji.
6. **Wywołanie serwisu w `try/catch` z dispatch po `instanceof` na typowanej klasie błędu.**

Koperta odpowiedzi: sukces to **goły** obiekt serwisu (bez `{ data: ... }`), błąd to zawsze dokładnie `{ "error": "<polski komunikat>" }`. Drabina statusów: 401 brak usera → 503 brak `supabase` → 400 złe ciało → 404 nie znaleziono → 500 awaria zapisu.

**Uwaga:** `export const prerender` **nie występuje nigdzie w `src/`** — `astro.config.mjs:11` ustawia `output: "server"` globalnie. Mimo że `CLAUDE.md.scaffold:22` tego wymaga, dodanie go do `/api/reviews` byłoby złamaniem faktycznej konwencji.

#### 4.2 Warstwa serwisu

Błędy to **rzucane klasy z polem `code` typu string-union** ([service.ts:6-22](src/lib/flashcards/service.ts#L6-L22)), nigdy obiekty wynikowe, i nigdy surowy `error` z Supabase. Klient Supabase jest polem jednego destrukturyzowanego obiektu wejściowego, nigdy pierwszym argumentem pozycyjnym ([service.ts:24-52](src/lib/flashcards/service.ts#L24-L52)).

**Nie ma `src/types.ts`.** DTO żyją w trzech miejscach: wygenerowane typy `Database`, interfejsy `*Input` obok funkcji serwisu, i lokalne interfejsy w komponentach (np. `Flashcard` w [FlashcardCollection.tsx:20-26](src/components/deck/FlashcardCollection.tsx#L20-L26) — pisany ręcznie, nie wyprowadzony z `Database`).

#### 4.3 Zapytanie kolejkujące

Idiom bazy kodu, jadący po istniejącym indeksie:

```ts
supabase
  .from("flashcards")
  .select(
    "id, front, back, due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, state, last_review",
  )
  .eq("user_id", userId) // celowanie w indeks, nie bezpieczeństwo — izolację daje RLS
  .lte("due", new Date().toISOString())
  .order("due", { ascending: true })
  .range(0, SESSION_SIZE - 1);
```

- **Konwencją paginacji jest `.range(0, PAGE_SIZE - 1)` ze stałą na poziomie modułu**, nie `.limit()` ([deck.astro:7-8](src/pages/deck.astro#L7-L8), [:16](src/pages/deck.astro#L16), `PAGE_SIZE = 50`).
- `.eq("user_id", …)` zostaje mimo RLS — oba istniejące wywołania serwisowe tak robią i dokumentują to jako celowanie w indeks.
- **Każda nigdy nieoceniona fiszka jest wymagalna od momentu utworzenia** (`due = now` przy insercie), więc kolejka „zaległych" i „nowych" to to samo zapytanie. **Nie istnieje żaden limit nowych kart na dzień ani przeplatanie po `state`** — jeżeli S-05 tego chce, to logika od zera i rozszerzenie zakresu ponad PRD.

#### 4.4 Wyścig read-modify-write — bez zabezpieczenia

Zapis oceny to: `SELECT` dziewięciu kolumn → `applyGrade` → `UPDATE`. W ścieżce fiszek **nie ma kolumny wersjonującej, nie ma `for update`, nie ma żadnej ochrony optymistycznej**. Dwie karty przeglądarki oceniające tę samą fiszkę — albo podwójne kliknięcie przycisku oceny — po cichu zgubią jeden zapis.

To dokładnie klasa błędu, która dała **jedyny CRITICAL** w przeglądzie S-02 ([impl-review.md:43](context/archive/2026-08-25-first-gated-generation/reviews/impl-review.md#L43)): check-then-act przez `await`, rozwiązany wtedy wzorcem rezerwacji. Plan musi zająć wobec tego jawne stanowisko — obrona po stronie UI (zablokowany przycisk na czas żądania) jest tania i zgodna z precedensem wzajemnie wykluczających się trybów z S-04, ale nie chroni przed dwiema kartami.

Dodatkowo z przeglądu S-02: **`PATCH /api/flashcards/:id` nie dotyka kolumn harmonogramu** — `updateFlashcard` zapisuje wyłącznie `front`/`back` ([service.ts:151-157](src/lib/flashcards/service.ts#L151-L157)). To dobra wiadomość: **edycja fiszki w S-03 nie resetuje terminu**, więc S-05 dziedziczy harmonogramy nienaruszone przez pielęgnację kolekcji.

### 5. Frontend

#### 5.1 Strona i wyspa — dwa konkurencyjne precedensy

- **`generate.astro`** (7 linii): pusta wyspa `client:load`, wszystko pobiera sama.
- **`deck.astro`**: strona pyta Supabase **we frontmatterze** i podaje wiersze jako propsy ([deck.astro:11-17](src/pages/deck.astro#L11-L17)); błąd pobrania renderuje _strona_, wyspa go nie widzi ([deck.astro:29-35](src/pages/deck.astro#L29-L35)).

Plan musi wybrać jeden. Warto odnotować, że komentarz w [deck.astro:7](src/pages/deck.astro#L7) obiecywał `GET /api/flashcards` „w S-03", ale **S-03 zamknął się bez tego endpointu** — pozycja nadal figuruje jako `proponowane` w rejestrze. Ocena jest mutacją, więc endpoint POST jest potrzebny tak czy inaczej.

**Wiązanie bezpieczeństwa:** `src/lib/srs` ciągnie Zod i `ts-fsrs`, więc `applyGrade` **musi liczyć się na serwerze**. Wyspa nie może importować z `@/lib/srs` — to dokładnie klasa błędu F6 z przeglądu S-02 (wyspa importowała z `@/lib/openrouter/`, naprawione przeniesieniem stałych do neutralnego [limits.ts](src/lib/limits.ts), którego nagłówek zapisuje tę zasadę wprost).

#### 5.2 Powłoka — cztery kroki i jedna pułapka

Żeby `/review` zaistniało: (1) dopisać pozycję do [navigation.ts:1-5](src/lib/navigation.ts#L1-L5), (2) dodać `"/review"` do `PROTECTED_ROUTES` w [middleware.ts:4](src/middleware.ts#L4), (3) użyć `AppLayout.astro`, (4) przestawić oba wiersze w rejestrze z `proponowane` na `istnieje`.

**Pułapka:** [navigation.test.ts:6-11](src/lib/navigation.test.ts#L6-L11) asercjonuje całą tablicę przez `toEqual`, więc **dodanie pozycji wywala test, dopóki nie zostanie zaktualizowany w tym samym commicie**. S-07 zaprojektował to jako świadomy tripwire, nie usterkę.

Dwie uwagi: `middleware.ts:19` używa surowego `startsWith`, więc `"/review"` ochroni też `/reviews` i `/review-cokolwiek` (nieszkodliwe, ale asymetryczne wobec segmentowego dopasowania w nawigacji). `src/components/Topbar.astro` to **martwy komponent** ze startera — nie brać za wzór.

#### 5.3 Architektura wyspy

Zero bibliotek stanu, zero `src/hooks/`, zero customowych hooków. Dwa wzorce do wyboru:

- `FlashcardCollection.tsx:71-80` — dziesięć płaskich `useState`.
- `GenerateView.tsx:13` — **maszyna statusów** (`type ViewStatus = "idle" | "generating" | "reviewing" | "error"`) plus helper `updateProposal` do łatania pojedynczego elementu ([:90-92](src/components/generate/GenerateView.tsx#L90-L92)).

Do sesji powtórkowej pasuje wariant drugi (`idle | loading | question | answer | grading | finished | error`).

Reszta konwencji: **surowy `fetch` inline, bez klienta API** — za to `readJson`, `readError` i ręcznie pisane type-guardy (nie Zod, Zod jest wyłącznie serwerowy) są **powielone dosłownie w obu wyspach**; trzecia wyspa da trzecią kopię, chyba że plan zdecyduje o ekstrakcji. Odświeżanie to **mutacja stanu lokalnego, nigdy refetch ani `location.reload()`**. **Aktualizacji optymistycznych nie ma nigdzie** — każda mutacja jest pesymistyczna. **Toastów nie ma** (brak `sonner` w zależnościach); błąd strony to `Alert variant="destructive"` z przyciskiem ponowienia ([GenerateView.tsx:223-241](src/components/generate/GenerateView.tsx#L223-L241)). Ładowanie to zawsze `<Loader2 className="animate-spin" />` w zablokowanym przycisku; nie ma skeletonów.

Stan pusty ([FlashcardCollection.tsx:281-288](src/components/deck/FlashcardCollection.tsx#L281-L288)) — obramowany box, jedno zdanie, `Button asChild` z linkiem — jest bezpośrednim precedensem dla „nie masz dziś nic do powtórki".

#### 5.4 Inwentarz komponentów i luka dostępności

`src/components/ui/` zawiera **sześć plików**: `button`, `card`, `alert`, `alert-dialog`, `textarea` oraz `LibBadge.astro` (dekoracja ze startera, nie prymityw).

**Brakuje, a sesja mogłaby chcieć:** `progress` (postęp „karta 3 z 12" byłby dziś zwykłym `<span>`, jak licznik w [GenerateView.tsx:247-249](src/components/generate/GenerateView.tsx#L247-L249)), `badge` (obecna konwencja to inline `rounded-full border px-2 py-0.5 text-xs`), `separator`, `dialog`, `tooltip`, `kbd`. Dodanie przez `npx shadcn@latest add` ma dwa haczyki: alias `hooks` wskazuje na nieistniejące `@/hooks`, a lokalna konwencja **usuwa klasy animacji** (patrz `alert-dialog.tsx`), więc świeżo dodane komponenty nie będą zgodne ze stylem domu.

**Luka dostępności jest realna i jest największym pojedynczym obszarem nowej pracy w UI.** Grep po całym `src/` za `useEffect|useRef|useReducer|onKeyDown|addEventListener|autoFocus|tabIndex|\.focus\(` daje **zero trafień**. Konkretnie nie istnieje:

- **Obsługa skrótów klawiszowych** — schemat „spacja odsłania, 1–4 ocenia" nie ma czego kopiować i wymagałby **pierwszego `useEffect` w tej bazie kodu** (nasłuch na `document`).
- **Zarządzanie fokusem** — przejście do następnej karty osieroci fokus klawiatury i czytnika ekranu, jeśli nie zostanie obsłużone świadomie.
- **Regiony live** — zero `aria-live`/`role="status"` w wyspach; zmiany stanu są wyłącznie wizualne.
- **Animacje poza `animate-spin`** — animacja obrotu karty byłaby **pierwszą w tej bazie kodu**, nie rozszerzeniem wzorca. `prefers-reduced-motion` nie jest nigdzie użyte.

Co jest: `aria-label` na nieopisanych kontrolkach, `aria-current="page"` w nawigacji, `role="alert"` w prymitywie `Alert`, `useId()` do wiązania etykiet, pierścienie fokusu z prymitywów oraz `eslint-plugin-jsx-a11y` w devDependencies (więc naruszenia łapie lint).

### 6. Testy i guardrail

**Stan bazowy zweryfikowany uruchomieniem:** 11 plików, 79 testów, ~21 s. Runner: Vitest 4, `environment: "node"` globalnie, **bez `globals`** — każdy plik importuje `describe`/`it`/`expect` jawnie, bo `eslint.config.js` nie ma sekcji dla plików testowych i trzyma je pod `strictTypeChecked`. jsdom włącza się **per plik** docblokiem `// @vitest-environment jsdom`.

CI ([ci.yml](.github/workflows/ci.yml)): checkout → setup-node 24 → `npm ci` → `astro sync` → `astro check` → `npm run lint` → `npm test` → `npm run build`. **`npm run db:test` (pgTAP) nie jest w CI** — testy RLS chodzą tylko lokalnie.

#### 6.1 Wzorzec testu endpointu

Seam to wstrzykiwany `locals.supabase`; **nie ma ani jednego `vi.mock` w testach tras**. Każdy plik definiuje lokalną fabrykę `context()` rzutującą `as never` ([flashcards.test.ts:12-27](src/pages/api/flashcards.test.ts#L12-L27)), używa prawdziwych obiektów `Request`/`Response`, stałych UUID-ów o kształcie v4, a asercje idą po `supabase.queries[n].payload` i `supabase.rpcCalls`.

**Blokada do usunięcia:** `StubQuery` w [supabase-stub.ts:23-72](src/lib/test-support/supabase-stub.ts#L23-L72) implementuje `select/insert/update/delete/eq/gte/single/maybeSingle/then`, ale **nie ma `lte`, `order`, `limit` ani `range`**. Jedyne zapytanie, dla którego S-05 istnieje, nie da się dziś zastubować. To ta sama praca, którą S-03 musiał wykonać dla `delete()`.

#### 6.2 Wzorzec testu wyspy

Testing Library + `user-event`, `vi.stubGlobal("fetch", …)` z jedną gotową `Response` na test ([FlashcardCollection.test.tsx:1-42](src/components/deck/FlashcardCollection.test.tsx#L1-L42)). **Nie ma `@testing-library/jest-dom`** — asercje to `.toBeTruthy()`, `.toBeNull()`, `.value`, `.disabled`; nie sięgać po `toBeInTheDocument()`. Zapytania idą **po roli i polskiej nazwie dostępnej**, więc przyciski oceny muszą mieć realne nazwy dostępne, żeby dały się testować.

**Ograniczenie:** przepływ sesji to co najmniej dwa kolejne żądania (pobranie kolejki → zapis oceny), a `mockResolvedValue` zwraca zawsze to samo. Potrzebne będzie łańcuchowanie `mockResolvedValueOnce` — czego żaden istniejący test jeszcze nie robi.

#### 6.3 Czego brakuje

Brak MSW, brak Playwright/Cypress (każdy plan od S-02 wyklucza E2E jawnie), brak fixture'ów bazodanowych dla testów TS, brak raportowania pokrycia, brak `--typecheck`. **Brak kontroli zegara — i to jest zaletą:** `vi.useFakeTimers()` nie występuje nigdzie, bo moduł SRS przyjmuje jawne `now`. Endpoint musi utrzymać tę dyscyplinę, inaczej stanie się nietestowalny.

**Strona `.astro` nie ma z definicji żadnego pokrycia automatycznego** — jedyną obroną jest `astro check` i `build`.

#### 6.4 Guardrail PRD

PRD daje S-05 **jedno wymaganie i jeden warunek brzegowy, i nic poza tym**:

> FR-009: Użytkownik może rozpocząć sesję nauki z algorytmem powtórek. Priority: must-have — [prd.md:81](context/foundation/prd.md#L81)

> Mechanizm powtórek / algorytm nauki nie może zawieść — sesja nauki zawsze musi poprawnie funkcjonować, niezależnie od źródła fiszek (AI czy manualne) — [prd.md:40](context/foundation/prd.md#L40)

**Żadne kryterium sukcesu PRD nie mierzy sesji powtórkowej** (oba pierwotne dotyczą akceptacji AI), **nie ma user story dla pętli nauki**, i nie ma ani słowa o długości sesji, dziennych limitach, statystykach, seriach czy cofaniu oceny. Wszystko poza FR-009 i guardrailem to **wymyślanie zakresu**.

Połowa „niezależnie od źródła" jest spełniona strukturalnie (§Summary), ale F-01 świadomie **oddelegował test obu źródeł do S-05** — to jest konkretny, nazwany dług do spłacenia w tej zmianie.

### 7. Zaufanie do klienta — `lessons.md` w kontekście sesji

Jedyny wpis w [lessons.md](context/foundation/lessons.md) każe sprawdzić, kto ustawia pole: jeśli wartość przychodzi w ciele żądania i serwer nie ma jak jej podważyć, trzeba ją opisać jako self-reported albo dorzucić serwerowy dowód. Litera reguły dotyczy pól zasilających licznik lub KPI — sesja żadnego KPI nie zasila. **Ale jej duch wiąże tu mocniej niż w S-02, bo nieweryfikowalna wartość nie przekłamuje raportu, tylko zapisuje trwały harmonogram, którego dotyczy guardrail.** Cztery pola, cztery różne rozstrzygnięcia:

| Pole                  | Werdykt                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`grade`**           | **Przyjąć i udokumentować jako self-report z założenia.** FSRS jest modelem samooceny; tylko uczący się wie, czy pamiętał. Nie zasila żadnego KPI, a zły wpis psuje wyłącznie własny harmonogram użytkownika. Nie dorabiać „dowodu".                                                                                                                               |
| **czas oceny**        | **Nigdy nie przyjmować z ciała żądania.** Wynik ts-fsrs zależy od upływu czasu bardziej niż od oceny. `now` powstaje przez `new Date()` w handlerze — to ta sama klasa co `edited`, ale o wyższej stawce, i F-01 już to przewidział.                                                                                                                               |
| **stan harmonogramu** | **Nigdy nie przyjmować z klienta.** Odesłanie dziewięciu pól przez wyspę jest kuszącą oszczędnością jednego odczytu i jest dokładnie trybem awarii `edited`. Serwis musi odczytać wiersz przez RLS i zwalidować go schematem. Precedens: gałąź AI weryfikuje `generation` po stronie serwera, a `source` wyprowadza się z kształtu payloadu, nigdy z pola klienta. |
| **skład kolejki**     | **Liczyć na serwerze.** `WHERE user_id = ? AND due <= now()` należy do serwera; endpoint nie przyjmuje listy ID ani filtra „due" od klienta.                                                                                                                                                                                                                       |

## Code References

Permalinki do `055796f` (commit jest wypchnięty na `origin/master`):

- [`src/lib/srs/index.ts:1-5`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/src/lib/srs/index.ts#L1-L5) — cała powierzchnia publiczna modułu SRS
- [`src/lib/srs/scheduler.ts:8-15`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/src/lib/srs/scheduler.ts#L8-L15) — trzy operacje i fabryka z nadpisywalnymi parametrami
- [`src/lib/srs/schedule-state.ts:5-19`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/src/lib/srs/schedule-state.ts#L5-L19) — schemat Zod dziewięciu pól
- [`src/db/schema-contract.test.ts:10`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/src/db/schema-contract.test.ts#L10) — asercja typu, która trzyma tylko w kierunku zapisu
- [`src/lib/flashcards/service.ts:81`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/src/lib/flashcards/service.ts#L81), [`:122`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/src/lib/flashcards/service.ts#L122) — oba miejsca inicjalizacji stanu harmonogramu
- [`src/lib/flashcards/service.ts:6-22`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/src/lib/flashcards/service.ts#L6-L22) — konwencja typowanego błędu serwisu
- [`src/pages/api/flashcards/[id].ts:33-51`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/src/pages/api/flashcards/%5Bid%5D.ts#L33-L51) — `getRequestContext` dla trasy o wielu metodach
- [`src/pages/api/flashcards.ts:7-13`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/src/pages/api/flashcards.ts#L7-L13) — stałe komunikaty i zakaz wypuszczania `error.issues`
- [`supabase/migrations/20260824202259_flashcards_schema.sql:43-51`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/supabase/migrations/20260824202259_flashcards_schema.sql#L43-L51) — dziewięć kolumn `not null` bez defaultów
- [`supabase/migrations/20260824202259_flashcards_schema.sql:69`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/supabase/migrations/20260824202259_flashcards_schema.sql#L69) — istniejący indeks `(user_id, due)`
- [`src/lib/test-support/supabase-stub.ts:23-72`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/src/lib/test-support/supabase-stub.ts#L23-L72) — stub bez `lte`/`order`/`range`
- [`src/lib/navigation.ts:1-5`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/src/lib/navigation.ts#L1-L5) i [`src/lib/navigation.test.ts:6-11`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/src/lib/navigation.test.ts#L6-L11) — kontrakt nawigacji i tripwire
- [`src/middleware.ts:4`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/src/middleware.ts#L4) — `PROTECTED_ROUTES` bez `/review`
- [`src/pages/deck.astro:11-17`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/src/pages/deck.astro#L11-L17) — precedens pobierania danych we frontmatterze
- [`src/components/generate/GenerateView.tsx:13`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/src/components/generate/GenerateView.tsx#L13) — wzorzec maszyny statusów
- [`eslint.config.js:71-82`](https://github.com/sebast82/10xCards/blob/055796f6903570e7ee57d59c9d632db19578cf54/eslint.config.js#L71-L82) — lista ścieżek serwerowych z `no-console: "error"`, **bez przyszłego katalogu sesji**

## Architecture Insights

1. **Kontrakt jako kod działa.** F-01 wyprodukował moduł, który przeszedł przez F-02 (kolumny), S-02 i S-04 (inicjalizacja stanu) i dotarł do S-05 bez ani jednej modyfikacji. Cena: dziewięć pól ma teraz trzy niezależne reprezentacje (Zod, wygenerowane typy DB, CHECK-i SQL), utrzymywane w spójności jedną asercją typu — która, jak pokazuje §3, pilnuje tylko jednego kierunku.
2. **Izolacja stoi na RLS, nie na kodzie.** Filtry `user_id` w zapytaniach są celowaniem w indeks; granicą bezpieczeństwa jest polityka `to authenticated` z `(select auth.uid()) = user_id`, i to samo dotyczy odczytu i zapisu w S-05.
3. **Konwencją jest kopiowanie, nie abstrahowanie.** `json`/`error` istnieją w trzech kopiach, `readJson`/`readError` w dwóch. Baza kodu świadomie preferuje lokalną duplikację nad przedwczesnym współdzieleniem; ekstrakcja w S-05 byłaby odejściem od konwencji i wymaga jawnej decyzji, a nie wykonania przy okazji.
4. **Seamy testowe projektuje się z góry.** Wszystko, co da się przetestować (serwisy, trasy, moduł SRS), przyjmuje swoją zależność jako argument; jedyny nieprzetestowany moduł (`openrouter/client.ts`) to ten, który woła globalny `fetch`. Endpoint oceny musi przyjmować `now` i klienta Supabase tą samą drogą.
5. **Sesja powtórkowa jest jakościowo innym interfejsem niż wszystko dotychczas.** Cała dotychczasowa aplikacja to formularze i listy: klik, żądanie, aktualizacja listy. Sesja to pętla ze stanem, sterowana klawiaturą, z przejściami — i baza kodu nie ma na to ani jednego wzorca (§5.4). To jest największe niedoszacowane ryzyko S-05, i leży w UI, nie w algorytmie.

## Historical Context (from prior changes)

- [`context/archive/2026-08-23-srs-algorithm-contract/plan.md`](context/archive/2026-08-23-srs-algorithm-contract/plan.md) — osiem decyzji, które wiążą S-05. Najważniejsze: **#1 `ReviewLog` nie jest utrwalany** (brak cofania), **#6 parametry FSRS są stałymi w kodzie** (brak ustawień per użytkownik), pakiet przypięty do `5.4.1` bez karety, ocena typowana jako `Grade` a nie `number`, jawne `now` w każdej operacji. Wprost: _„Nie tworzymy endpointów ani UI — `/api/reviews` i `/review` należą do S-05"_ ([:57](context/archive/2026-08-23-srs-algorithm-contract/plan.md#L57)).
- [`context/archive/2026-08-23-srs-algorithm-contract/research.md`](context/archive/2026-08-23-srs-algorithm-contract/research.md) — pomiar **~1,25 µs na kartę** na realnym `workerd`; sesja 100 kart to ~0,2 ms z 10 ms budżetu CPU. **Limit CPU Cloudflare nie jest ryzykiem S-05 i nie ma po co go ponownie rozważać.** Tam też zapisano, że kolejka musi żyć w stanie wyspy, bo redirect-po-POST gubiłby sesję przy każdej ocenie.
- [`context/archive/2026-08-25-first-gated-generation/reviews/impl-review.md`](context/archive/2026-08-25-first-gated-generation/reviews/impl-review.md) — najbogatsze źródło klas błędów. F1: check-then-act przez `await` (→ §4.4). F2: zignorowany `.error` z Supabase przy `no-console: "error"` daje **całkowicie cichą awarię** — w S-05 oznaczałoby to ocenę, po której harmonogram się nie rusza, czyli niewidoczne naruszenie guardraila. F3: zapytanie bez limitu. F6: wyspa importująca z katalogu serwerowego. **F7: „jeden moduł = jeden `.test.ts`"** — brak testów serwisu nazwano _przeoczeniem, nie ograniczeniem architektury_, więc S-05 bez testu serwisu i testu trasy wchodzi w znane, nazwane finding.
- [`context/archive/2026-08-25-first-gated-generation/reviews/plan-review.md`](context/archive/2026-08-25-first-gated-generation/reviews/plan-review.md) — ograniczenia procesu: `/10x-implement` liczy fazy po nagłówkach dokładnie w formacie `## Phase N:`, a sekcja `## Progress` musi mieć **jeden wiersz na każde kryterium sukcesu**, w podziale Automated/Manual. Dodatkowo: pgTAP wykonuje asercje sekwencyjnie w jednej sesji, więc **testem pgTAP nie da się wykryć braku blokady**.
- [`context/archive/2026-08-26-app-shell-navigation/plan.md`](context/archive/2026-08-26-app-shell-navigation/plan.md) — S-07 **świadomie nie dodał `/review`** ani wyszarzonego linku: _„Do kontraktu trafiają wyłącznie działające trasy"_. Cztery mechaniczne kroki z §5.2 to dług przekazany wprost S-05.
- [`context/archive/2026-09-01-manual-card-edit-delete/`](context/archive/2026-09-01-manual-card-edit-delete/) — edycja **nie dotyka `source`, `generation_id` ani pól harmonogramu**, potwierdzone weryfikacją ręczną. F1 (WARNING): pełzanie zakresu w postaci zmiany portu bazy w współdzielonym `config.toml`. F2 (OBSERVATION): ręczne kryteria odhaczone bez śladu dowodowego — naprawione dopiero `manual-verification.md`. **S-05 ma kryteria ręczne z konieczności (guardrail jest twierdzeniem behawioralnym), więc plik dowodowy warto zaplanować z góry.**
- [`context/archive/2026-09-01-manual-card-create/plan.md`](context/archive/2026-09-01-manual-card-create/plan.md) — _„Payload shape chooses the server branch; clients never submit a writable `source`"_, unia dwóch `.strict()` schematów, progi walidacji lustrzane wobec CHECK-ów bazy, **nie dopisuj do stanu lokalnego, zanim serwer nie potwierdzi**, oraz wzajemnie wykluczające się tryby interakcji. Wszystkie cztery mają bezpośredni odpowiednik w sesji powtórkowej.

## Related Research

- `context/archive/2026-08-23-srs-algorithm-contract/research.md` — research wewnętrzny F-01 (wybór i weryfikacja `ts-fsrs` na `workerd`)
- `context/archive/2026-08-23-srs-algorithm-contract/srs-library-research.md` — research zewnętrzny, porównanie bibliotek SRS
- `context/archive/2026-08-23-srs-algorithm-contract/ts-fsrs-api-doc.md` — wyciąg z API ts-fsrs (§6 potwierdza brak API kolejkowania)
- `docs/reference/contract-surfaces.md` — rejestr nazw nośnych; S-05 przestawia w nim dwa wiersze

## Open Questions

Pytania techniczne są zamknięte. Otwarte są **decyzje produktowe i projektowe**, których PRD celowo nie rozstrzyga (§6.4) — należą do `/10x-plan`, nie do dalszego researchu:

1. **Skąd strona bierze kolejkę** — frontmatter `review.astro` (precedens `deck.astro`) czy `GET /api/reviews` (pierwszy endpoint GET w repo)? POST na ocenę jest potrzebny w obu wariantach.
2. **Co widzi użytkownik, gdy nic nie jest wymagalne.** Pusty stan czy nauka przed terminem? Wariant drugi to nowa logika bez oparcia w PRD.
3. **Rozmiar sesji** — stała w rodzaju `PAGE_SIZE = 50`. Jaka wartość i czy sesja kończy się po wyczerpaniu kolejki, czy dobiera ponownie (karty ocenione `Again` wracają jako wymagalne w ciągu minuty przy `learning_steps: ["1m","10m"]`).
4. **Czy przyciski oceny pokazują interwały** — `preview()` jest gotowe i nieużywane, ale kosztuje dodatkowe przeliczenie i wymaga wyprowadzenia czytelnej etykiety z `due`/`scheduled_days`.
5. **Zakres obrony przed podwójną oceną** (§4.4) — sama blokada przycisku, czy również ochrona serwerowa? Blokada nie chroni przed dwiema kartami przeglądarki.
6. **Jak daleko idzie warstwa klawiatury i dostępności** (§5.4) — to jedyny obszar, w którym S-05 buduje od zera, więc jedyny realny kandydat do przycięcia pod termin 2026-09-07.
7. **Czy `readJson`/`readError` zostają wyekstrahowane** przy trzeciej kopii, czy konwencja duplikacji obowiązuje dalej.
8. **Dziedziczone zobowiązanie z F-01:** _„Czy `ts-fsrs` zachowa się tak samo na wdrożonej instancji jak na `wrangler dev`? Domknięcie: **pierwszy deploy S-05**"_ ([research.md:193](context/archive/2026-08-23-srs-algorithm-contract/research.md#L193)). To pytanie zamyka się dopiero po wdrożeniu i należy do kryteriów ręcznych planu.
