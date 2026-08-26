-- Zaklamrowanie licznikow: gdy liczba fiszek pod zleceniem przekroczy `generated_count`
-- (powtorzony zapis po zerwanej sieci, retry klienta), surowy count naruszal CHECK
-- `generations_accepted_total_leq_generated`, funkcja rzucala, a liczniki zostawaly trwale zanizone.
create or replace function public.recount_generation_acceptance(p_generation_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Blokada przed `count(*)`: bez niej dwa rownolegle zapisy fiszek zanizaja licznik.
  perform 1 from public.generations where id = p_generation_id for update;

  update public.generations g
  set
    accepted_unedited_count = least(c.unedited, g.generated_count),
    accepted_edited_count = least(c.edited, g.generated_count - least(c.unedited, g.generated_count))
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
