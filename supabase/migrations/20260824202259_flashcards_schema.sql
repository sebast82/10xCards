create type public.flashcard_source as enum ('ai', 'ai_edited', 'manual');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  model text not null,
  source_text_length integer not null,
  source_text_hash text not null,
  generated_count integer not null default 0,
  accepted_unedited_count integer not null default 0,
  accepted_edited_count integer not null default 0,
  generation_duration integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint generations_source_text_length_positive check (source_text_length > 0),
  constraint generations_source_text_hash_format check (source_text_hash ~ '^[0-9a-fA-F]{64}$'),
  constraint generations_generated_count_nonnegative check (generated_count >= 0),
  constraint generations_accepted_unedited_count_nonnegative check (accepted_unedited_count >= 0),
  constraint generations_accepted_edited_count_nonnegative check (accepted_edited_count >= 0),
  constraint generations_generation_duration_nonnegative check (generation_duration >= 0),
  constraint generations_accepted_total_leq_generated check (accepted_unedited_count + accepted_edited_count <= generated_count)
);

create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  generation_id uuid references public.generations (id) on delete set null,
  front text not null,
  back text not null,
  source public.flashcard_source not null,
  due timestamptz not null,
  stability double precision not null,
  difficulty double precision not null,
  scheduled_days integer not null,
  learning_steps smallint not null,
  reps integer not null,
  lapses integer not null,
  state smallint not null,
  last_review timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint flashcards_front_not_blank check (btrim(front) <> ''),
  constraint flashcards_back_not_blank check (btrim(back) <> ''),
  constraint flashcards_front_length check (length(btrim(front)) <= 500),
  constraint flashcards_back_length check (length(btrim(back)) <= 2000),
  constraint flashcards_due_required check (due is not null),
  constraint flashcards_stability_nonnegative check (stability >= 0),
  constraint flashcards_difficulty_range check (difficulty between 0 and 10),
  constraint flashcards_scheduled_days_nonnegative check (scheduled_days >= 0),
  constraint flashcards_learning_steps_nonnegative check (learning_steps >= 0),
  constraint flashcards_reps_nonnegative check (reps >= 0),
  constraint flashcards_lapses_nonnegative check (lapses >= 0),
  constraint flashcards_state_range check (state between 0 and 3)
);

create index generations_user_id_created_at_idx on public.generations (user_id, created_at desc);
create index flashcards_user_id_due_idx on public.flashcards (user_id, due);

create trigger generations_set_updated_at
before update on public.generations
for each row
execute function public.set_updated_at();

create trigger flashcards_set_updated_at
before update on public.flashcards
for each row
execute function public.set_updated_at();

create or replace function public.prevent_flashcard_source_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.source is distinct from new.source then
    raise exception 'flashcard source is immutable';
  end if;
  return new;
end;
$$;

create trigger flashcards_prevent_source_change
before update on public.flashcards
for each row
execute function public.prevent_flashcard_source_change();

alter table public.generations enable row level security;
alter table public.flashcards enable row level security;

grant select, insert, update, delete on public.generations to authenticated;
grant select, insert, update, delete on public.flashcards to authenticated;

grant select, insert, update, delete on public.generations to service_role;
grant select, insert, update, delete on public.flashcards to service_role;

create policy "generations_select_own"
on public.generations
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "generations_insert_own"
on public.generations
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "generations_update_own"
on public.generations
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "generations_delete_own"
on public.generations
for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "flashcards_select_own"
on public.flashcards
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "flashcards_insert_own"
on public.flashcards
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "flashcards_update_own"
on public.flashcards
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "flashcards_delete_own"
on public.flashcards
for delete
to authenticated
using ((select auth.uid()) = user_id);