-- SAN WMS V4.2.0
-- 업무요청 출고 가능일 기준 수정 및 작업 시작일 제한 제거
--
-- 요청 등록 기준 (Asia/Seoul 서버 시간)
--   15:00 이전: 당일이 영업일이면 당일 출고 요청 가능
--   15:00 이후: 다음 영업일부터 출고 요청 가능
--   휴무일에는 시간과 관계없이 다음 영업일부터 가능
--
-- 작업 처리 기준
--   배정 작업자는 요청 출고일과 관계없이 즉시 작업 시작 가능
--   담당자·상태·KPI 검증은 기존대로 유지

begin;

create or replace function public.earliest_work_request_ship_date(
  p_requested_at timestamptz default now()
)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_local timestamp;
  v_today date;
begin
  v_local := p_requested_at at time zone 'Asia/Seoul';
  v_today := v_local::date;

  if v_local::time < time '15:00'
     and public.is_business_day(v_today) then
    return v_today;
  end if;

  return public.next_business_date(v_today, 1);
end;
$$;

create or replace function public.start_work_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.work_requests%rowtype;
  v_role text;
  v_allowed boolean;
  v_load numeric;
begin
  perform public.require_role(array['admin','manager','operator']);
  v_role := public.current_role();

  select * into v_request
  from public.work_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception '업무요청을 찾을 수 없습니다.';
  end if;

  if v_request.status <> 'SCHEDULED' then
    raise exception '작업 시작 가능한 상태가 아닙니다.';
  end if;

  -- 요청 출고일과 관계없이 배정된 작업자는 즉시 작업을 시작할 수 있다.
  v_allowed := v_request.assigned_to = auth.uid()
    or exists (
      select 1
      from public.work_request_candidates c
      where c.work_request_id = p_request_id
        and c.user_id = auth.uid()
    )
    or v_role in ('admin','manager');

  if not v_allowed then
    raise exception '이 업무요청의 담당 후보가 아닙니다.';
  end if;

  if v_request.assigned_to is not null
     and v_request.assigned_to <> auth.uid() then
    raise exception '이미 다른 작업자에게 배정되었습니다. 담당자: %', public.user_label(v_request.assigned_to);
  end if;

  v_load := public.worker_remaining_capacity(
    auth.uid(),
    v_request.requested_ship_date,
    v_request.item_count,
    v_request.total_qty,
    p_request_id
  );

  if v_load < 0 then
    raise exception '해당 날짜의 KPI 한도를 초과하여 작업을 시작할 수 없습니다.';
  end if;

  update public.work_requests
  set status = 'IN_PROGRESS',
      assigned_to = auth.uid(),
      assigned_name_snapshot = public.user_label(auth.uid()),
      reserved_user_id = auth.uid(),
      started_at = now(),
      updated_at = now()
  where id = p_request_id;

  perform public.write_work_request_event(
    p_request_id,
    'WORK_STARTED',
    to_jsonb(v_request),
    public.work_request_to_json(p_request_id),
    '요청 출고일과 관계없이 작업 시작 · 먼저 시작한 사용자에게 자동 배정'
  );

  insert into public.work_request_notifications(
    work_request_id,
    user_id,
    notification_type,
    message,
    available_from
  )
  values (
    p_request_id,
    v_request.requester_id,
    'WORK_STARTED',
    v_request.request_no || ' 작업이 시작되었습니다.',
    now()
  );

  return public.work_request_to_json(p_request_id);
end;
$$;

grant execute on function public.earliest_work_request_ship_date(timestamptz) to authenticated;
grant execute on function public.start_work_request(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

select
  public.earliest_work_request_ship_date(
    (date_trunc('day', now() at time zone 'Asia/Seoul') + time '14:00') at time zone 'Asia/Seoul'
  ) as before_cutoff_example,
  public.earliest_work_request_ship_date(
    (date_trunc('day', now() at time zone 'Asia/Seoul') + time '15:30') at time zone 'Asia/Seoul'
  ) as after_cutoff_example;
