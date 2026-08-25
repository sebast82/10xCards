---
change_id: flashcards-schema-isolation
title: Schemat fiszek i izolacja danych per użytkownik
status: done
created: 2026-08-24
updated: 2026-08-25
archived_at: null
---

## Notes

Lokalne fazy implementacji i weryfikacji F-02 są zakończone. Migracja została wdrożona zdalnie 2026-08-24, a historia lokalna i zdalna jest zgodna. Ręcznie potwierdzono obecność tabel, RLS z kompletem polityk oraz działanie logowania i wylogowania na wdrożonej instancji.

Przegląd implementacji 2026-08-25 (`reviews/impl-review.md`): 8 ustaleń, wszystkie naprawione. Wzmocniono asercje pgTAP, dodano migrację `20260825120802_revoke_anon_table_privileges.sql` (wypchnięta na chmurę 2026-08-25) i przywrócono asercję kontraktu typów z planu. Komplet kryteriów automatycznych i manualnych zamknięty.
