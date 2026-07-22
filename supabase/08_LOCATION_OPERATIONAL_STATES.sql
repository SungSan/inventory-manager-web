-- SAN WMS v1.5.3 - LOC MAP 작업중/사용불가 상태
-- DATA-PRESERVING MIGRATION: 기존 상품, 재고, 로케이션, 로그를 삭제하지 않습니다.
-- 04_LOCATION_MAP.sql 이후 한 번 실행하세요.

alter table public.locations
  add column if not exists unavailable boolean not null default false;

alter table public.locations
  add column if not exists unavailable_reason text;

create or replace function public.list_location_map_states()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'location_id',l.id,
      'unavailable',l.unavailable,
      'unavailable_reason',l.unavailable_reason,
      'active_transfer_count',coalesce(t.job_count,0),
      'active_transfer_role',case
        when coalesce(t.is_source,false) and coalesce(t.is_destination,false) then 'BOTH'
        when coalesce(t.is_source,false) then 'SOURCE'
        when coalesce(t.is_destination,false) then 'DESTINATION'
        else null
      end
    ) order by l.location_code
  ),'[]'::jsonb)
  into v_result
  from public.locations l
  left join lateral (
    select
      count(distinct j.id)::integer as job_count,
      bool_or(j.source_location_id=l.id) as is_source,
      bool_or(j.destination_location_id=l.id) as is_destination
    from public.transfer_jobs j
    where j.status in ('DRAFT','READY')
      and (j.source_location_id=l.id or j.destination_location_id=l.id)
  ) t on true;

  return v_result;
end;
$$;

