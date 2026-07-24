-- SAN WMS V4.2.2
-- 업무요청 출고 가능일 기준
--
-- Asia/Seoul 서버 시간 기준
--   12:00 이전: 당일이 영업일이면 당일 출고 가능
--   12:00 이상 ~ 17:00 이하: 다음 영업일부터 가능
--   17:00 초과: 두 번째 영업일부터 가능
--   휴무일·공휴일에는 같은 시간대 규칙을 적용해 다음 영업일을 계산
--
-- 작업자는 요청 출고일과 관계없이 즉시 작업 가능하며,
-- 담당자·상태·KPI 검증은 기존 로직을 유지한다.

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
  v_time time;
begin
  v_local := p_requested_at at time zone 'Asia/Seoul';
  v_today := v_local::date;
  v_time := v_local::time;

  if v_time < time '12:00'
     and public.is_business_day(v_today) then
    return v_today;
  end if;

  if v_time <= time '17:00' then
    return public.next_business_date(v_today, 1);
  end if;

  return public.next_business_date(v_today, 2);
end;
$$;

grant execute on function public.earliest_work_request_ship_date(timestamptz) to authenticated;

notify pgrst, 'reload schema';

commit;

select
  public.earliest_work_request_ship_date(
    (date_trunc('day', now() at time zone 'Asia/Seoul') + time '11:59') at time zone 'Asia/Seoul'
  ) as before_noon,
  public.earliest_work_request_ship_date(
    (date_trunc('day', now() at time zone 'Asia/Seoul') + time '12:00') at time zone 'Asia/Seoul'
  ) as noon,
  public.earliest_work_request_ship_date(
    (date_trunc('day', now() at time zone 'Asia/Seoul') + time '17:00') at time zone 'Asia/Seoul'
  ) as five_pm,
  public.earliest_work_request_ship_date(
    (date_trunc('day', now() at time zone 'Asia/Seoul') + time '17:01') at time zone 'Asia/Seoul'
  ) as after_five_pm;
