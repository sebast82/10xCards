<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: E2E krytycznej pętli

- **Plan**: `context/changes/testing-e2e-critical-loop/plan.md`
- **Scope**: pełny plan — Fazy 1–4 z 4 (commity `15a84c3^..HEAD`, 7 commitów, 10 plików)
- **Date**: 2026-09-07
- **Verdict**: NEEDS ATTENTION → wszystkie 10 findingów naprawione w triage (2026-09-08)
- **Findings**: 0 critical, 6 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

**Kontekst dla werdyktu.** Sama implementacja jest wierna planowi: wszystkie punkty „Changes Required"
z czterech faz wypadły jako MATCH, wszystkie dziesięć granic z „What We're NOT Doing" utrzymane,
a jedyny DRIFT (3.4, required status check) został obsłużony dokładnie klauzulą awaryjną, którą plan
sam przewidział. `NEEDS ATTENTION` bierze się z findingów okołowdrożeniowych — utwardzenia CI,
jednej dziury w asercji i jednej regresji wprowadzonej podczas Fazy 4 — a nie z rozjazdu z zamiarem.

## Weryfikacja kryteriów sukcesu

| Kryterium                             | Wynik          | Dowód                                                                                                                          |
| ------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 / 2.4 `npx astro check`           | PASS           | 87 plików, 0 errors, 0 warnings                                                                                                |
| 1.2 / 2.3 / 4.1 `npm run lint`        | PASS           | exit 0                                                                                                                         |
| 1.3 `npm test`                        | PASS           | 19 plików, 195/195 testów                                                                                                      |
| 2.5 brak antywzorców w specu          | PASS           | jedyne trafienie `waitForTimeout` to komentarz „nigdy `waitForTimeout`" w linii 66                                             |
| 3.1 / 3.2 joby zielone na realnym PR  | PASS           | run `34161846658`: `e2e` success, `ci` success, `db-tests` success                                                             |
| 3.3 `gh workflow view`                | PASS           | `CI - ci.yml`, ID 321309961, job `e2e` rozwiązany                                                                              |
| 4.2 brak `TBD` w §6.6                 | PASS           | jedyne `TBD` w pliku to preambuła §6 opisująca konwencję                                                                       |
| 4.3 Status z ustalonego słownika      | PASS           | `complete`                                                                                                                     |
| 2.1 / 2.2 / 2.6 przebiegi Playwrighta | NIE ODTWORZONE | brak lokalnego stacku Supabase i `.env.test`; zaliczone w czasie Fazy 2, potwierdzone trzema zielonymi przebiegami `e2e` na PR |
| 3.7 required status check             | PENDING        | zablokowane z zewnątrz (403), udokumentowane w §7 i `change.md`                                                                |

Pozycje manualne 1.5–1.7, 2.7–2.12, 3.5–3.6, 3.8–3.9 mają pokrycie w dowodach: dwa scratchowe
przebiegi PR (`SCRATCH: weryfikacja bramki e2e (NIE MERGOWAĆ)`, oba failure) odpowiadają
deliberate-breakom z 3.5/3.6. Brak śladów rubber-stampingu.

## Findings

### F1 — Ślady Playwrighta w artefakcie CI niosą hasło konta e2e i ciasteczka sesji

