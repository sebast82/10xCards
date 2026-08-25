-- Rola anon nie ma czego szukać w tabelach użytkownika; RLS nie chroni przed TRUNCATE.
revoke all on public.flashcards from anon;
revoke all on public.generations from anon;

-- Powielał `due timestamptz not null` z tej samej definicji kolumny.
alter table public.flashcards drop constraint flashcards_due_required;
