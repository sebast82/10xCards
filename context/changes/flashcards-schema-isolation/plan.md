# Schemat fiszek i izolacja danych per użytkownik — Implementation Plan

## Overview

F-02 buduje trwałą warstwę danych dla całej pętli produktu: tabelę `flashcards` z dziewięcioma polami harmonogramu FSRS (kontrakt z F-01) i znacznikiem pochodzenia, tabelę `generations` z licznikami mierzącymi oba kryteria sukcesu PRD, oraz polityki RLS gwarantujące, że każdy użytkownik czyta i modyfikuje wyłącznie własne rekordy. Typy bazy trafiają do kodu, a izolacja zostaje udowodniona testem, nie deklaracją.

## Current State Analysis

- **Warstwa danych nie istnieje.** `supabase/` zawiera wyłącznie `config.toml` (project_id `10x-astro-starter`, Postgres 17) i `.gitignore`. Brak katalogu `migrations/`, brak `seed.sql`, brak typów bazy. [README.md](README.md) stwierdza wprost: „No database tables or migrations are required".
- **Kontrakt kolumn jest zamknięty i wiążący.** [docs/reference/contract-surfaces.md](docs/reference/contract-surfaces.md) §„Nazwy w danych" podaje dokładne typy PostgreSQL dla dziewięciu pól harmonogramu, enum `flashcard_source` oraz wymóg indeksu `(user_id, due)` wymuszony przez zapytanie sesji `WHERE user_id = ? AND due <= now() ORDER BY due`.
- **Kod zna już kształt wiersza.** [src/lib/srs/schedule-state.ts](src/lib/srs/schedule-state.ts) definiuje `scheduleStateRowSchema` 1:1 z przyszłymi kolumnami, z konkretnymi zakresami: `stability` nieujemna, `difficulty` w 0–10, `state` jako `0 | 1 | 2 | 3`, `last_review` nullable. F-02 jest pierwszym miejscem, gdzie ten kształt spotyka się z rzeczywistością.
- **Klient Supabase jest nietypowany i może być `null`.** [src/lib/supabase.ts](src/lib/supabase.ts) wywołuje `createServerClient` bez generyka `Database` i zwraca `null`, gdy brakuje zmiennych środowiskowych. `App.Locals` ([src/env.d.ts](src/env.d.ts)) niesie wyłącznie `user`.
- **Izolacja musi żyć w bazie.** Aplikacja łączy się kluczem `anon` z sesją użytkownika (`astro.config.mjs` → `SUPABASE_KEY`), nigdy kluczem `service_role`. Filtrowanie po `user_id` w kodzie jest wygodą, nie zabezpieczeniem — jedynym mechanizmem izolacji jest RLS.
- **Produkcja jest w chmurze.** Aplikacja stoi na `https://10x-cards.sebger82.workers.dev` z chmurowym projektem Supabase (`context/archive/2026-08-17-deployment/deployment-plan.md`, Faza 4). Migracja musi trafić lokalnie **i** zdalnie.
- **Infrastruktura testowa istnieje.** Vitest jest skonfigurowany (`npm test`), a `supabase` CLI jest w `devDependencies` (`^2.23.4`) — obie komendy potrzebne w tym planie (`supabase test db`, `supabase gen types`) są dostępne bez nowych zależności.

## Desired End State

W repo istnieje jedna migracja, która na czystej bazie tworzy komplet: enum pochodzenia, dwie tabele z ograniczeniami, indeks kolejkowania, trigger `updated_at` i osiem polityk RLS. `npx supabase db reset` odtwarza ten stan od zera. `npm run db:test` przechodzi i wywala się, gdy którakolwiek polityka przestanie odcinać cudze rekordy. `src/db/database.types.ts` jest wygenerowany z tej samej migracji i wpięty w `createClient()`, więc `supabase.from("flashcards")` w S-02 podpowiada kolumny i wyłapuje literówkę na etapie `astro check`. Chmurowy projekt ma tę samą migrację w historii (`supabase migration list` pokazuje zgodność), a rejestr nazw nośnych zawiera obie tabele.

