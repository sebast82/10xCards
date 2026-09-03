create extension if not exists pgtap;

begin;
select plan(13);

insert into auth.users (id, email)
values
  ('c1111111-1111-4111-8111-111111111111', 'gen-user-a@example.com'),
  ('c2222222-2222-4222-8222-222222222222', 'gen-user-b@example.com')
on conflict (id) do nothing;

insert into public.generations (
  id, user_id, model, source_text_length, source_text_hash,
  generated_count, accepted_unedited_count, accepted_edited_count,
  generation_duration
)
values
  (
    'c3333333-3333-4333-8333-333333333333',
    'c1111111-1111-4111-8111-111111111111',
    'gpt-4o-mini',
    128,
    repeat('a', 64),
    2,
    1,
    1,
    3200
  ),
  (
    'c4444444-4444-4444-8444-444444444444',
    'c2222222-2222-4222-8222-222222222222',
    'gpt-4o-mini',
    200,
    repeat('b', 64),
    1,
    0,
    1,
    2600
  );

select is(
  (select relrowsecurity from pg_class where oid = 'public.generations'::regclass),
  true,
  'generations has row level security enabled'
);

-- Act as user B for the read-isolation assertion.
set local role authenticated;
set local request.jwt.claims = '{"sub":"c2222222-2222-4222-8222-222222222222","role":"authenticated"}';

select results_eq(
  $$ select count(*)::int from public.generations $$,
  $$ values (1) $$,
  'user B sees only their own generation rows'
);

-- Write-isolation block. Neutralise the SELECT policy so the WRITE policy is the only thing
-- that can block B's cross-account write (F1 de-conflation, O2-13). The `alter policy` is
-- rolled back with the surrounding transaction.
set local role postgres;
alter policy "generations_select_own" on public.generations using (true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"c2222222-2222-4222-8222-222222222222","role":"authenticated"}';

with attempted_update as (
  update public.generations
  set model = 'tampered'
  where user_id = 'c1111111-1111-4111-8111-111111111111'
  returning 1
)
select is(
  (select count(*)::int from attempted_update),
  0,
  'write policy (not select policy) blocks B updating user A generation'
);

set local role postgres;
select results_eq(
  $$ select model from public.generations where id = 'c3333333-3333-4333-8333-333333333333' $$,
  $$ values ('gpt-4o-mini'::text) $$,
  'user A generation row is unchanged after blocked cross-account update'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"c2222222-2222-4222-8222-222222222222","role":"authenticated"}';

with attempted_delete as (
  delete from public.generations
  where user_id = 'c1111111-1111-4111-8111-111111111111'
  returning 1
)
select is(
  (select count(*)::int from attempted_delete),
  0,
  'write policy (not select policy) blocks B deleting user A generation'
);

set local role postgres;
select results_eq(
  $$ select count(*)::int from public.generations where id = 'c3333333-3333-4333-8333-333333333333' $$,
  $$ values (1) $$,
  'user A generation row still present after blocked cross-account delete'
);

-- Restore the real SELECT policy before the remaining assertions.
alter policy "generations_select_own" on public.generations using ((select auth.uid()) = user_id);

set local role authenticated;
set local request.jwt.claims = '{"sub":"c2222222-2222-4222-8222-222222222222","role":"authenticated"}';

select throws_like(
  $$
    insert into public.generations (
      id, user_id, model, source_text_length, source_text_hash,
      generated_count, accepted_unedited_count, accepted_edited_count, generation_duration
    )
    values (
      'c5555555-5555-4555-8555-555555555555',
      'c1111111-1111-4111-8111-111111111111',
      'gpt-4o-mini', 100, repeat('c', 64), 0, 0, 0, 1000
    )
  $$,
  '%row-level security%',
  'B cannot insert a generation row impersonating user A'
);

set local request.jwt.claims = '{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated"}';

select throws_like(
  $$ update public.generations set user_id = 'c2222222-2222-4222-8222-222222222222' where id = 'c3333333-3333-4333-8333-333333333333' $$,
  '%row-level security%',
  'user A cannot reassign own generation to user B (WITH CHECK on UPDATE)'
);

select lives_ok(
  $$
    insert into public.generations (
      id, user_id, model, source_text_length, source_text_hash,
      generated_count, accepted_unedited_count, accepted_edited_count, generation_duration
    )
    values (
      'c6666666-6666-4666-8666-666666666666',
      'c1111111-1111-4111-8111-111111111111',
      'gpt-4o-mini', 100, repeat('d', 64), 0, 0, 0, 1000
    )
  $$,
  'user A can insert own generation row'
);

with own_update as (
  update public.generations set model = 'gpt-4o'
  where id = 'c3333333-3333-4333-8333-333333333333'
  returning 1
)
select is((select count(*)::int from own_update), 1, 'user A can update own generation row');

with own_delete as (
  delete from public.generations
  where id = 'c6666666-6666-4666-8666-666666666666'
  returning 1
)
select is((select count(*)::int from own_delete), 1, 'user A can delete own generation row');

set local role anon;
select throws_like(
  $$ select public.recount_generation_acceptance('c3333333-3333-4333-8333-333333333333') $$,
  '%permission denied%',
  'anon cannot EXECUTE recount_generation_acceptance'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_like(
  $$ truncate public.generations $$,
  '%permission denied%',
  'authenticated cannot truncate generations'
);

select * from finish();
rollback;
