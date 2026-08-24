# Schemat fiszek i izolacja danych per użytkownik — Plan Brief

> Pełny plan: `context/changes/flashcards-schema-isolation/plan.md`

## What & Why

F-02 buduje warstwę danych, na której stoi cała pętla produktu: tabelę fiszek z polami harmonogramu FSRS i znacznikiem pochodzenia, tabelę zleceń generowania z licznikami mierzącymi oba kryteria sukcesu PRD, oraz polityki RLS odcinające cudze rekordy. Sonda raportuje warstwę danych jako nieistniejącą, a dziewięć wymagań koniecznych na niej stoi — zły kształt tabeli odkryty w połowie pętli to jedyna przeróbka, której termin 2026-08-31 nie wchłonie.

## Starting Point

W repo nie ma ani jednej migracji: `supabase/` zawiera wyłącznie `config.toml`, README twierdzi wprost, że tabele nie są potrzebne. Jest za to gotowy kontrakt — F-01 zostawił w `docs/reference/contract-surfaces.md` dokładne typy PostgreSQL dla dziewięciu pól harmonogramu i enum pochodzenia, a w `src/lib/srs/schedule-state.ts` schemat Zod w kształcie 1:1 z przyszłymi kolumnami. Klient Supabase w `src/lib/supabase.ts` działa, ale jest nietypowany i łączy się kluczem `anon`, więc izolacja może żyć wyłącznie w bazie.

## Desired End State

Jedna migracja odtwarza całą warstwę danych na czystej maszynie jedną komendą. `npm run db:test` dowodzi testem pgTAP, że użytkownik A nie widzi, nie zmienia i nie zapisuje rekordów użytkownika B — i wywali się, gdy któraś polityka przestanie działać. `supabase.from("flashcards")` podpowiada kolumny w edytorze, a rozjazd między migracją a kontraktem F-01 zatrzymuje `astro check`. Chmurowy projekt ma tę samą migrację w historii, więc S-02 może zacząć zapisywać fiszki bez dotykania schematu.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
| --- | --- | --- | --- |
| Zakres tabel | `flashcards` + `generations` | Kryterium „75% akceptacji" staje się mierzalne wprost, a nie wnioskowane z rozkładu `source` | Plan |
| Kształt `generations` | metadane + liczniki + `source_text_hash` | Hash wykrywa powtórne wklejenie tego samego tekstu, nie przechowując go — NFR o nietrwałości wklejki zostaje spełnione | Plan |
| Walidacja treści | CHECK w bazie **i** Zod w kodzie | Klucz `anon` pozwala pisać do tabeli spoza naszego endpointu; walidacja tylko w kodzie serwera jest obejścialna | Plan |
| Kolumny audytowe | `created_at` + `updated_at` z triggerem | Triggera nie da się pominąć z poziomu endpointu; S-03 dostaje wiarygodny znacznik za darmo | Plan |
| Migracja na prod | plik w repo + `supabase link` / `db push` | Jedno źródło prawdy dla lokalnego i chmurowego projektu; kolejne zmiany dokładają pliki, nie łatają stanu | Plan |
| Typy bazy | `gen types --local`, commitowane | Typy generowane z bazy odtworzonej z migracji — rozjazd z migracją jest niemożliwy | Plan |
| Model RLS | cztery polityki per operacja, per tabela | `with check` na INSERT blokuje zapis na cudze `user_id`, czego sam `using` nie łapie; zawężenie UPDATE w S-03 nie wymaga rozbijania polityki | Plan |
| Dowód izolacji | pgTAP przez `supabase test db` | Sprawdza RLS tam, gdzie ono żyje; każda kolejna migracja odpala go jedną komendą | Plan |
| Pola harmonogramu | zakresy CHECK odwzorowują schemat Zod | Baza i moduł muszą odrzucać te same wartości, inaczej `parse()` wybucha na wierszu, który baza przepuściła | Plan |
| CHECK `state` ↔ `last_review` | świadomie pominięty | Zbyt ciasne ograniczenie ujawni się dopiero w S-05, na fiszkach już zapisanych | Plan |

## Scope

**In scope:**
- Jedna migracja: enum `flashcard_source`, tabele `flashcards` i `generations`, CHECK-i, FK do `auth.users` i między tabelami, indeksy `(user_id, due)` oraz `(user_id, created_at desc)`, funkcja i trigger `updated_at`
- RLS na obu tabelach + osiem polityk dla roli `authenticated`
- Test pgTAP izolacji + skrypty `db:test`, `db:reset`, `db:types`
- `src/db/database.types.ts` generowany z lokalnej bazy, generyk `Database` w `createClient()`
- Test kontraktu wiążący wygenerowany typ wiersza ze `ScheduleStateRow` z F-01
- `db push` na chmurowy projekt + aktualizacja `contract-surfaces.md` i `README.md`

