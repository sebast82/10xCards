<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Schemat fiszek i izolacja danych per użytkownik

- **Plan**: context/changes/flashcards-schema-isolation/plan.md
- **Scope**: Phases 1–4 (full plan)
- **Date**: 2026-08-25
- **Verdict**: NEEDS ATTENTION (triaged 2026-08-25 — 8/8 findings FIXED)
- **Findings**: 0 critical, 5 warnings, 3 observations

## Triage

Wszystkie osiem ustaleń naprawione 2026-08-25. Weryfikacja po poprawkach: `supabase db reset` OK, `npm run db:test` 10/10, `npx astro check` 0 błędów, `npm test` 12/12, `npm run lint` 0 błędów, `npm run build` OK, `npm run db:types` idempotentne.

**Wdrożone na produkcję**: migracja `20260825120802_revoke_anon_table_privileges.sql` wypchnięta 2026-08-25 (`db push --dry-run` → dokładnie jedna migracja → `db push`). `supabase migration list` pokazuje `20260824202259` i `20260825120802` po obu stronach.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Automated verification (re-run 2026-08-25)

| Command | Result |
|---------|--------|
| `npm run db:test` | PASS — `Files=1, Tests=10`, `Result: PASS` |
| `npx supabase db lint --level warning` | PASS — `No schema errors found` |
| `npm test` | PASS — 3 files, 12 tests |
| `npx astro check` | PASS — 0 errors, 0 warnings, 4 hints |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run db:types` | PASS — regeneracja bez zmian treści, plik UTF-8 bez BOM |

Nie uruchamiano `npx supabase db push --dry-run` ani `migration list` — operacje dotykają zdalnego projektu; polegam na wpisach 4.1/4.2 w Progress.

## Findings

### F1 — Asercje RLS dla `update`/`delete` są tautologiczne

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/tests/rls_flashcards.test.sql:108-113
- **Detail**: Test wykonuje `update ... where user_id = <B>`, a następnie sprawdza `select count(*) from public.flashcards where front = 'tampered'`. Sprawdzenie biegnie w kontekście użytkownika A, którego polityka `flashcards_select_own` i tak ukrywa wiersze B — licznik wyniesie 0 niezależnie od tego, czy polityka `flashcards_update_own` cokolwiek zablokowała. To samo dotyczy asercji o `delete`. Test przeszedłby na zielono nawet po całkowitym usunięciu polityk `update`/`delete`. Plan wymagał asercji „`update` i `delete` na wierszu B **dotyka zera wierszy**" — czyli liczby wierszy zmodyfikowanych, nie widocznych.
- **Fix**: Mierz liczbę dotkniętych wierszy zamiast widocznych, np. `select is((with u as (update public.flashcards set front = 'tampered' where user_id = '2222...' returning 1) select count(*)::int from u), 0, '...')` i analogicznie dla `delete ... returning 1`. Dodatkowo po `reset role` potwierdź, że wiersz B nadal ma oryginalny `front`.
  - Strength: Asercja zaczyna mierzyć politykę zapisu, a nie politykę odczytu — czyli to, co deklaruje jej nazwa.
  - Tradeoff: Dwie linijki więcej na asercję; `plan(10)` bez zmian.
  - Confidence: HIGH — potwierdzone lekturą polityk i przebiegiem `npm run db:test`.
  - Blind spot: Nie zweryfikowano wariantu mutacyjnego (ręczne rozluźnienie polityki), bo krok manualny 2.4 pozostaje niepotwierdzony.
- **Decision**: FIXED — asercje przepisane na CTE `update/delete ... returning 1` liczące dotknięte wiersze. Zweryfikowano mutacyjnie na lokalnej bazie: przy `flashcards_select_own using (true)` + `flashcards_update_own using (true)` test schodzi na czerwono (`Failed tests: 4-5`), po `supabase db reset` wraca zielony (10/10). Uwaga uboczna z eksperymentu: `update` na cudzym wierszu jest odcinany najpierw przez politykę `select` (klauzula `where` czyta kolumny), więc sama asercja nie rozróżnia, która polityka zadziałała.

### F2 — Odcięcie roli `anon` opiera się na brakujących grantach, nie na RLS; `anon` zachowuje `TRUNCATE`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260824202259_flashcards_schema.sql:105-109, supabase/tests/rls_flashcards.test.sql:150-158
- **Detail**: Migracja nadaje DML rolom `authenticated` i `service_role`, ale niczego nie odbiera roli `anon`. Zapytanie do `information_schema.role_table_grants` na lokalnej bazie pokazuje, że `anon` ma na `public.flashcards` uprawnienia `TRUNCATE`, `TRIGGER` i `REFERENCES` (bez DML). RLS nie chroni przed `TRUNCATE`. Jednocześnie test zakłada dla `anon` błąd `%permission denied%`, czyli mierzy stan grantów konkretnej instancji, a nie gwarancję RLS. Plan wymagał tu innej asercji: „po przełączeniu na `set local role anon` obie tabele zwracają **zero wierszy**". Jeżeli chmurowy projekt ma klasyczne `alter default privileges ... grant all on tables to anon`, `anon` dostanie tam `select`, a asercja lokalna nadal będzie zielona przy odmiennym stanie produkcji.
- **Fix A ⭐ Recommended**: Dopisz w kolejnej migracji `revoke all on public.flashcards, public.generations from anon;` (oraz `revoke all on schema-level`, jeśli potrzebne) i zostaw asercję `throws_like` jako świadome sprawdzenie braku grantów.
  - Strength: Zamyka `TRUNCATE`/`TRIGGER` dla roli publicznej i sprawia, że asercja opisuje stan wymuszony przez repo, a nie przez domyślne uprawnienia instancji.
  - Tradeoff: Kolejna migracja do wypchnięcia na produkcję; trzeba powtórzyć cykl `db reset` → `db:test` → `db:types` i `db push`.
  - Confidence: HIGH — granty potwierdzone zapytaniem do lokalnej bazy.
  - Blind spot: Nie sprawdzono grantów `anon` na projekcie chmurowym — tam stan może być inny niż lokalnie.
- **Fix B**: Zmień samą asercję na zgodną z planem (`anon` widzi zero wierszy) bez zmiany grantów.
  - Strength: Bez nowej migracji; test przestaje zależeć od domyślnych grantów instancji.
  - Tradeoff: Nie usuwa `TRUNCATE` dla `anon`; przy braku grantu `select` asercja „zero wierszy" i tak wybuchnie błędem, więc trzeba ją napisać warunkowo.
  - Confidence: MEDIUM — zachowanie zależy od grantów, które właśnie są przedmiotem sporu.
  - Blind spot: Ryzyko `TRUNCATE` pozostaje nieadresowane.
- **Decision**: FIXED via Fix A — nowa migracja `supabase/migrations/20260825120802_revoke_anon_table_privileges.sql` z `revoke all on public.flashcards, public.generations from anon`. Po `supabase db reset` rola `anon` nie ma na obu tabelach żadnego uprawnienia, `npm run db:test` nadal 10/10. Skutek uboczny: kryterium 1.3 planu („plik migracji jest jedynym w katalogu") jest od teraz nieaktualne. Otwarte: te same `TRUNCATE`/`TRIGGER`/`REFERENCES` ma nadal rola `authenticated` oraz nieznany jest stan grantów na projekcie chmurowym — migrację trzeba tam wypchnąć.

### F3 — Test kontraktu nie porównuje `ScheduleStateRow` z wygenerowanym typem wiersza

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/db/schema-contract.test.ts:6-45
- **Detail**: Plan (Faza 3 §4) wymagał jednej asercji: `ScheduleStateRow` przypisywalny do `Pick<Tables<"flashcards">["Row"], keyof ScheduleStateRow>`. Implementacja zamiast tego deklaruje **dwa identyczne co do znaku** interfejsy — `FlashcardScheduleDbRow` i `ScheduleContractRow` — i porównuje każdą ze stron z własną, ręcznie utrzymywaną kopią kształtu. Powstała trzecia kopia kontraktu, dokładnie to, czego plan chciał uniknąć („jedno źródło prawdy"). Dodatkowo `const row: ScheduleStateRow = {...}` z `expect(row).toBeDefined()` istnieje wyłącznie po to, by test miał ciało runtime'owe. Zweryfikowano też, że asercje `expectTypeOf` **nie są egzekwowane przez `npm test`** (Vitest bez `--typecheck` je wymazuje) — łapie je dopiero `npx astro check`, który na szczęście stoi w `.github/workflows/ci.yml`. Manualne kryterium 3.6 („zmiana nazwy kolumny → `npm test` czerwony") jest więc w obecnym kształcie nieprawdziwe.
- **Fix A ⭐ Recommended**: Zastąp oba lokalne interfejsy asercją z planu (`expectTypeOf<ScheduleStateRow>().toExtend<Pick<Database["public"]["Tables"]["flashcards"]["Row"], keyof ScheduleStateRow>>()`), usuń martwy `row`/`toBeDefined`, i popraw treść kroku 3.6 na `npx astro check`.
  - Strength: Kontrakt wraca do bezpośredniego porównania dwóch prawdziwych źródeł; znika trzecia kopia do ręcznego utrzymania.
  - Tradeoff: Traci się „zamrożony" opis kształtu, który wyłapuje spójne przemianowanie kolumny po obu stronach.
  - Confidence: HIGH — asercja z planu kompiluje się na obecnych typach, kierunek przypisania toleruje zawężenie `state`.
  - Blind spot: Nie sprawdzono, czy autor celowo chciał zamrozić nazwy kolumn.
- **Fix B**: Zostaw jeden mirror (usuń duplikat), dodaj brakującą asercję `ScheduleStateRow` ↔ `Pick<Row, ...>` obok niego.
  - Strength: Zachowuje wykrywanie przemianowania kolumn i dokłada brakujące porównanie wprost.
  - Tradeoff: Mirror nadal wymaga ręcznej aktualizacji przy każdej świadomej zmianie schematu.
  - Confidence: MEDIUM — więcej kodu do utrzymania przy tej samej wartości diagnostycznej.
  - Blind spot: Rośnie ryzyko, że mirror rozjedzie się z oboma źródłami naraz.
- **Decision**: FIXED via Fix A — oba ręczne interfejsy i martwe `expect(row).toBeDefined()` usunięte, została asercja z planu `expectTypeOf<ScheduleStateRow>().toExtend<Pick<FlashcardRow, keyof ScheduleStateRow>>()` plus jednolinijkowy komentarz o tym, że egzekwuje ją `astro check`, nie Vitest. `astro check` 0 błędów, `npm test` 12/12, `npm run lint` czysty. Otwarte: treść kroku 3.6 w `## Progress` nadal mówi o `npm test` — nie zmieniano jej, bo konwencja Progress zabrania edycji tytułów kroków; poprawne brzmienie to `npx astro check`.

