-- Sibling do 20260825120802_revoke_anon_table_privileges.sql: tamta migracja odebrała
-- TRUNCATE/TRIGGER/REFERENCES roli `anon`, ale te same przywileje nadal trzymała rola
-- `authenticated` (odziedziczone z ALTER DEFAULT PRIVILEGES przy tworzeniu tabel). RLS nie
-- chroni przed TRUNCATE — uwierzytelniony użytkownik mógł skasować całą tabelę danych.
--
-- Odbieramy tylko przywileje destrukcyjne/schematowe; SELECT/INSERT/UPDATE/DELETE zostają —
-- to na nich stoi RLS. Forward-only, bez zmiany danych.
--
-- UWAGA: jak przy 20260825120802, ta migracja musi zostać wypchnięta na powiązany projekt
-- cloud osobnym `supabase db push` po zmergowaniu (schemat jest już na produkcji).
revoke truncate, trigger, references on public.flashcards from authenticated;
revoke truncate, trigger, references on public.generations from authenticated;
