---
change_id: srs-algorithm-contract
doc_type: external-api-reference
library: ts-fsrs
library_id: /open-spaced-repetition/ts-fsrs
source: Context7 (`npx ctx7 docs`), źródła w repo `open-spaced-repetition/ts-fsrs` (`README.md`, `packages/fsrs/README.md`, `_autodocs/*`)
fetched: 2026-08-23
status: reference
---

# ts-fsrs — wyciąg z API na potrzeby F-01

> Materiał referencyjny do `context/foundation/roadmap.md` → **F-01: Kontrakt algorytmu powtórek i stanu harmonogramu**.
> To jest zewnętrzna dokumentacja biblioteki, nie decyzja projektowa. Rozstrzygnięcia i kontrakt żyją w `change.md` / `plan.md`.
> **Trzy nieścisłości tego dokumentu wobec zainstalowanej wersji 5.4.1 są opisane w `research.md` §3** — przeczytaj je przed użyciem tego wyciągu.
> Metadane rozstrzygnięcia biblioteki: Source Reputation `High`, Benchmark Score `89`, 447 snippetów.

## 1. Model danych — `Card`

Jedyna struktura, którą trzeba utrwalić, żeby sesja nauki umiała wyznaczyć termin kolejnego pokazania i zaktualizować go po ocenie.

```typescript
interface Card {
  due: Date              // termin kolejnego pokazania — po tym polu filtruje sesja
  stability: number      // siła pamięci (dni przy 90% recall)
  difficulty: number     // trudność w skali 1–10
  scheduled_days: number // dni do kolejnej powtórki (wynik ostatniej oceny)
  reps: number           // łączna liczba powtórek
  lapses: number         // liczba zapomnień
  state: State           // etap cyklu życia
  learning_steps: number // aktualny krok w fazie nauki
  last_review?: Date     // kiedy ostatnio oceniona
  elapsed_days: number   // DEPRECATED — nie wprowadzać do schematu
}

enum State {
  New = 0,
  Learning = 1,
  Review = 2,
  Relearning = 3,
}
```

Stan jest **wyłącznie per fiszka**. Scheduler jest bezstanowy — nie ma stanu per sesja ani per kolekcja.
To odpowiada na `Unknowns` z F-01.

Powiązany typ pomocniczy:

```typescript
interface FSRSState {
  stability: number
  difficulty: number
}
```

Źródła: `_autodocs/02-types.md`, `_autodocs/08-quick-reference.md`.

## 2. Cykl życia fiszki

```typescript
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs'

const scheduler = fsrs()

// 1. Nowa fiszka — bez różnicy, czy z AI, czy ręczna
const card = createEmptyCard()
// state: State.New, wszystkie pola liczbowe = 0, due = teraz

// 2. Podgląd wszystkich czterech wyników PRZED oceną (opcjonalne,
//    np. żeby pokazać interwał na każdym przycisku)
const preview = scheduler.repeat(card, new Date())
preview[Rating.Again].card
preview[Rating.Hard].card
preview[Rating.Good].card
preview[Rating.Easy].card

// 3. Zastosowanie oceny użytkownika
const { card: updated, log } = scheduler.next(card, new Date(), Rating.Good)
```

### `createEmptyCard`

```typescript
createEmptyCard<R = Card>(now?: DateInput, afterHandler?: (card: Card) => R): R
```

- `now` — opcjonalny termin `due`; domyślnie bieżąca data.
- `afterHandler` — opcjonalny transformer na własne DTO.

```typescript
const cardDTO = createEmptyCard(new Date(), (card) => ({
  ...card,
  id: crypto.randomUUID(),
  due: card.due.getTime(),
}))
```

### `repeat(card, now, afterHandler?)`

Zwraca `IPreview` — cztery warianty indeksowane po `Grade` (1–4). **Nie modyfikuje** stanu fiszki.

### `next(card, now, grade, afterHandler?)`

