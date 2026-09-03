---
change_id: testing-generation-error-contract
title: Kontrakt błędów generowania — rozróżnialne błędy dostawcy i brak wycieku tekstu źródłowego
status: implementing
created: 2026-09-02
updated: 2026-09-03
archived_at: null
---

## Notes

Rollout Phase 1 of `context/foundation/test-plan.md`: "Kontrakt błędów generowania".

Risks covered:
- **#1** — dostawca modelu zwraca zły kształt / timeout / limit, a użytkownik widzi pustą listę zamiast rozróżnialnego błędu.
- **#5** — wklejony tekst źródłowy przeżywa zadanie, które go przetworzyło: trafia do trwałego zapisu, logu albo treści błędu.

Test types planned: unit + integration.

Risk response intent:
- **#1**: udowodnić, że dla każdej klasy awarii dostawcy użytkownik dostaje rozróżnialny, nie-pusty komunikat, a do kolekcji nie trafia żadna propozycja.
- **#5**: udowodnić, że po zakończeniu generowania żaden trwały zapis ani treść błędu nie zawiera wklejonego tekstu.
