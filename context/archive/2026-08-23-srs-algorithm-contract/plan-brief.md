# Kontrakt algorytmu powtórek i stanu harmonogramu — Plan Brief

> Pełny plan: `context/changes/srs-algorithm-contract/plan.md`
> Research wewnętrzny: `context/changes/srs-algorithm-contract/research.md`
> Research zewnętrzny: `context/changes/srs-algorithm-contract/srs-library-research.md`

## What & Why

F-01 zamienia wynik researchu w kontrakt wiążący dwie kolejne zmiany: jakie dokładnie dane musi nieść fiszka, żeby sesja nauki umiała wyznaczyć termin jej kolejnego pokazania i zaktualizować go po ocenie. Stoi **przed** schematem, a nie w nim, bo decyzja podjęta dopiero przy S-05 oznaczałaby migrację na fiszkach, które użytkownik już zapisał — a terminu 2026-08-31 taka przeróbka nie wchłonie.

## Starting Point

Biblioteka jest już wybrana i zweryfikowana empirycznie, nie założeniowo: `ts-fsrs@5.4.1` (FSRS-6.0) działa na `workerd`, ma zero zależności runtime i liczy ~1,25 µs na kartę; zależność jest w [package.json](package.json). Nie ma natomiast warstwy danych (zero migracji, zero typów bazy), nie ma `zod` mimo deklaracji w `tech-stack.md`, nie ma frameworka testowego, a [contract-surfaces.md](docs/reference/contract-surfaces.md) zawiera dwa opisy ról po polsku zamiast nazw kolumn.

## Desired End State

W repo istnieje moduł `src/lib/srs/` — jedyne miejsce, które wie, jak wygląda stan harmonogramu: nazywa dziewięć pól w kształcie 1:1 z przyszłymi kolumnami, waliduje wiersz odczytany z bazy i wystawia trzy operacje potrzebne sesji nauki. Jest pokryty testami wykonywanymi w CI. Równolegle rejestr nazw nośnych zawiera konkretne typy PostgreSQL, enum pochodzenia i indeks wymuszony przez kolejkowanie — na tyle dokładnie, że F-02 pisze `CREATE TABLE` bez otwierania tego planu.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
| --- | --- | --- | --- |
| Biblioteka | `ts-fsrs@5.4.1` | Jedyny kandydat z zapasem w bramie „popular" (114k/tydz.); FSRS-6 > SM-2; 0 zależności runtime | Research |
| Zakres stanu | wyłącznie per fiszka | Scheduler jest bezstanowy — nie ma stanu per sesja ani per kolekcja | Research |
| Utrwalanie `ReviewLog` | nie w MVP | Najmniejsza migracja; log to tabela doklejana, więc dodanie później nie rusza istniejących rekordów | Plan |
| `due`, `last_review` | `timestamptz` | Kolejkowanie `WHERE due <= now()` natywnie indeksowalne, bez konwersji | Plan |
| `state` | `smallint` + CHECK 0–3 | Mapuje 1:1 na enum liczbowy; PG enum wymagałby mapowania przy każdym odczycie | Plan |
| `stability`, `difficulty` | `double precision` | Wartości runtime FSRS to zwykłe floaty (`decimal.js` jest tylko dev-dependency) | Plan |
| Znacznik pochodzenia | enum `ai` / `ai_edited` / `manual`, niezmienny po zapisie | Jedyny wariant mierzący **oba** kryteria sukcesu PRD; `boolean` nie odróżni propozycji przyjętej od poprawionej | Plan |
| Parametry FSRS | stałe w kodzie, domyślne | MVP nie ma ustawień per użytkownik; wartości potwierdzone empirycznie | Research |
| Artefakt F-01 | dokument **+** kod | Sama proza nie obroni dziewięciu pól liczbowych przed pomyłką `stability` ↔ `difficulty` | Plan |
| Runner testów | Vitest teraz, wąski zakres | Między F-01 a S-05 leżą cztery zmiany — odłożony runner nie powstałby wcale | Plan |
| Granica walidacji | Zod przed `TypeConvert.card` | `FSRSValidationError` **nie jest eksportowany** w 5.4.1 | Research |

## Scope