- **Severity**: ⚠️ WARNING (❌ CRITICAL w momencie przełączenia repo na publiczne)
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml:130-137`
- **Detail**: `playwright.config.ts:32` ustawia `trace: "on-first-retry"`, a `:21` daje `retries: 2`
  w CI — więc każdy czerwony przebieg produkuje trace. `tests/e2e/auth.setup.ts:40-42` wpisuje
  `E2E_PASSWORD` w prawdziwy formularz i wysyła go przez `POST /api/auth/signin`; trace zapisuje
  zarówno wartość akcji `fill`, jak i pełną wymianę sieciową wraz z ciasteczkami sesji Supabase.
  Maskowanie sekretów GitHuba (i jawne `::add-mask::` w `:91`) działa **wyłącznie na logi** — nigdy
  na zawartość artefaktów. Waga: README §„End-to-end tests" krok 1 każe założyć konto testowe
  w prawdziwym projekcie Supabase, który czyta dev server, więc wyciekłe hasło nie jest ograniczone
  do jednorazowego stacku CI.
- **Fix A ⭐ Recommended**: Usunąć `test-results/` ze ścieżki artefaktu, zostawić sam
  `playwright-report/`, i dopisać w README, że `E2E_USERNAME`/`E2E_PASSWORD` to poświadczenia
  jednorazowe, nie konto używane do czegokolwiek innego.
  - Strength: Raport HTML zachowuje wartość diagnostyczną, a nośnik poświadczeń znika; job CI i tak
    zakłada użytkownika sam (`ci.yml:99-114`), więc nic nie traci.
  - Tradeoff: Trace przy debugowaniu czerwonego CI trzeba odtworzyć lokalnie.
  - Confidence: HIGH — jednoliniowa zmiana w `path:`, zero wpływu na zielony przebieg.
  - Blind spot: Nie sprawdziłem, czy sam raport HTML nie osadza fragmentów żądań przy pewnych
    reporterach.
- **Fix B**: Zostawić artefakt, ale wyłączyć trace dla projektu `setup` (to on wpisuje hasło),
  zostawiając go dla `chromium`.
  - Strength: Pełna diagnostyka na testach, które faktycznie się psują; hasło nigdy nie trafia do trace'u.
  - Tradeoff: Więcej konfiguracji; awaria samego logowania traci trace, a to niebanalna klasa awarii.
  - Confidence: MEDIUM — wymaga per-projektowego `use.trace`, nieprzetestowane w tym repo.
  - Blind spot: Ciasteczka sesji nadal lądują w trace'ach testów `chromium`.
- **Decision**: FIXED via Fix A — `test-results/` usunięte ze ścieżki artefaktu (zostaje samo `playwright-report/`), z komentarzem wyjaśniającym dlaczego; README ostrzega, że `E2E_USERNAME`/`E2E_PASSWORD` to poświadczenia jednorazowe.

### F2 — Przebieg prettiera z Fazy 4 uszkodził niepowiązaną linię w §6.5

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/foundation/test-plan.md:259`
- **Detail**: `npx prettier --write` uruchomiony w Fazie 4 zinterpretował zawinięty znak `+`
  na początku kontynuacji zdania jako marker listy i przepisał go na `-`, wcinając przy tym dwie
  kolejne linie w zagnieżdżony punkt. Zdanie o sekwencji guarda `reps` czyta się teraz
  „legalna druga ocena → 1 wiersz **-** spójny re-parse" zamiast „**+** spójny re-parse". To zmiana
  treści w linii §6.5, której ta faza nie miała dotykać — regresja wprowadzona przez narzędzie
  formatujące, nie decyzja.
- **Fix**: Przywrócić `+` i oryginalne wcięcie dwóch następnych linii; żeby prettier nie zrobił tego
  ponownie, przenieść `+` na koniec poprzedniej linii albo zapisać jako `&#43;`.
- **Decision**: FIXED — `+` przeniesiony na koniec poprzedniej linii, wcięcia przywrócone. Plik jest prettier-stabilny, więc kolejny przebieg formatowania tego nie powtórzy.

### F3 — Zamykająca asercja `toBeHidden()` jest zielona także na gałęzi błędu

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `tests/e2e/critical-loop.spec.ts:126`
- **Detail**: `expect(session.getByText(front, { exact: true })).toBeHidden()` przechodzi zawsze, gdy
  tekstu nie ma — w tym na ścieżce błędu. Ścieżka jest konkretna i to ta, którą test zawsze idzie:
  ocena zwraca 200 → `handleGrade` widzi `remaining.length === 0` (`ReviewSession.tsx:177`) →
  `await loadQueue(nextReviewed)` (`:179`) odpytuje `GET /api/reviews`; jeśli ten refetch padnie,
  `setStatus("error")` renderuje destrukcyjny `Alert` (`:282`), a tekst karty znika. Test jest wtedy
  zielony, a użytkownik widzi „Coś poszło nie tak". `waitForResponse` z `:113-115` filtruje po
  metodzie POST, więc tego drugiego GET-a nie obejmuje. Ironia jest istotna: cała Faza 2 powstała
  wokół reguły „nie asertuj czegoś, co da się spełnić z niewłaściwego powodu", a ostatnia linia
  specu łamie tę regułę w drugą stronę.
