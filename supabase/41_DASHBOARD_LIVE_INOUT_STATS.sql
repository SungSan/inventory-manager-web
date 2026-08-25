-- SAN WMS V4.6.6
-- Dashboard live inbound/outbound statistics
--
-- Periods
--   DAY   : hourly buckets
--   WEEK  : daily buckets (Mon-Sun)
--   MONTH : daily buckets
--   YEAR  : monthly buckets
--
-- Timezone is fixed to Asia/Seoul for warehouse operations.
-- Transactions already marked REVERSED are excluded. REVERSAL rows themselves remain
-- because they represent the effective inventory correction that is still valid.

begin;

create index if not exists idx_inventory_transactions_created_at
  on public.inventory_transactions(created_at desc);

create or replace function public.get_dashboard_flow_stats(
  p_period text default 'DAY',
  p_anchor_date date default ((now() at time zone 'Asia/Seoul')::date)
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_period text:=upper(btrim(coalesce(p_period,'DAY')));
  v_anchor date:=coalesce(p_anchor_date,(now() at time zone 'Asia/Seoul')::date);
  v_start_date date;
  v_end_date date;
  v_start_ts timestamptz;
  v_end_ts timestamptz;
  v_period_label text;
  v_inbound_qty bigint:=0;
  v_outbound_qty bigint:=0;
  v_inbound_count bigint:=0;
  v_outbound_count bigint:=0;
  v_series jsonb:='[]'::jsonb;
begin
  perform public.require_user_ready();

  if v_period not in ('DAY','WEEK','MONTH','YEAR') then
    raise exception '지원되지 않는 조회 기간입니다.';
  end if;

  if v_period='DAY' then
    v_start_date:=v_anchor;
    v_end_date:=v_start_date+1;
    v_period_label:=to_char(v_start_date,'YYYY-MM-DD');
  elsif v_period='WEEK' then
    v_start_date:=date_trunc('week',v_anchor::timestamp)::date;
    v_end_date:=v_start_date+7;
    v_period_label:=to_char(v_start_date,'YYYY-MM-DD')||' ~ '||to_char(v_end_date-1,'YYYY-MM-DD');
  elsif v_period='MONTH' then
    v_start_date:=date_trunc('month',v_anchor::timestamp)::date;
    v_end_date:=(v_start_date+interval '1 month')::date;
    v_period_label:=to_char(v_start_date,'YYYY-MM');
  else
    v_start_date:=date_trunc('year',v_anchor::timestamp)::date;
    v_end_date:=(v_start_date+interval '1 year')::date;
    v_period_label:=to_char(v_start_date,'YYYY');
  end if;

  v_start_ts:=v_start_date::timestamp at time zone 'Asia/Seoul';
  v_end_ts:=v_end_date::timestamp at time zone 'Asia/Seoul';

  select
    coalesce(sum(t.qty) filter (where t.operation='IB'),0)::bigint,
    coalesce(sum(t.qty) filter (where t.operation='OB'),0)::bigint,
    count(*) filter (where t.operation='IB')::bigint,
    count(*) filter (where t.operation='OB')::bigint
  into v_inbound_qty,v_outbound_qty,v_inbound_count,v_outbound_count
  from public.inventory_transactions t
  where t.created_at>=v_start_ts
    and t.created_at<v_end_ts
    and t.operation in ('IB','OB')
    and coalesce(t.status,'ACTIVE')<>'REVERSED';

  if v_period='DAY' then
    with buckets as (
      select generate_series(
        v_start_date::timestamp,
        v_end_date::timestamp-interval '1 hour',
        interval '1 hour'
      ) as bucket
    ), agg as (
      select
        date_trunc('hour',t.created_at at time zone 'Asia/Seoul') as bucket,
        coalesce(sum(t.qty) filter (where t.operation='IB'),0)::bigint inbound_qty,
        coalesce(sum(t.qty) filter (where t.operation='OB'),0)::bigint outbound_qty,
        count(*) filter (where t.operation='IB')::bigint inbound_count,
        count(*) filter (where t.operation='OB')::bigint outbound_count
      from public.inventory_transactions t
      where t.created_at>=v_start_ts
        and t.created_at<v_end_ts
        and t.operation in ('IB','OB')
        and coalesce(t.status,'ACTIVE')<>'REVERSED'
      group by 1
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'bucket',to_char(b.bucket,'YYYY-MM-DD"T"HH24:00:00'),
      'label',to_char(b.bucket,'HH24:00'),
      'inbound_qty',coalesce(a.inbound_qty,0),
      'outbound_qty',coalesce(a.outbound_qty,0),
      'inbound_count',coalesce(a.inbound_count,0),
      'outbound_count',coalesce(a.outbound_count,0)
    ) order by b.bucket),'[]'::jsonb)
    into v_series
    from buckets b
    left join agg a on a.bucket=b.bucket;

  elsif v_period in ('WEEK','MONTH') then
    with buckets as (
      select generate_series(
        v_start_date::timestamp,
        v_end_date::timestamp-interval '1 day',
        interval '1 day'
      ) as bucket
    ), agg as (
      select
        date_trunc('day',t.created_at at time zone 'Asia/Seoul') as bucket,
        coalesce(sum(t.qty) filter (where t.operation='IB'),0)::bigint inbound_qty,
        coalesce(sum(t.qty) filter (where t.operation='OB'),0)::bigint outbound_qty,
        count(*) filter (where t.operation='IB')::bigint inbound_count,
        count(*) filter (where t.operation='OB')::bigint outbound_count
      from public.inventory_transactions t
      where t.created_at>=v_start_ts
        and t.created_at<v_end_ts
        and t.operation in ('IB','OB')
        and coalesce(t.status,'ACTIVE')<>'REVERSED'
      group by 1
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'bucket',to_char(b.bucket,'YYYY-MM-DD'),
      'label',to_char(b.bucket,'MM/DD'),
      'inbound_qty',coalesce(a.inbound_qty,0),
      'outbound_qty',coalesce(a.outbound_qty,0),
      'inbound_count',coalesce(a.inbound_count,0),
      'outbound_count',coalesce(a.outbound_count,0)
    ) order by b.bucket),'[]'::jsonb)
    into v_series
    from buckets b
    left join agg a on a.bucket=b.bucket;

  else
    with buckets as (
      select generate_series(
        v_start_date::timestamp,
        v_end_date::timestamp-interval '1 month',
        interval '1 month'
      ) as bucket
    ), agg as (
      select
        date_trunc('month',t.created_at at time zone 'Asia/Seoul') as bucket,
        coalesce(sum(t.qty) filter (where t.operation='IB'),0)::bigint inbound_qty,
        coalesce(sum(t.qty) filter (where t.operation='OB'),0)::bigint outbound_qty,
        count(*) filter (where t.operation='IB')::bigint inbound_count,
        count(*) filter (where t.operation='OB')::bigint outbound_count
      from public.inventory_transactions t
      where t.created_at>=v_start_ts
        and t.created_at<v_end_ts
        and t.operation in ('IB','OB')
        and coalesce(t.status,'ACTIVE')<>'REVERSED'
      group by 1
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'bucket',to_char(b.bucket,'YYYY-MM-01'),
      'label',to_char(b.bucket,'YYYY-MM'),
      'inbound_qty',coalesce(a.inbound_qty,0),
      'outbound_qty',coalesce(a.outbound_qty,0),
      'inbound_count',coalesce(a.inbound_count,0),
      'outbound_count',coalesce(a.outbound_count,0)
    ) order by b.bucket),'[]'::jsonb)
    into v_series
    from buckets b
    left join agg a on a.bucket=b.bucket;
  end if;

  return jsonb_build_object(
    'period',v_period,
    'anchor_date',to_char(v_anchor,'YYYY-MM-DD'),
    'period_label',v_period_label,
    'start_date',to_char(v_start_date,'YYYY-MM-DD'),
    'end_date',to_char(v_end_date-1,'YYYY-MM-DD'),
    'inbound_qty',v_inbound_qty,
    'outbound_qty',v_outbound_qty,
    'inbound_count',v_inbound_count,
    'outbound_count',v_outbound_count,
    'series',v_series,
    'generated_at',now()
  );
end;
$$;

revoke all on function public.get_dashboard_flow_stats(text,date) from public,anon;
grant execute on function public.get_dashboard_flow_stats(text,date) to authenticated;

notify pgrst,'reload schema';
commit;

select 'SAN WMS V4.6.6 dashboard live inout stats migration completed' as result;