### F4 — Zmiana oznaczona jako `done` przy sześciu niepotwierdzonych krokach manualnych

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/flashcards-schema-isolation/plan.md (Progress), context/changes/flashcards-schema-isolation/change.md
- **Detail**: `change.md` ma `status: done`, a w `## Progress` pozostają odhaczone jako niewykonane kroki 1.5, 1.6, 2.4, 2.5, 3.5, 3.6. Każda z Faz 1–3 miała jawny **Implementation Note** nakazujący zatrzymanie do czasu potwierdzenia ręcznego. Najbardziej nośny jest krok 2.4 (mutacja polityki → czerwony test) — F1 pokazuje empirycznie, dlaczego jego pominięcie kosztowało: dwie asercje testu nic nie mierzą i mutacja polityki `update`/`delete` by tego nie wykryła.
- **Fix**: Wykonaj brakujące kroki manualne (albo świadomie je wykreśl z uzasadnieniem) i dopiero wtedy utrzymuj `status: done`.
- **Decision**: FIXED — 1.5, 1.6, 2.4, 2.5 i 3.6 zweryfikowane w trakcie tego przeglądu i odhaczone w `## Progress` z datą i dowodem (odrzucenie `state = 4` i pustego `front`, dziewięć kolumn w typach z rejestru, mutacja polityki → czerwony test → zielony po `db reset`, wymuszanie kontraktu typu przez `astro check`). Krok 3.5 potwierdzony ręcznie 2026-08-25 — komplet kryteriów manualnych zamknięty, `change.md` wraca na `status: done`.

