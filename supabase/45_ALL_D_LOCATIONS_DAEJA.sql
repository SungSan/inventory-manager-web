-- SAN WMS V4.8.1: every LOC whose normalized code starts with D belongs to Daeja-dong.
begin;

create or replace function public.enforce_location_facility_from_code()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_code text := regexp_replace(upper(coalesce(new.location_code, '')), '[^A-Z0-9]', '', 'g');
begin
  if v_code like 'D%' then
    new.facility := 'DAEJA';
  elsif v_code like 'K1%' or v_code like 'KN%' then
    new.facility := 'GWANSAN';
  end if;
  return new;
end;
$$;

drop trigger if exists locations_enforce_facility_from_code on public.locations;
create trigger locations_enforce_facility_from_code
before insert or update of location_code, facility on public.locations
for each row execute function public.enforce_location_facility_from_code();

update public.locations
set facility='DAEJA'
where regexp_replace(upper(coalesce(location_code, '')), '[^A-Z0-9]', '', 'g') like 'D%'
  and facility is distinct from 'DAEJA';

notify pgrst,'reload schema';
commit;

select 'SAN WMS V4.8.1 all D locations assigned to DAEJA' as result;
