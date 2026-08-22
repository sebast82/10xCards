---
project: "10xCards"
version: 1
status: draft
created: 2026-08-21
updated: 2026-08-21
prd_version: 2
main_goal: speed
top_blocker: time
---

# Roadmap: 10xCards

> Wyprowadzone z `context/foundation/prd.md` (v2) + automatycznie zbadanego stanu bazy kodu.
> Edytuj w miejscu; archiwizuj, gdy dokument zostanie zastąpiony.
> Elementy poniżej są ułożone w kolejności zależności. Tabela „W skrócie" jest indeksem.
> Ten dokument jest źródłem prawdy dla **sekwencji i uzasadnień**; stan wykonania żyje w GitHub Issues
> (`sebast82/10xCards`), dopasowywany po `Change ID`. Zmiana zakresu — najpierw tutaj, potem w issue.
> Ścieżki, endpointy i inne nazwy nośne celowo nie występują poniżej — mieszkają w
> `docs/reference/contract-surfaces.md`, żeby sekwencja przetrwała zmianę decyzji technicznych.

## Vision recap

Ręczne formatowanie materiału źródłowego w pary pytanie+odpowiedź zabiera więcej czasu niż sama nauka — to tarcie zniechęca do korzystania ze spaced repetition. 10xCards zdejmuje ten krok: użytkownik wkleja tekst, a AI proponuje gotowe fiszki.

Wyróżnik produktu — ta jedna cecha, której usunięcie sprawia, że produkt staje się nieodróżnialny od Anki czy Quizleta — to połączenie dwóch rzeczy: fiszki powstają z **własnego tekstu użytkownika**, ale żadna nie trafia do kolekcji **bez jego świadomej akceptacji**. Automat bez bramki akceptacji nie buduje zaufania; bramka bez automatu nie oszczędza czasu.

## North star

