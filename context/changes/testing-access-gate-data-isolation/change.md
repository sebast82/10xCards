---
change_id: testing-access-gate-data-isolation
title: Testy bramki dostępu i izolacji danych w CI (rollout Phase 2 test-planu)
status: implemented
created: 2026-09-03
updated: 2026-09-04
archived_at: null
---

## Notes

Rollout Phase 2 of context/foundation/test-plan.md: "Bramka dostępu i izolacja danych w CI".
Risks covered: #2 (użytkownik odczytuje/modyfikuje fiszkę innego konta — sprawdzane "czy zalogowany", nie "czy właściciel" — IDOR), #4 (wylogowany/niezalogowany użytkownik dosięga chronionego ekranu lub endpointu zamiast przekierowania na logowanie).
Test types planned: integration na trasie API + testy polityk bazy (pgTAP) wpięte w CI + quality gates.
Risk response intent:
- #2: dowieść, że żądanie z sesją użytkownika B nie odczytuje ani nie zmienia rekordu użytkownika A, i że pozostaje to egzekwowane także gdy warstwa aplikacji zawiedzie; podważyć założenie "polityka bazy jest włączona, więc endpoint nie musi sprawdzać własności"; unikać zamockowania klienta bazy tak, że polityka nigdy się nie wykonuje.
- #4: dowieść, że żądanie bez ważnej sesji nigdy nie zwraca danych ani chronionego ekranu — zwraca przekierowanie albo odmowę, także przy wygasłej sesji; podważyć założenie "ekran renderuje login, więc endpoint też jest chroniony"; unikać testowania mechanizmu logowania dostawcy zamiast własnego bramkowania (patrz §7).
