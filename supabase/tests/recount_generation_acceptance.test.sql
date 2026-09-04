create extension if not exists pgtap;

begin;
select plan(15);

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

delete from public.flashcards
where id = '20000000-0000-4000-8000-000000000001';
select public.recount_generation_acceptance('10000000-0000-4000-8000-000000000001');

select results_eq(
  $$
    select accepted_unedited_count, accepted_edited_count
    from public.generations
    where id = '10000000-0000-4000-8000-000000000001'
  $$,
  $$ values (1, 1) $$,
  'usuniecie fiszki AI obniza licznik akceptacji generacji'
);

select ok(
  (
    select accepted_unedited_count + accepted_edited_count <= generated_count
    from public.generations
    where id = '10000000-0000-4000-8000-000000000001'
  ),
  'przeliczenie po usunieciu nadal spelnia ograniczenie generacji'
);

-- --------------------------------------------------------------------------
-- Przypadki dodane w rollout Fazie 3 (ryzyko #6). Wstawione TU, a nie po bloku
-- izolacji nizej: sesja jest wciaz `set local role authenticated` jako uzytkownik A
-- (sub = aaaaaaaa-...-aaaaaaaaaaaa), wiec `recount` (`security invoker`) biegnie pod
-- RLS tak, jak wola go serwis. Za blokiem izolacji sesja jest `postgres` i utrata
-- `security invoker` przeszlaby niezauwazona. Swieze UUID-y — gen1/gen2 sa mutowane wyzej.
-- --------------------------------------------------------------------------

-- Klamra least(): wiecej fiszek AI niz generated_count (powtorzony zapis po zerwanej sieci).
-- Przed migracja 20260826141500 surowy count naruszal CHECK i funkcja rzucala.
insert into public.generations (
  id, user_id, model, source_text_length, source_text_hash,
  generated_count, accepted_unedited_count, accepted_edited_count,
  generation_duration
)
values
  (
    '10000000-0000-4000-8000-000000000003',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'google/gemini-2.5-flash',
    900,
    repeat('c', 64),
    2,
    0,
    0,
    3900
  );

insert into public.flashcards (
  id, user_id, generation_id, front, back, source,
  due, stability, difficulty, scheduled_days,
  learning_steps, reps, lapses, state, last_review
)
values
  ('20000000-0000-4000-8000-000000000010', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000003', 'P10', 'O10', 'ai',        '2026-08-26T12:00:00+00:00', 0, 5, 0, 0, 0, 0, 0, null),
  ('20000000-0000-4000-8000-000000000011', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000003', 'P11', 'O11', 'ai',        '2026-08-26T12:00:00+00:00', 0, 5, 0, 0, 0, 0, 0, null),
  ('20000000-0000-4000-8000-000000000012', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000003', 'P12', 'O12', 'ai',        '2026-08-26T12:00:00+00:00', 0, 5, 0, 0, 0, 0, 0, null),
  ('20000000-0000-4000-8000-000000000013', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000003', 'P13', 'O13', 'ai_edited', '2026-08-26T12:00:00+00:00', 0, 5, 0, 0, 0, 0, 0, null);

select lives_ok(
  $$ select public.recount_generation_acceptance('10000000-0000-4000-8000-000000000003') $$,
  'recount z 4 fiszkami AI przy generated_count = 2 nie rzuca (klamra least)'
);

select results_eq(
  $$
    select accepted_unedited_count, accepted_edited_count
    from public.generations
    where id = '10000000-0000-4000-8000-000000000003'
  $$,
  $$ values (2, 0) $$,
  'klamra: accepted_unedited = least(3, 2) = 2; accepted_edited = least(1, 2 - 2) = 0'
);

select ok(
  (
    select accepted_unedited_count + accepted_edited_count <= generated_count
    from public.generations
    where id = '10000000-0000-4000-8000-000000000003'
  ),
  'suma po klamrze nie przekracza generated_count (CHECK spelniony)'
);

-- Usuniecie ostatniej fiszki AI w zleceniu -> (0, 0).
insert into public.generations (
  id, user_id, model, source_text_length, source_text_hash,
  generated_count, accepted_unedited_count, accepted_edited_count,
  generation_duration
)
values
  (
    '10000000-0000-4000-8000-000000000004',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'google/gemini-2.5-flash',
    400,
    repeat('d', 64),
    1,
    0,
    0,
    2500
  );

insert into public.flashcards (
  id, user_id, generation_id, front, back, source,
  due, stability, difficulty, scheduled_days,
  learning_steps, reps, lapses, state, last_review
)
values
  ('20000000-0000-4000-8000-000000000020', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000004', 'P20', 'O20', 'ai', '2026-08-26T12:00:00+00:00', 0, 5, 0, 0, 0, 0, 0, null);

select public.recount_generation_acceptance('10000000-0000-4000-8000-000000000004');
select results_eq(
  $$
    select accepted_unedited_count, accepted_edited_count
    from public.generations
    where id = '10000000-0000-4000-8000-000000000004'
  $$,
  $$ values (1, 0) $$,
  'jedna fiszka ai -> (1, 0)'
);

delete from public.flashcards where id = '20000000-0000-4000-8000-000000000020';
select public.recount_generation_acceptance('10000000-0000-4000-8000-000000000004');
select results_eq(
  $$
    select accepted_unedited_count, accepted_edited_count
    from public.generations
    where id = '10000000-0000-4000-8000-000000000004'
  $$,
  $$ values (0, 0) $$,
  'usuniecie ostatniej fiszki AI w zleceniu zeruje oba liczniki'
);

-- Usuniete zlecenie: `generation_id` fiszki wyzerowany przez `on delete set null`;
-- recount musi byc bezpiecznym no-opem (`for update` nic nie zlapie, `update` nic nie ruszy).
insert into public.generations (
  id, user_id, model, source_text_length, source_text_hash,
  generated_count, accepted_unedited_count, accepted_edited_count,
  generation_duration
)
values
  (
    '10000000-0000-4000-8000-000000000005',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'google/gemini-2.5-flash',
    300,
    repeat('e', 64),
    1,
    0,
    0,
    1500
  );

insert into public.flashcards (
  id, user_id, generation_id, front, back, source,
  due, stability, difficulty, scheduled_days,
  learning_steps, reps, lapses, state, last_review
)
values
  ('20000000-0000-4000-8000-000000000030', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000005', 'P30', 'O30', 'ai', '2026-08-26T12:00:00+00:00', 0, 5, 0, 0, 0, 0, 0, null);

delete from public.generations where id = '10000000-0000-4000-8000-000000000005';

select lives_ok(
  $$ select public.recount_generation_acceptance('10000000-0000-4000-8000-000000000005') $$,
  'recount na usunietym zleceniu jest bezpiecznym no-opem'
);

-- Liczniki gen1 stają się nieaktualne: 2 x ai zamiast zapisanej 1.
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
  $$ values (1, 1) $$,
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
