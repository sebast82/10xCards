create extension if not exists pgtap;

begin;
select plan(10);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'user-a@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'user-b@example.com')
on conflict (id) do nothing;

insert into public.generations (
  id, user_id, model, source_text_length, source_text_hash,
  generated_count, accepted_unedited_count, accepted_edited_count,
  generation_duration
)
values
  (
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    'gpt-4o-mini',
    128,
    repeat('a', 64),
    2,
    1,
    1,
    3200
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    '22222222-2222-4222-8222-222222222222',
    'gpt-4o-mini',
    200,
    repeat('b', 64),
    1,
    0,
    1,
    2600
  );

insert into public.flashcards (
  id, user_id, generation_id, front, back, source,
  due, stability, difficulty, scheduled_days,
  learning_steps, reps, lapses, state, last_review
)
values
  (
    '55555555-5555-4555-8555-555555555555',
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',
    'Question A',
    'Answer A',
    'ai',
    '2026-08-25T12:00:00+00:00',
    12.5,
    3.2,
    5,
    2,
    4,
    0,
    1,
    '2026-08-24T09:00:00+00:00'
  ),
  (
    '66666666-6666-4666-8666-666666666666',
    '22222222-2222-4222-8222-222222222222',
    '44444444-4444-4444-8444-444444444444',
    'Question B',
    'Answer B',
    'manual',
    '2026-08-26T12:00:00+00:00',
    8.5,
    4.0,
    3,
    1,
    2,
    0,
    0,
    '2026-08-23T14:00:00+00:00'
  );

select is(
  (select relrowsecurity from pg_class where oid = 'public.generations'::regclass),
  true,
  'generations has row level security enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.flashcards'::regclass),
  true,
  'flashcards has row level security enabled'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select results_eq(
  $$ select count(*)::int from public.generations $$,
  $$ values (1) $$,
  'user A sees only their generation rows'
);

select results_eq(
  $$ select count(*)::int from public.flashcards $$,
  $$ values (1) $$,
  'user A sees only their flashcard rows'
);

with attempted_update as (
  update public.flashcards
  set front = 'tampered'
  where user_id = '22222222-2222-4222-8222-222222222222'
  returning 1
)
select is((select count(*)::int from attempted_update), 0, 'update on other user row affects no rows');

with attempted_delete as (
  delete from public.flashcards
  where user_id = '22222222-2222-4222-8222-222222222222'
  returning 1
)
select is((select count(*)::int from attempted_delete), 0, 'delete on other user row affects no rows');

select throws_like(
  $$
    insert into public.flashcards (
      id, user_id, generation_id, front, back, source,
      due, stability, difficulty, scheduled_days,
      learning_steps, reps, lapses, state, last_review
    )
    values (
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      null,
      'Other user card',
      'Other user answer',
      'manual',
      '2026-08-27T12:00:00+00:00',
      9.5,
      2.1,
      4,
      1,
      3,
      0,
      2,
      '2026-08-25T12:00:00+00:00'
    )
  $$,
  '%row-level security policy%',
  'inserting another user record is denied by RLS'
);

select throws_like(
  $$ update public.flashcards set source = 'manual' where user_id = '11111111-1111-4111-8111-111111111111' $$,
  '%flashcard source is immutable%',
  'changing source is blocked by trigger'
);

set local role anon;
select throws_like(
  $$ select count(*)::int from public.flashcards $$,
  '%permission denied%',
  'anon users cannot read flashcards'
);
select throws_like(
  $$ select count(*)::int from public.generations $$,
  '%permission denied%',
  'anon users cannot read generations'
);

select * from finish();
rollback;
