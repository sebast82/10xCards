---
date: 2026-08-23
researcher: GitHub Copilot
git_commit: a946fffcf07588fc2fe9fbeb065c7db527a685b4
branch: master
repository: sebast82/10xCards
topic: "Zgodność ts-fsrs z bazą kodu 10xCards (F-01 → S-02, S-05)"
tags: [research, codebase, srs, ts-fsrs, cloudflare-workers, supabase, astro]
status: complete
last_updated: 2026-08-24
last_updated_by: GitHub Copilot
last_updated_note: "Wydzielono research zewnętrzny (porównanie bibliotek) do srs-library-research.md"
---

# Research: zgodność `ts-fsrs` z bazą kodu 10xCards

> Research **wewnętrzny** — co mówi ta baza kodu.
> Porównanie kandydatów i uzasadnienie wyboru biblioteki: `srs-library-research.md`.
> Wyciąg z API biblioteki: `ts-fsrs-api-doc.md`.

## Pytanie badawcze

Czy `context/changes/srs-algorithm-contract/ts-fsrs-api-doc.md` jest zgodny z tą bazą kodu, i co z niej wynika dla wdrożenia F-01, a następnie S-02 i S-05.

**Metoda:** cztery równoległe sub-agenty czytające bazę kodu (runtime/build, warstwa danych, wzorce API/UI, dokumenty kontraktowe) + empiryczna instalacja `ts-fsrs` i smoke test na `workerd` przez `wrangler dev`.

**Stan repo w chwili badania:** commit `a946fff`, branch `master`, drzewo czyste.

## Podsumowanie

**`ts-fsrs` jest zgodny z tą bazą kodu — ryzyko `engines: node >=20` zdjęte empirycznie, nie założeniowo.** Nie trzeba zmieniać ani jednej linii w `astro.config.mjs`, `wrangler.jsonc` czy `tsconfig.json`.

Dokument `ts-fsrs-api-doc.md` jest **wierny w zakresie kontraktu stanu** (interfejs `Card`, `State`, `FSRSParameters`, wartości domyślne, brak stanu per sesja) i **zawiera trzy nieścisłości** opisane w §3 — jedną istotną (`FSRSValidationError` nie jest eksportowany).

Blokery nie leżą po stronie biblioteki, tylko po stronie projektu: **warstwa danych nie istnieje w ogóle** (zero migracji, zero RLS, zero typów bazy), a **wzorzec „redirect-po-POST" z auth nie da się rozciągnąć na S-02 i S-05** — obie funkcje wymagają pierwszego w repo endpointu zwracającego JSON i pierwszego `fetch()` po stronie klienta.

## 1. Weryfikacja empiryczna na workerd

Przebieg: `npm install ts-fsrs` → tymczasowy endpoint SSR `src/pages/api/srs-smoke.ts` → `npx astro check` → `npx eslint` → `npm run build` → `npx wrangler dev` → HTTP GET. Endpoint usunięty po pomiarach; w repo została wyłącznie zależność w [package.json](package.json).

| Etap | Wynik |
| --- | --- |
| Instalacja | `ts-fsrs@5.4.1`, 1 pakiet, **0 zależności runtime**, 0 podatności |
| `astro check` | **0 errors, 0 warnings** (tsconfig `strict` + `verbatimModuleSyntax`) |
| `eslint` (`strictTypeChecked`) | Jedyny błąd to formatowanie Prettiera — **zero naruszeń reguł type-safety** |
| `astro build` | OK; chunk endpointu z `ts-fsrs` = **53,24 KiB** |
| `wrangler dev` (workerd 1.20260811.1) | **HTTP 200** |

Odpowiedź endpointu na `workerd`:

```json
{
  "runtime": "Cloudflare-Workers",
  "defaultWeightCount": 21,
  "freshState": "New",
  "previewIntervals": { "again": 0, "hard": 0, "good": 0, "easy": 8 },
  "reviewed": {
    "due": "2026-08-23T10:10:00.000Z", "stability": 2.3065,
    "difficulty": 2.11810397, "elapsed_days": 0, "scheduled_days": 0,
    "reps": 1, "lapses": 0, "learning_steps": 1, "state": 1,
    "last_review": "2026-08-23T10:00:00.000Z"
  },
  "roundTrippedDueIsDate": true,
  "roundTrippedStateIsNumber": true,
  "rollbackRestoresNew": true,
  "retrievability": 1
}
```