### Key Discoveries:

- Zakresy w `scheduleStateRowSchema` ([src/lib/srs/schedule-state.ts](src/lib/srs/schedule-state.ts)) są **kontraktem do odwzorowania w CHECK-ach** — baza i moduł muszą odrzucać dokładnie te same wartości, inaczej `scheduleStateRowSchema.parse()` wybuchnie na wierszu, który baza przepuściła.
- `TypeConvert.card` przyjmuje `due` i `last_review` jako stringi ISO z offsetem — `timestamptz` w PostgREST serializuje się dokładnie w tym formacie, więc konwersja nie wymaga warstwy pośredniej.
- `supabase test db` uruchamia `pg_prove` w kontenerze na plikach z `supabase/tests`, a **każdy test jest opakowany we własną transakcję i cofany niezależnie od wyniku** — testowi wolno wstawiać użytkowników do `auth.users` bez sprzątania po sobie.
- `supabase db push` wymaga wcześniejszego `supabase link`; pierwsze uruchomienie zakłada tabelę `supabase_migrations.schema_migrations` na zdalnym projekcie i od tego momentu pomija migracje już zastosowane.
- Znacznik `source` jest **niezmienny po zapisie** (decyzja F-01) — S-03 nie rusza tej kolumny, a plan nie dodaje mechanizmu, który by ją chronił poza konwencją.

## What We're NOT Doing

- Nie budujemy endpointów `/api/flashcards`, `/api/generations` ani `/api/reviews` — to S-02, S-03 i S-05.
- Nie tworzymy tabeli `review_logs` — F-01 świadomie odłożył utrwalanie `ReviewLog`; log to tabela doklejana, więc dodanie jej później nie rusza istniejących rekordów.
- Nie rozszerzamy `App.Locals` o klienta Supabase — to wchodzi w S-02, przy pierwszym konsumencie.
- Nie piszemy warstwy repozytoriów ani serwisów nad tabelami — pierwszy konsument zdecyduje o jej kształcie.
- Nie dodajemy soft delete (PRD §FR-007 świadomie wybrał trwałe usuwanie) ani mechanizmu eksportu/kopii zapasowej.
- Nie automatyzujemy `db push` w CI — migracje jadą z lokalnej maszyny.
- Nie seedujemy danych demonstracyjnych do `supabase/seed.sql`.

## Implementation Approach

Kolejność jest wymuszona przez zależności narzędziowe: migracja musi istnieć, zanim `supabase db reset` postawi lokalną bazę; baza musi stać, zanim pgTAP ją przetestuje i zanim `gen types` z niej wygeneruje typy; typy muszą się zgadzać z modułem F-01, zanim cokolwiek pojedzie na produkcję. Stąd cztery fazy, każda z osobnym punktem zatrzymania.

Migracja jest **jednym plikiem** — obie tabele, enum, indeksy, trigger i wszystkie polityki. Rozbicie na kilka plików nie daje nic (żadna nie jest wdrażana osobno), a utrudnia czytanie schematu jako całości.

## Critical Implementation Details

**Wydajność polityk RLS.** Warunek zapisujemy jako `(select auth.uid()) = user_id`, nie `auth.uid() = user_id`. Owinięcie w podzapytanie sprawia, że planer traktuje wywołanie jako `InitPlan` i liczy je raz na zapytanie zamiast raz na wiersz — przy `select` po kolekcji fiszek to różnica rzędu wielkości.

**Ustalony `search_path` w funkcji triggera.** Funkcja `set_updated_at()` musi mieć `set search_path = ''` i odwoływać się do obiektów w pełni kwalifikowanych nazwach. Funkcja bez ustalonego `search_path` jest wektorem przejęcia uprawnień (linter Supabase zgłasza to jako `function_search_path_mutable`) i zapala ostrzeżenie w `supabase db lint`.

