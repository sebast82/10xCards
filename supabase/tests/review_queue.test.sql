create extension if not exists pgtap;

begin;
select plan(16);

-- Pierwszy test realnego Postgresa dla kolejki powtorek. Pokrywa to, czego SupabaseStub
-- strukturalnie nie umie: WHERE due <= now(), ORDER BY due, sufit 50 wierszy, izolacje
-- kolejki miedzy kontami i semantyke optymistycznej blokady na reps.
--
-- Kotwica do serwisu (dryf widoczny w przegladzie):
--   * ksztalt odczytu kolejki  - src/lib/reviews/service.ts:62-96
--       select <kolumny> from public.flashcards
--       where user_id = ? and due <= now() order by due asc limit 50
--   * guarded UPDATE oceny      - src/lib/reviews/service.ts:132-149
--       update public.flashcards set <9 kolumn harmonogramu>
--       where id = ? and user_id = ? and reps = ?

insert into auth.users (id, email)
values
  ('a0000000-0000-4000-8000-000000000001', 'queue-a@example.com'),
  ('a0000000-0000-4000-8000-000000000002', 'queue-b@example.com')
on conflict (id) do nothing;

-- Uzytkownik A: 51 fiszek wymagalnych w przeszlosci, due rosnace wraz z indeksem
-- (karta i: due = now() - (60 - i) min), wiec porzadek rosnacy po due == porzadek po id.
insert into public.flashcards (
  id, user_id, generation_id, front, back, source,
  due, stability, difficulty, scheduled_days,
  learning_steps, reps, lapses, state, last_review
)
select
  ('b0000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'a0000000-0000-4000-8000-000000000001',
  null,
  'Pytanie ' || i,
  'Odpowiedz ' || i,
  'manual',
  now() - ((60 - i) * interval '1 minute'),
  1, 5, 0, 0, 2, 0, 2, null
from generate_series(1, 51) as i;

-- Karta A z due w przyszlosci - nie kwalifikuje sie do kolejki.
insert into public.flashcards (
  id, user_id, generation_id, front, back, source,
  due, stability, difficulty, scheduled_days,
  learning_steps, reps, lapses, state, last_review
)
values
  ('b0000000-0000-4000-8000-000000000052', 'a0000000-0000-4000-8000-000000000001', null,
   'Pytanie przyszle', 'Odpowiedz przyszla', 'manual',
   now() + interval '1 day', 1, 5, 0, 0, 2, 0, 2, null);

-- Uzytkownik B: jedna fiszka wymagalna w przeszlosci (kontrola izolacji).
insert into public.flashcards (
  id, user_id, generation_id, front, back, source,
  due, stability, difficulty, scheduled_days,
  learning_steps, reps, lapses, state, last_review
)
values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null,
   'Pytanie B', 'Odpowiedz B', 'manual',
   now() - interval '30 minutes', 1, 5, 0, 0, 2, 0, 2, null);