Zwraca `RecordLogItem`:

```typescript
type RecordLogItem = {
  card: Card       // stan fiszki po ocenie
  log: ReviewLog   // zapis oceny, która została zastosowana
}
```

Źródła: `README.md`, `packages/fsrs/README.md`, `_autodocs/01-scheduler-api.md`, `_autodocs/03-algorithms.md`.

## 3. Serializacja do bazy i z bazy

### Zapis — `afterHandler`

Mapuje wynik na DTO w jednym przejściu, bez ręcznej konwersji dat:

```typescript
const saved = scheduler.next(card, new Date(), Rating.Good, ({ card, log }) => ({
  card: {
    ...card,
    due: card.due.getTime(),
    last_review: card.last_review?.getTime() ?? null,
  },
  log: {
    ...log,
    due: log.due.getTime(),
    review: log.review.getTime(),
  },
}))
```

### Odczyt — `TypeConvert.card`

```typescript
import { TypeConvert } from 'ts-fsrs'

const card = TypeConvert.card(stored)
```

Normalizuje timestampy na `Date` i stringi na `State`. Rzuca `FSRSValidationError`, gdy dane wejściowe są niepoprawne — to naturalna granica walidacji przy odczycie z bazy.

Źródła: `_autodocs/08-quick-reference.md`, `_autodocs/05-conversion-errors.md`.

## 4. `ReviewLog` — historia powtórek

```typescript
interface ReviewLog {
  rating: Rating            // wystawiona ocena (Again/Hard/Good/Easy)
  state: State              // stan fiszki w chwili powtórki
  due: Date                 // termin fiszki sprzed powtórki
  stability: number         // stability sprzed powtórki
  difficulty: number        // difficulty sprzed powtórki
  scheduled_days: number    // dni do kolejnej powtórki (po tej ocenie)
  learning_steps: number    // krok nauki sprzed powtórki
  review: Date              // kiedy powtórka nastąpiła
  elapsed_days: number      // DEPRECATED
  last_elapsed_days: number // DEPRECATED
}
```

Log jest potrzebny wyłącznie dla dwóch operacji:

```typescript
// Cofnięcie ostatniej oceny
const previousCard = scheduler.rollback(reviewedCard, log)
// rzuca FSRSValidationError przy próbie cofnięcia oceny ręcznej

// Odtworzenie stanu z historii ocen (np. import)
const result = scheduler.reschedule(createEmptyCard(), reviews, {
  skipManual: true,
  recordLogHandler: (item) => item,
})
```

Sygnatura `reschedule`:

```typescript
reschedule<T = RecordLogItem>(
  current_card: CardInput | Card,
  reviews?: FSRSHistory[],
  options?: RequireOnly<RescheduleOptions<T>, 'recordLogHandler'>
): IReschedule<T>
```

Dostępny jest też `forget(card, now, reset_count?)`.

**Decyzja do podjęcia w F-01:** czy MVP utrwala `ReviewLog` w osobnej tabeli. Bez niego harmonogramowanie działa w pełni; tracimy tylko cofanie oceny i odtwarzanie stanu z historii.

Źródła: `_autodocs/02-types.md`, `_autodocs/01-scheduler-api.md`, `packages/fsrs/README.md`.

## 5. Konfiguracja — `FSRSParameters`

```typescript
interface FSRSParameters {
  request_retention: number       // docelowe prawdopodobieństwo przypomnienia (0–1)
  maximum_interval: number        // maksymalna liczba dni między powtórkami
  w: number[] | readonly number[] // 21 wag algorytmu (v6)
  enable_fuzz: boolean            // losowe rozmycie interwałów
  enable_short_term: boolean      // korzystanie z kroków fazy nauki
  learning_steps: Steps           // kroki nauki początkowej
  relearning_steps: Steps         // kroki po zapomnieniu
}
```

Wartości domyślne:

