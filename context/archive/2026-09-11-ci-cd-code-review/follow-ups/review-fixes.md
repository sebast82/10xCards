# Follow-ups: ci-cd-code-review

Queued from the implementation review (`reviews/impl-review.md`).

## F1 — Skalibrować ocenę `security` zanim etykiety zaczną coś znaczyć

- **Skąd:** check 3.2 planu nie przeszedł. PR #20 (zamknięty) niósł dwie zaszyte podatności —
  flagę CLI `--diff-ref` interpolowaną do `execSync` oraz krok workflow wstawiający
  `${{ github.event.pull_request.title }}` do `run:` (GHA script injection, na znaku 9 358 diffa,
  czyli dobrze wewnątrz okna 60 000). Model ocenił `security` na 7 i 6, PR dostał `ai-cr:passed`.
- **Czego to NIE jest:** błędu w `computeVerdict`. Próg (`average ≥ 7` + `security ≥ 6`) działa
  zgodnie ze specyfikacją; problem leży w tym, co model wstawia do `scores.security`.
- **Doraźnie (zrobione w impl-review):** stopka komentarza PR mówi wprost, że ocena `security`
  jest nieskalibrowana i nie zastępuje przeglądu bezpieczeństwa
  (`packages/code-reviewer/src/format.ts`).
- **Do zrobienia:**
  - Twarde kotwice w `REVIEWER_INSTRUCTIONS` dla klasy „niezaufane wejście dociera do powłoki /
    interpretera" — np. „untrusted input reaching a shell, `eval`, or a GHA `run:` block = security ≤ 3".
  - Zestaw fixtur eval z zaszytymi podatnościami (GHA script injection, command injection, wyciek
    sekretu w logach) + asercja, że każda schodzi poniżej progu `PASS_THRESHOLDS.security`.
  - Sprawdzić, czy `reasoning: { effort: 'low' }` (`packages/code-reviewer/src/model.ts`, adaptacja
    z Fazy 1) współodpowiada za zaniżenie — porównać te same fixtury przy `low` i `medium`.
- **Do czasu zamknięcia:** `ai-cr:passed` pozostaje advisory i nie może trafić do required status
  checks (i tak zablokowane przez „What We're NOT Doing" w planie — self-attested build).
