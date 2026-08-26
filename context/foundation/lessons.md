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
