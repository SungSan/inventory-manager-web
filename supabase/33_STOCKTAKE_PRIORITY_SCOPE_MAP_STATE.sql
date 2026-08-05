-- SAN WMS V4.5.6
-- 재고실사 우선 범위 지원
--
-- 목적
--   1) 로케이션맵 및 재고실사 화면에 최근 완료 실사 이후의 이동 이력을 일관되게 반환
--   2) transfer_movement_count_since_count > 0 인 LOC를 "확인 필요"로 분류 가능하게 보장
--   3) 기존 재고실사 상태(DUE_SOON / DUE / NEVER 등)는 get_inventory_count_dashboard 결과를 그대로 사용
--
-- 데이터 보존형 마이그레이션이며 재고, 실사, 이관 기록을 수정하거나 삭제하지 않습니다.

begin;

create or replace function public.list_location_map_states()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dashboard jsonb;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  -- 현재 운영 중인 재고실사 판정식을 단일 기준으로 재사용합니다.
  v_dashboard := public.get_inventory_count_dashboard();

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'location_id', l.id,
        'unavailable', coalesce(l.unavailable, false),
        'unavailable_reason', l.unavailable_reason,
        'active_transfer_count', coalesce(active_transfer.job_count, 0),
        'active_transfer_role', case
          when coalesce(active_transfer.is_source, false)
           and coalesce(active_transfer.is_destination, false) then 'BOTH'
          when coalesce(active_transfer.is_source, false) then 'SOURCE'
          when coalesce(active_transfer.is_destination, false) then 'DESTINATION'
          else null
        end,
        'active_stocktake_count', coalesce(active_count.count_value, 0),
        'active_stocktake_session_id', active_count.session_id,
        'active_stocktake_count_no', active_count.count_no,
        'inventory_count_status', dashboard_location.row_value ->> 'count_status',
        'last_counted_at', dashboard_location.row_value ->> 'last_counted_at',
        'next_due_at', dashboard_location.row_value ->> 'next_due_at',
        'movement_count_since_count', coalesce(movement.transaction_count, 0),
        'transfer_movement_count_since_count', coalesce(movement.transfer_job_count, 0),
        'moved_qty_since_count', coalesce(movement.moved_qty, 0)
      )
      order by l.location_code
    ),
    '[]'::jsonb
  )
  into v_result
  from public.locations l
  left join lateral (
    select item as row_value
    from jsonb_array_elements(coalesce(v_dashboard -> 'locations', '[]'::jsonb)) item
    where item ->> 'location_id' = l.id::text
    limit 1
  ) dashboard_location on true
  left join lateral (
    select
      count(distinct j.id)::integer as job_count,
      bool_or(j.source_location_id = l.id) as is_source,
      bool_or(j.destination_location_id = l.id) as is_destination
    from public.transfer_jobs j
    where j.status in ('DRAFT', 'READY')
      and (j.source_location_id = l.id or j.destination_location_id = l.id)
  ) active_transfer on true
  left join lateral (
    select
      count(*)::integer as count_value,
      (array_agg(s.id order by s.created_at desc))[1] as session_id,
      (array_agg(s.count_no order by s.created_at desc))[1] as count_no
    from public.inventory_count_locations cl
    join public.inventory_count_sessions s on s.id = cl.session_id
    where cl.location_id = l.id
      and s.status = 'IN_PROGRESS'
      and cl.status in ('PENDING', 'IN_PROGRESS')
  ) active_count on true
  left join lateral (
    select
      count(t.id)::integer as transaction_count,
      count(distinct t.reference_id) filter (
        where t.reference_type = 'TRANSFER'
          and nullif(t.reference_id, '') is not null
      )::integer as transfer_job_count,
      coalesce(sum(t.qty), 0) as moved_qty
    from public.inventory_transactions t
    where t.location_id = l.id
      and coalesce(t.status, 'ACTIVE') = 'ACTIVE'
      and dashboard_location.row_value ->> 'last_counted_at' is not null
      and t.created_at > (dashboard_location.row_value ->> 'last_counted_at')::timestamptz
  ) movement on true;

  return v_result;
end;
$$;

revoke all on function public.list_location_map_states() from public, anon;
grant execute on function public.list_location_map_states() to authenticated;

notify pgrst, 'reload schema';

commit;

select
  'SAN WMS V4.5.6 stocktake priority scope map state completed' as result;
