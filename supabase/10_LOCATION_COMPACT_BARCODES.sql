-- SAN WMS v3.5.5 - 하이픈 없는 로케이션 바코드 인식
-- DATA-PRESERVING MIGRATION: 기존 상품, 재고, 로케이션, 로그를 삭제하지 않습니다.
-- 예: 저장/표시 D1A-01-01-01, 스캔 D1A010101

begin;

create or replace function public.location_compact_barcode(p_location_code text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(replace(trim(coalesce(p_location_code,'')),'-',''),'\s+','','g'));
$$;

create index if not exists barcodes_normalized_value_active_idx
  on public.barcodes(normalized_value)
  where active;

create or replace function public.sync_location_compact_barcode(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_location public.locations%rowtype;
  v_compact text;
  v_normalized text;
  v_conflict record;
begin
  select * into v_location
  from public.locations
  where id=p_location_id;

  if not found then return; end if;

  v_compact:=public.location_compact_barcode(v_location.location_code);
  v_normalized:=public.normalize_barcode(v_compact);

  -- 로케이션 코드가 변경된 경우 이전 자동 별칭을 제거합니다.
  delete from public.barcodes
  where scan_target_id=v_location.scan_target_id
    and symbology='LOCATION-COMPACT'
    and normalized_value<>v_normalized;

  if v_compact='' then return; end if;

  -- 같은 로케이션에 이미 동일한 바코드가 있으면 중복 생성하지 않습니다.
  if exists(
    select 1
    from public.barcodes
    where scan_target_id=v_location.scan_target_id
      and normalized_value=v_normalized
  ) then
    update public.barcodes
    set active=true
    where scan_target_id=v_location.scan_target_id
      and normalized_value=v_normalized
      and symbology='LOCATION-COMPACT';
    return;
  end if;

  -- 다른 상품 또는 로케이션이 같은 번호를 사용 중이면 잘못 연결하지 않습니다.
  select b.scan_target_id,st.target_type
  into v_conflict
  from public.barcodes b
  join public.scan_targets st on st.id=b.scan_target_id
  where b.normalized_value=v_normalized
    and b.scan_target_id<>v_location.scan_target_id
  limit 1;

  if found then
    raise exception '%의 스캔 별칭 %가 다른 % 바코드와 충돌합니다.',
      v_location.location_code,v_compact,v_conflict.target_type;
  end if;

  insert into public.barcodes(
    scan_target_id,barcode_value,source,symbology,is_primary,active,created_by
  ) values(
    v_location.scan_target_id,v_compact,'internal','LOCATION-COMPACT',false,true,null
  );
end;
$$;

create or replace function public.sync_location_compact_barcode_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.sync_location_compact_barcode(new.id);
  return new;
end;
$$;

-- 로케이션 생성 함수에서 대표 바코드가 등록된 뒤 실행되도록 지연 트리거로 구성합니다.
drop trigger if exists sync_location_compact_barcode_after_change on public.locations;
create constraint trigger sync_location_compact_barcode_after_change
after insert or update on public.locations
deferrable initially deferred
for each row execute function public.sync_location_compact_barcode_trigger();

-- 기존 로케이션 전체에 하이픈 없는 스캔 별칭을 생성합니다.
do $$
declare
  v_location record;
begin
  for v_location in select id from public.locations order by location_code
  loop
    perform public.sync_location_compact_barcode(v_location.id);
  end loop;
end;
$$;

grant execute on function public.location_compact_barcode(text) to authenticated;
revoke all on function public.sync_location_compact_barcode(uuid) from public;

notify pgrst, 'reload schema';

commit;

select
  count(*) as compact_location_barcodes
from public.barcodes
where symbology='LOCATION-COMPACT';