**Świadomie pominięty CHECK `state` ↔ `last_review`.** Kuszące jest wymuszenie „nowa fiszka nie ma daty ostatniej oceny" jako `check (state <> 0 or last_review is null)`. Nie robimy tego: FSRS dopuszcza przejścia, w których ta zależność nie jest oczywista (np. przyszłe `reschedule()`), a ograniczenie okaże się zbyt ciasne dopiero w S-05 — na fiszkach, które użytkownik już zapisał. Spójność tej pary pilnuje moduł `src/lib/srs/`, nie baza.

**Niezmienność `source` jest wymuszona w bazie.** Wartość `source` jest niezmienialna po zapisie — to nie tylko konwencja dokumentacyjna, lecz warunek na poziomie bazy, bo S-03 i S-04 nie mogą przypadkiem przepisać pochodzenia fiszki po akceptacji. To samo dotyczy kolejnych zmian: jeśli użytkownik zmienia własny rekord, `source` nie może ulec zmianie bez wyraźnego, świadomego portingu schematu.

**Kolejność kroków przy zmianie schematu.** Po każdej modyfikacji migracji obowiązuje ten sam cykl: `supabase db reset` → `npm run db:test` → `npm run db:types`. Pominięcie ostatniego kroku daje typy starsze niż schemat, co ujawni się dopiero jako błąd runtime w S-02.

---

## Phase 1: Migracja schematu i izolacja

### Overview

Powstaje jedyny plik SQL, który definiuje warstwę danych MVP: enum pochodzenia, dwie tabele, ograniczenia odwzorowujące kontrakt F-01, indeks kolejkowania sesji, trigger znacznika modyfikacji i osiem polityk RLS.

### Changes Required:

#### 1. Plik migracji

**File**: `supabase/migrations/<timestamp>_flashcards_schema.sql` (tworzony przez `npx supabase migration new flashcards_schema`)

**Intent**: Jedna migracja stawiająca komplet warstwy danych — od enuma po polityki — tak żeby `supabase db reset` na czystej maszynie odtworzył identyczny stan.

**Contract**: Kolejność obiektów w pliku: enum → funkcja triggera → `generations` → `flashcards` → indeksy → triggery → `enable row level security` → polityki. `flashcards` odwołuje się do `generations`, więc ta druga musi powstać wcześniej.

#### 2. Enum pochodzenia

**File**: ta sama migracja

**Intent**: Odwzorować decyzję z 2026-08-21 — pochodzenie fiszki jest trójwartościowe, bo `boolean` nie odróżni propozycji przyjętej bez zmian od poprawionej przed zapisem, a to jest różnica, którą mierzy pierwsze kryterium sukcesu PRD.

**Contract**: `create type public.flashcard_source as enum ('ai', 'ai_edited', 'manual');` — wartości i kolejność zgodne z [docs/reference/contract-surfaces.md](docs/reference/contract-surfaces.md).

#### 3. Tabela `generations`

**File**: ta sama migracja

**Intent**: Nieść metadane pojedynczego zlecenia generowania i liczniki, z których wprost liczy się oba kryteria sukcesu PRD. Tekst źródłowy **nie** trafia do tabeli — wyłącznie jego długość i skrót, co nie narusza wymagania niefunkcjonalnego o nietrwałości wklejki.

**Contract**: Kolumny — `id uuid primary key default gen_random_uuid()`, `user_id uuid not null references auth.users (id) on delete cascade`, `model text not null`, `source_text_length integer not null`, `source_text_hash text not null`, `generated_count integer not null default 0`, `accepted_unedited_count integer not null default 0`, `accepted_edited_count integer not null default 0`, `generation_duration integer not null` (milisekundy), `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`.

Ograniczenia: `source_text_length` dodatnia; `source_text_hash` o długości 64 znaków (SHA-256 w zapisie szesnastkowym); wszystkie liczniki nieujemne; `generation_duration` nieujemna; oraz warunek spójności `accepted_unedited_count + accepted_edited_count <= generated_count`.

Indeks: `(user_id, created_at desc)` pod listę historii generowań.

#### 4. Tabela `flashcards`

**File**: ta sama migracja

**Intent**: Trwały dom dla fiszki — treść, pochodzenie, właściciel i komplet stanu harmonogramu, który sesja z S-05 odczyta i zapisze bez znajomości API `ts-fsrs`.