**S-02: użytkownik wkleja tekst, przegląda propozycje AI (akceptuj / edytuj / odrzuć) i widzi zaakceptowane fiszki w swojej kolekcji** — to jedyny krok, który weryfikuje główne kryterium sukcesu PRD („75% fiszek wygenerowanych przez AI jest akceptowane bez istotnych zmian"). Przy celu `speed` ustawiony tak wcześnie, jak pozwalają zależności: zaraz po schemacie danych i działającym logowaniu.

> „Gwiazda przewodnia" oznacza tu najmniejszy przepływ od końca do końca, którego udane dowiezienie udowadnia, że produkt ma sens — umieszczony możliwie wcześnie, bo wszystko inne ma znaczenie tylko wtedy, gdy on działa.

Deklaracja właściciela produktu brzmiała: gwiazdą jest **cała pętla** (rejestracja → generowanie → akceptacja i zapis → sesja powtórkowa). Pole „gwiazda przewodnia" opisuje pojedynczy przepływ, więc zapisano w nim S-02, a deklarację odwzorowano w sekwencji: wszystkie ogniwa pętli (S-01, S-02, S-03, S-04, S-05) poprzedzają jakąkolwiek pracę spoza niej. Poza pętlę wychodzi wyłącznie S-06, i to jako dociągnięcie wymagania niefunkcjonalnego do już działającego generowania.

## At a glance

| ID   | Change ID                        | Outcome (użytkownik może …)                                                       | Prerequisites | PRD refs                    | Status   |
| ---- | -------------------------------- | --------------------------------------------------------------------------------- | ------------- | --------------------------- | -------- |
| F-01 | `srs-algorithm-contract`         | (fundament) wybrany jest gotowy algorytm powtórek i kontrakt stanu, który niesie fiszka | —         | FR-009, Non-Goals, Success Criteria §Guardrails | ready |
| F-02 | `flashcards-schema-isolation`    | (fundament) fiszki mają trwały schemat ze znacznikiem pochodzenia, a każdy użytkownik widzi wyłącznie swoje | F-01          | Access Control, FR-008      | proposed |
| S-01 | `deployed-auth-baseline`         | zarejestrować się, zalogować i wylogować na wdrożonej instancji                     | —             | FR-001, FR-002, Access Control | done     |
| S-02 | `first-gated-generation`         | wkleić tekst, przejrzeć propozycje AI i zapisać zaakceptowane do swojej kolekcji    | F-02, S-01    | US-01, FR-003, FR-004, FR-008 | proposed |
| S-03 | `manual-card-edit-delete`        | poprawić treść zapisanej fiszki i usunąć zbędną                                     | S-02          | FR-006, FR-007              | proposed |
| S-04 | `manual-card-create`             | dodać własną fiszkę ręcznie, bez udziału AI                                         | S-02          | FR-005                      | proposed |
| S-05 | `srs-review-session`             | uruchomić sesję powtórkową i ocenić fiszki według algorytmu spaced repetition       | F-02, S-02    | FR-009, Success Criteria §Guardrails | proposed |
| S-06 | `streaming-generation-progress`  | widzieć pierwsze fiszki i postęp już w trakcie generowania, bez czekania na całość  | S-02          | US-01, FR-003, Non-Functional Requirements | proposed |

## Streams

Pomoc nawigacyjna — grupuje elementy dzielące ten sam łańcuch zależności. Kolejność wiążąca nadal wynika z grafu zależności poniżej; ta tabela to proponowana kolejność czytania w poprzek równoległych torów.

| Stream | Theme                     | Chain                                  | Note                                                                                            |
| ------ | ------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A      | Dostęp i wdrożenie        | `S-01`                                 | Domknięty — dostarcza reszcie roadmapy działającą instancję z sesją użytkownika. |
| B      | Pętla generowania         | `F-01` → `F-02` → `S-02` → `S-06`      | Ścieżka gwiazdy przewodniej; przy celu `speed` ma pierwszeństwo w każdym remisie.                 |
| C      | Zarządzanie kolekcją      | `S-03` / `S-04` (równolegle)            | Dołącza do Stream B w `S-02`; oba elementy niezależne od siebie.                                  |
| D      | Pętla nauki               | `S-05`                                 | Dołącza do Stream B w `S-02`, a kontrakt bierze z `F-01`; domyka pętlę zadeklarowaną przez właściciela produktu. |

## Baseline

Co jest już w bazie kodu na dzień `2026-08-21` (auto-research + potwierdzenie użytkownika).
Fundamenty poniżej zakładają obecność tych elementów i NIE budują ich ponownie.

- **Frontend:** present — Astro 7 + React 19 (wyspy), Tailwind 4, komponenty w `src/components/ui/`; strony `index`, `dashboard`, `auth/signin`, `auth/signup`, `auth/confirm-email`.
- **Backend / API:** partial — endpointy SSR istnieją tylko dla auth (`src/pages/api/auth/signin.ts`, `signup.ts`, `signout.ts`); brak endpointów domenowych (fiszki, generowanie).
- **Data:** absent — `supabase/config.toml` obecny, ale brak katalogu migracji, schematu i typów bazy.
- **Auth:** present — klient Supabase SSR (`src/lib/supabase.ts`), middleware chroniące `/dashboard` (`src/middleware.ts`), pełny cykl rejestracja/logowanie/wylogowanie w kodzie. Projekt Supabase w chmurze utworzony, sekrety `SUPABASE_URL` i `SUPABASE_KEY` ustawione na produkcji, rejestracja z potwierdzeniem email przetestowana na wdrożonej instancji (`context/changes/deployment/deployment-plan.md`, Faza 4).
- **Deploy / infra:** present — `wrangler.jsonc` (`nodejs_compat`, assets, observability); aplikacja wdrożona pod `https://10x-cards.sebger82.workers.dev`, auto-deploy na push do `master` przez Cloudflare Workers Builds. CI GitHub Actions robi lint + build (deploy celowo poza nim).
- **Observability:** partial — `observability.enabled` w konfiguracji Workers; brak biblioteki logowania i śledzenia błędów.

## Foundations

### F-01: Kontrakt algorytmu powtórek i stanu harmonogramu

- **Outcome:** (fundament) wybrany jest gotowy algorytm powtórek i spisany kontrakt stanu — jakie dane musi nieść każda fiszka, żeby sesja nauki umiała wyznaczyć termin jej kolejnego pokazania i zaktualizować go po ocenie.
- **Change ID:** `srs-algorithm-contract`
- **PRD refs:** FR-009, Non-Goals, Success Criteria §Guardrails
- **Unlocks:** F-02 (kształt pól harmonogramu w schemacie), S-05 (sesja powtórkowa); domyka niewiadomą „jakiego stanu wymaga fiszka, żeby dało się ją zaplanować", która bez tego wypłynęłaby dopiero przy S-05 — na fiszkach już zapisanych przez użytkownika
- **Prerequisites:** —
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:**
  - Czy wybrany algorytm trzyma stan wyłącznie per fiszka, czy potrzebuje też stanu per sesja lub per kolekcja? — Owner: user. Block: no (odpowiedź jest częścią dostarczanego kontraktu, nie warunkiem jego rozpoczęcia).
- **Risk:** Konsekwencje tej decyzji sięgają znacznie dalej niż sama sesja nauki, dlatego stoi przed schematem, a nie w nim. **(1)** Wyznacza pola harmonogramu w F-02 — podjęta dopiero przy S-05 oznacza migrację na fiszkach, które użytkownik już zapisał. **(2)** Wyznacza, co sesja zapisuje przy każdej ocenie, więc przesądza kształt interakcji w S-05, a nie tylko jej wnętrze. **(3)** PRD w Non-Goals zakazuje pisania własnego algorytmu, więc to wybór z gotowych rozwiązań i akceptacja ich modelu stanu — nie projektowanie od zera. **(4)** Warunek brzegowy PRD („mechanizm powtórek nie może zawieść, niezależnie od źródła fiszek") wyklucza kontrakt zakładający, że fiszka pochodzi z AI — po S-04 w kolekcji są oba rodzaje. Dodatkowe ograniczenie doboru: algorytm musi dać się uruchomić w docelowym środowisku serwerowym projektu, opisanym w `infrastructure.md`. Zakres celowo decyzyjny, nie implementacyjny — sam algorytm zostaje wdrożony w S-05; tutaj powstaje tylko ustalenie i kontrakt, żeby nie opóźniać gwiazdy przewodniej.
- **Status:** ready

### F-02: Schemat fiszek i izolacja danych per użytkownik

- **Outcome:** (fundament) fiszki mają trwały schemat w bazie — z polami stanu wynikającymi z kontraktu F-01 i ze znacznikiem pochodzenia (AI albo ręczne) — a polityka dostępu gwarantuje, że każdy użytkownik odczytuje i modyfikuje wyłącznie własne rekordy; typy bazy są dostępne w kodzie.
- **Change ID:** `flashcards-schema-isolation`
- **PRD refs:** Access Control, FR-008
- **Unlocks:** S-02 (zapis zaakceptowanych propozycji), S-03, S-04 (zarządzanie kolekcją), S-05 (odczyt i zapis stanu harmonogramu); domyka niewiadomą „gdzie żyją fiszki i kto je widzi" dla całej pętli
- **Prerequisites:** F-01
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sonda raportuje warstwę danych jako nieistniejącą, a wszystkie dziewięć wymagań koniecznych na niej stoi — zły kształt tabeli odkryty w połowie pętli to jedyna przeróbka, której termin 2026-08-31 nie wchłonie. Stąd zależność od F-01: pola harmonogramu wchodzą do schematu od razu, zanim użytkownik cokolwiek zapisze. Z tego samego powodu znacznik pochodzenia fiszki (decyzja z 2026-08-21) wchodzi tą samą migracją — dopisany później wymagałby przerobienia już zapisanych rekordów, a wstecz i tak nie da się odtworzyć pochodzenia. Zakres celowo wąski: tabela fiszek, polityka izolacji, typy — bez budowania „całej warstwy danych" z góry. Każdy kolejny element pętli i tak przechodzi przez tę warstwę pionowo.
- **Status:** proposed

## Slices

### S-01: Rejestracja i logowanie na wdrożonej instancji

- **Outcome:** użytkownik może założyć konto na email i hasło, zalogować się i wylogować na publicznie dostępnej instancji aplikacji, a niezalogowany trafia na ekran logowania.
- **Change ID:** `deployed-auth-baseline`
- **PRD refs:** FR-001, FR-002, Access Control
- **Prerequisites:** —
- **Parallel with:** F-01, F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Wdrożenie, sekrety produkcyjne i rejestracja z potwierdzeniem email zostały dowiezione w `context/changes/deployment/deployment-plan.md` (Fazy 1–4), a logowanie i wylogowanie potwierdzono na wdrożonej instancji 2026-08-21. Ryzyko, które ten element miał zdjąć — niespodzianki środowiska uruchomieniowego opisane w `infrastructure.md` (klient Supabase na workerd, cookies sesji za edge) — zostało zdjęte empirycznie, nie założeniowo. Każdy kolejny element pętli buduje już na sprawdzonym założeniu, że sesja użytkownika utrzymuje się na produkcji.
- **Status:** done

### S-02: Generowanie fiszek z wklejonego tekstu, przegląd i zapis do kolekcji

- **Outcome:** użytkownik może wkleić tekst źródłowy, zobaczyć listę propozycji fiszek w formacie pytanie+odpowiedź, każdą zaakceptować, poprawić przed zapisem albo odrzucić, a zaakceptowane zobaczyć na liście swojej kolekcji.
- **Change ID:** `first-gated-generation`
- **PRD refs:** US-01, FR-003, FR-004, FR-008
- **Prerequisites:** F-02, S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Który model przez OpenRouter i jaki kształt promptu daje 75% akceptacji bez istotnych zmian? — Owner: user. Block: no (start na dowolnym rozsądnym modelu; kryterium mierzy się na własnych tekstach po pierwszym uruchomieniu).
  - Jak zagwarantować, że wklejony tekst nie zostaje nigdzie po zakończeniu żądania (zakaz trwałego zapisu z wymagań niefunkcjonalnych) — również w logach? — Owner: user. Block: no.
- **Risk:** To jest gwiazda przewodnia i jednocześnie największa niewiadoma produktowa — jakości propozycji nie da się przewidzieć z PRD, tylko zmierzyć na własnym materiale. Sekwencjonowane zaraz po fundamencie i logowaniu, bo im później ten pomiar, tym mniej wieczorów zostaje na poprawę promptu. Odrzucone propozycje nie mogą trafiać do bazy — inaczej kryterium „75% fiszek w kolekcji pochodzi z AI" przestaje cokolwiek mierzyć.
- **Status:** proposed

### S-03: Poprawianie i usuwanie zapisanych fiszek

- **Outcome:** użytkownik może zmienić treść pytania lub odpowiedzi w zapisanej fiszce i trwale usunąć fiszkę ze swojej kolekcji.
- **Change ID:** `manual-card-edit-delete`
- **PRD refs:** FR-006, FR-007
- **Prerequisites:** S-02
- **Parallel with:** S-04, S-05, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Edycja po zapisie to inna operacja niż poprawka propozycji przed akceptacją z S-02 — jeśli obie trafią do jednego przebiegu, formularz zacznie obsługiwać dwa różne stany. Usuwanie jest nieodwracalne (PRD świadomie odrzucił soft delete), więc potwierdzenie akcji jest częścią zakresu, a nie ozdobnikiem.
- **Status:** proposed

### S-04: Ręczne tworzenie fiszki

- **Outcome:** użytkownik może dodać własną fiszkę (pytanie+odpowiedź) bez udziału AI i zobaczyć ją w kolekcji obok fiszek wygenerowanych.
- **Change ID:** `manual-card-create`
- **PRD refs:** FR-005
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-05, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Najmniejszy element pętli, świadomie po S-02: ręczne dodawanie korzysta z tego samego zapisu i tej samej listy, więc zbudowane po generowaniu nie tworzy drugiej ścieżki zapisu. Odwrotna kolejność oznaczałaby przerabianie formularza pod przepływ AI.
- **Status:** proposed

### S-05: Sesja powtórkowa z algorytmem spaced repetition

- **Outcome:** użytkownik może uruchomić sesję nauki, dostawać fiszki w kolejności wyznaczonej przez gotowy algorytm powtórek, oceniać swoją odpowiedź, a wynik oceny wpływa na termin kolejnego pokazania fiszki.
- **Change ID:** `srs-review-session`
- **PRD refs:** FR-009, Success Criteria §Guardrails
- **Prerequisites:** F-02, S-02
- **Parallel with:** S-03, S-04, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Kontrakt algorytmu i pola stanu przychodzą gotowe z F-01, więc ryzyko tego elementu nie leży już w wyborze rozwiązania, tylko w jego wpięciu. PRD stawia tu jedyny twardy warunek brzegowy: sesja nauki musi działać poprawnie niezależnie od źródła fiszek — po S-04 w kolekcji są zarówno fiszki z AI, jak i ręczne, i obie muszą wchodzić do harmonogramu tak samo. Domyka pętlę zadeklarowaną przez właściciela produktu, więc przy celu `speed` nie schodzi poniżej S-06 w kolejce.
- **Status:** proposed

### S-06: Przyrostowe pojawianie się fiszek i widoczny postęp generowania

- **Outcome:** użytkownik widzi pierwsze propozycje w ciągu 30 sekund od zlecenia i ciągły postęp generowania, a kolejne fiszki dochodzą przyrostowo — może zacząć przegląd, zanim generowanie się skończy.
- **Change ID:** `streaming-generation-progress`
- **PRD refs:** US-01, FR-003, Non-Functional Requirements
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-05
- **Blockers:** —
- **Unknowns:**
  - Czy limity środowiska (czas CPU, liczba podzapytań, równoległe połączenia wychodzące — opisane w `infrastructure.md`) pozwalają na przyrostowe dostarczanie bez zmiany planu hostingu? — Owner: user. Block: no.
- **Risk:** Świadomie oddzielone od S-02, żeby pomiar jakości propozycji nie czekał na strojenie strumieniowania. Jedyny element poza pętlą — przy celu `speed` i głównym ryzyku `time` to pierwszy kandydat do odłożenia, jeśli termin zacznie napierać: generowanie zbiorcze spełnia FR-003, tylko gorzej się go używa.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                       | Issue | Suggested issue title                                    | Ready for `/10x-plan` | Notes                                              |
| ---------- | ------------------------------- | ----- | -------------------------------------------------------- | --------------------- | -------------------------------------------------- |
| F-01       | `srs-algorithm-contract`        | #1    | Kontrakt algorytmu powtórek i stanu harmonogramu          | yes                   | `/10x-plan srs-algorithm-contract`                  |
| F-02       | `flashcards-schema-isolation`   | #2    | Schemat fiszek i izolacja danych per użytkownik           | no                    | Czeka na F-01 (pola harmonogramu)                   |
| S-01       | `deployed-auth-baseline`        | #3    | Rejestracja i logowanie na wdrożonej instancji            | done                  | Zweryfikowane na produkcji 2026-08-21; issue zamknięte |
| S-02       | `first-gated-generation`        | #4    | Generowanie fiszek z tekstu: przegląd, akceptacja, zapis  | no                    | Czeka na F-02 i S-01; gwiazda przewodnia            |
| S-03       | `manual-card-edit-delete`       | #5    | Poprawianie i usuwanie zapisanych fiszek                  | no                    | Czeka na S-02                                       |
| S-04       | `manual-card-create`            | #6    | Ręczne tworzenie fiszki                                   | no                    | Czeka na S-02                                       |
| S-05       | `srs-review-session`            | #7    | Sesja powtórkowa z algorytmem spaced repetition           | no                    | Czeka na F-02 i S-02; domyka pętlę                  |
| S-06       | `streaming-generation-progress` | #8    | Przyrostowe generowanie i widoczny postęp                 | no                    | Czeka na S-02; pierwszy kandydat do odłożenia       |

Kamienie milowe: F-01–S-05 w `MVP — pętla` (termin 2026-08-31), S-06 w `Bufor — do przycięcia`.

## Open Roadmap Questions

Brak otwartych pytań — oba rozstrzygnięto 2026-08-21.

**Rozstrzygnięte**

1. **Które metody logowania wdrożyć w MVP?** → **tylko email+hasło**. Pełny cykl jest już w kodzie, więc koszt zerowy; przy celu `speed` każda dodatkowa metoda to konfiguracja, która nie przybliża żadnego kryterium sukcesu. OAuth i logowanie bez hasła zostają w `## Parked`. Wpływ: S-01 potwierdza istniejącą ścieżkę, nie dodaje nowej. Issue #9 (zamknięte).
2. **Czy dane odróżniają fiszkę z AI od ręcznej?** → **tak, znacznik pochodzenia w tabeli fiszek**. Bez niego drugie kryterium sukcesu („75% kolekcji pochodzi z AI") jest niemierzalne, a pochodzenia nie da się odtworzyć wstecz. Wpływ: znacznik wchodzi tą samą migracją co reszta schematu w F-02, które wraca ze stanu `blocked` do `proposed`. Issue #10 (zamknięte).

## Parked

- **Własny, zaawansowany algorytm powtórek (SuperMemo, Anki)** — Why parked: PRD §Non-Goals; MVP korzysta z gotowej biblioteki, budowa własnego wykracza poza zakres i termin.
- **Import wielu formatów plików (PDF, DOCX)** — Why parked: PRD §Non-Goals; w MVP jedynym wejściem jest tekst wklejony kopiuj-wklej.
- **Współdzielenie zestawów fiszek między użytkownikami** — Why parked: PRD §Non-Goals; MVP jest narzędziem osobistym.
- **Integracje z platformami edukacyjnymi** — Why parked: PRD §Non-Goals; MVP jest samodzielną aplikacją.
- **Aplikacja mobilna** — Why parked: PRD §Non-Goals; na start tylko aplikacja webowa.
- **OAuth i logowanie bez hasła** — Why parked: decyzja z 2026-08-21 — MVP wdraża wyłącznie email+hasło, które jest już zaimplementowane. PRD dopuszcza dowolną z trzech metod, więc to zawężenie zakresu, nie odstępstwo od wymagań.
- **Śledzenie błędów i logowanie ponad to, co daje platforma** — Why parked: cel `speed`; wbudowana obserwowalność Workers jest już włączona i wystarcza przy skali `users: small`.

## Done

- **S-01: użytkownik może założyć konto na email i hasło, zalogować się i wylogować na wdrożonej instancji** — zweryfikowane 2026-08-21 na `https://10x-cards.sebger82.workers.dev` (rejestracja z potwierdzeniem email, logowanie, wylogowanie). Praca prowadzona w `context/changes/deployment/`; folder nie jest jeszcze zarchiwizowany — uruchom `/10x-archive`, gdy uznasz go za zamknięty. Issue #3. Lesson: —

(Kolejne wpisy dopisuje `/10x-archive` — i przestawia status elementu na `done` — gdy archiwizowana zmiana ma pasujący Change ID.)
