-- SAN WMS V3.8.2
-- 1) 사용불가(active=false) 로케이션이 신규 재고실사 대상에 들어가지 않도록 DB에서 차단
-- 2) 전산 재고가 0인 PENDING LOC를 시작 화면 진입 없이 즉시 완료

begin;

create or replace function public.guard_inventory_count_target_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.locations l
    where l.id = new.location_id
      and coalesce(l.active, false) = true
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

-- 이미 생성됐지만 아직 시작하지 않은 사용불가 LOC도 대상에서 정리한다.
delete from public.inventory_count_locations sl
using public.locations l
where sl.location_id = l.id
  and coalesce(l.active, false) = false
  and sl.status = 'PENDING';

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
    and coalesce(l.active, false) = true
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

  -- 기존 시작 함수가 LOC 잠금과 실사 품목 스냅샷을 담당한다.
  perform public.start_inventory_count_location(p_session_id, p_location_id);

  -- 시작 직후 다시 확인한다. 오류 발생 시 같은 트랜잭션에서 시작 처리도 롤백된다.
  select coalesce(sum(greatest(coalesce(v.qty, 0), 0)), 0)
    into v_total_qty
  from public.inventory_stock_view v
  where v.location_id = p_location_id;

  if v_total_qty <> 0 then
    raise exception '확인 처리 중 재고가 변경되었습니다. 일반 실사를 진행하세요.';
  end if;

  -- 기존 완료 함수를 사용해 최근 실사일, 다음 실사일, 세션 자동완료 로직을 그대로 적용한다.
  v_result := public.complete_inventory_count_location(p_session_id, p_location_id);

  return v_result || jsonb_build_object(
    'completion_type', 'EMPTY_CONFIRMED',
    'empty_confirmed', true,
    'location_code', v_location_code
  );
end;
$$;

grant execute on function public.complete_empty_inventory_count_location(uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;

select 'SAN WMS V3.8.2 inactive LOC exclusion and empty LOC confirmation migration completed' as result;