Potwierdzone na prawdziwym runtime (`navigator.userAgent === "Cloudflare-Workers"`, nie Node): `createEmptyCard`, `repeat`, `next`, `rollback`, `get_retrievability`, `TypeConvert.card` (round-trip ISO string → `Date`, number → `State`).

**Fallback `@squeakyrobot/fsrs` z `srs-library-research.md` jest zbędny.** Ryzyko, które go uzasadniało, nie zmaterializowało się.

### 1.1. Koszt CPU — odpowiedź na limit 10 ms free tier

Pomiar czasu odpowiedzi HTTP dla rosnących partii `TypeConvert.card()` + `scheduler.next()` (minimum z 5 przebiegów, `wrangler dev`):

| Partia | Czas odpowiedzi | Praca ponad baseline |
| --- | --- | --- |
| 1 | 7,13 ms | baseline (narzut HTTP) |
| 10 | 7,04 ms | ~0 |
| 100 | 7,29 ms | ~0,2 ms |
| 1 000 | 8,31 ms | ~1,2 ms |
| 10 000 | 19,56 ms | ~12,5 ms |

**~1,25 µs na przeliczenie jednej karty.** Napięcie z `context/foundation/infrastructure.md` („transforming many generated flashcards synchronously counts as CPU time", [infrastructure.md#L62](context/foundation/infrastructure.md#L62)) **nie dotyczy FSRS przy realistycznej skali**: sesja 100 kart to ~0,2 ms, czyli 2% budżetu 10 ms. Limit CPU pozostaje ryzykiem dla parsowania odpowiedzi LLM w S-02, nie dla harmonogramowania w S-05.

## 2. Zgodność z konfiguracją projektu

| Wymiar | Stan | Wniosek |
| --- | --- | --- |
| Astro | `^7.1.3`, `output: "server"` ([astro.config.mjs](astro.config.mjs)) | SSR działa, endpointy `src/pages/api/**` renderowane serwerowo |
| Adapter | `@astrojs/cloudflare ^14.1.4`, wywołany bez opcji | brak `vite.ssr.external`/`noExternal` — nic nie wyklucza paczki z bundla |
| `nodejs_compat` | włączone ([wrangler.jsonc](wrangler.jsonc)) | zbędne dla `ts-fsrs` (0 importów `node:*` w `dist`), ale nieszkodliwe |
| `moduleResolution` | `Bundler` + `module: ESNext` (dziedziczone z `astro/tsconfigs/strict`) | poprawnie wybiera build ESM z pola `exports` |
| `engines` w projekcie | **brak pola**; `.nvmrc` = 24.19.0, CI = Node 24 | `engines: node >=20` z `ts-fsrs` nie tworzy konfliktu |
| `verbatimModuleSyntax` | `true` | typy z `ts-fsrs` **muszą** być importowane jako `import type { Card }` |
| ESLint | `strictTypeChecked` + `stylisticTypeChecked`, CI wywala się na `npm run lint` | zweryfikowane — kod FSRS przechodzi bez wyłączeń reguł |
| Framework testowy | **brak** | patrz §5, ryzyko wobec guardrail-a PRD |

**Rozjazd do naprawy przy okazji:** [README.md#L16](README.md#L16) podaje Node 22.14.0, `.nvmrc` mówi 24.19.0, CI używa 24.

## 3. Nieścisłości w `ts-fsrs-api-doc.md`

Zweryfikowane wobec `node_modules/ts-fsrs/dist/index.d.ts` w wersji 5.4.1.

1. **Wersja pakietu vs wersja algorytmu.** Dokument mówi „FSRS v6" i nie podaje wersji pakietu. Faktycznie: pakiet `5.4.1`, a `FSRSVersion` zwraca `"v5.4.1 using FSRS-6.0"`. Numeracja pakietu i numeracja algorytmu to dwie różne rzeczy — plan musi przypiąć wersję pakietu, nie algorytmu. Potwierdzone: `default_w.length === 21` (FSRS-6), `request_retention: 0.9`, `maximum_interval: 36500`, `enable_fuzz: false`, `enable_short_term: true`, `learning_steps: ["1m","10m"]`, `relearning_steps: ["10m"]` — wszystkie wartości domyślne w dokumencie są poprawne.

2. **`FSRSValidationError` nie jest eksportowany.** Dokument (§3, §4) opisuje go jako „naturalną granicę walidacji przy odczycie z bazy". Powierzchnia eksportu 5.4.1 go nie zawiera — nie da się zrobić `instanceof FSRSValidationError`. **Konsekwencja dla F-01:** kontrakt nie może polegać na tym typie błędu; walidację odczytu z bazy trzeba oprzeć na Zodzie (którego w projekcie jeszcze nie ma, mimo że deklaruje go brama „typed" w [tech-stack.md#L24](context/foundation/tech-stack.md#L24)).

3. **`ReviewLog` ma jedno pole więcej niż w dokumencie… i jest ono deprecated.** Dokument wymienia `last_elapsed_days` poprawnie, ale sekcja „Konsekwencje dla schematu" w `srs-library-research.md` wskazuje na usunięcie tylko `elapsed_days`. W 5.4.1 **oba** pola (`elapsed_days`, `last_elapsed_days`) są oznaczone `@deprecated — removed in 6.0.0`. Do schematu F-02 nie wchodzi żadne z nich.

**Zgodne w 100%:** interfejs `Card` (9 pól + `last_review?`), `State` (0–3), `CardInput` (przyjmuje `StateType | State` i `DateInput`), `Steps`/`StepUnit`, sygnatury `createEmptyCard`/`repeat`/`next`/`reschedule`/`forget`/`get_retrievability`, brak API „daj następną fiszkę", brak stanu per sesja.

## 4. Co baza kodu daje, a czego nie daje — pod F-01, S-02, S-05

### 4.1. Warstwa danych — nie istnieje

- Katalog `supabase/migrations` **nie istnieje**; `file_search **/*.sql` → **zero plików** w całym repo. Zero DDL, zero `enable row level security`, zero polityk.
- Zero wygenerowanych typów bazy; brak skryptu `supabase gen types` w [package.json](package.json); brak `SUPABASE_PROJECT_ID` w `.env.example`.
- `createServerClient` wołany **bez generyka `Database`** ([src/lib/supabase.ts](src/lib/supabase.ts)) — każde `.from("flashcards").select()` zwróci `any`. Przy dziewięciu polach numerycznych to gwarantowane ciche pomyłki `stability` ↔ `difficulty`.
- **Ryzyko bezpieczeństwa:** klient tworzony jest z `SUPABASE_KEY` (klucz anon). Bez RLS z polityką `user_id = auth.uid()` pierwszy `select` na tabeli fiszek zwróci cudze dane. To łamie PRD §Access Control („każdy użytkownik widzi i zarządza wyłącznie swoimi fiszkami", [prd.md#L99-L101](context/foundation/prd.md#L99-L101)).

### 4.2. Sesja i middleware — klient nie jest propagowany

- `App.Locals` zawiera **wyłącznie** `user` ([src/env.d.ts](src/env.d.ts)). Nie ma `locals.supabase` ani `locals.session`; middleware nie przekazuje dalej gotowego klienta ([src/middleware.ts](src/middleware.ts)).
- Skutek: każdy przyszły endpoint domenowy (`/api/generations`, `/api/flashcards`, `/api/reviews`) tworzy własny klient i **niezależnie powtarza strażnik `null`**. Dług rośnie liniowo z liczbą endpointów — taniej rozszerzyć `Locals` teraz niż po S-05.
- **`PROTECTED_ROUTES = ["/dashboard"]` nie obejmuje `/api/**`** ([src/middleware.ts](src/middleware.ts)). Nowe endpointy muszą **same** weryfikować `locals.user`, inaczej `/api/generations` staje się nieuwierzytelnionym, płatnym endpointem AI.

### 4.3. Wzorce API i UI — pod S-02 i S-05 nie wystarczają

Co rozszerza się wprost: strona `.astro` jako shell + jedna wyspa `client:load`, `PROTECTED_ROUTES` (dopisanie `/generate`, `/review`, `/deck`), `Astro.locals.user` jako `initialData`, `createClient(headers, cookies)` per żądanie, `cn()` + warianty `Button` (4 przyciski oceny w S-05), sygnatura `export const POST: APIRoute`.

Czego nie ma i trzeba zaprojektować od zera:

1. **Zwracanie JSON-a.** Wszystkie trzy endpointy auth kończą się `context.redirect(...)` (302). `Response.json` / `new Response` — **zero wystąpień w repo**. Rejestr kontraktów zakłada JSON dla endpointów domenowych ([contract-surfaces.md#L45](docs/reference/contract-surfaces.md#L45)) — to będzie pierwszy taki endpoint.
2. **Klient `fetch`.** `fetch(` w `src/**` → **0 trafień**. Brak typów DTO, obsługi statusów, stanu `loading/error` per akcja.
3. **Stan wyspy.** `useEffect` → 0 trafień; brak nanostores/zustand/Context. Kolejka kart w S-05 i lista propozycji w S-02 muszą żyć w stanie wyspy — przy redirect-po-POST każda ocena to pełny reload i utrata sesji.
4. **`useFormStatus`** ([SubmitButton.tsx](src/components/auth/SubmitButton.tsx)) działa tylko w kontekście natywnego `<form>`. Przy mutacjach fetch-owych potrzebny własny stan `pending` — per element w S-02, per ocena w S-05.
5. **Błędy per element.** Wzorzec `?error=` w URL → prop → [ServerError.tsx](src/components/auth/ServerError.tsx) obsługuje jeden globalny komunikat na stronę. „Nie udało się zapisać propozycji #3" wymaga błędu przypiętego do elementu listy.
6. **Walidacja serwerowa nie istnieje.** `form.get("email") as string` bez null-checku; `zod` **nie jest zależnością**, mimo że wymagają go i [tech-stack.md#L24](context/foundation/tech-stack.md#L24), i `CLAUDE.md.scaffold`. Endpoint przyjmujący tekst do LLM-a nie ma dziś czym wymusić limitu długości.
7. **Braki w bibliotece UI.** `src/components/ui/` zawiera tylko `button.tsx`. Brakuje `textarea` (wklejanie tekstu w S-02 — `FormField` renderuje twardo `<input>` i wymaga propa `icon`), `card`, `dialog`, `progress`. Konfiguracja shadcn jest gotowa ([components.json](components.json)), więc to dodanie, nie przebudowa.
8. **Dwa równoległe systemy stylów.** Tokeny shadcn są zdefiniowane w [src/styles/global.css](src/styles/global.css), ale warstwa auth ich nie używa — stosuje hardkodowany glassmorphism (`bg-white/10`, `text-blue-100/80`). Nowe ekrany muszą świadomie wybrać jeden.

### 4.4. Rejestr kontraktów — F-01 musi go zaktualizować

[docs/reference/contract-surfaces.md](docs/reference/contract-surfaces.md) rezerwuje trasy `/generate`, `/deck`, `/review` i endpointy `/api/generations`, `/api/flashcards`, `/api/flashcards/:id`, `/api/reviews`, ale **nie zawiera ani jednej nazwy tabeli ani kolumny** — tylko dwa opisy ról po polsku („znacznik pochodzenia fiszki", „stan harmonogramu powtórek"). Sam plik stanowi: „Konkretne nazwy kolumn i typy ustala `/10x-plan` przy F-01 i F-02 — i zapisuje je tutaj."

Dwa napięcia do rozstrzygnięcia w planie:
- **`/api/reviews` GET „pobranie fiszek na sesję"** zakłada API, którego biblioteka nie ma. Kolejkowanie to ręczne `WHERE user_id = ? AND due <= now() ORDER BY due` — wymusza indeks `(user_id, due)`, nieprzewidziany w rejestrze.
- **Brak endpointu na cofnięcie oceny** mimo dostępnego (i zweryfikowanego empirycznie) `rollback()`. To pochodna decyzji o `ReviewLog` — patrz §6.

## 5. Guardrail PRD bez pokrycia testowego

[prd.md#L40](context/foundation/prd.md#L40) stawia jeden twardy warunek brzegowy: „mechanizm powtórek nie może zawieść — sesja nauki zawsze musi poprawnie funkcjonować, niezależnie od źródła fiszek". W projekcie **nie ma frameworka testowego** i nie ma go w CI (`npm ci` → `astro sync` → `lint` → `build`).

Znacznik pochodzenia fiszki jest **ortogonalny** wobec stanu FSRS — algorytm nie zna źródła karty — więc warunek „niezależnie od źródła" jest spełniony strukturalnie. Ale „nie może zawieść" bez ani jednego testu pozostaje deklaracją. To luka, której żaden dokument fundamentowy nie adresuje.

## 6. Decyzje do podjęcia w F-01

Dokumentacja daje materiał, nie rozstrzygnięcie. Każda z poniższych dotyka schematu F-02, więc musi paść **przed** pierwszą migracją.

| # | Decyzja | Materiał |
| --- | --- | --- |
| 1 | Czy `ReviewLog` jest utrwalany w osobnej tabeli | Bez niego harmonogramowanie działa w pełni; tracimy `rollback()` (zweryfikowany, działa) i `reschedule()`. Rejestr nie przewiduje endpointu cofania. |
| 2 | `due`, `last_review`: `timestamptz` czy `bigint` | Obie ścieżki obsłużone (`afterHandler` przy zapisie, `TypeConvert.card` przy odczycie — round-trip ISO→`Date` potwierdzony empirycznie). Za `timestamptz`: kolejkowanie `WHERE due <= now()` jest natywnie indeksowalne. |
| 3 | `state`: PG enum czy `smallint` | `State` to enum liczbowy 0–3. `smallint` mapuje 1:1; `CardInput` przyjmuje też wariant stringowy. |
| 4 | `stability`, `difficulty`: `double precision` czy `numeric` | Wartości runtime to zwykłe floaty (`decimal.js` jest tylko dev-dependency). |
| 5 | Znacznik pochodzenia: `boolean` czy enum `ai`/`ai_edited`/`manual` | PRD wymaga mierzalności „75% fiszek zaakceptowanych **bez istotnych zmian**" — `boolean` nie odróżni fiszki AI zaakceptowanej od zedytowanej, więc nie zmierzy kryterium. |
| 6 | Parametry FSRS: stałe w kodzie czy per użytkownik | `srs-library-research.md` rozstrzygnął na „w kodzie"; wartości domyślne potwierdzone empirycznie. Wariant per użytkownik dokłada tabelę ustawień do tej samej migracji. |
| 7 | Czy rozszerzyć `Locals` o `supabase` teraz | Zmiana dotyka [src/env.d.ts](src/env.d.ts) i [src/middleware.ts](src/middleware.ts); koszt rośnie z każdym kolejnym endpointem. |
| 8 | Czy dołożyć `zod` i runner testów w F-01 | Oba deklarowane w `tech-stack.md`/`CLAUDE.md.scaffold`, oba nieobecne. `FSRSValidationError` nie jest eksportowany, więc granica walidacji odczytu potrzebuje własnego narzędzia. |

**Nie wchodzi do schematu:** `elapsed_days`, `last_elapsed_days` (oba `@deprecated`, usuwane w 6.0.0).

## 7. Kolejność wdrożenia — obserwacja z bazy kodu

Roadmapa stawia S-02 przed S-05. Baza kodu tego nie podważa, ale dokłada trzy prace wspólne, które wypłyną przy S-02 i będą już gotowe dla S-05:

1. Pierwszy endpoint zwracający JSON + pierwszy `fetch()` po stronie klienta (§4.3.1–2).
2. Weryfikacja `locals.user` w endpointach `/api/**` + walidacja wejścia (§4.2, §4.3.6).
3. Rozszerzenie `Locals` o klienta Supabase (§4.2).

Osobno: `OPENROUTER_API_KEY` **nie jest ustawiony** na produkcji ani zadeklarowany w schemacie `astro:env` w [astro.config.mjs](astro.config.mjs) — S-02 wymaga obu.

## 8. Zmiany pozostawione w repo

- [package.json](package.json) / `package-lock.json` — dodany `ts-fsrs@5.4.1` w `dependencies`. Uzasadnienie: rozstrzygnięcie F-01 potwierdzone empirycznie; usunięcie oznaczałoby ponowną instalację przy pierwszym kroku implementacji.
- Tymczasowy endpoint `src/pages/api/srs-smoke.ts` użyty do pomiarów **został usunięty** — był nieuwierzytelniony i nie należy do żadnego kontraktu.

## Otwarte pytania

- Czy `ts-fsrs` zachowa się tak samo na wdrożonej instancji jak na `wrangler dev`? Lokalny `workerd` to ten sam silnik, a odpowiedź endpointu potwierdziła `Cloudflare-Workers`, ale [infrastructure.md#L74](context/foundation/infrastructure.md#L74) ostrzega, że dev ≠ prod. Domknięcie: pierwszy deploy S-05.
- Czy przy „migracji" z `ts-fsrs` 5.x do 6.x (usunięcie `elapsed_days`) potrzebna będzie migracja bazy? Nie, jeśli utrzymana zostanie zasada z §6 (nie wprowadzać deprecated pól do schematu).
- Czym pokryć guardrail PRD §L40 bez frameworka testowego (§5).
