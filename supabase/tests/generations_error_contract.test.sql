create extension if not exists pgtap;

begin;
select plan(5);

-- Seed: jeden uzytkownik. Kolumny NOT NULL bez defaultu dla public.generations to
-- user_id, model, source_text_length, source_text_hash, generation_duration
-- (wzor z recount_generation_acceptance.test.sql). status ma default 'pending',
-- error_code jest nullable.
insert into auth.users (id, email)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'error-contract@example.com')
on conflict (id) do nothing;

-- 1. Proza w source_text_hash: CHECK generations_source_text_hash_format wymaga ^[0-9a-fA-F]{64}$.
--    Bez tego CHECK-u trasa moglaby zapisac wklejony akapit w kolumnie hasha (ryzyko #5).
select throws_like(
  $$
    insert into public.generations (
      user_id, model, source_text_length, source_text_hash, generation_duration
    )
    values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'google/gemini-2.5-flash',
      1200,
      'To jest wklejony akapit tekstu zrodlowego.',
      4100
    )
  $$,
  '%generations_source_text_hash_format%',
  'proza zamiast 64-hex w source_text_hash jest odrzucona przez CHECK'
);

-- 2. Komunikat zamiast kodu w error_code: CHECK generations_error_code_shape wymaga ^[a-z_]{1,40}$.
--    Spacje, wielkie litery i kropka wykluczaja komunikat uzytkownika z tej kolumny (ryzyko #5).
select throws_like(
  $$
    insert into public.generations (
      user_id, model, source_text_length, source_text_hash, generation_duration,
      status, error_code
    )
    values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'google/gemini-2.5-flash',
      1200,
      repeat('a', 64),
      4100,
      'failed',
      'Model nie odpowiedzial na czas. Sprobuj ponownie.'
    )
  $$,
  '%generations_error_code_shape%',
  'komunikat (spacje, wielkie litery, kropka) w error_code jest odrzucony przez CHECK'
);

-- 3. Biwarunek generations_error_code_only_when_failed, strona (a): status='failed' bez error_code.
select throws_like(
  $$
    insert into public.generations (
      user_id, model, source_text_length, source_text_hash, generation_duration,
      status, error_code
    )
    values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'google/gemini-2.5-flash',
      1200,
      repeat('a', 64),
      4100,
      'failed',
      null
    )
  $$,
  '%generations_error_code_only_when_failed%',
  'status=failed bez error_code jest odrzucony (strona a biwarunku)'
);

-- 4. Biwarunek generations_error_code_only_when_failed, strona (b): status != 'failed' z error_code.
select throws_like(
  $$
    insert into public.generations (
      user_id, model, source_text_length, source_text_hash, generation_duration,
      status, error_code
    )
    values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'google/gemini-2.5-flash',
      1200,
      repeat('a', 64),
      4100,
      'pending',
      'timeout'
    )
  $$,
  '%generations_error_code_only_when_failed%',
  'status=pending z error_code jest odrzucony (strona b biwarunku)'
);

-- 5. Kontrola pozytywna: wiersz kanoniczny awarii przechodzi, wiec CHECK-i nie sa za wask.
--    error_code='rate_limited' to kod wprowadzony w trakcie researchu - musi zmiescic sie w ^[a-z_]{1,40}$.
select lives_ok(
  $$
    insert into public.generations (
      user_id, model, source_text_length, source_text_hash, generation_duration,
      status, error_code
    )
    values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'google/gemini-2.5-flash',
      1200,
      repeat('a', 64),
      4100,
      'failed',
      'rate_limited'
    )
  $$,
  'wiersz status=failed z error_code=rate_limited i 64-hex hashem przechodzi (kontrola pozytywna)'
);

select * from finish();
rollback;
