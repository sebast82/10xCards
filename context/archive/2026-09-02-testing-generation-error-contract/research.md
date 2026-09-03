---
date: 2026-09-02T22:10:00+02:00
researcher: Sebastian Urbański
git_commit: 223fb407c202890a3abc76f09845d53fc8e025e4
branch: master
repository: sebast82/10xCards
topic: "Faza 1 rolloutu testów — kontrakt błędów generowania (ryzyka #1 i #5)"
tags: [research, codebase, testing, openrouter, generations, error-contract, privacy, zdr, vitest]
status: complete
last_updated: 2026-09-02
last_updated_by: Sebastian Urbański
---

# Research: Kontrakt błędów generowania — ryzyka #1 i #5

**Date**: 2026-09-02T22:10:00+02:00
**Researcher**: Sebastian Urbański
**Git Commit**: `223fb40` (zsynchronizowany z `origin/master`)
**Branch**: `master`
**Repository**: `sebast82/10xCards`

## Research Question

Faza 1 rolloutu z [test-plan.md §3](context/foundation/test-plan.md): udowodnić, że każda klasa awarii
dostawcy kończy się **rozróżnialnym** błędem i **zerem zapisów**, a wklejony tekst źródłowy nie
przeżywa żądania. Zakres uzgodniony z właścicielem: trasa + skutki uboczne + warstwa UI; wybór
substratu dla testów „integration" pozostawiony temu researchowi.

## Summary

Sześć ustaleń, które przesądzają o kształcie planu.

1. **Oracle istnieje i jest mocny.** Drabina statusów, koperta błędu `{ error }`, zakaz `error.issues`
   i wymóg stałych komunikatów są zapisane *prescriptywnie* w [plan.md §Phase 4](context/archive/2026-08-25-first-gated-generation/plan.md)
   — tekst napisany **przed** kodem. Nie trzeba zgadywać ani przepisywać asercji z implementacji.
2. **Ryzyko #1 ma dwie twarze — jedna jest bezpieczna, druga była realna.** Słowo „limit" w opisie ryzyka
   czyta się dwojako. *Nasz* limit dobowy jest w pełni rozróżnialny (HTTP 429 + własny komunikat).
   *Limit dostawcy* (HTTP 429 od OpenRoutera) był **nieodróżnialny** od błędnego klucza (401) i awarii
   dostawcy (500) — wszystkie trzy dawały 502 i bajt w bajt ten sam komunikat. **Naprawione w trakcie
   researchu** (Q1 zamknięte, patrz §Zmiany wprowadzone w trakcie researchu).
