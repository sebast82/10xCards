-- Liczniki akceptacji są przeliczane z `flashcards`, nie inkrementowane:
-- dzięki temu powtórzone żądanie nie zawyża pomiaru kryterium 75%.
create or replace function public.recount_generation_acceptance(p_generation_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Blokada przed `count(*)`: bez niej dwa równoległe zapisy fiszek zaniżają licznik.
  perform 1 from public.generations where id = p_generation_id for update;

  update public.generations g
  set
    accepted_unedited_count = c.unedited,
    accepted_edited_count = c.edited
  from (
    select
      count(*) filter (where source = 'ai') as unedited,
      count(*) filter (where source = 'ai_edited') as edited
    from public.flashcards
    where generation_id = p_generation_id
  ) c
  where g.id = p_generation_id;
end;
$$;

revoke execute on function public.recount_generation_acceptance(uuid) from public;
grant execute on function public.recount_generation_acceptance(uuid) to authenticated;