- **Fix**: Dołożyć jedną pozytywną asercję, która odróżnia stan „skończone" od „błąd" i nadal omija
  liczniki odrzucone w komentarzu — `await expect(session.getByRole("link", { name: "Wróć do talii" })).toBeVisible();`.
  Ten link istnieje w EmptyState dla `empty` i `finished` (`ReviewSession.tsx:260-280`), a nie
  istnieje ani na gałęzi błędu, ani w trakcie sesji.
- **Decision**: FIXED — dołożona pozytywna asercja `getByRole("link", { name: "Wróć do talii" })`, odróżniająca `finished` od gałęzi błędu. Zweryfikowane w źródle: link istnieje wyłącznie w EmptyState `empty`/`finished` (`ReviewSession.tsx:260-280`), gałąź błędu ma `Spróbuj ponownie`.

### F4 — Hook sprzątający porzuca fiszkę przy nieudanym DELETE i nie podaje jej id

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `tests/e2e/critical-loop.spec.ts:21-34`
- **Detail**: `expect(deleted.ok(), …).toBe(true)` w `:30` rzuca przed `createdId = null` w `:32`.
  Fiszka zostaje, a że utworzona przez `/deck` jest wymagalna natychmiast, staje na czele kolejki
  i wywala warunek wstępny z `:53` każdemu następnemu przebiegowi na tym koncie. Komunikat podaje
  status i ciało odpowiedzi, ale **nie `createdId`**, więc nikt nie znajdzie sieroty, żeby usunąć ją
  ręcznie. To dokładnie ten scenariusz zatrucia konta, przed którym hook miał chronić — obsłużony
  dla ścieżki nieudanej asercji, nieobsłużony dla nieudanego DELETE.
- **Fix**: Ponawiać kasowanie zamiast asertować raz
  (`await expect.poll(async () => (await page.request.delete(...)).status()).toBe(200)`) i wstawić
  `createdId` do komunikatu awarii.
- **Decision**: FIXED — uchwyty zerowane przed kasowaniem, DELETE ponawiany do 3 razy, komunikat awarii niesie `createdId` oraz ostatni status i ciało odpowiedzi.

### F5 — Komentarze w `ci.yml` nadal każą dodać required status checks

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `.github/workflows/ci.yml:31-32` (db-tests), `:54-55` (e2e)
- **Detail**: Korekta z Fazy 4 nie przeszła do pliku workflow. Oba komentarze wciąż instruują
  „dodaj `db-tests` / `e2e` do required status checks gałęzi master w repo Settings → Branches",
  podczas gdy `test-plan.md` §5, §6.4 i §7 oraz nowa sekcja CI w README stwierdzają, że branch
  protection zwraca na tym repo 403 i że wcześniejszy zapis o `db-tests` był nieprawdziwy. §6.4
  wprost oznacza komentarz w workflow jako niewykonalny, a mimo to zostawia go bez zmian.
  Kontrybutor czytający workflow dostaje wycofaną instrukcję.
- **Fix**: Przeredagować oba komentarze na warunkowe — „gdy branch protection stanie się dostępna na
  planie tego repo, dodaj … do required status checks" — żeby workflow i dokumentacja mówiły to samo.
- **Decision**: FIXED — oba komentarze przeredagowane na warunkowe (`once the repo goes public or the plan is upgraded`), z odesłaniem do `context/foundation/test-plan.md` §7.