```typescript
{
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m'],
  w: [0.212, 1.293, /* … 21 wag */],
}
```

Tworzenie schedulera:

```typescript
import { fsrs, generatorParameters } from 'ts-fsrs'

const scheduler = fsrs(generatorParameters({
  request_retention: 0.85,
  maximum_interval: 50000,
  enable_fuzz: true,
  learning_steps: ['1m', '5m', '10m'],
}))
```

`generatorParameters(props?)` uzupełnia brakujące pola domyślnymi i normalizuje tablicę wag. `fsrs(params?)` przyjmuje również `Partial<FSRSParameters>` bezpośrednio.

Trenowanie własnych wag `w` jest poza zakresem MVP (PRD §Non-Goals) — domyślne wystarczają.

Źródła: `_autodocs/02-types.md`, `_autodocs/03-algorithms.md`, `_autodocs/08-quick-reference.md`, `_autodocs/01-scheduler-api.md`.

## 6. Wybór fiszek do sesji

Biblioteka **nie ma** API typu „daj następną fiszkę". Kolejkowanie to zwykłe zapytanie do bazy po polu `due`:

```sql
SELECT * FROM flashcards
WHERE user_id = ? AND due <= now()
ORDER BY due
```

Pomocniczo dostępne jest prawdopodobieństwo przypomnienia:

```typescript
scheduler.get_retrievability(card)                    // "85.50%" (string)
scheduler.get_retrievability(card, new Date(), false) // 0.8550 (number)
```

`get_retrievability(card, now?, format?)` — `format: true` (domyślnie) zwraca sformatowany procent, `false` liczbę.

Źródło: `_autodocs/01-scheduler-api.md`.

## 7. Środowisko uruchomieniowe

Istotne dla warunku z F-01: algorytm musi działać w docelowym środowisku serwerowym opisanym w `context/foundation/infrastructure.md` (Cloudflare Workers / workerd).

- Instalacja: `npm install ts-fsrs`. Wymagany Node.js ≥ 20.0.0.
- Pakiet `ts-fsrs` to czysty TypeScript bez zależności natywnych — nadaje się do samego harmonogramowania.
- **Ograniczenie:** osobny pakiet `@open-spaced-repetition/binding` (WASM, do trenowania parametrów) **nie wspiera edge runtimes** — dokumentacja wprost kieruje do `ts-fsrs`, jeżeli potrzebne jest wyłącznie harmonogramowanie. F-01 powinno zapisać to jako granicę zakresu.

Źródła: `README.md`, `packages/fsrs/README.md`, `packages/binding/README.md`.

## 8. Powierzchnia importu

```typescript
import {
  // Fabryki i klasy
  fsrs,
  createEmptyCard,
  FSRS,

  // Enumy
  State,
  Rating,
  StrategyMode,

  // Typy
  type Card,
  type CardInput,
  type FSRSParameters,
  type RecordLogItem,
  type Grade,

  // Funkcje
  generatorParameters,
  forgetting_curve,
  date_scheduler,
  date_diff,
} from 'ts-fsrs'
```

Źródło: `_autodocs/08-quick-reference.md`.

## Otwarte punkty dla F-01

Do rozstrzygnięcia w `change.md` / `plan.md` — dokumentacja daje materiał, nie decyzję:

1. Czy `ReviewLog` jest utrwalany (osobna tabela), czy MVP obchodzi się bez cofania i `reschedule`.
2. Czy `due` i `last_review` w bazie to `timestamptz`, czy liczbowe timestampy — obie ścieżki obsłużone przez `afterHandler` / `TypeConvert.card`.
3. Czy parametry (`request_retention`, `learning_steps`) są stałe dla aplikacji, czy konfigurowalne per użytkownik — druga opcja dokłada tabelę ustawień.
4. `elapsed_days` i `last_elapsed_days` są oznaczone jako deprecated — nie powinny wejść do schematu F-02.
