-- Rezerwacja zlecenia: wiersz `generations` powstaje PRZED wywolaniem modelu, zeby limit dobowy
-- obejmowal rowniez generowania trwajace i nieudane. Sprawdzenie limitu przed insertem zostawialo
-- okno, w ktorym N rownoleglych zadan widzialo ten sam count i wszystkie wchodzily w platne wywolanie.
create type public.generation_status as enum ('pending', 'succeeded', 'failed');

alter table public.generations add column status public.generation_status;
update public.generations set status = 'succeeded' where status is null;
alter table public.generations alter column status set not null;
alter table public.generations alter column status set default 'pending';

alter table public.generations add column error_code text;

-- Kod bledu, nie komunikat: wzorzec mechanicznie blokuje wyciek tekstu zrodlowego do bazy.
alter table public.generations
  add constraint generations_error_code_shape
    check (error_code is null or error_code ~ '^[a-z_]{1,40}$');

alter table public.generations
  add constraint generations_error_code_only_when_failed
    check ((status = 'failed') = (error_code is not null));