**Out of scope:**
- Endpointy `/api/flashcards`, `/api/generations`, `/api/reviews` — S-02, S-03, S-05
- Tabela `review_logs` — odłożona świadomie w F-01
- Rozszerzenie `App.Locals` o klienta Supabase — S-02
- Warstwa repozytoriów/serwisów nad tabelami, soft delete, seed danych
- `db push` w CI

## Architecture / Approach

```
supabase/migrations/<ts>_flashcards_schema.sql
        │
        ├─ db reset ──▶ lokalna baza ──┬─▶ supabase test db  (dowód izolacji)
        │                              └─▶ gen types --local ──▶ src/db/database.types.ts
        │                                                              │
        │                                                    createClient<Database>()
        │                                                              │
        │                                          test kontraktu ◀────┴──▶ ScheduleStateRow (F-01)
        │
        └─ db push ──▶ chmurowy projekt Supabase (prod)
```

Kolejność jest wymuszona narzędziowo: migracja musi istnieć, zanim baza stanie; baza musi stać, zanim pgTAP ją przetestuje i zanim powstaną typy; typy muszą zgadzać się z modułem F-01, zanim cokolwiek pojedzie na produkcję.

## Phases at a Glance

| Faza | Co dostarcza | Główne ryzyko |
| --- | --- | --- |
| 1. Migracja i izolacja | Enum, dwie tabele, ograniczenia, indeksy, trigger, RLS + 8 polityk | Zakres CHECK-ów rozjedzie się ze schematem Zod z F-01 — baza przepuści wiersz, na którym `parse()` wybuchnie |
| 2. Dowód izolacji | Test pgTAP dwóch użytkowników + `npm run db:test` | Test przechodzący z powodu błędu w samym teście; zdejmowane mutacją polityki w weryfikacji ręcznej |
| 3. Typy w kodzie | `database.types.ts`, typowany klient, test kontraktu | Typy starsze niż schemat, jeśli ktoś pominie `db:types` po zmianie migracji |
| 4. Prod i rejestr | Migracja na chmurowym projekcie, zaktualizowany rejestr nazw i README | `db push` jest nieodwracalny; łagodzone obowiązkowym `--dry-run` |

**Prerequisites:** F-01 ukończone (kontrakt kolumn w `contract-surfaces.md`). Lokalnie: Docker + `supabase start`. Do Fazy 4: hasło do bazy chmurowego projektu i jego `project-ref`.
**Estimated effort:** jedna sesja na fazy 1–3, krótka domykająca na fazę 4.

## Open Risks & Assumptions

- **Liczniki w `generations` są tak dobre, jak S-02.** Schemat tylko je udostępnia; jeśli S-02 nie zaktualizuje ich przy akceptacji, kryterium sukcesu PRD będzie cicho pokazywać zero.
- **Test pgTAP nie wejdzie do CI** — wymaga Dockera i lokalnego stacku. Regresja izolacji zostanie złapana tylko wtedy, gdy ktoś uruchomi `npm run db:test` po zmianie schematu; plan zapisuje to jako obowiązkowy krok cyklu.
- **Limity treści (500/2000 znaków) są zgadywane przed pierwszym generowaniem.** Jeśli propozycje AI z S-02 okażą się dłuższe, zmiana limitu to migracja — tania, bo `alter ... drop constraint`, ale wymagająca przejścia całego cyklu.
- **Niezmienność `source` jest konwencją, nie ograniczeniem.** Polityka UPDATE pozwala właścicielowi zmienić tę kolumnę; pilnuje jej dopiero warstwa aplikacji w S-03.
- **`db push` odkłada ryzyko środowiskowe na koniec.** Zgodnie z `infrastructure.md` lokalny stack nie jest w 100% wierny produkcji; różnice ujawnią się dopiero w Fazie 4.

## Success Criteria (Summary)

- S-02 może pisać endpointy zapisu i odczytu fiszek, czytając wyłącznie `contract-surfaces.md` — bez otwierania tego planu i bez zgadywania nazw kolumn
- Jedna komenda (`npm run db:test`) odpowiada na pytanie „czy użytkownik może zobaczyć cudzą fiszkę" — i odpowiada „nie"
- `astro check` zatrzymuje rozjazd między migracją a kontraktem harmonogramu z F-01, zanim trafi on na produkcję
