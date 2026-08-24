---
change_id: srs-algorithm-contract
title: Kontrakt algorytmu powtórek i stanu harmonogramu
status: implementing
created: 2026-08-23
updated: 2026-08-24
archived_at: null
---

## Notes

Roadmap F-01. Wybór gotowej biblioteki spaced repetition i spisanie kontraktu stanu, który musi nieść każda fiszka, żeby sesja nauki (S-05) umiała wyznaczyć termin kolejnego pokazania i zaktualizować go po ocenie.

Zakres decyzyjny, nie implementacyjny — sam algorytm wdraża S-05 `srs-review-session`.

Research zewnętrzny (Exa MCP) w `srs-library-research.md`: porównanie kandydatów, rekomendacja `ts-fsrs`, kontrakt stanu per fiszka, konsekwencje dla schematu w F-02.

Research wewnętrzny (`/10x-research`) w `research.md` (2026-08-23): `ts-fsrs@5.4.1` (FSRS-6.0) potwierdzony empirycznie na `workerd` przez `wrangler dev`, ~1,25 µs na przeliczenie karty. Zależność dodana do `package.json`. Osiem decyzji do rozstrzygnięcia przed migracją F-02.

Wyciąg z API biblioteki: `ts-fsrs-api-doc.md`.

Plan (2026-08-24) w `plan.md`, streszczenie w `plan-brief.md`. Wszystkie osiem decyzji z `research.md` §6 rozstrzygniętych — tabela w `plan.md` §Implementation Approach. Zakres: moduł `src/lib/srs/` jako wykonywalny kontrakt, Vitest pod guardrail PRD, nazwy kolumn i typy w `docs/reference/contract-surfaces.md`.

Kontrakt nazw danych, ochrona endpointów domenowych i polityka Node są zapisane w rejestrze oraz README; F-01 jest gotowe do domknięcia po weryfikacji Fazy 3.