**In scope:**
- Moduł `src/lib/srs/` — kształt wiersza, schemat Zod, mapowanie wiersz ↔ `Card`, fabryka schedulera, trzy operacje sesji
- `zod` jako zależność; `ts-fsrs` przypięty do dokładnej wersji `5.4.1`
- Vitest + `npm test` w CI, wąski zestaw testów kontraktu i cyklu życia
- Nazwy kolumn, typy PG, enum pochodzenia i indeks `(user_id, due)` w `contract-surfaces.md`
- Zasada: endpointy `/api/**` poza `/api/auth/*` muszą same weryfikować `locals.user`
- Poprawka wersji Node w `README.md`

**Out of scope:**
- Migracja, tabela, RLS, typy bazy — to F-02
- Endpointy `/api/reviews`, trasa `/review`, UI sesji — to S-05
- Utrwalanie `ReviewLog`, cofanie oceny, `reschedule()`
- Rozszerzenie `App.Locals` o klienta Supabase — wchodzi w S-02, przy pierwszym konsumencie
- Trenowanie własnych wag FSRS (PRD §Non-Goals; WASM nie działa na edge)

## Architecture / Approach

Moduł `src/lib/srs/` jest cienką warstwą nad `ts-fsrs`, która nie zna ani Supabase, ani Astro — dzięki temu wywołuje się go z testu bez bazy i bez serwera.

```
wiersz z bazy ──▶ schemat Zod ──▶ TypeConvert.card ──▶ Card
                  (granica          (round-trip
                   walidacji)        ISO→Date)
                                                         │
                                            scheduler.next(card, now, grade)
                                                         │
Card ──▶ mapowanie na wiersz (Date→ISO, last_review→null) ──▶ zapis
```

Kolejność „Zod przed `TypeConvert.card`" jest wymuszona: `FSRSValidationError` nie jest eksportowany w 5.4.1, więc wyjątek biblioteki byłby nierozpoznawalny dla wołającego.

## Phases at a Glance

| Faza | Co dostarcza | Główne ryzyko |
| --- | --- | --- |
| 1. Wykonywalny kontrakt stanu | Moduł `src/lib/srs/` + `zod` + przypięta wersja `ts-fsrs` | Moduł nie ma konsumenta aż do S-05 — kod bez wywołania łatwo rozjeżdża się z rzeczywistością |
| 2. Pokrycie guardrail-a PRD | Vitest, testy kontraktu i cyklu życia, krok w CI | Konfiguracja runnera w projekcie Astro może wymusić zmiany w ESLint — ryzyko zdejmowane przez jawne importy z `vitest` zamiast globals |
| 3. Zapis kontraktu w rejestrze | Nazwy kolumn i typy w `contract-surfaces.md`, zasada auth dla `/api/**`, poprawka Node | Rejestr rozjedzie się z modułem, jeśli Faza 1 zmieni nazwę pola po drodze |

**Prerequisites:** brak — F-01 nie ma zależności w roadmapie. `ts-fsrs` jest już zainstalowany.
**Estimated effort:** jedna sesja na fazy 1–2, krótka domykająca na fazę 3.

## Open Risks & Assumptions

- **Zachowanie na wdrożonej instancji** potwierdzone tylko przez `wrangler dev` (ten sam silnik `workerd`, `navigator.userAgent === "Cloudflare-Workers"`). `infrastructure.md` ostrzega, że dev ≠ prod — domknięcie dopiero przy pierwszym deployu S-05.
- **Decyzja o `ReviewLog` jest odwracalna** wyłącznie pod warunkiem, że log pozostanie osobną tabelą z kluczem obcym, a nie kolumnami na fiszce.
- **Niezmienność `source` po zapisie** przesądza, że S-03 (edycja zapisanej fiszki) nie rusza znacznika. Jeśli produkt uzna później, że edycja po zapisie też jest „istotną zmianą", pomiar kryterium PRD trzeba będzie przedefiniować — nie schemat.
- **Kontrakt nie ma konsumenta w tej zmianie.** Pierwszy realny test kształtu to F-02; rozjazd między modułem a migracją ujawni się dopiero tam.

## Success Criteria (Summary)

- F-02 może napisać migrację, czytając wyłącznie `contract-surfaces.md` — bez sięgania do researchu i bez zgadywania typów
- `npm test` w CI wywala się, gdy ktoś zamieni `stability` z `difficulty` albo odwróci kierunek konwersji daty — guardrail PRD przestaje być deklaracją
- S-05 wywołuje trzy operacje modułu bez dotykania `ts-fsrs` i bez znajomości jego API