### F6 — Workflow bez `permissions:`; job `e2e` twardo pada na PR-ach z forka

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml:1-8`, `:61`, `:105-106`
- **Detail**: Dwie rzeczy, które są nieszkodliwe w prywatnym repo i przestają być takie po flipie na
  publiczne — a flip jest w planach. (a) Nigdzie nie ma bloku `permissions:`, więc `GITHUB_TOKEN`
  dziedziczy domyślne uprawnienia repozytorium; `actions/checkout@v4` domyślnie zapisuje ten token
  do `.git/config`, a `ci` i `e2e` wołają `npm ci`, które wykonuje skrypty lifecycle z `package.json`
  przysłanego w PR. (b) Trigger to `pull_request` (słusznie — `pull_request_target` byłby groźny),
  więc PR-y z forków nie dostają sekretów; strażnicy z `:105-106` robią wtedy `exit 1` z komunikatem
  „Brak sekretu E2E_USERNAME w ustawieniach repozytorium", co dla kontrybutora z zewnątrz jest
  myląca czerwona bramka, której nie da się naprawić.
- **Fix A ⭐ Recommended**: Dodać `permissions: contents: read` na poziomie workflow,
  `persist-credentials: false` na krokach checkout w `db-tests`/`e2e`, a job `e2e` zawęzić do
  `github.event.pull_request.head.repo.full_name == github.repository`.
  - Strength: Zamyka obie sprawy przed flipem, żadna nie wpływa na obecne zielone przebiegi.
  - Tradeoff: PR-y z forków przestają mieć pokrycie e2e — świadomy koszt, standardowy dla bramek
    wymagających sekretów.
  - Confidence: HIGH — `contents: read` wystarcza wszystkim trzem jobom; żaden nie pisze do repo.
  - Blind spot: Nie sprawdziłem domyślnych uprawnień workflow ustawionych na tym koncie.
- **Fix B**: Odłożyć do momentu, w którym migracja na publiczne faktycznie się zacznie, i wpisać to
  jako punkt kontrolny w checkliście migracji.
  - Strength: Nie utwardza czegoś, co dziś nie jest wystawione; trzyma zmianę przy decyzji, która ją
    uzasadnia.
  - Tradeoff: Ryzyko, że przy flipie ktoś o tym zapomni — a flip jest właśnie momentem, w którym
    koszt pomyłki jest największy.
  - Confidence: MEDIUM — zależy wyłącznie od dyscypliny checklisty.
  - Blind spot: Brak.
- **Decision**: FIXED via Fix A — `permissions: contents: read` na poziomie workflow, `persist-credentials: false` na checkoutach `db-tests`/`e2e`, job `e2e` zawężony do PR-ów z tego samego repozytorium.

### F7 — Rozjazd wersji Supabase CLI między CI a lokalnym

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `package-lock.json` (supabase 2.109.1) vs `.github/workflows/ci.yml:44,76` (2.117.0)
- **Detail**: Komentarz w `:37-41` argumentuje, że oba piny w CI muszą się zgadzać, „bo oba czytają
  ten sam `config.toml`". Identyczny argument dotyczy CLI, którym deweloperzy faktycznie wołają
  `npm run db:test` i README-owe `npx supabase start` — a to trzecia, jeszcze inna wersja. To ten sam
  rodzaj cichej pułapki, która w Fazie 3 kosztowała commit `ac2b965`.
- **Fix**: Podnieść `supabase` w `package.json` do `2.117.0`, albo dopisać do komentarza, dlaczego
  lokalny rozjazd jest tolerowany.
- **Decision**: FIXED — `supabase` w `package.json` podniesiony z `^2.23.4` do `^2.117.0` (lock: 2.117.0, zgodnie z pinem CI). Zmiana w locku ograniczona do `supabase`, jego binarek per-platforma i tranzytywnego `jose`. Komentarz w `ci.yml` wspomina teraz o utrzymywaniu tego progu.

### F8 — `aria-label` regionu dubluje `<h1>` bezpośrednio w nim

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/review/ReviewSession.tsx:248-249`
- **Detail**: Czytnik ekranu ogłosi „Sesja powtórkowa, region", a zaraz potem „Sesja powtórkowa,
  nagłówek". `FlashcardCollection`, z którego wzięty jest wzorzec, nie ma wewnątrz nagłówka o tej
  samej treści — wzorzec zastosowano do przypadku, pod który nie był kształtowany.
- **Fix**: `aria-labelledby` wskazujące na `<h1>` z `id` daje identyczny uchwyt
  `getByRole("region", { name: "Sesja powtórkowa" })` bez podwójnego ogłoszenia.