create or replace function public.admin_set_location_unavailable(
  p_location_id uuid,
  p_unavailable boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_before public.locations%rowtype;
  v_after public.locations%rowtype;
  v_stock bigint:=0;
  v_jobs integer:=0;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if public.current_role()<>'admin' then raise exception '관리자만 사용불가 LOC를 설정할 수 있습니다.'; end if;

  select * into v_before from public.locations where id=p_location_id for update;
  if not found then raise exception '로케이션을 찾을 수 없습니다.'; end if;
  if not v_before.active then raise exception 'LOC MAP에서 제외된 로케이션은 사용불가 상태를 설정할 수 없습니다.'; end if;

  if coalesce(p_unavailable,false) then
    select coalesce(sum(qty),0) into v_stock
    from public.inventory_balances
    where location_id=p_location_id and qty>0;
    if v_stock>0 then
      raise exception '재고가 남아 있는 LOC는 사용불가로 전환할 수 없습니다. 먼저 재고를 이관하세요.';
    end if;

    select count(*) into v_jobs
    from public.transfer_jobs
    where status in ('DRAFT','READY')
      and (source_location_id=p_location_id or destination_location_id=p_location_id);
    if v_jobs>0 then
      raise exception '진행 중인 이관 업무에 포함된 LOC는 사용불가로 전환할 수 없습니다.';
    end if;
  end if;

  update public.locations
  set
    unavailable=coalesce(p_unavailable,false),
    unavailable_reason=case
      when coalesce(p_unavailable,false) then nullif(trim(coalesce(p_reason,'')),'')
      else null
    end,
    updated_at=now()
  where id=p_location_id
  returning * into v_after;

  -- 사용불가 LOC는 맵에는 남지만 바코드 스캔 대상에서는 제외됩니다.
  update public.scan_targets
  set active=(v_after.active and not v_after.unavailable)
  where id=v_after.scan_target_id;

  if v_after.active and not v_after.unavailable then
    update public.barcodes
    set active=true
    where scan_target_id=v_after.scan_target_id and is_primary;
  end if;

  perform public.write_audit(
    case when v_after.unavailable then 'LOCATION_UNAVAILABLE_SET' else 'LOCATION_UNAVAILABLE_CLEARED' end,
    'location',v_after.id::text,v_after.location_code,
    jsonb_build_object('unavailable',v_before.unavailable,'reason',v_before.unavailable_reason),
    jsonb_build_object('unavailable',v_after.unavailable,'reason',v_after.unavailable_reason),
    null
  );

  return jsonb_build_object(
    'id',v_after.id,
    'location_code',v_after.location_code,
    'unavailable',v_after.unavailable,
    'unavailable_reason',v_after.unavailable_reason
  );
end;
$$;

-- LOC MAP 제외/복구 시 사용불가 상태는 함께 초기화합니다.
create or replace function public.admin_set_map_location_active(
  p_location_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_location public.locations%rowtype;
  v_stock bigint;
  v_jobs integer:=0;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if public.current_role()<>'admin' then raise exception '관리자만 LOC MAP 로케이션을 제외하거나 복구할 수 있습니다.'; end if;

  select * into v_location from public.locations where id=p_location_id for update;
  if not found then raise exception '로케이션을 찾을 수 없습니다.'; end if;

  if not coalesce(p_active,false) then
    select coalesce(sum(qty),0) into v_stock
    from public.inventory_balances
    where location_id=p_location_id and qty>0;
    if v_stock>0 then raise exception '재고가 남아 있는 로케이션은 제외할 수 없습니다. 먼저 재고를 이관하세요.'; end if;

    select count(*) into v_jobs
    from public.transfer_jobs
    where status in ('DRAFT','READY')
      and (source_location_id=p_location_id or destination_location_id=p_location_id);
    if v_jobs>0 then raise exception '진행 중인 이관 업무에 사용 중인 로케이션은 제외할 수 없습니다.'; end if;
  end if;

  update public.locations
  set active=coalesce(p_active,false),unavailable=false,unavailable_reason=null,updated_at=now()
  where id=p_location_id
  returning * into v_location;

  update public.scan_targets set active=v_location.active where id=v_location.scan_target_id;
  if v_location.active then
    update public.barcodes set active=true
    where scan_target_id=v_location.scan_target_id and is_primary;
  end if;

  perform public.write_audit(
    case when v_location.active then 'MAP_LOCATION_RESTORED' else 'MAP_LOCATION_REMOVED' end,
    'location',v_location.id::text,v_location.location_code,
    null,jsonb_build_object('active',v_location.active,'unavailable',false),null
  );

  return jsonb_build_object(
    'id',v_location.id,'scan_target_id',v_location.scan_target_id,
    'location_code',v_location.location_code,'zone',v_location.zone,
    'active',v_location.active,'created_at',v_location.created_at,'updated_at',v_location.updated_at
  );
end;
$$;

-- 기존 로케이션 관리 화면에서도 활성/비활성 변경 시 상태가 꼬이지 않도록 보정합니다.
create or replace function public.update_location(
  p_location_id uuid,
  p_new_location_code text default null,
  p_new_zone text default null,
  p_new_active boolean default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_before public.locations%rowtype;
  v_after public.locations%rowtype;
  v_stock bigint;
  v_jobs integer:=0;
begin
  perform public.require_role(array['admin','manager','operator']);
  select * into v_before from public.locations where id=p_location_id for update;
  if not found then raise exception '로케이션을 찾을 수 없습니다.'; end if;

  if p_new_active is false and v_before.active then
    select coalesce(sum(qty),0) into v_stock
    from public.inventory_balances
    where location_id=p_location_id and qty>0;
    if v_stock>0 then raise exception '재고가 남아 있는 로케이션은 비활성화할 수 없습니다. 먼저 재고를 이관하세요.'; end if;

    select count(*) into v_jobs
    from public.transfer_jobs
    where status in ('DRAFT','READY')
      and (source_location_id=p_location_id or destination_location_id=p_location_id);
    if v_jobs>0 then raise exception '진행 중인 이관 업무에 사용 중인 로케이션은 비활성화할 수 없습니다.'; end if;
  end if;

  update public.locations l set
    location_code=coalesce(upper(trim(p_new_location_code)),l.location_code),
    zone=coalesce(upper(trim(p_new_zone)),l.zone),
    active=coalesce(p_new_active,l.active),
    unavailable=case when p_new_active is not null then false else l.unavailable end,
    unavailable_reason=case when p_new_active is not null then null else l.unavailable_reason end,
    updated_at=now()
  where l.id=p_location_id returning l.* into v_after;

  update public.scan_targets
  set active=(v_after.active and not v_after.unavailable)
  where id=v_after.scan_target_id;

  perform public.write_audit('LOCATION_UPDATED','location',p_location_id::text,v_after.location_code,to_jsonb(v_before),to_jsonb(v_after));
  return to_jsonb(v_after);
end;
$$;

-- 사용불가 LOC에 재고가 다시 생기는 것을 모든 경로(CSV, 입고, 이관, 거래취소)에서 차단합니다.
create or replace function public.guard_unavailable_inventory_balance()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.qty>0 and exists(
    select 1 from public.locations l where l.id=new.location_id and l.unavailable
  ) then
    raise exception '사용불가로 지정된 로케이션에는 재고를 저장할 수 없습니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_unavailable_inventory_balance on public.inventory_balances;
create trigger guard_unavailable_inventory_balance
before insert or update of qty,location_id on public.inventory_balances
for each row execute function public.guard_unavailable_inventory_balance();

-- 직접 RPC/DB 작업으로 진행 중 이관을 생성하는 경우도 차단합니다.
create or replace function public.guard_unavailable_transfer_job()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.status in ('DRAFT','READY') then
    if exists(select 1 from public.locations where id=new.source_location_id and unavailable) then
      raise exception '사용불가 LOC는 이관 출발지로 사용할 수 없습니다.';
    end if;
    if new.destination_location_id is not null and exists(
      select 1 from public.locations where id=new.destination_location_id and unavailable
    ) then
      raise exception '사용불가 LOC는 이관 도착지로 사용할 수 없습니다.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_unavailable_transfer_job on public.transfer_jobs;
create trigger guard_unavailable_transfer_job
before insert or update of source_location_id,destination_location_id,status on public.transfer_jobs
for each row execute function public.guard_unavailable_transfer_job();

revoke all on function public.list_location_map_states() from public;
revoke all on function public.admin_set_location_unavailable(uuid,boolean,text) from public;
grant execute on function public.list_location_map_states() to authenticated;
grant execute on function public.admin_set_location_unavailable(uuid,boolean,text) to authenticated;

notify pgrst, 'reload schema';
select 'SAN WMS location operational states migration completed' as result;
