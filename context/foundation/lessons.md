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