**Contract**: Kolumny tożsamości i treści — `id uuid primary key default gen_random_uuid()`, `user_id uuid not null references auth.users (id) on delete cascade`, `generation_id uuid references public.generations (id) on delete set null` (nullable: fiszka ręczna z S-04 nie ma zlecenia), `front text not null`, `back text not null`, `source public.flashcard_source not null`.

Pola harmonogramu — dokładnie dziewięć nazw i typów z rejestru: `due timestamptz not null`, `stability double precision not null`, `difficulty double precision not null`, `scheduled_days integer not null`, `learning_steps smallint not null`, `reps integer not null`, `lapses integer not null`, `state smallint not null`, `last_review timestamptz` (jedyne pole harmonogramu dopuszczające `null`).

Kolumny audytowe — `created_at`, `updated_at`, obie `timestamptz not null default now()`.

Ograniczenia treści: `front` i `back` niepuste po `btrim` i nie dłuższe niż odpowiednio 500 i 2000 znaków.

Ograniczenia harmonogramu **muszą odwzorowywać `scheduleStateRowSchema`** ([src/lib/srs/schedule-state.ts](src/lib/srs/schedule-state.ts)) co do zakresu: `stability >= 0`, `difficulty between 0 and 10`, `scheduled_days >= 0`, `learning_steps >= 0`, `reps >= 0`, `lapses >= 0`, `state between 0 and 3`.

Indeks kolejkowania: `create index flashcards_user_id_due_idx on public.flashcards (user_id, due);` — wymuszony przez zapytanie sesji z rejestru nazw nośnych.

#### 5. Trigger znacznika modyfikacji

**File**: ta sama migracja

**Intent**: `updated_at` ma być prawdą niezależną od tego, czy autor endpointu w S-03 pamiętał o polu.

**Contract**: Funkcja `public.set_updated_at()` w `plpgsql`, `security invoker`, z `set search_path = ''`, ustawiająca `new.updated_at = now()` i zwracająca `new`. Trigger `before update ... for each row` na obu tabelach.

#### 6. Trigger blokujący zmianę `source`

**File**: ta sama migracja

**Intent**: Wymusić niezmienność `source` na poziomie bazy, nie tylko w konwencji S-03.

**Contract**: Funkcja `public.prevent_flashcard_source_change()` w `plpgsql`, `security invoker`, z `set search_path = ''`, która sprawdza `if old.source is distinct from new.source then raise exception 'flashcard source is immutable'; end if; return new;`. Trigger `before update on public.flashcards for each row` wykonuje ten warunek. Ta sama funkcja jest też testowana pgTAP jako błąd przy próbie zmiany `source`.

#### 7. RLS i polityki

**File**: ta sama migracja

**Intent**: Zamknąć dostęp do rekordów tak, by żaden błąd w warstwie aplikacji nie mógł pokazać ani zmienić cudzej fiszki. Rola `anon` nie dostaje żadnej polityki, więc przy włączonym RLS jest odcięta domyślnie.

**Contract**: `alter table public.flashcards enable row level security;` i to samo dla `public.generations`. Następnie po cztery polityki na tabelę, wszystkie `to authenticated`, nazwane wzorcem `<tabela>_<operacja>_own` (np. `flashcards_select_own`):

- `for select` — `using ((select auth.uid()) = user_id)`
- `for insert` — `with check ((select auth.uid()) = user_id)`
- `for update` — `using (...)` **i** `with check (...)` (bez `with check` da się przepisać cudzy `user_id` na swój lub odwrotnie)
- `for delete` — `using (...)`

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się na czystej bazie: `npx supabase db reset`
- Brak błędów schematu: `npx supabase db lint --level error --fail-on error`
- Plik migracji istnieje w `supabase/migrations/` i jest jedynym w katalogu

#### Manual Verification:

- W Supabase Studio obie tabele mają włączone RLS i po cztery polityki
- Wstawienie fiszki z `state = 4` albo pustym `front` kończy się błędem ograniczenia
- `\d public.flashcards` pokazuje wszystkie dziewięć kolumn harmonogramu w typach z rejestru

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się i poczekaj na potwierdzenie ręcznego sprawdzenia, zanim przejdziesz do Fazy 2.

