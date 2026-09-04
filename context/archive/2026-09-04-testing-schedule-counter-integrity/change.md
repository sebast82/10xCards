---
change_id: testing-schedule-counter-integrity
title: Test rollout Phase 3 — integrity of the review schedule and generation counters
status: archived
created: 2026-09-04
updated: 2026-09-04
archived_at: 2026-09-04T11:14:41Z
---

## Notes

Rollout Phase 3 of context/foundation/test-plan.md: "Integralność harmonogramu i liczników".

Risks covered:
- #3: sesja powtórkowa gubi/psuje stan harmonogramu — ocena nie zapisuje się lub wyznacza bezsensowny termin, użytkownik po cichu traci postęp.
- #6: liczniki akceptacji generacji rozjeżdżają się ze stanem kolekcji po edycji/usunięciu fiszki — kryterium "75%" raportuje liczbę nie do odtworzenia z danych.

Test types planned: unit + integration + testy procedur bazy.

Risk response intent:
- #3: udowodnić, że po ocenie stan harmonogramu fiszki zmienia się deterministycznie i trwale, a powtórna ocena tej samej fiszki nie tworzy stanu sprzecznego; przedmiotem testu jest własny kontrakt stanu, nie biblioteka.
- #6: udowodnić, że liczniki generacji dają się odtworzyć z aktualnego stanu kolekcji także po edycji i po usunięciu fiszki.
