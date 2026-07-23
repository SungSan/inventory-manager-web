-- SAN WMS V3.8.2
-- 1) 로케이션 맵에서 사용불가(unavailable=true)로 지정한 LOC를 재고실사 대상에서 제외
-- 2) PENDING LOC의 전산 SKU를 현재 재고 기준으로 표시
-- 3) 현재 전산 SKU가 0인 PENDING LOC를 시작 화면 진입 없이 즉시 완료

begin;

create or replace function public.guard_inventory_count_target_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.locations l
    where l.id = new.location_id
      and coalesce(l.unavailable, false) = true
  ) then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_inventory_count_target_location
  on public.inventory_count_locations;

create trigger trg_guard_inventory_count_target_location
before insert on public.inventory_count_locations
for each row
execute function public.guard_inventory_count_target_location();

-- 이미 생성됐지만 아직 시작하지 않은 사용불가 LOC도 실사 대상에서 제거한다.
delete from public.inventory_count_locations sl
using public.locations l
where sl.location_id = l.id
  and coalesce(l.unavailable, false) = true
  and sl.status = 'PENDING';

-- 미시작 LOC는 실사 스냅샷이 없으므로 현재 재고 기준 SKU 수를 반환한다.
create or replace function public.get_inventory_count_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public.require_role(array['admin','manager','operator']);

  select jsonb_build_object(
    'id',s.id,
    'count_no',s.count_no,
    'scope_type',s.scope_type,
    'scope_value',s.scope_value,
    'status',s.status,
    'note',s.note,
    'created_at',s.created_at,
    'completed_at',s.completed_at,
    'cancelled_at',s.cancelled_at,
    'locations',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'session_id',sl.session_id,
          'location_id',l.id,
          'location_code',l.location_code,
          'zone',l.zone,
          'status',sl.status,
          'system_sku_count',case
            when sl.status='PENDING' then (
              select count(*)::integer
              from public.inventory_stock_view v
              where v.location_id=l.id
                and coalesce(v.qty,0)>0
            )
            else sl.system_sku_count
          end,
          'counted_sku_count',sl.counted_sku_count,
          'difference_sku_count',sl.difference_sku_count,
          'difference_qty',sl.difference_qty,
          'started_at',sl.started_at,
          'completed_at',sl.completed_at,
          'next_due_at',sl.next_due_at
        )
        order by case sl.status
          when 'IN_PROGRESS' then 0
          when 'PENDING' then 1
          when 'CANCELLED' then 2
          else 3
        end,l.location_code
      )
      from public.inventory_count_locations sl
      join public.locations l on l.id=sl.location_id
      where sl.session_id=s.id
        and coalesce(l.unavailable,false)=false
    ),'[]'::jsonb)
  )
  into v_result
  from public.inventory_count_sessions s
  where s.id=p_session_id;

  if v_result is null then
    raise exception '재고실사 작업을 찾을 수 없습니다.';
  end if;

  return v_result;
end;
$$;

create or replace function public.complete_empty_inventory_count_location(
  p_session_id uuid,
  p_location_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location_code text;
  v_status text;
  v_total_qty numeric;
  v_result jsonb;
begin
  select l.location_code, sl.status
    into v_location_code, v_status
  from public.inventory_count_locations sl
  join public.inventory_count_sessions s on s.id = sl.session_id
  join public.locations l on l.id = sl.location_id
  where sl.session_id = p_session_id
    and sl.location_id = p_location_id
    and s.status = 'IN_PROGRESS'
    and coalesce(l.unavailable, false) = false
  for update of sl, l;

  if not found then
    raise exception '실사 대상이 아니거나 사용불가 상태인 LOC입니다.';
  end if;

  if v_status <> 'PENDING' then
    raise exception '대기 상태인 LOC만 빈 LOC 확인 완료할 수 있습니다.';
  end if;

  select coalesce(sum(greatest(coalesce(v.qty, 0), 0)), 0)
    into v_total_qty
  from public.inventory_stock_view v
  where v.location_id = p_location_id;

  if v_total_qty <> 0 then
    raise exception '현재 전산 재고가 존재하여 빈 LOC로 완료할 수 없습니다. 새로고침 후 일반 실사를 진행하세요.';
  end if;

  perform public.start_inventory_count_location(p_session_id, p_location_id);

  select coalesce(sum(greatest(coalesce(v.qty, 0), 0)), 0)
    into v_total_qty
  from public.inventory_stock_view v
  where v.location_id = p_location_id;

  if v_total_qty <> 0 then
    raise exception '확인 처리 중 재고가 변경되었습니다. 일반 실사를 진행하세요.';
  end if;

  v_result := public.complete_inventory_count_location(p_session_id, p_location_id);

  return v_result || jsonb_build_object(
    'completion_type', 'EMPTY_CONFIRMED',
    'empty_confirmed', true,
    'location_code', v_location_code
  );
end;
$$;

grant execute on function public.get_inventory_count_session(uuid) to authenticated;
grant execute on function public.complete_empty_inventory_count_location(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;

select 'SAN WMS V3.8.2 live SKU and unavailable LOC stocktake migration completed' as result;