- **Decision**: FIXED — `aria-label` zastąpiony przez `aria-labelledby` wskazujące na `<h1 id="review-session-heading">`. Test regionu nadal zielony (8/8), bo dostępny name się nie zmienił.

### F9 — `ci.yml` miesza języki komentarzy

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `.github/workflows/ci.yml`
- **Detail**: Istniejący komentarz `db-tests` (`:29-32`) i reszta pliku są po angielsku; wszystkie
  komentarze dodane przez tę zmianę (`:37-41, 51-60, 72-73, 79-81, 95-98, 116, 119-122, 129`) są po
  polsku — łącznie z liniami wciśniętymi w angielski blok `db-tests`. Komentarze w kodzie repo bywają
  polskie, więc konwencja nie jest jednolita, ale `ci.yml` do tej pory był, a to akurat plik, który
  plan każe czytać przez porównanie joba z jobem. Istotne też przy pytaniu o publiczne repo.
- **Fix**: Wybrać jeden język dla `ci.yml`.
- **Decision**: FIXED — `ci.yml` ujednolicony na angielski: komentarze, nazwy kroków i komunikaty `::error::`. YAML zweryfikowany parserem po przepisaniu.

### F10 — Brak `timeout-minutes` i `concurrency` w workflow

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml`
- **Detail**: Zablokowany job `e2e` (Docker + dev server + przeglądarka) pali domyślne 6 godzin
  runnera. Kolejne pushe do tego samego PR uruchamiają nakładające się stacki Supabase na osobnych
  runnerach. Przy `db-tests` istniało to wcześniej, ale `e2e` podwaja ekspozycję.
- **Fix**: `timeout-minutes: 20` na `e2e` plus workflow-level
  `concurrency: { group: "${{ github.workflow }}-${{ github.ref }}", cancel-in-progress: true }`.
- **Decision**: FIXED — `timeout-minutes: 20` na jobie `e2e` oraz `concurrency` z `cancel-in-progress: true` na poziomie workflow.

## Co wypadło czysto

- **Wierność planowi**: wszystkie punkty „Changes Required" z Faz 1–4 — MATCH. Spec realizuje
  wszystkie dziewięć kroków kontraktu w zadanej kolejności, łącznie z warunkiem wstępnym przed
  czymkolwiek innym, `toPass()` na obu pierwszych interakcjach z wyspą, asercją po własnym tekście
  karty i statusem 200 odczytanym przed DOM-em.
- **Dyscyplina zakresu**: wszystkie dziesięć granic z „What We're NOT Doing" utrzymane. Brak
  `page.route` w `tests/e2e/` (jedyne wystąpienie to komentarz wyjaśniający), brak stubu
  `/api/generations`, brak kotwic na `/generate`, `[PLACEHOLDER]` w `lessons.md` nietknięty, `src/`
  zmienione wyłącznie w dwóch plikach `ReviewSession`.
- **Zmiana nieplanowana**: `playwright.config.ts` (`workers: 1`) nie jest w żadnym „Changes Required",
  ale jest bezpośrednią konsekwencją projektu warunku wstępnego, opisaną sześcioma liniami komentarza
  w miejscu i powtórzoną w §6.6. To udokumentowana konsekwencja, nie cichy scope creep.
- **Bezpieczeństwo powłoki w CI**: zero interpolacji `${{ }}` wewnątrz bloków `run:`, każdy sekret
  wchodzi przez `env:`, każde rozwinięcie cytowane, ciało JSON budowane przez `jq -n --arg`.
  `::add-mask::` nałożone przed zapisem do `$GITHUB_ENV`. `supabase stop` pod `if: always()`
  w obu jobach.
- **Zgodność wzorców**: `ReviewSession.tsx:248` odwzorowuje `FlashcardCollection.tsx:224`
  dokładnie, a landmark obejmuje wszystkie gałęzie stanu — co jest właśnie tym, co czyni zakresowaną
  asercję z `:126` osadzoną, a nie trywialnie prawdziwą. Job `e2e` strukturalnie odbija `db-tests`,
  zgodnie z zamiarem planu.