select is(
  (select relrowsecurity from pg_class where oid = 'public.flashcards'::regclass),
  true,
  'flashcards ma wlaczone row level security'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- Sufit wsadu: kolejka oddaje dokladnie 50 wierszy mimo 51 wymagalnych.
select is(
  (select count(*)::int from (
    select id from public.flashcards
    where user_id = 'a0000000-0000-4000-8000-000000000001' and due <= now()
    order by due asc
    limit 50
  ) q),
  50,
  'kolejka zwraca dokladnie 50 wierszy (sufit wsadu REVIEW_BATCH_SIZE)'
);

-- Predykat due <= now() wyklucza karte przyszla...
select is(
  (select count(*)::int from public.flashcards
   where user_id = 'a0000000-0000-4000-8000-000000000001'
     and due <= now()
     and id = 'b0000000-0000-4000-8000-000000000052'),
  0,
  'karta z due w przyszlosci nie kwalifikuje sie do kolejki'
);

-- ...i nie dlatego, ze jej nie ma - wlasciciel ja widzi, wyklucza ja predykat czasu.
select is(
  (select count(*)::int from public.flashcards
   where user_id = 'a0000000-0000-4000-8000-000000000001'
     and id = 'b0000000-0000-4000-8000-000000000052'),
  1,
  'karta przyszla istnieje i jest widoczna dla wlasciciela'
);

-- Porzadek rosnacy po due: przy tym seedzie == porzadek po id, co daje niezalezny oracle.
select results_eq(
  $$
    select id from public.flashcards
    where user_id = 'a0000000-0000-4000-8000-000000000001' and due <= now()
    order by due asc
    limit 50
  $$,
  $$
    select id from public.flashcards
    where user_id = 'a0000000-0000-4000-8000-000000000001' and due <= now()
    order by id asc
    limit 50
  $$,
  'kolejka oddaje wiersze w rosnacym porzadku due'
);

-- 51. wiersz past-due (najswiezsze due) wypada poza 50-wierszowa strone.
select is(
  (select count(*)::int from (
    select id from public.flashcards
    where user_id = 'a0000000-0000-4000-8000-000000000001' and due <= now()
    order by due asc
    limit 50
  ) q
  where q.id = 'b0000000-0000-4000-8000-000000000051'),
  0,
  '51. wiersz past-due (najswiezsze due) nie miesci sie na stronie 50'
);

-- ...a 50. wiersz jeszcze sie miesci (kontrola pozytywna dla granicy strony).
select is(
  (select count(*)::int from (
    select id from public.flashcards
    where user_id = 'a0000000-0000-4000-8000-000000000001' and due <= now()
    order by due asc
    limit 50
  ) q
  where q.id = 'b0000000-0000-4000-8000-000000000050'),
  1,
  '50. wiersz past-due miesci sie na stronie 50 (kontrola granicy)'
);

-- Izolacja kolejki: fiszka uzytkownika B nie trafia do wyniku A (filtr aplikacyjny).
select is(
  (select count(*)::int from (
    select id from public.flashcards
    where user_id = 'a0000000-0000-4000-8000-000000000001' and due <= now()
    order by due asc
    limit 50
  ) q
  where q.id = 'c0000000-0000-4000-8000-000000000001'),
  0,
  'fiszka uzytkownika B nie pojawia sie w kolejce A'
);

-- Kontrola pozytywna: najwczesniejsza karta A jest w wyniku.
select is(
  (select count(*)::int from (
    select id from public.flashcards
    where user_id = 'a0000000-0000-4000-8000-000000000001' and due <= now()
    order by due asc
    limit 50
  ) q
  where q.id = 'b0000000-0000-4000-8000-000000000001'),
  1,
  'najwczesniejsza karta A jest w kolejce (kontrola pozytywna)'
);

-- RLS, nie tylko filtr aplikacyjny: bez user_id w WHERE A widzi wylacznie swoje 51 wierszy past-due.
select is(
  (select count(*)::int from public.flashcards where due <= now()),
  51,
  'RLS ogranicza widok past-due do wierszy A - karta B niewidoczna nawet bez filtra user_id'
);

-- Semantyka guarda reps: pierwsza ocena z aktualnym reps trafia w 1 wiersz.
with graded as (
  update public.flashcards
  set due = now() + interval '10 minutes',
      stability = 2, difficulty = 5, scheduled_days = 0, learning_steps = 0,
      reps = 3, lapses = 2, state = 2, last_review = now()
  where id = 'b0000000-0000-4000-8000-000000000001'
    and user_id = 'a0000000-0000-4000-8000-000000000001'
    and reps = 2
  returning 1
)
select is((select count(*)::int from graded), 1, 'guarded UPDATE z aktualnym reps trafia w 1 wiersz');

select is(
  (select reps from public.flashcards where id = 'b0000000-0000-4000-8000-000000000001'),
  3,
  'po ocenie reps wzrosl do 3'
);

-- Wiersz po ocenie jest spojny i re-parsowalny (domeny CHECK + niepusty due).
select ok(
  (select due is not null
        and state between 0 and 3
        and stability >= 0
        and difficulty between 0 and 10
        and scheduled_days >= 0
        and learning_steps >= 0
        and reps >= 0
        and lapses >= 0
   from public.flashcards where id = 'b0000000-0000-4000-8000-000000000001'),
  'wiersz po ocenie ma spojny, re-parsowalny stan harmonogramu'
);

-- Nieaktualny guard (reps = 2) po zaawansowaniu do 3 nie trafia w zaden wiersz.
with stale as (
  update public.flashcards
  set due = now() + interval '20 minutes', reps = 4, last_review = now()
  where id = 'b0000000-0000-4000-8000-000000000001'
    and user_id = 'a0000000-0000-4000-8000-000000000001'
    and reps = 2
  returning 1
)
select is((select count(*)::int from stale), 0, 'nieaktualny guard (reps = 2) nie trafia w zaden wiersz');

-- Legalna druga ocena (guard na reps = 3) przechodzi - bez stanu sprzecznego.
with regraded as (
  update public.flashcards
  set due = now() + interval '30 minutes',
      stability = 3, difficulty = 5, scheduled_days = 0, learning_steps = 0,
      reps = 4, lapses = 2, state = 2, last_review = now()
  where id = 'b0000000-0000-4000-8000-000000000001'
    and user_id = 'a0000000-0000-4000-8000-000000000001'
    and reps = 3
  returning 1
)
select is((select count(*)::int from regraded), 1, 'legalna druga ocena (guard reps = 3) przechodzi');

select is(
  (select reps from public.flashcards where id = 'b0000000-0000-4000-8000-000000000001'),
  4,
  'reps po drugiej ocenie = 4'
);

select * from finish();
rollback;
