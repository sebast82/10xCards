create extension if not exists pgtap;

begin;
select plan(7);

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'recount-a@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'recount-b@example.com')
on conflict (id) do nothing;

insert into public.generations (
  id, user_id, model, source_text_length, source_text_hash,
  generated_count, accepted_unedited_count, accepted_edited_count,
  generation_duration
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'google/gemini-2.5-flash',
    1200,
    repeat('a', 64),
    5,
    0,
    0,
    4100
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'google/gemini-2.5-flash',
    800,
    repeat('b', 64),
    2,
    0,
    0,
    3300
  );

insert into public.flashcards (
  id, user_id, generation_id, front, back, source,
  due, stability, difficulty, scheduled_days,
  learning_steps, reps, lapses, state, last_review
)
values
  ('20000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000001', 'Pytanie 1', 'Odpowiedz 1', 'ai',        '2026-08-26T12:00:00+00:00', 0, 5, 0, 0, 0, 0, 0, null),
  ('20000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000001', 'Pytanie 2', 'Odpowiedz 2', 'ai',        '2026-08-26T12:00:00+00:00', 0, 5, 0, 0, 0, 0, 0, null),
  ('20000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000001', 'Pytanie 3', 'Odpowiedz 3', 'ai_edited', '2026-08-26T12:00:00+00:00', 0, 5, 0, 0, 0, 0, 0, null),
  ('20000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000002', 'Pytanie 4', 'Odpowiedz 4', 'ai',        '2026-08-26T12:00:00+00:00', 0, 5, 0, 0, 0, 0, 0, null),
  ('20000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000002', 'Pytanie 5', 'Odpowiedz 5', 'ai_edited', '2026-08-26T12:00:00+00:00', 0, 5, 0, 0, 0, 0, 0, null);

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';

select public.recount_generation_acceptance('10000000-0000-4000-8000-000000000001');

select results_eq(
  $$ select accepted_unedited_count from public.generations where id = '10000000-0000-4000-8000-000000000001' $$,
  $$ values (2) $$,
  'accepted_unedited_count liczy fiszki o source = ai'
);

select results_eq(
  $$ select accepted_edited_count from public.generations where id = '10000000-0000-4000-8000-000000000001' $$,
  $$ values (1) $$,
  'accepted_edited_count liczy fiszki o source = ai_edited'
);

select public.recount_generation_acceptance('10000000-0000-4000-8000-000000000001');

select results_eq(
  $$
    select accepted_unedited_count, accepted_edited_count
    from public.generations
    where id = '10000000-0000-4000-8000-000000000001'
  $$,
  $$ values (2, 1) $$,
  'drugie wywolanie nie zmienia licznikow (przeliczanie, nie inkrementacja)'
);

select lives_ok(
  $$ select public.recount_generation_acceptance('10000000-0000-4000-8000-000000000002') $$,
  'przeliczenie do wartosci rownej generated_count nie lamie CHECK'
);

select results_eq(
  $$
    select accepted_unedited_count, accepted_edited_count
    from public.generations
    where id = '10000000-0000-4000-8000-000000000002'
  $$,
  $$ values (1, 1) $$,
  'liczniki na granicy generated_count maja wlasciwe wartosci'
);

-- Liczniki gen1 stają się nieaktualne: 3 x ai zamiast zapisanych 2.
-- Bez tego kroku wywołanie przez użytkownika B dałoby ten sam wynik również
-- dla wersji `security definer` — czyli asercja izolacji nie testowałaby niczego.
insert into public.flashcards (
  id, user_id, generation_id, front, back, source,
  due, stability, difficulty, scheduled_days,
  learning_steps, reps, lapses, state, last_review
)
values
  ('20000000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000001', 'Pytanie 6', 'Odpowiedz 6', 'ai', '2026-08-26T12:00:00+00:00', 0, 5, 0, 0, 0, 0, 0, null);

set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
select public.recount_generation_acceptance('10000000-0000-4000-8000-000000000001');

set local role postgres;

select results_eq(
  $$
    select accepted_unedited_count, accepted_edited_count
    from public.generations
    where id = '10000000-0000-4000-8000-000000000001'
  $$,
  $$ values (2, 1) $$,
  'wywolanie przez innego uzytkownika nie aktualizuje cudzych licznikow'
);

select ok(
  (
    select bool_and(accepted_unedited_count + accepted_edited_count <= generated_count)
    from public.generations
  ),
  'liczniki spelniaja CHECK generations_accepted_total_leq_generated'
);

select * from finish();
rollback;