3. **Cała granica HTTP do dostawcy jest nieprzetestowana.** Nie istnieje test dla `src/lib/openrouter/client.ts`.
   To plik, który posiada fallback ZDR, klasyfikację awarii i współdzielony budżet timeoutu.
   Przegląd S-02 sam to odnotował jako dług („zostaje na osobną zmianę") i ta zmiana nigdy nie powstała.
4. **Blokada techniczna istnieje, ale jest tańsza niż się wydaje.** `astro:env/server` nie rozwiązuje się
   pod Vitestem, przez co trasy `/api/generations` **nie da się dziś zaimportować w teście**.
   Zweryfikowane empirycznie: gołe `vi.mock("astro:env/server", …)` wystarcza — bez zmian w
   `vitest.config.ts`, bez aliasu, bez pliku fixture.
5. **Największa dziura po stronie UI jest utajona, nie aktywna.** [GenerateView.tsx](src/components/generate/GenerateView.tsx)
   renderuje odpowiedź `200 { proposals: [] }` jako ekran review z zerem kart — bez błędu, bez pustego
   stanu, bez przycisku ponowienia. To *dokładnie* scenariusz z ryzyka #1 („użytkownik widzi pustą listę").
   Dziś trzyma to wyłącznie serwerowy strażnik `no_proposals`. Klient nie ma własnej obrony.
6. **Ryzyko #5 jest w bardzo dobrym stanie i warto to potwierdzić, a nie zakładać.** Tekst źródłowy nie
   trafia nigdzie: brak kolumny, brak logów na ścieżce, wszystkie komunikaty stałe. Ochrona jest
   *strukturalna* (dwa CHECK-i w bazie) i *mechaniczna* (`no-console: error` na pięciu globach) — ale
   oba CHECK-i mają **zero pokrycia testami**.

---

## Detailed Findings

### 1. Oracle — co źródła *mówią*, że kod ma robić

Doktryna z [CLAUDE.md](CLAUDE.md) zakazuje wyprowadzania oczekiwań z implementacji. Poniżej wyłącznie
źródła prescriptywne, uporządkowane wg siły.

| Źródło | Siła | Co ustala |
|---|---|---|
| [prd.md §Non-Functional Requirements](context/foundation/prd.md) | najwyższa | Tekst źródłowy nie pozostaje w storage aplikacji po zakończeniu żądania |
| [plan.md §Phase 4 ▸ Endpoint](context/archive/2026-08-25-first-gated-generation/plan.md) | wysoka (napisane przed kodem) | Drabina: 401 → 503 → 400 (stały komunikat, **nigdy `error.issues`**) → 429 limit dobowy → 502 błąd modelu. Koperta `{ error: string }` obowiązuje wszystkie endpointy |
| [plan.md §Phase 3](context/archive/2026-08-25-first-gated-generation/plan.md) | wysoka | `finish_reason: "length"` to **osobna klasa** — bez niej komunikat byłby mylący; częściowo złe propozycje **nie** wywracają generowania; błąd rzucany tylko gdy nie zostaje ani jedna |
| [plan.md §Phase 3 ▸ 4](context/archive/2026-08-25-first-gated-generation/plan.md) | wysoka | Fallback ZDR: warunek ma obejmować **404 z ciałem wzmiankującym dostawcę**, nie dowolny 404. „Zbyt szeroki warunek zamieniłby każdy błąd 404 w ciche obniżenie prywatności" |
| [plan-brief.md §Key Decisions](context/archive/2026-08-25-first-gated-generation/plan-brief.md) | wysoka | „Ciche obniżenie gwarancji prywatności byłoby gorsze niż jej brak" — `privacyMode` musi być widoczny w odpowiedzi i w UI |
| [reviews/impl-review.md F1](context/archive/2026-08-25-first-gated-generation/reviews/impl-review.md) | średnia (decyzja z przeglądu) | Rezerwacja: nieudane, płatne wywołania **muszą** liczyć się do limitu, a awaryjność modelu musi być mierzalna bez logowania |
| [test-plan.md §2 Risk Response](context/foundation/test-plan.md) | wysoka (zaakceptowane przez zespół) | „Dla **każdej klasy awarii dostawcy** użytkownik dostaje rozróżnialny, nie-pusty komunikat, a do kolekcji nie trafia żadna propozycja" |

**Źródło, którego NIE wolno użyć jako oracle.** [prd.md](context/foundation/prd.md) nadal zawiera NFR
„pierwsze fiszki w ciągu 30 sekund … z ciągłym widocznym postępem … przyrostowo". To wymaganie zostało
**uchylone dla tego wydania** decyzją właściciela produktu z 2026-09-02 (commit `8daada6`,
[roadmap.md §Parked](context/foundation/roadmap.md)): S-06 `streaming-generation-progress` wycofane,
generowanie jest jednym blokującym żądaniem. PRD jest w tym punkcie nieaktualny i czeka na rewizję.
Test asertujący przyrostowe propozycje albo budżet 30 s testowałby wymaganie, które nie obowiązuje.

Konsekwencja dla kontraktu błędów: całe NFR 30 s sprowadza się do drabiny timeoutów
**45 s (serwer) < 60 s (klient) < ~100 s (próg 524 Cloudflare)** — udokumentowanej w
[impl-review.md F10](context/archive/2026-08-25-first-gated-generation/reviews/impl-review.md).

### 2. Mapa klas awarii — stan faktyczny wobec kontraktu

Z granicy dostawcy wychodzą **dwie** klasy błędów: `OpenRouterError` ([client.ts:30-40](src/lib/openrouter/client.ts#L30-L40))
i `GenerationParseError` ([parse.ts:19-27](src/lib/openrouter/parse.ts#L19-L27)). Trasa traktuje je
identycznie — obie → 502 ([generations.ts:70-72](src/pages/api/generations.ts#L70-L72)).

| # | Wyzwalacz | `code` | HTTP | Rozróżnialny? |
|---|---|---|---|---|
| A | DNS / odmowa połączenia / zerwanie w trakcie odczytu body ([client.ts:64-67](src/lib/openrouter/client.ts#L64-L67)) | `network` | 502 | ✅ własny komunikat |
| B | Wyczerpany budżet 45 s — `TimeoutError`/`AbortError` ([client.ts:65](src/lib/openrouter/client.ts#L65)) | `timeout` | 502 | ✅ własny komunikat |
| C1 | **Limit dostawcy** — HTTP 429 albo `error.metadata.error_type === "rate_limit_exceeded"` | `rate_limited` | 502 | ✅ **po naprawie z tego researchu** — własny komunikat „odczekaj chwilę" |
| C2 | Pozostałe non-OK: 401 zły klucz, 5xx, 404 spoza kontraktu ZDR | `upstream` | 502 | ✅ względem C1; 401 i 5xx nadal dzielą jeden komunikat (świadomie — patrz Q1) |
| D | HTTP 200, ale body nie jest JSON-em ([client.ts:93-98](src/lib/openrouter/client.ts#L93-L98)) | `upstream` | 502 | ⚠️ ten sam komunikat co C2; dodatkowo `status` błędu wynosi `200` |
| E | Brak `choices` / `choices: []` / `content` nie jest stringiem ([parse.ts:29-38](src/lib/openrouter/parse.ts#L29-L38)) | `malformed_response` | 502 | ✅ |
| F | `finish_reason === "length"` ([parse.ts:64-66](src/lib/openrouter/parse.ts#L64-L66)) | `truncated` | 502 | ✅ komunikat podpowiada skrócenie tekstu |
| G/H | `content` nie parsuje się jako JSON / brak tablicy `flashcards` ([parse.ts:47-53](src/lib/openrouter/parse.ts#L47-L53), [:68-71](src/lib/openrouter/parse.ts#L68-L71)) | `malformed_response` | 502 | ✅ (zbiorczo z E) |
| I | Ani jedna propozycja nie przeszła walidacji ([parse.ts:85-87](src/lib/openrouter/parse.ts#L85-L87)) | `no_proposals` | 502 | ✅ |
| J | Część propozycji poprawna, część nie ([parse.ts:74-83](src/lib/openrouter/parse.ts#L74-L83)) | — nie rzuca | 200 | ⚠️ ciche odrzucenie, zgodne z planem |

Poza granicą dostawcy trasa zwraca jeszcze: 401 bez sesji, 503 przy braku `supabase` **lub** klucza
(dwie przyczyny zlane w jeden status — [generations.ts:40-42](src/pages/api/generations.ts#L40-L42)),
400 przy złym ciele, **429 przy naszym limicie dobowym**, 500 przy `quota_check_failed`/`persist_failed`.

**Kluczowa obserwacja o `status`.** `OpenRouterError` *przenosi* prawdziwy status HTTP
([client.ts:38](src/lib/openrouter/client.ts#L38)) — zweryfikowałem to empirycznie: dla odpowiedzi 429
błąd niesie `code: "upstream"`, `status: 429`. Informacja **istnieje i jest poprawna**; gubi się dopiero
niżej, bo nikt jej nie czyta — [service.ts:70-78](src/lib/generations/service.ts#L70-L78) zapisuje wyłącznie
`caught.code`, a [generations.ts:70-72](src/pages/api/generations.ts#L70-L72) używa wyłącznie
`caught.message`. To czyni ewentualną naprawę tanią, ale jest to **zmiana zachowania, nie test**.

### 3. Fallback ZDR — najmocniejszy oracle w repozytorium, i jego luka

Plan S-02 rozstrzygnął tę kwestię wyjątkowo dokładnie: fallback jest jawny w kontrakcie funkcji,
**nie jest logowany** (zakaz `console.*` na tej ścieżce) i **nie jest zapisywany w bazie** —
„informacja żyje tyle, co odpowiedź". Uzasadnienie: „gdyby pula ZDR okazała się trwale pusta,
aplikacja działałaby miesiącami z nieobowiązującą gwarancją prywatności i nikt by się nie dowiedział".

Co zweryfikowałem empirycznie na stubie `fetch` (sonda usunięta po pomiarze):

- Retry odpala się przy 404 z ciałem pasującym do `/provider|endpoint|data policy/i` ([client.ts:12](src/lib/openrouter/client.ts#L12), [:84](src/lib/openrouter/client.ts#L84)); 404 bez dopasowania **nie** ponawia i daje `upstream` ze `status: 404`.
- Drugie żądanie ma usunięty wyłącznie klucz `zdr`; **`data_collection: "deny"` przeżywa fallback**.
- Oba żądania dostają **ten sam obiekt `AbortSignal`** — `calls[0][1].signal === calls[1][1].signal`. Kontrakt „jeden budżet na obie próby" ([client.ts:78-79](src/lib/openrouter/client.ts#L78-L79)) jest bezpośrednio obserwowalny, bez czekania 45 s.

**Ważne dla oracle**: „standard" **nie** znaczy „dostawca może swobodnie retencjonować". Znaczy „brak
trasy gwarantującej ZDR, nadal `data_collection: deny`". Test asertujący, że w trybie standard tekst
*jest* retencjonowany, asertowałby coś, czego kod nie twierdzi.

**Luka oracle — zamknięta w trakcie researchu.** Pierwotny regex `/provider|endpoint|data policy/i`
nie kodował żadnego udokumentowanego sygnału; plan S-02 zastrzegł „dopóki nie potwierdzone na żywym
kluczu…", a krok 9.5 jest odhaczony **bez zapisanego wyniku** (folder S-02 nie ma `manual-verification.md`,
choć S-03 i S-05 mają). Fixture napisany z tamtego regexu byłby podręcznikowym mirror testem.
Dokumentacja OpenRoutera rozstrzyga to bez żywego klucza — patrz §Zmiany wprowadzone w trakcie researchu.

Warto odnotować asymetrię, która łagodzi obawę planu: `privacyMode` przełącza się na `"standard"`
*w momencie wysłania* drugiego żądania ([client.ts:85](src/lib/openrouter/client.ts#L85)), a to żądanie
faktycznie nie zawiera `zdr`. Jeśli więc zbyt szeroki regex spowoduje niepotrzebny retry, etykieta
**nadal mówi prawdę** o tym, co poszło do dostawcy. Realny koszt zbyt szerokiego warunku to dodatkowe
płatne wywołanie, nie kłamstwo o prywatności. Kosztem zbyt wąskiego jest awaria tam, gdzie fallback
by pomógł.

### 4. Ryzyko #5 — co faktycznie może przeżyć żądanie

Trzy niezależne warstwy obrony, wszystkie w dobrym stanie:

**Baza.** `generations` nie ma kolumny na tekst ([20260824202259_flashcards_schema.sql:15-34](supabase/migrations/20260824202259_flashcards_schema.sql#L15-L34)).
Przechowuje `source_text_length` (integer) i `source_text_hash` (SHA-256), przy czym CHECK
`generations_source_text_hash_format` wymusza `^[0-9a-fA-F]{64}$` — kolumna **fizycznie nie pomieści prozy**.
Drugi CHECK, `generations_error_code_shape` (`^[a-z_]{1,40}$`,
[20260826140000_generation_reservation.sql:14-16](supabase/migrations/20260826140000_generation_reservation.sql#L14-L16)),
mechanicznie blokuje wpisanie *komunikatu* zamiast *kodu* — czyli zamyka drogę, którą tekst wejściowy
mógłby wyciec do bazy przez interpolowany błąd.

**Komunikaty.** Każde ciało błędu na trasie jest stałą albo szablonem interpolującym wyłącznie stałe
modułowe ([generations.ts:10-16](src/pages/api/generations.ts#L10-L16)). `parsed.error.issues`
**nigdy nie jest czytane** — `safeParse` konsumowane jest tylko przez `.success` i `.data`
([generations.ts:50-55](src/pages/api/generations.ts#L50-L55)). Żadne ciało odpowiedzi dostawcy nie
dociera do odpowiedzi HTTP: `outcome.body` jest czytane do regexu i `JSON.parse`, po czym porzucane.
`OpenRouterError` i `GenerationParseError` przyjmują wyłącznie `code`, nie mają `cause`.

**Logi.** Cztery wywołania `console.*` w całym `src/` — wszystkie poza ścieżką generowania, wszystkie
logujące wyłącznie kod błędu lub UUID ([flashcards/service.ts:110](src/lib/flashcards/service.ts#L110),
[:213](src/lib/flashcards/service.ts#L213), [reviews/service.ts:82](src/lib/reviews/service.ts#L82),
[:123](src/lib/reviews/service.ts#L123)). Egzekwuje to `no-console: "error"` na pięciu globach
([eslint.config.js:70-83](eslint.config.js#L70-L83)) z komentarzem „Ścieżki, przez które przechodzi
tekst źródłowy użytkownika". Zastrzeżenie: globalne `no-console` to nadal `warn`, a CI nie używa
`--max-warnings 0` — bramką jest wyłącznie te pięć globów.

**Czego to nie zamyka.** Hash SHA-256 krótkiego lub niskoentropijnego tekstu jest odwracalny słownikowo
i pozwala porównywać równość tekstów między kontami. Research S-02 sam to zauważył i **to jest powód
dolnego limitu długości wejścia**. Litera PRD („nie pozostaje w storage") jest spełniona; nigdzie
w dokumentach nie oceniono jednak samego hasha.

**Ustalenie o zapisach.** Na trasie `/api/generations` „zero propozycji w kolekcji" jest **prawdziwe
trywialnie** — moduł nie zawiera ani jednego odwołania do `flashcards`; akceptacja to osobne żądanie
`POST /api/flashcards` ([GenerateView.tsx:154-158](src/components/generate/GenerateView.tsx#L154-L158)).
Realny strażnik to `.eq("status", "succeeded")` w [flashcards/service.ts:64-69](src/lib/flashcards/service.ts#L64-L69),
i jest on **wyłącznie aplikacyjny** — FK nie ma predykatu na status, a migracja klamrująca
([20260826141500_clamp_generation_acceptance.sql:16-17](supabase/migrations/20260826141500_clamp_generation_acceptance.sql#L16-L17))
usunęła przypadkowy backstop, którym był pękający CHECK. To przesuwa wartościowy test z trasy
generowania na **drugie żądanie**.

### 5. Warstwa UI — gdzie rozróżnialność ginie

[GenerateView.tsx](src/components/generate/GenerateView.tsx) **nigdy nie sprawdza `response.status`**.
Wszystkie statusy 400/401/429/500/502/503 przechodzą przez te same trzy linie
([:109-113](src/components/generate/GenerateView.tsx#L109-L113)): weź `payload.error` dosłownie, ustaw
stan `error`, wyrenderuj jeden Alert.

**Konsekwencja dla planu**: komunikaty serwera **są całym kontraktem rozróżnialności**. Test UI
asertujący „ustawił się stan błędu" albo „`queryByRole("alert")` nie jest nullem" przeszedłby na zielono
po zwinięciu wszystkich awarii do jednego komunikatu — czyli byłby testem, który przechodzi po usunięciu
testowanego mechanizmu (reguła F-02). Asercje muszą trafiać w **dokładny tekst w DOM**.

Zachowanie brzegowe, uporządkowane:

| Sytuacja | Co widzi użytkownik |
|---|---|
| `!ok`, ciało nie-JSON / bez pola `error` / `error: ""` | Alert z fallbackiem „Coś poszło nie tak" — błąd, ale bez rozróżnienia przyczyny |
| `fetch` odrzucone (offline) | „Nie udało się połączyć z serwerem" |
| **Klientowy timeout 60 s** ([:104](src/components/generate/GenerateView.tsx#L104)) | **Ten sam** komunikat o braku połączenia — timeout jest etykietowany jako awaria sieci |
| 200 o złym kształcie | Alert ogólny — **dobrze**, zły kształt nie zamienia się w pustkę |
| **200 z `proposals: []`** | **Nagłówek „Propozycje", licznik „zapisano 0 z 0", zero kart. Brak błędu, brak pustego stanu, brak ponowienia.** |

Ostatni wiersz to literalnie scenariusz ryzyka #1. Jest dziś **utajony**, bo `parseGenerationResponse`
rzuca `no_proposals` zanim pusta tablica wyjdzie z serwera ([parse.ts:85-87](src/lib/openrouter/parse.ts#L85-L87)).
Klient nie ma własnej obrony — dowolna zmiana serwera przepuszczająca pustą tablicę odtworzy awarię po cichu.
`GenerateView` w ogóle nie importuje `EmptyState`.

Drobniejsze: `privacyMode` jest **koercjonowany, nie walidowany** —
`privacyMode === "standard" ? "standard" : "zdr"` ([:71](src/components/generate/GenerateView.tsx#L71)),
więc brakująca lub śmieciowa wartość po cichu staje się `"zdr"` i **wygasza ostrzeżenie o trybie standard**.
Test tego ostrzeżenia nie może przepisywać tego ternary.

### 6. Co jest technicznie możliwe — zweryfikowane, nie założone

Obie kluczowe niewiadome sprawdziłem uruchamiając sondy (usunięte; drzewo jest czyste).

**Blokada `astro:env/server` jest realna.** Import `src/pages/api/generations.ts` pod Vitestem kończy się
`ERR_MODULE_NOT_FOUND: Cannot find package 'astro:env/server'` ([generations.ts:2](src/pages/api/generations.ts#L2)).
`vitest.config.ts` nie ładuje żadnych pluginów, więc wirtualny moduł Astro nie istnieje.

**Obejście jest jednolinijkowe i wystarczające.** Zweryfikowane: samo
`vi.mock("astro:env/server", () => ({ OPENROUTER_API_KEY: "test-key" }))` na górze pliku testowego
rozwiązuje import. **Bez zmian w `vitest.config.ts`, bez aliasu, bez modułu fixture.**
Sparowane z `vi.hoisted` daje mutowalny klucz, więc gałąź 503 „brak konfiguracji" też jest testowalna.
Uruchomiłem na prawdziwym handlerze `POST` ścieżki 401 / 503 / 400 — przechodzą.

To nie jest złamanie reguły z [test-plan.md §4](context/foundation/test-plan.md) („mockowanie wyłącznie
na granicy sieci, nigdy modułów wewnętrznych"): `astro:env/server` to wirtualny moduł budowania,
dostarczany normalnie przez plugin Astro, a nie nasz kod.

**Seam sieciowy działa i jest w domowym stylu.** `vi.stubGlobal("fetch", …)` w pełni steruje
`client.ts` — `fetch` jest gołym globalem ([client.ts:52](src/lib/openrouter/client.ts#L52)), a funkcja
nie ma żadnego wstrzykiwanego zależnika. Przećwiczyłem klasy C, B, D, oba warianty 404 i asercję
współdzielonego sygnału — wszystkie przechodzą. Wzorzec istnieje już w repo:
[ReviewSession.test.tsx:18-25](src/components/review/ReviewSession.test.tsx#L18-L25) (`stubFetch` z
`mockResolvedValueOnce`) to właściwy model dla sekwencji ZDR.

Czego **nie** da się tanio przetestować: literalnej wartości 45 000 ms — `AbortSignal.timeout` używa
timera, którego fake timers Vitesta nie przechwytują, a stała nie jest eksportowana. Odnotowuję to jako
świadome wyłączenie, nie lukę.

**Zastrzeżenie środowiskowe**: testy dowodzą semantyki `DOMException` w Node 24, a produkcja to workerd
(`@astrojs/cloudflare`). Rozróżnienie `timeout` vs `network` opiera się na `error.name`
([client.ts:65](src/lib/openrouter/client.ts#L65)) i jest weryfikowane wyłącznie w Node.

**Konwencja testu trasy** ([flashcards.test.ts:12-27](src/pages/api/flashcards.test.ts#L12-L27)):
handler importowany jako zwykła funkcja i wołany bezpośrednio, `locals` jako goły literał
`{ user, supabase }`, prawdziwy `Request`, i **rzutowanie `as never`** jako furtka omijająca budowę
pełnego `APIContext`. Helper `context()` jest **kopiowany do każdego pliku**, nie współdzielony — to
udokumentowana konwencja projektu, nie zaniedbanie.

**Granice `SupabaseStub`** ([supabase-stub.ts](src/lib/test-support/supabase-stub.ts)): to rejestrator
wywołań, nie baza. Nie modeluje żadnych constraintów, nie zna RLS, nie robi kaskad, `rpc` jest no-opem,
a kolejka wyników jest **pozycyjna i współdzielona między `from()` i `rpc()`** — dorzucenie jednego
zapytania w serwisie przesuwa wszystkie późniejsze asercje. Stub potrafi natomiast dokładnie to, czego
potrzebuje ryzyko #1: `supabase.queries.every(q => q.table !== "flashcards")`.

**CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)): na PR biegną `astro check`, `lint`,
`vitest run`, `build`. **pgTAP nie jest krokiem CI** — `supabase test db` istnieje wyłącznie jako skrypt
`db:test`. Potwierdza to §4 test-planu. Pre-commit uruchamia tylko `lint-staged`; **testy nie biegną lokalnie
przed commitem**.

### 7. Istniejące pokrycie i luki

**To, co już jest** — 15 plików Vitest (~108 przypadków) plus 2 pgTAP. Wbrew brzmieniu
[test-plan.md §4](context/foundation/test-plan.md), baza testowa jest znacząca.

Najbliższe tej fazie:
- [parse.test.ts](src/lib/openrouter/parse.test.ts) — 11 przypadków, 8 negatywnych. **Bez mirror testów**:
  każda oczekiwana wartość to literał pisany ręcznie. Zawiera już asercję ryzyka #5
  ([:91](src/lib/openrouter/parse.test.ts#L91)) — sentinel z treści modelu nie pojawia się ani w
  `error.message`, ani w `JSON.stringify(error)`.
- [generations/service.test.ts](src/lib/generations/service.test.ts) — 6 przypadków, hermetyczne na stubie.
  Pokrywa limit dobowy, rezerwację przed wywołaniem modelu, hash zamiast tekstu, `status: 'failed'` + `error_code`.

**Luki, uporządkowane wg wartości:**

1. **`src/lib/openrouter/client.ts` — zero testów.** Klasy A, B, C, D, oba warianty 404, propagacja
   `privacyMode`, współdzielony sygnał, fallback `model`. Odnotowane w
   [impl-review.md F7](context/archive/2026-08-25-first-gated-generation/reviews/impl-review.md) jako dług
   („wymagałby wstrzykiwanego `fetch`, co zostaje na osobną zmianę") — dziś wiemy, że wstrzykiwanie nie jest potrzebne.
2. **`src/pages/api/generations.ts` — zero testów.** Cała drabina statusów i wszystkie stałe ciała błędu.
3. **`GenerateView` — zero testów.** W szczególności pusta tablica i „komunikat dociera do DOM".
4. **Oba CHECK-i anty-wyciekowe — zero pokrycia.** `supabase/tests/` nie wstawia wiersza ze `status`/`error_code`.
5. **Brak asercji, że `flashcards` nie jest dotykane** przy awarii — stub daje to tanio, po prostu nikt tego nie napisał.
6. **Gałęzie częściowej awarii** (§Open Questions Q3) — nietestowane.

**Anty-wzorzec do naprawienia, nie skopiowania.** [flashcards/service.test.ts:48](src/lib/flashcards/service.test.ts#L48)
asertuje, że *filtr `.eq("status","succeeded")` został przekazany* — czyli przepisuje implementację.
Test przeszedłby, gdyby filtr działał odwrotnie. Właściwa asercja to **wynik**: żądanie z `generationId`
generowania `failed` dostaje 404 i nie tworzy wiersza.

**Drugi anty-wzorzec do uniknięcia.** [generations/service.test.ts:6-11](src/lib/generations/service.test.ts#L6-L11)
mockuje *wewnętrzny* moduł `@/lib/openrouter/client`. Na poziomie serwisu to uzasadnione, ale
[test-plan.md §4](context/foundation/test-plan.md) wymaga mockowania wyłącznie na granicy sieci — a ta
granica jest teraz dostępna. Testy tej fazy powinny stubować `fetch`.

---

## Architecture Insights

- **Rozróżnialność jest własnością end-to-end, nie własnością warstwy.** Informacja o klasie awarii
  powstaje w `client.ts` (gdzie `status: 429` *istnieje*), jest redukowana do `code` w `service.ts`,
  do `message` w `generations.ts` i do jednego Alertu w `GenerateView`. Każda warstwa gubi trochę.
  Test na jednej warstwie nie dowodzi kontraktu — stąd trzy warstwy w rekomendacji poniżej.
- **Prywatność jest wymuszona strukturalnie, nie proceduralnie.** Brak kolumny + CHECK na kształt hasha
  + CHECK na kształt kodu błędu + ESLint na pięciu globach. To rzadki i bardzo dobry układ: mechanizmy,
  a nie obietnice. Właśnie dlatego warto je przetestować — mechanizm bez testu cofa się przy pierwszej migracji.
- **Sekwencja zapisu nie jest atomowa** — cztery niezależne round-tripy PostgREST, bez transakcji
  ([service.ts:81-141](src/lib/generations/service.ts#L81-L141)). Zgodnie z [CLAUDE.md](CLAUDE.md) to
  wskazanie na **testy hermetyczne dla gałęzi częściowej awarii**, nie na integracyjne wymuszanie błędu w środku sekwencji.
- **Nieudane generowania celowo kosztują limit.** Rezerwacja powstaje przed wywołaniem modelu, a licznik
  dobowy nie filtruje po `status` ([service.ts:54-58](src/lib/generations/service.ts#L54-L58)). To decyzja,
  nie błąd — ale sprawia, że osierocony wiersz `pending` jest realną szkodą (Q3).

---

## Zmiany wprowadzone w trakcie researchu

Research domknął dwa blokery zmianą w [client.ts](src/lib/openrouter/client.ts). Oba oparte na
dokumentacji dostawcy pobranej 2026-09-02, nie na kształcie implementacji.

### Q1 — `rate_limited` jako osobna klasa awarii

Źródło: [openrouter.ai/docs/api_reference/errors-and-debugging](https://openrouter.ai/docs/api_reference/errors-and-debugging).
Udokumentowana koperta błędu limitu:

```json
{ "error": { "code": 429, "message": "Rate limit exceeded",
  "metadata": { "error_type": "rate_limit_exceeded", "provider_code": "rate_limited" } } }
```

Dokumentacja nazywa `error.metadata.error_type` **kanonicznym, stabilnym** identyfikatorem kategorii,
przeznaczonym do programowego rozróżniania „rather than relying on HTTP status codes alone". Dlatego
detekcja sprawdza **oba** sygnały: status 429 **lub** `error_type === "rate_limit_exceeded"` — ten drugi
łapie limit zgłoszony pod innym statusem HTTP.

Kod `rate_limited` spełnia CHECK `generations_error_code_shape` (`^[a-z_]{1,40}$`), więc trafia do kolumny
`error_code` bez zmiany migracji. Mapowanie HTTP pozostaje **502**, zgodnie z oracle z planu S-02
(„błąd modelu → 502") — nasze 429 jest zarezerwowane dla limitu dobowego i zlanie ich w jeden status
zniweczyłoby rozróżnialność, którą ta zmiana wprowadza.

### Q2 — wykrycie braku trasy ZDR z udokumentowanego kształtu

Źródło: [openrouter.ai/docs/guides/features/router-metadata](https://openrouter.ai/docs/guides/features/router-metadata).
Gdy reguły filtrowania wykluczą wszystkie endpointy — a `provider.zdr: true` jest taką regułą — OpenRouter
zwraca 404 z komunikatem zaczynającym się od **„No allowed providers are available for the selected model."**
oraz `openrouter_metadata.attempt === 0` („the request never reached an external provider").

Detekcja parsuje teraz kopertę JSON i dopasowuje ten **zakotwiczony** prefiks, zamiast szukać
`/provider|endpoint|data policy/i` w surowym tekście. Zmiana **zawęża**, nie poszerza: udokumentowany
komunikat zawiera słowo „providers", więc stary regex też go łapał — ale łapał przy tym każdy 404
wzmiankujący „endpoint" (np. literówka w nazwie modelu), płacąc za to zbędnym płatnym wywołaniem.
Cytowana obawa planu S-02 („zbyt szeroki warunek zamieniłby każdy błąd 404 w ciche obniżenie
prywatności") jest tym zamknięta.

Odnotowana niepewność resztkowa: dokumentacja pokazuje wariant komunikatu dla `provider.only`, nie dla
`zdr`. Zdanie wiodące jest udokumentowane jako wspólne dla filtrowania jako takiego, ale wariantu ZDR
nie widziano dosłownie. Jedno żywe wywołanie z `zdr: true` na modelu bez trasy ZDR zamknęłoby to
ostatecznie — wartościowe, nieblokujące.

### Stan weryfikacji

Zmiana przeszła `npx astro check` (0 błędów), `npm run lint` i pełny `npm test` (15 plików, 112 testów).
Zachowanie zweryfikowałem tymczasową sondą na dziewięciu przypadkach zbudowanych z **ciał dokładnie
z dokumentacji** — w tym rozłączność czterech komunikatów, brak ponowienia dla `"Resource not found"`,
brak ponowienia dla 404 łapanego wcześniej po słowie „endpoint", odporność na 404 z ciałem nie-JSON
i brak wycieku tekstu źródłowego. Sonda została usunięta.

> **Wejście do P1**: ta zmiana jest dziś **bez trwałych testów** — sonda była narzędziem weryfikacji,
> nie artefaktem. `client.test.ts` z pakietu P1 musi objąć obie ścieżki, a fixture'y ma budować
> z ciał zacytowanych powyżej, nie z kształtu `client.ts`.

## Rekomendacja: dwie warstwy, cztery pakiety

Odpowiedź na delegowane pytanie o substrat: **realne lokalne Supabase nie jest tu potrzebne.**
Trasa generowania pisze wyłącznie do `generations`, a jedyne asercje, przy których stub kłamie, to
constrainty bazy — te wyrażają się **taniej i mocniej bezpośrednio w pgTAP** niż przez trasę HTTP.

| Pakiet | Warstwa | Substrat | Co dowodzi | Koszt |
|---|---|---|---|---|
| **P1** `client.test.ts` | unit / hermetyczny | `vi.stubGlobal("fetch")` | Klasy A–D rozróżnialne, w tym nowy `rate_limited` z obu sygnałów (status 429 i `error_type`); udokumentowany 404 ponawia bez `zdr` i zachowuje `data_collection`; `"Resource not found"` **nie** ponawia; jeden sygnał na obie próby; żaden błąd nie niesie tekstu źródłowego | najniższy, największy zysk — **pokrywa też zmianę z tego researchu** |
| **P2** `generations.test.ts` | integration trasy / hermetyczny | `vi.mock("astro:env/server")` + `SupabaseStub` + stub `fetch` | Pełna drabina 401/503/400/429/500/502; każde ciało błędu to stała; `error.issues` nigdy nie wychodzi; **żadne zapytanie nie dotyka `flashcards`** | niski |
| **P3** `GenerateView.test.tsx` | komponent / jsdom | pragma `// @vitest-environment jsdom` + `stubFetch` | Dokładny komunikat serwera dociera do DOM i **różni się** między klasami; `proposals: []` **nie** renderuje się jako review | niski |
| **P4** pgTAP | integration bazy / realny Postgres | `npm run db:test`, bramka ad hoc | `source_text_hash` odrzuca prozę; `error_code` odrzuca komunikat; `error_code` ⟺ `status='failed'` | średni (lokalna infra) |

P4 zostaje bramką ad hoc — CI wpina pgTAP dopiero Faza 2, zgodnie z
[test-plan.md §5](context/foundation/test-plan.md). Nie należy tego wyprzedzać w tej fazie.

Kandydat na piąty pakiet, świadomie **odłożony do Fazy 2**: „`POST /api/flashcards` odrzuca `generationId`
generowania `failed`/`pending`". To najmocniejszy dowód „zero propozycji w kolekcji", ale strażnik jest
aplikacyjny i splata się z własnością rekordu — czyli z ryzykiem #2, które jest tematem Fazy 2.

---

## Code References

- [src/lib/openrouter/client.ts:75-106](src/lib/openrouter/client.ts#L75-L106) — `generateFlashcards`: sekwencja ZDR, współdzielony sygnał, klasyfikacja
- [src/lib/openrouter/client.ts:12](src/lib/openrouter/client.ts#L12) — `ZDR_ROUTE_MISSING`, nieugruntowany w dokumentacji dostawcy
- [src/lib/openrouter/parse.ts:55-88](src/lib/openrouter/parse.ts#L55-L88) — kontrakt parsowania; nigdy nie zwraca pustej tablicy
- [src/lib/generations/service.ts:81-141](src/lib/generations/service.ts#L81-L141) — cztery nieatomowe operacje
- [src/lib/generations/service.ts:77-79](src/lib/generations/service.ts#L77-L79) — `markFailed` **porzuca błąd update'u**
- [src/pages/api/generations.ts:10-16](src/pages/api/generations.ts#L10-L16) — zamrożone komunikaty
- [src/pages/api/generations.ts:65-75](src/pages/api/generations.ts#L65-L75) — mapowanie wyjątków na statusy
- [src/components/generate/GenerateView.tsx:109-113](src/components/generate/GenerateView.tsx#L109-L113) — status HTTP nigdy nie sprawdzany
- [src/components/generate/GenerateView.tsx:243-259](src/components/generate/GenerateView.tsx#L243-L259) — ekran review renderowany dla pustej tablicy
- [supabase/migrations/20260826140000_generation_reservation.sql:14-20](supabase/migrations/20260826140000_generation_reservation.sql#L14-L20) — CHECK-i na kształt `error_code`
- [src/lib/test-support/supabase-stub.ts:106-119](src/lib/test-support/supabase-stub.ts#L106-L119) — `from`/`rpc`/`asClient`
- [src/pages/api/flashcards.test.ts:12-27](src/pages/api/flashcards.test.ts#L12-L27) — konwencja `context()` z `as never`
- [src/components/review/ReviewSession.test.tsx:14-30](src/components/review/ReviewSession.test.tsx#L14-L30) — `jsonResponse` + `stubFetch` + teardown

## Historical Context (from prior changes)

- [context/archive/2026-08-25-first-gated-generation/plan.md](context/archive/2026-08-25-first-gated-generation/plan.md) — źródło drabiny statusów, koperty błędu, reguły stałych komunikatów i kontraktu fallbacku ZDR
- [context/archive/2026-08-25-first-gated-generation/research.md](context/archive/2026-08-25-first-gated-generation/research.md) §5 — pięć zamknięć wycieku tekstu (Z1–Z6), w tym uzasadnienie dolnego limitu długości wejścia
- [context/archive/2026-08-25-first-gated-generation/reviews/impl-review.md](context/archive/2026-08-25-first-gated-generation/reviews/impl-review.md) — F1 (rezerwacja), F7 (`client.ts` bez testów — dług nigdy niespłacony), F9 (KPI self-reported), F10 (drabina timeoutów)
- [context/archive/2026-08-24-flashcards-schema-isolation/reviews/impl-review.md](context/archive/2026-08-24-flashcards-schema-isolation/reviews/impl-review.md) — F1: „test, który przechodzi po usunięciu testowanego mechanizmu, nie jest testem"; F2: granty `authenticated` w chmurze **nadal otwarte**
- [context/foundation/roadmap.md §Parked](context/foundation/roadmap.md) — S-06 wycofane 2026-09-02; NFR 30 s nie obowiązuje w tym wydaniu
- [context/foundation/lessons.md](context/foundation/lessons.md) — „Metryka deklarowana przez klienta nie jest metryką"; dotyczy `edited` na ścieżce akceptacji, nie samego generowania

**Dryf rejestru do odnotowania** (poza zakresem tej fazy): [docs/reference/contract-surfaces.md](docs/reference/contract-surfaces.md)
nie zawiera kolumn `status` i `error_code`, nadal opisuje `/api/flashcards/:id` jako `proponowane`
i zawiera martwą linię o S-06.

## Related Research

- [context/archive/2026-09-01-srs-review-session/research.md](context/archive/2026-09-01-srs-review-session/research.md) §4.1–4.2 — anatomia endpointu i konwencja klas błędów z polem `code`
- [context/archive/2026-08-24-flashcards-schema-isolation/](context/archive/2026-08-24-flashcards-schema-isolation/) — izolacja danych, wejście do Fazy 2

## Open Questions

Q1 i Q2 zostały **rozstrzygnięte i wdrożone** w trakcie tego researchu (decyzja właściciela, 2026-09-02).
Q3 i Q4 pozostają otwarte.

**Q1 — Czy limit dostawcy ma być rozróżnialny od 401 i 5xx? → TAK, wdrożone.**
[test-plan.md §2](context/foundation/test-plan.md) mówi „dla **każdej klasy awarii dostawcy** rozróżnialny
komunikat", a ryzyko #1 wprost wymienia „limit". Dochodzi kod `rate_limited` i czwarty komunikat.
**Zakres świadomie ograniczony**: 401 (zły klucz) i 5xx nadal dzielą komunikat `upstream`. Obie te
sytuacje są awariami po stronie operatora, na które użytkownik nie ma wpływu i reaguje tak samo
(ponów później) — rozdzielanie ich dawałoby rozróżnialność bez różnicy w działaniu. Limit jest inny:
niesie konkretną instrukcję („odczekaj"), której pozostałe nie niosą.

**Q2 — Jak wygląda odpowiedź przy braku trasy ZDR? → Ugruntowane w dokumentacji, wdrożone.**
Odpowiedź nie wymagała żywego klucza. Szczegóły i cytaty w sekcji poniżej.

**Q3 — Co ma się stać, gdy `markFailed` sam zawiedzie?** *(nieblokujące — można obejść zakresem)*
[service.ts:77-79](src/lib/generations/service.ts#L77-L79) nie sprawdza błędu update'u. Jeśli dostawca
padnie i ten update też padnie, wiersz zostaje `pending` **na zawsze**: liczy się do limitu dobowego
i jest nieodróżnialny od żądania w locie. Nie ma reapera ani crona. Żadne źródło nie mówi, co powinno
się stać. Uwaga: intencja rezerwacji z F1 („awaryjność modelu musi być mierzalna bez logowania") jest
tu **wprost naruszona**. Do czasu decyzji P2 może asertować wyłącznie obserwowalny kontrakt — oryginalny
błąd jest przerzucany dalej i użytkownik dostaje 502.

**Q4 — Czy fallback do trybu standard ma zostawiać ślad po stronie serwera?**
Plan S-02 świadomie zdecydował „nie" (informacja żyje tyle, co odpowiedź) i uzasadnił to.
Ale ten sam plan bał się scenariusza „pula ZDR trwale pusta, nikt się nie dowie" — a jedyną obroną jest
dziś ulotny tekst w UI, który znika po odświeżeniu. To spójna decyzja, nie błąd; odnotowuję ją
jako świadomie przyjęte ryzyko, do rewizji tylko jeśli Q2 wykaże, że fallback włącza się często.