### F5 — `roadmap.md` sam sobie przeczy: tabela `done`, opis slice'a `in-progress`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/roadmap.md#L41, context/foundation/roadmap.md#L99
- **Detail**: Wiersz tabeli F-02 ustawiono na `done`, a sekcja szczegółowa tego samego elementu na `in-progress`. Dodatkowo sam plik stwierdza, że wpisy w „Ukończone" dopisuje `/10x-archive`, przestawiając przy okazji status — ta edycja wyprzedziła archiwizację i nie była częścią planu (Faza 4 wymieniała wyłącznie `contract-surfaces.md` i `README.md`).
- **Fix**: Ujednolić oba miejsca na jeden status i pozostawić przestawienie na `done` skillowi `/10x-archive`.
- **Decision**: FIXED — slice F-02 w `roadmap.md` ustawiony na `done`, spójnie z wierszem tabeli i wpisem w sekcji „Ukończone".

### F6 — Nieplanowany wpis `ignores` w konfiguracji ESLint obejmuje plik spoza tej zmiany

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js:72-74
- **Detail**: Dodano `ignores: ["src/db/database.types.ts", "worker-configuration.d.ts"]`. Wyłączenie pliku generowanego przez `db:types` jest uzasadnione i konieczne, ale nie było opisane w planie, a `worker-configuration.d.ts` to plik zastany, niezwiązany z F-02 — poszerza to martwe pole lintera poza zakres tej zmiany.
- **Fix**: Zostawić `src/db/database.types.ts`, a wyłączenie `worker-configuration.d.ts` przenieść do osobnej zmiany albo krótko uzasadnić komentarzem.
- **Decision**: FIXED — wpis zachowany, ale z jednolinijkowym uzasadnieniem („pliki generowane: `npm run db:types` i `wrangler types` nadpisują je w całości"). Próba usunięcia `worker-configuration.d.ts` z `ignores` przywraca 2 ostrzeżenia lintera z pliku generowanego przez Wranglera (linie 10338, 10355), więc wpis jest zasadny — brakowało tylko powodu na piśmie.

### F7 — `database.types.ts` bez nagłówka „plik generowany, nie edytuj"

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/db/database.types.ts:1
- **Detail**: Plan (Faza 3 §1) wymagał, by „nagłówek pliku mówił jednym zdaniem", że plik jest wyłączony spod ręcznej edycji. Plik zaczyna się od `export type Json =`. Wymóg realnie kłóci się z kryterium 3.1 (idempotentna regeneracja przez `>`), bo `supabase gen types` nadpisuje plik w całości.
- **Fix**: Rozwiązać konflikt jawnie — albo `db:types` dokleja nagłówek (`... | Out-File`/`sed`), albo skreślić wymóg z planu i opisać zasadę w README obok komendy `npm run db:types`.
- **Decision**: FIXED — wymóg nagłówka skreślony jako sprzeczny z idempotentną regeneracją; zasada zapisana w `README.md` pod krokiem `npm run db:types` („generated output — never edit it by hand", ze wskazaniem cyklu migracja → `db reset` → `db:types`).

### F8 — Zbędne instrukcje w migracji: `create extension pgcrypto` i `check (due is not null)`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260824202259_flashcards_schema.sql:1, supabase/migrations/20260824202259_flashcards_schema.sql:60
- **Detail**: (a) `create extension if not exists pgcrypto;` jest na Supabase no-opem — rozszerzenie stoi w schemacie `extensions` (potwierdzone `pg_extension`), a `gen_random_uuid()` jest wbudowane od PostgreSQL 13. Na czystym PostgreSQL ta linia zainstalowałaby rozszerzenie w `public`, co linter Supabase zgłasza jako `extension_in_public`. (b) `constraint flashcards_due_required check (due is not null)` powiela `due timestamptz not null` z tej samej definicji kolumny. Żadna z tych linii nie występuje w kontrakcie planu.
- **Fix**: Usunąć obie linie (albo, jeśli `pgcrypto` ma zostać dla przenośności, dopisać `with schema extensions`).
- **Decision**: FIXED — `create extension if not exists pgcrypto;` usunięte z migracji `20260824202259` (udowodniony no-op: rozszerzenie stoi w schemacie `extensions`, `gen_random_uuid()` jest wbudowane od PG13), a `flashcards_due_required` zdjęte przez `alter table ... drop constraint` w niewypchniętej jeszcze migracji `20260825120802` — tak, żeby produkcja, na której migracja `20260824202259` jest już zastosowana, zbiegła się z lokalnym stanem zamiast się z nim rozjechać. Po `supabase db reset`: 11 ograniczeń `check` na `flashcards` (bez redundantnego), `npm run db:test` 10/10.
