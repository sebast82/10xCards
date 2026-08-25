---
change_id: first-gated-generation
title: Generowanie fiszek z wklejonego tekstu — przegląd, akceptacja, zapis
status: planned
created: 2026-08-25
updated: 2026-08-25
archived_at: null
---

## Notes

Roadmap S-02 (`context/foundation/roadmap.md`) — gwiazda przewodnia MVP.

Outcome: użytkownik wkleja tekst źródłowy, widzi listę propozycji fiszek (pytanie+odpowiedź),
każdą akceptuje / poprawia przed zapisem / odrzuca, a zaakceptowane trafiają do jego kolekcji.

- PRD refs: US-01, FR-003, FR-004, FR-008
- Prerequisites: F-02 (`flashcards-schema-isolation`), S-01 (`deployed-auth-baseline`) — oba `done`
- GitHub issue: #4
- Otwarte niewiadome (z roadmapy, obie nieblokujące):
  - Który model przez OpenRouter i jaki kształt promptu daje 75% akceptacji bez istotnych zmian?
  - Jak zagwarantować, że wklejony tekst nie zostaje nigdzie po zakończeniu żądania — również w logach?
- Twarde ograniczenie: odrzucone propozycje nie mogą trafiać do bazy.

## Artefakty

- `research.md` (2026-08-25) — obie niewiadome zamknięte rekomendacjami; pięć decyzji projektowych
  przeniesionych do `/10x-plan` (sekcja Open Questions).
- `plan.md` (2026-08-25) — 9 faz; wszystkie pięć decyzji z researchu rozstrzygniętych.
- `plan-brief.md` (2026-08-25) — dwustronicowe streszczenie z tabelą decyzji.
