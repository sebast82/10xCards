create extension if not exists pgtap;

begin;
select plan(22);

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

-- Write-isolation block. Neutralise flashcards_select_own so the WRITE policy is the only
-- thing that can block a cross-account write (F1 de-conflation, O2-13). Assertions 5/6 above
-- stay green even if flashcards_update_own / _delete_own is weakened, because the SELECT
-- policy hides B's rows from A's WHERE read; this block removes that cover. The `alter
-- policy` statements are rolled back with the surrounding transaction.
set local role postgres;
alter policy "flashcards_select_own" on public.flashcards using (true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

with attempted_update as (
  update public.flashcards
  set front = 'tampered'
  where user_id = '11111111-1111-4111-8111-111111111111'
  returning 1
)
select is(
  (select count(*)::int from attempted_update),
  0,
  'write policy (not select policy) blocks B updating user A flashcard'
);

set local role postgres;
select results_eq(
  $$ select front from public.flashcards where id = '55555555-5555-4555-8555-555555555555' $$,
  $$ values ('Question A'::text) $$,
  'user A flashcard front is unchanged after blocked cross-account update'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

with attempted_srs as (
  update public.flashcards
  set due = '2030-01-01T00:00:00+00:00', stability = 999, state = 3, reps = 999
  where user_id = '11111111-1111-4111-8111-111111111111'
  returning 1
)
select is(
  (select count(*)::int from attempted_srs),
  0,
  'write policy blocks B tampering with user A SRS columns (due/stability/state/reps)'
);

with attempted_delete as (
  delete from public.flashcards
  where user_id = '11111111-1111-4111-8111-111111111111'
  returning 1
)
select is(
  (select count(*)::int from attempted_delete),
  0,
  'write policy (not select policy) blocks B deleting user A flashcard'
);

set local role postgres;
select results_eq(
  $$ select count(*)::int from public.flashcards where id = '55555555-5555-4555-8555-555555555555' $$,
  $$ values (1) $$,
  'user A flashcard still present after blocked cross-account delete'
);
select is(
  (select stability from public.flashcards where id = '55555555-5555-4555-8555-555555555555'),
  12.5::double precision,
  'user A SRS state is unchanged after blocked tampering'
);

-- Restore the real SELECT policy before the remaining assertions.
alter policy "flashcards_select_own" on public.flashcards using ((select auth.uid()) = user_id);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select throws_like(
  $$ update public.flashcards set user_id = '22222222-2222-4222-8222-222222222222' where id = '55555555-5555-4555-8555-555555555555' $$,
  '%row-level security%',
  'user A cannot reassign own flashcard to user B (WITH CHECK on UPDATE)'
);

select lives_ok(
  $$
    insert into public.flashcards (
      id, user_id, generation_id, front, back, source,
      due, stability, difficulty, scheduled_days,
      learning_steps, reps, lapses, state, last_review
    )
    values (
      '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a',
      '11111111-1111-4111-8111-111111111111',
      null,
      'Own new card', 'Own new answer', 'manual',
      '2026-09-01T00:00:00+00:00', 1, 5, 0, 0, 0, 0, 0, null
    )
  $$,
  'user A can insert own flashcard'
);

with own_update as (
  update public.flashcards set front = 'edited by owner'
  where id = '55555555-5555-4555-8555-555555555555'
  returning 1
)
select is((select count(*)::int from own_update), 1, 'user A can update own flashcard');

with own_delete as (
  delete from public.flashcards where id = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a' returning 1
)
select is((select count(*)::int from own_delete), 1, 'user A can delete own flashcard');

select throws_like(
  $$ truncate public.flashcards $$,
  '%permission denied%',
  'authenticated cannot truncate flashcards'
);

-- Empty-claims: an authenticated role with no JWT claims (the DB-level face of an expired
-- session) sees zero rows — auth.uid() is null, so no policy predicate matches.
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select is(
  (select count(*)::int from public.flashcards),
  0,
  'authenticated with no claims sees zero flashcard rows'
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