---

## Phase 2: Dowód izolacji (pgTAP)

### Overview

Izolacja przestaje być deklaracją w migracji, a staje się twierdzeniem sprawdzanym jedną komendą — przy tej i każdej kolejnej zmianie schematu.

### Changes Required:

#### 1. Test polityk RLS

**File**: `supabase/tests/rls_flashcards.test.sql`

**Intent**: Udowodnić na żywej bazie, że użytkownik A nie widzi, nie zmienia i nie usuwa rekordów użytkownika B, oraz że nie potrafi zapisać rekordu podszywającego się pod B.

**Contract**: Plik w konwencji pgTAP: `begin;` → `select plan(<n>);` → asercje → `select * from finish();` → `rollback;`.

Przygotowanie: wstaw dwóch użytkowników do `auth.users` ze stałymi UUID-ami i po jednej fiszce oraz jednym generowaniu dla każdego (jako rola domyślna, przed przełączeniem kontekstu).

Przełączenie kontekstu na użytkownika A — obie komendy są konieczne, sama zmiana roli nie ustawia tożsamości:

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<uuid-A>","role":"authenticated"}';
```

Asercje (minimum): `flashcards` widoczne dla A to dokładnie jeden wiersz i jest to wiersz A; to samo dla `generations`; `update` i `delete` na wierszu B dotyka zera wierszy; `insert` z `user_id` równym B kończy się błędem `42501`; `update` własnego rekordu z zamianą `source` na inną wartość kończy się błędem z powodu triggera `prevent_flashcard_source_change`; po przełączeniu na `set local role anon` obie tabele zwracają zero wierszy. Dodatkowo `select is_rls_enabled(...)` (albo równoważne sprawdzenie `pg_class.relrowsecurity`) na obu tabelach.

#### 2. Skrypt uruchomieniowy

**File**: [package.json](package.json)

**Intent**: Dać jedną, zapamiętywalną komendę, żeby test izolacji był odpalany rutynowo, a nie tylko w tej zmianie.

**Contract**: Skrypty `db:test` → `supabase test db`, `db:reset` → `supabase db reset`. Nie wpinamy ich w `npm test` — Vitest musi działać w CI bez Dockera.

### Success Criteria:

#### Automated Verification:

- Test izolacji przechodzi: `npm run db:test`
- Vitest nadal przechodzi i nie wymaga bazy: `npm test`
- Linting przechodzi: `npm run lint`

#### Manual Verification:

- Tymczasowe rozluźnienie polityki `flashcards_select_own` (warunek na `true`) powoduje **czerwony** wynik `npm run db:test` — test faktycznie mierzy to, co deklaruje
- Po cofnięciu zmiany test znów przechodzi

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się i poczekaj na potwierdzenie mutacji polityki, zanim przejdziesz do Fazy 3.

---

## Phase 3: Typy bazy w kodzie

### Overview

Schemat wchodzi do TypeScriptu: klient Supabase zaczyna znać kolumny, a test typu pilnuje, żeby migracja nie rozjechała się z kontraktem F-01.

### Changes Required:

#### 1. Wygenerowane typy bazy

**File**: `src/db/database.types.ts`

**Intent**: Jedno źródło prawdy o kształcie tabel po stronie kodu, generowane z tej samej migracji, która stoi w bazie — nigdy pisane ręcznie.

**Contract**: Wynik `supabase gen types typescript --local --schema public`, commitowany do repo. Plik jest wyłączony spod ręcznej edycji; nagłówek pliku ma o tym mówić jednym zdaniem.

#### 2. Skrypt regeneracji

**File**: [package.json](package.json)

**Intent**: Regeneracja musi być komendą, nie akapitem w README.

**Contract**: Skrypt `db:types` → `supabase gen types typescript --local --schema public > src/db/database.types.ts`.

#### 3. Typowany klient Supabase

**File**: [src/lib/supabase.ts](src/lib/supabase.ts)

**Intent**: Wpiąć generyk `Database` w `createServerClient`, żeby zapytania w S-02 były sprawdzane statycznie. Zachowanie zwracania `null` przy braku zmiennych środowiskowych zostaje bez zmian — wszyscy wołający już je obsługują.

**Contract**: `createServerClient<Database>(...)`; typ zwracany funkcji `createClient` to `SupabaseClient<Database> | null`.

#### 4. Test kontraktu schematu

**File**: `src/db/schema-contract.test.ts`

**Intent**: Złapać rozjazd między migracją a modułem F-01 na etapie kompilacji, a nie w S-05 na danych użytkownika. To pierwszy realny konsument kontraktu z F-01.

**Contract**: Test typu w Vitest (`expectTypeOf`) sprawdzający, że `ScheduleStateRow` jest przypisywalny do `Pick<Tables<"flashcards">["Row"], keyof ScheduleStateRow>`. Kierunek przypisania jest celowy: łapie brakującą kolumnę, literówkę w nazwie i zmianę rodzaju typu (`string` ↔ `number`), a jednocześnie toleruje to, że moduł zawęża `state` do `0 | 1 | 2 | 3`, podczas gdy baza opisuje je jako `number`. Dodatkowo asercja wartości: enum `flashcard_source` z wygenerowanych typów ma dokładnie trzy wartości `ai`, `ai_edited`, `manual`.

### Success Criteria:

#### Automated Verification:

- Typy generują się bez zmian w drzewie roboczym po `npm run db:types` (regeneracja jest idempotentna)
- Sprawdzenie typów przechodzi: `npx astro check`
- Testy przechodzą, w tym nowy test kontraktu: `npm test`
- Linting i build przechodzą: `npm run lint` oraz `npm run build`

#### Manual Verification:

- W edytorze `supabase.from("flashcards").select()` podpowiada kolumny, a literówka w nazwie kolumny jest podkreślana
- Ręczna zmiana nazwy kolumny w migracji → `db reset` → `db:types` → `npm test` kończy się czerwono na teście kontraktu (i wraca na zielono po cofnięciu)

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się i poczekaj na potwierdzenie, zanim przejdziesz do Fazy 4 — kolejna faza dotyka produkcji.

---

## Phase 4: Wdrożenie na chmurowy projekt i domknięcie rejestru

### Overview

Migracja trafia na projekt, z którego korzysta wdrożona instancja, a rejestr nazw nośnych i README przestają twierdzić, że baza nie ma tabel.

### Changes Required:

#### 1. Powiązanie i wypchnięcie migracji

**File**: — (operacja na środowisku, nie na repo)

**Intent**: Zsynchronizować chmurowy projekt z historią migracji w repo, z podglądem przed wykonaniem.

**Contract**: Kolejność: `npx supabase link --project-ref <ref>` → `npx supabase migration list` (sprawdzenie, czy lokalny stan nie jest rozbieżny z zdalnym) → `npx supabase db push --dry-run` (musi wypisać dokładnie jedną migrację; jeżeli nie, przerwij i rozwiąż konflikt historii zamiast pushować) → `npx supabase db push` → `npx supabase migration list` (kolumny LOCAL i REMOTE zgodne). `db push` jest operacją nieodwracalną na produkcji — tutaj bezpieczną, bo tworzy wyłącznie nowe obiekty, ale kontrola `--dry-run` i zakaz pushowania przy rozbieżności są obowiązkowe. Jeśli push się nie uda pośrednio lub z powodu konfliktu schematu, plan rollbacku obejmuje zatrzymanie wdrożenia danych, ręczne usunięcie obiektu „wstecz” tylko w ramach tej migracji i ponowne `supabase migration repair --status reverted` w razie potrzeby.

#### 2. Rejestr nazw nośnych

**File**: [docs/reference/contract-surfaces.md](docs/reference/contract-surfaces.md)

**Intent**: Zamknąć obieg — nazwy zarezerwowane w F-01 jako „proponowane" stają się faktem, a S-02 pisze endpointy, czytając wyłącznie ten plik.

**Contract**: Nowa sekcja z tabelami `public.flashcards` i `public.generations` (nazwa, rola, stan `istnieje`), uzupełnienie tabeli „Nazwy w danych" o `front`, `back`, `generation_id`, `created_at`, `updated_at` oraz kolumny `generations`. Zapis dwóch zasad: liczniki w `generations` aktualizuje S-02 przy akceptacji, a `generation_id` jest `null` dla fiszek ręcznych.

#### 3. Dokumentacja konfiguracji

**File**: [README.md](README.md)

**Intent**: Zdanie „No database tables or migrations are required" jest od tej chwili nieprawdziwe i wprowadzi w błąd każdego, kto stawia projekt od zera.

**Contract**: Sekcja „Supabase Configuration" opisuje: `supabase start` → `supabase db reset` (stosuje migracje) → `npm run db:types`, oraz `npm run db:test` jako sposób weryfikacji polityk. Dla projektu chmurowego — `supabase link` + `supabase db push`.

### Success Criteria:

#### Automated Verification:

- Podgląd wypycha dokładnie jedną migrację: `npx supabase db push --dry-run`
- Historia migracji zgodna lokalnie i zdalnie: `npx supabase migration list`
- Build przechodzi: `npm run build`

#### Manual Verification:

- W dashboardzie chmurowego projektu obie tabele istnieją, mają włączone RLS i komplet polityk
- Zalogowany użytkownik na `https://10x-cards.sebger82.workers.dev` nadal loguje się i wylogowuje bez regresji
- `contract-surfaces.md` i `README.md` opisują stan faktyczny — nowa osoba stawia projekt lokalnie, idąc wyłącznie za README

