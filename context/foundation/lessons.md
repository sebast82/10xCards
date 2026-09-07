# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Metryka deklarowana przez klienta nie jest metryką

- **Context:** `src/pages/api/flashcards.ts:17-22`, `src/lib/flashcards/service.ts:55` — `edited`
  przychodzi w ciele żądania i decyduje o `source = 'ai' | 'ai_edited'`, czyli o rozbiciu
  `accepted_unedited_count` / `accepted_edited_count`.
- **Problem:** Serwer nie przechowuje propozycji (świadoma decyzja prywatnościowa), więc nie potrafi
  zweryfikować ani treści, ani flagi `edited`. Klient może wysłać dowolny `front`/`back`
  z `edited: false` i zasilić licznik, na którym opiera się kryterium sukcesu PRD (75%).
  Miara wygląda jak pomiar, a jest deklaracją.
- **Rule:** Zanim uznasz pole za metrykę, sprawdź, kto je ustawia. Jeśli wartość pochodzi z ciała
  żądania i serwer nie ma jak jej podważyć, opisz ją jako self-reported w PRD/planie albo dorzuć
  serwerowy dowód (skrót, sygnaturę, stan po stronie serwera). Nie raportuj jej jako pomiaru.
- **Applies to:** Każde pole zasilające licznik lub KPI, przyjmowane z ciała żądania — w szczególności
  flagi typu `edited`, `source`, `manual` oraz wszystko, co trafia do `public.generations`.

## Osierocony wiersz `pending` po podwójnej awarii generowania

- **Context:** `src/lib/generations/service.ts:112-118` — `createGeneration` rezerwuje wiersz
  `generations` w stanie `pending`, potem woła `generateFlashcards`; przy awarii dostawcy wywołuje
  `markFailed`, a błąd samego `markFailed` jest połykany (`await` bez `try`/rzutu). Trasa zwraca wtedy
  oryginalny 502.
- **Problem:** Gdy `markFailed` też padnie, wiersz zostaje `pending` na zawsze. `assertWithinDailyLimit`
  liczy wszystkie wiersze z ostatnich 24h bez filtra po `status`, więc osierocone `pending` zjadają
  dobowy limit użytkownika i nikt tego nie sprząta. Żadne źródło (PRD, plan S-02) nie mówi, co ma się
  stać — test w `src/pages/api/generations.test.ts` przypina tylko obserwowalny kontrakt (502
  z oryginalnym błędem), nie naprawę.
- **Rule:** [PLACEHOLDER — uzupełnij: np. „Każdy licznik/limit liczony z wierszy rezerwowanych przed
  operacją zewnętrzną musi albo filtrować po stanie terminalnym, albo mieć ścieżkę sprzątania wierszy
  utkniętych w stanie nieterminalnym”]
- **Applies to:** [PLACEHOLDER — np. `public.generations` rezerwacje + `assertWithinDailyLimit`; każdy
  przyszły wzorzec „rezerwuj wiersz → wywołaj API → oznacz wynik”]

## Pierwsze kliknięcie w wyspę Astro ginie przed hydracją

- **Context:** `tests/e2e/seed.spec.ts:18-24`, `src/pages/deck.astro:35` — `FlashcardCollection`
  jest wyspą `client:load`. Playwright uznaje przycisk „Dodaj fiszkę" za actionable, bo SSR wysyła
  gotowy HTML; handler Reacta podpina się dopiero po hydracji.
- **Problem:** Klik trafia w martwy przycisk, nic się nie dzieje, a test wywala się dopiero
  30 s później na `fill()` w formularzu, którego nikt nie otworzył. Objaw wskazuje na złe locatory,
  przyczyna leży o krok wcześniej — i jest wyścigiem, więc znika przy debugowaniu na wolnej maszynie.
- **Rule:** Pierwsza interakcja z wyspą (`client:load`, `client:idle`, `client:visible`) po `page.goto()`
  musi być ponawialna — `expect(async () => { … }).toPass()`, z klikiem i asercją na widoczny skutek
  w środku bloku. Nigdy `waitForTimeout` i nigdy „samo kliknięcie" jako dowód, że stan się zmienił.
- **Applies to:** Każdy test e2e, którego pierwsza akcja dotyczy komponentu Reacta w `src/components/**`
  osadzonego w `.astro`; w szczególności `/deck`, `/generate`, `/review`.

## Tekst renderowany przez wyspę występuje w DOM dwa razy

- **Context:** `tests/e2e/seed.spec.ts:14-16,37,41-42` — `page.getByText("E2E przód 1788…")` trafiał
  w dwa węzły: `<p>` w karcie i `<code>` ze zserializowanymi propsami wyspy (`{"flashcards": …}`),
  które Astro wstawia do dokumentu na potrzeby hydracji.
- **Problem:** Strict mode violation zamiast asercji o treści. Odruchowa „naprawa" — `.first()`
  albo `.nth(0)` — przypina test do kolejności węzłów w DOM i cicho przestaje sprawdzać to, co miała:
  równie dobrze zielony byłby wtedy blob propsów bez wyrenderowanej karty.
- **Rule:** Asercje o danych przekazanych do wyspy zawężaj do kontenera po roli
  (`page.getByRole("region", { name: … })` — tu `aria-label="Kolekcja fiszek"`) i dodawaj
  `{ exact: true }`. Na strict mode violation szukaj właściwego zakresu, nie `.first()`.
- **Applies to:** Każda asercja `getByText` na treści, która jest jednocześnie propsem wyspy —
  fiszki na `/deck`, propozycje na `/generate`, karty na `/review`.

## Zapis przez API w teście e2e potrzebuje ciasteczek karty i nagłówka `Origin`

- **Context:** `tests/e2e/seed.spec.ts:45-50` — sprzątanie przez `DELETE /api/flashcards/:id`
  zwracało 403 „Cross-site DELETE form submissions are forbidden", mimo poprawnego `storageState`.
- **Problem:** Dwie niezależne przyczyny dające ten sam objaw. Fixture `request` ma własny kontekst
  sieciowy — startuje ze stanem z pliku i nie widzi ciasteczka sesji odświeżonego przez Supabase
  w trakcie testu. Do tego `APIRequestContext` nie dokłada nagłówka `Origin`, który przeglądarka
  wysyła sama, więc bramka origin w Astro klasyfikuje żądanie jako cross-site.
- **Rule:** Do zapisów w teście używaj `page.request` (dzieli ciasteczka z kartą), nie fixture'a
  `request`, i przekazuj `headers: { Origin: new URL(page.url()).origin }`. Asercję pisz z opisem
  niosącym status i ciało odpowiedzi — bez tego dostajesz gołe `expected true, received false`.
- **Applies to:** Każdy setup/teardown w e2e wołający `POST`/`PATCH`/`DELETE` na `/api/**`;
  ta sama para pułapek dotyczy przygotowywania danych przed testem, nie tylko sprzątania po nim.
