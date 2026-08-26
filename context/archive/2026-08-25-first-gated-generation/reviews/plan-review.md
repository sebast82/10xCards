<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-02 `first-gated-generation`

- **Plan**: `context/changes/first-gated-generation/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-25
- **Verdict**: REVISE → SOUND (po triage'u; wszystkie 6 findings naprawione w planie)
- **Findings**: 3 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict (przed) | Verdict (po fixach) |
|-----------|-----------------|---------------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | WARNING | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

10/10 paths ✓, 5/5 symbols ✓, brief↔plan ✓ (1 nit), contract-surfaces: 3/3 sekcje H2 dotknięte, kształt raportowany wiernie.

Zweryfikowane bezpośrednio w kodzie: `PROTECTED_ROUTES = ["/dashboard"]`, `no-console: "warn"` bez `--max-warnings 0` w CI, `generated_count integer not null default 0`, CHECK `generations_accepted_total_leq_generated`, `ScheduleStateRow` = dokładnie 9 pól, `App.Locals` bez `supabase`, `.env.example` = 2 linie, `environment: "node"` w Vitest, brak `context/foundation/lessons.md`. Wszystkie twierdzenia z „Current State Analysis" potwierdzone.

Nit: `plan-brief.md` mówi „`source` + `createNewCard()` = 12 pól", plan mówi „9 pól harmonogramu". Plan ma rację — `ScheduleStateRow` ma 9 kluczy.

## Findings

### F1 — Sekcja Progress łamie kontrakt mechaniczny

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Nagłówki faz + `## Progress`
- **Detail**: (a) ciało planu używało `## Faza N:`, a Progress `### Phase N:` — `/10x-implement` liczy fazy z nagłówków `## Phase N:` (SKILL.md:55) i znalazłby zero; (b) faza 6 miała 7 punktów Manual, a Progress 6 wierszy (brak „odświeżenie strony gubi propozycje"); (c) faza 8 miała 4 punkty Manual, a Progress 3 (scalone `?error=` + banner).
- **Fix**: Nagłówki faz zmienione na `## Phase N: <nazwa>`, dodany wiersz 6.10, rozbite 8.6 → 8.6 + 8.8. Indeksów nie renumerowano.
- **Decision**: FIXED

### F2 — Funkcja przeliczająca liczniki ma wyścig odczyt-zapis

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Faza 2 — kontrakt `recount_generation_acceptance`
- **Detail**: Idempotencja chroni przed powtórzeniem tego samego żądania, ale nie przed dwoma różnymi naraz. Przy zapisie per fiszka i liście do 25 kart równoległe POST-y są normą. W `read committed` `count(*)` wykonuje się przed pobraniem blokady wiersza `generations`, więc blokada wierszowa na `update` nie serializuje cyklu: T_A liczy 1, T_B liczy 2 i commituje, T_A commituje 1 — licznik pokazuje 1 przy dwóch fiszkach. Kierunek błędu to zaniżenie, czyli cicha degradacja kryterium 75%.
- **Fix A ⭐ Recommended**: `perform 1 from public.generations where id = p_generation_id for update;` jako pierwsza instrukcja funkcji
  - Strength: serializuje cały cykl count→update; trzy linie, `security invoker` i RLS bez zmian.
  - Tradeoff: zapisy w obrębie jednego zlecenia sekwencyjne — przy ~25 kartach nieodczuwalne.
  - Confidence: HIGH — standardowy wzorzec read-modify-write w Postgresie.
  - Blind spot: kolejność blokad stała we wszystkich ścieżkach; do potwierdzenia, jeśli S-03 doda UPDATE w innym porządku.
- **Fix B**: Zapis zbiorczy zamiast per fiszka
  - Strength: jeden insert i jeden recount — wyścig znika z definicji; zgodne z P4 z `research.md`.
  - Tradeoff: cofa świadomą decyzję z briefu i przebudowuje fazy 5–6.
  - Confidence: MEDIUM.
  - Blind spot: nie rozwiązuje wyścigu, gdy S-03 doda usuwanie zapisanych fiszek.
- **Uwaga do testu**: pgTAP wykonuje asercje sekwencyjnie w jednej sesji, więc asercja (b) przejdzie także dla wersji z wyścigiem. Obecność blokady weryfikuje się odczytem migracji — dodano jako punkt 2.8.
- **Decision**: FIXED (Fix A)

### F3 — `google/gemini-2.5-flash` myśli, a `max_tokens` liczony jest z sufitu treści

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Faza 3 pkt 1 + Performance Considerations
- **Detail**: `research.md:136` wyróżnia `flash-lite` adnotacją „thinking domyślnie wyłączone" — czyli w wybranym `flash` jest włączone. Plan nie wspominał o tokenach rozumowania ani razu, a opierał na tym modelu trzy rzeczy: (1) `max_tokens: <cap>` — rozumowanie konsumuje ten sam budżet, więc `finish_reason: "length"` i obcięty JSON dałyby 502 przy każdym generowaniu, wykryte dopiero w fazie 9; (2) koszt ~0,006 $ zakłada 2 000 tokenów wyjścia, a rozumowanie jest rozliczane po stawce wyjścia; (3) latencja — model wybrano za 0,57 s TTFT, ale faza rozumowania poprzedza pierwszy token treści. Dodatkowo wzór na `max_tokens` nie był podany.
- **Fix A**: `reasoning: { enabled: false }` + jawny wzór
  - Strength: budżet przewidywalny, szacunki kosztu i latencji prawdziwe.
  - Tradeoff: możliwa niewielka strata jakości.
  - Confidence: MEDIUM — kierunek pewny, kształt pola do potwierdzenia w dokumentacji.
  - Blind spot: interakcja z `provider.require_parameters: true` niesprawdzona.
- **Fix B ⭐ (wybrany)**: Zostawić rozumowanie, dać zapas w `max_tokens` i obsłużyć obcięcie
  - Strength: zachowuje potencjalnie lepszą jakość; wystarczy osobny typ błędu na `finish_reason === "length"`.
  - Tradeoff: koszt i latencja pozostają nieoszacowane do fazy 9.
  - Confidence: MEDIUM.
  - Blind spot: sufit kosztu dobowego do przeliczenia po pomiarze.
- **Zastosowane w planie**: wzór `max_tokens = 8_000 + cap * 400`; osobna obsługa `finish_reason: "length"` w `parse.ts` przed `JSON.parse`, mapowana na 502; przypadek testowy dla obcięcia; zastrzeżenia przy szacunkach kosztu i latencji; punkt 9.9 — odnotować `reasoning_tokens` i brak `finish_reason: "length"`.
- **Decision**: FIXED (Fix B)

### F4 — Brak limitu czasu na wywołaniu OpenRoutera

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 3 pkt 4 (`client.ts`), Faza 6 pkt 2 (`GenerateView.tsx`)
- **Detail**: Kontrakt `client.ts` wymieniał „timeout" wśród błędów lecących dalej bez ponowienia, ale nic go nie ustanawiało. `fetch` na `workerd` nie ma domyślnego limitu po stronie aplikacji, a limit 10 ms CPU nie obejmuje czekania na sieć — zawieszony dostawca zostawiał użytkownika przy spinnerze bez końca, wbrew wymaganiu „pierwsze fiszki w ciągu 30 sekund".
- **Fix**: `AbortSignal.timeout(45_000)` na obu wywołaniach w adapterze (powyżej budżetu 30 s, żeby timeout był awarią, nie normą), `AbortError` → 502; `AbortSignal.timeout(60_000)` po stronie wyspy, żeby serwerowy komunikat zdążył dotrzeć przed przerwaniem po stronie klienta.
- **Decision**: FIXED

### F5 — `MAX_FLASHCARDS = 30` jest nieosiągalny

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Faza 3 pkt 2 i 5, Performance Considerations, Faza 6
- **Detail**: `proposalCap(10_000) = min(30, ⌈10000/400⌉) = 25`. Przy `SOURCE_TEXT_MAX = 10_000` człon `30` nie zadziałał nigdy — sufit 30 wymagałby 12 000 znaków, które walidacja z fazy 4 odrzuca. Skutki: przypadek testowy „wartość dająca więcej niż 30 → 30" testował martwą gałąź, a Performance Considerations i brief cytowały „sufit 30 propozycji" przy faktycznym 25.
- **Fix**: `MAX_FLASHCARDS = 25` z jawnym powiązaniem z `SOURCE_TEXT_MAX`; przypadek testowy zamieniony na granicę sufitu (9 601 → 25, 9 600 → 24); „30" poprawione na „25" w Performance Considerations i w fazie 6.
- **Decision**: FIXED

### F6 — `edited` jest deklarowany przez klienta i nieweryfikowalny serwerowo

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 5 (kontrakt endpointu), Faza 6 (porównanie treści)
- **Detail**: Podział na `accepted_unedited_count` i `accepted_edited_count` — czyli pomiar kryterium 75% — opiera się w całości na fladze przysłanej przez przeglądarkę. Serwer nie utrwala propozycji (ta sama decyzja, na której stoi twarde ograniczenie „odrzucone nie trafiają do bazy"), więc nie ma czym tego zweryfikować.
- **Fix**: Zastrzeżenie dopisane do fazy 5 — wskaźnik jest deklarowany, nie zmierzony; bez znaczenia przy pomiarze na własnym materiale, istotne przy porównywaniu modeli.
- **Decision**: FIXED

## Co przeszło bez uwag

- **End-State Alignment**: każda zdolność z Desired End State ma fazę, która ją buduje; kryteria sukcesu nie da się spełnić przy niezrealizowanym celu.
- **Architectural Fitness**: warstwa serwisów wprowadzona przez pierwszego konsumenta, nie na zapas; `fetch` zamiast SDK uzasadniony limitem 3 MB; `/deck` w SSR bez endpointu — mniej kodu i zero nowych konwencji; odczyt bez filtra `user_id` jest poprawny, bo RLS jest jedynym mechanizmem izolacji.
- **Scope**: „What We're NOT Doing" nie wraca w żadnej fazie; faza 8 jawnie oznaczona jako odcinalna z uzasadnieniem.
- **Contract surfaces**: plan dotyka wszystkich trzech sekcji rejestru, raportuje ich obecny kształt wiernie i aktualizuje plik w tym samym przebiegu (fazy 4, 5, 6, 7).
- **Świadome odejście od researchu**: `research.md` P4 rekomenduje batch insert, plan wybiera zapis per fiszka — odstępstwo udokumentowane w briefie z uzasadnieniem, nie przeoczenie.