**Implementation Note**: Ostatnia faza. Po potwierdzeniu ręcznej weryfikacji zmiana jest gotowa do `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- Test kontraktu schematu (`src/db/schema-contract.test.ts`) — zgodność `ScheduleStateRow` z wygenerowanym typem wiersza oraz komplet wartości enuma pochodzenia
- Istniejące testy `src/lib/srs/` pozostają bez zmian i nadal działają bez bazy

### Integration Tests:

- pgTAP (`supabase/tests/rls_flashcards.test.sql`) — izolacja odczytu, zapisu, aktualizacji i usuwania między dwoma użytkownikami; odcięcie roli `anon`; potwierdzenie włączonego RLS na obu tabelach

### Manual Testing Steps:

1. `npx supabase start` i `npx supabase db reset` — migracja stosuje się na czystej bazie
2. W Studio: wstaw fiszkę z `state = 7` → oczekiwany błąd `check`; wstaw z `front = '   '` → oczekiwany błąd `check`
3. Rozluźnij politykę `select` i uruchom `npm run db:test` → oczekiwany czerwony wynik; cofnij zmianę → zielony
4. Zmień nazwę kolumny w migracji, przejdź cykl `db reset` → `db:types` → `npm test` → oczekiwany czerwony test kontraktu; cofnij
5. Po `db push`: w dashboardzie chmurowego projektu sprawdź obecność tabel, RLS i polityk
6. Zaloguj się na wdrożonej instancji i wyloguj — brak regresji w przepływie auth

## Performance Considerations

Indeks `(user_id, due)` obsługuje jedyne gorące zapytanie MVP — kolejkę sesji nauki. Indeks `(user_id, created_at desc)` na `generations` obsługuje listę historii. Przy skali z PRD (`users: small`, `data_volume: small`) to wystarcza; nie dodajemy indeksów „na zapas", bo każdy kosztuje przy zapisie i trzeba go utrzymać.

Warunek RLS w formie `(select auth.uid())` jest jedyną optymalizacją, która ma tu realne znaczenie — bez niej funkcja wykonuje się raz na wiersz przy każdym `select` po kolekcji.

## Migration Notes

Migracja tworzy wyłącznie nowe obiekty — nie ma danych do przeniesienia ani do przepisania, bo tabel jeszcze nie ma. To jedyny moment w projekcie, w którym zmiana kształtu tabeli fiszek jest darmowa; po S-02 każda zmiana dotyka rekordów użytkownika.

Wycofanie: usunięcie obu tabel i enuma odwraca migrację w całości, ale `db push` nie ma automatycznego cofania — wycofanie na produkcji oznacza ręczny `drop` i `supabase migration repair --status reverted`.

Kaskada `on delete cascade` na `user_id` sprawia, że usunięcie konta w Supabase Auth czyści fiszki i generowania — zgodnie z PRD, gdzie retencja danych trwa „dopóki użytkownik nie usunie konta lub fiszek".

## References

- Kontrakt kolumn i typów: [docs/reference/contract-surfaces.md](docs/reference/contract-surfaces.md)
- Kontrakt stanu harmonogramu (F-01): `context/archive/2026-08-23-srs-algorithm-contract/plan.md`
- Kształt wiersza w kodzie: [src/lib/srs/schedule-state.ts](src/lib/srs/schedule-state.ts)
- Klient Supabase do otypowania: [src/lib/supabase.ts](src/lib/supabase.ts)
- Ryzyka środowiska uruchomieniowego: [context/foundation/infrastructure.md](context/foundation/infrastructure.md)

## Progress

> Konwencja: `- [ ]` do zrobienia, `- [x]` zrobione. Dopisz ` — <commit sha>`, gdy krok wyląduje. Nie zmieniaj tytułów kroków.

### Phase 1: Migracja schematu i izolacja

#### Automated

- [ ] 1.1 Migracja stosuje się na czystej bazie: `npx supabase db reset`
- [ ] 1.2 Brak błędów schematu: `npx supabase db lint --level error --fail-on error`
- [ ] 1.3 Plik migracji istnieje w `supabase/migrations/` i jest jedynym w katalogu

#### Manual

- [ ] 1.4 W Supabase Studio obie tabele mają włączone RLS i po cztery polityki
- [ ] 1.5 Wstawienie fiszki z `state = 4` albo pustym `front` kończy się błędem ograniczenia
- [ ] 1.6 `\d public.flashcards` pokazuje wszystkie dziewięć kolumn harmonogramu w typach z rejestru

### Phase 2: Dowód izolacji (pgTAP)

#### Automated

- [ ] 2.1 Test izolacji przechodzi: `npm run db:test`
- [ ] 2.2 Vitest nadal przechodzi i nie wymaga bazy: `npm test`
- [ ] 2.3 Linting przechodzi: `npm run lint`

#### Manual

- [ ] 2.4 Rozluźnienie polityki `flashcards_select_own` daje czerwony `npm run db:test`
- [ ] 2.5 Po cofnięciu zmiany test znów przechodzi

### Phase 3: Typy bazy w kodzie

#### Automated

- [ ] 3.1 Regeneracja typów jest idempotentna: `npm run db:types` nie zmienia drzewa roboczego
- [ ] 3.2 Sprawdzenie typów przechodzi: `npx astro check`
- [ ] 3.3 Testy przechodzą, w tym test kontraktu: `npm test`
- [ ] 3.4 Linting i build przechodzą: `npm run lint` oraz `npm run build`

#### Manual

- [ ] 3.5 Edytor podpowiada kolumny w `supabase.from("flashcards")`, literówka jest podkreślana
- [ ] 3.6 Zmiana nazwy kolumny w migracji wywala test kontraktu i wraca na zielono po cofnięciu

### Phase 4: Wdrożenie na chmurowy projekt i domknięcie rejestru

#### Automated

- [ ] 4.1 Podgląd wypycha dokładnie jedną migrację: `npx supabase db push --dry-run`
- [ ] 4.2 Historia migracji zgodna lokalnie i zdalnie: `npx supabase migration list`
- [ ] 4.3 Build przechodzi: `npm run build`

#### Manual

- [ ] 4.4 W dashboardzie chmurowego projektu obie tabele mają RLS i komplet polityk
- [ ] 4.5 Logowanie i wylogowanie na wdrożonej instancji bez regresji
- [ ] 4.6 `contract-surfaces.md` i `README.md` opisują stan faktyczny
