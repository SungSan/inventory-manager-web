-- SAN WMS V4.5.7
-- 업무요청 작업 중 수량 수정 승인 후 100% 처리 상태 자동 완료 보정
--
-- 문제:
--   작업 중 요청 수량을 수정/승인하면 work_request_items.requested_qty와
--   work_requests.total_qty는 변경되지만 완료 여부를 다시 계산하지 않아
--   처리 수량 = 요청 수량(100%)이어도 PARTIAL 상태가 남을 수 있었습니다.
--
-- 처리:
--   1) 수정 승인 직후 모든 품목 processed_qty >= requested_qty 이면 COMPLETED 전환
--   2) completed_at 기록
--   3) 기존 출고명세서 생성 함수 재사용(중복 생성 방지 내장)
--   4) 완료 알림/이벤트 중복 방지
--   5) 이미 100%인데 IN_PROGRESS/PARTIAL로 남은 기존 데이터 자동 보정
--
-- 재고 수량, 스캔 기록, 요청 수량 자체는 변경하지 않습니다.

begin;

create or replace function public.reconcile_work_request_completion_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.work_requests%rowtype;
  v_fulfilled boolean := false;
  v_has_processed boolean := false;
  v_doc uuid;
begin
  if new.status <> 'APPROVED' or old.status = 'APPROVED' then
    return new;
  end if;

  select *
  into v_request
  from public.work_requests
  where id = new.work_request_id
  for update;

  if not found or v_request.status not in ('IN_PROGRESS', 'PARTIAL') then
    return new;
  end if;

  select
    exists(
      select 1
      from public.work_request_items i
      where i.work_request_id = v_request.id
    )
    and not exists(
      select 1
      from public.work_request_items i
      where i.work_request_id = v_request.id
        and i.processed_qty < i.requested_qty
    ),
    exists(
      select 1
      from public.work_request_items i
      where i.work_request_id = v_request.id
        and i.processed_qty > 0
    )
  into v_fulfilled, v_has_processed;

  if v_fulfilled then
    update public.work_requests
    set status = 'COMPLETED',
        completed_at = coalesce(completed_at, now()),
        updated_at = now()
    where id = v_request.id;

    v_doc := public.finalize_work_request_document(v_request.id);

    if not exists (
      select 1
      from public.work_request_notifications n
      where n.work_request_id = v_request.id
        and n.notification_type = 'WORK_COMPLETED'
    ) then
      insert into public.work_request_notifications(
        work_request_id,
        user_id,
        notification_type,
        message,
        available_from
      ) values (
        v_request.id,
        v_request.requester_id,
        'WORK_COMPLETED',
        v_request.request_no || ' 출고 작업이 완료되었습니다.',
        now()
      );
    end if;

    if not exists (
      select 1
      from public.work_request_events e
      where e.work_request_id = v_request.id
        and e.event_type = 'WORK_COMPLETED'
    ) then
      perform public.write_work_request_event(
        v_request.id,
        'WORK_COMPLETED',
        null,
        jsonb_build_object('document_id', v_doc),
        '수정 승인 후 전체 요청 수량 충족으로 자동 완료'
      );
    end if;
  elsif v_has_processed and v_request.status = 'IN_PROGRESS' then
    update public.work_requests
    set status = 'PARTIAL',
        updated_at = now()
    where id = v_request.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_work_request_reconcile_after_change_approval
on public.work_request_change_requests;

create trigger trg_work_request_reconcile_after_change_approval
after update of status
on public.work_request_change_requests
for each row
when (new.status = 'APPROVED')
execute function public.reconcile_work_request_completion_after_change();

-- 이미 100% 처리됐지만 상태가 남아 있는 기존 업무요청 자동 복구.
do $$
declare
  v_request public.work_requests%rowtype;
  v_doc uuid;
  v_completed_at timestamptz;
begin
  for v_request in
    select wr.*
    from public.work_requests wr
    where wr.status in ('IN_PROGRESS', 'PARTIAL')
      and exists (
        select 1
        from public.work_request_items i
        where i.work_request_id = wr.id
      )
      and not exists (
        select 1
        from public.work_request_items i
        where i.work_request_id = wr.id
          and i.processed_qty < i.requested_qty
      )
    for update
  loop
    select greatest(
      coalesce((select max(s.scanned_at) from public.work_request_scans s where s.work_request_id = v_request.id), '-infinity'::timestamptz),
      coalesce((select max(c.decided_at) from public.work_request_change_requests c where c.work_request_id = v_request.id and c.status = 'APPROVED'), '-infinity'::timestamptz)
    )
    into v_completed_at;

    if v_completed_at = '-infinity'::timestamptz then
      v_completed_at := now();
    end if;

    update public.work_requests
    set status = 'COMPLETED',
        completed_at = coalesce(completed_at, v_completed_at),
        updated_at = now()
    where id = v_request.id;

    v_doc := public.finalize_work_request_document(v_request.id);

    if not exists (
      select 1
      from public.work_request_notifications n
      where n.work_request_id = v_request.id
        and n.notification_type = 'WORK_COMPLETED'
    ) then
      insert into public.work_request_notifications(
        work_request_id,
        user_id,
        notification_type,
        message,
        available_from
      ) values (
        v_request.id,
        v_request.requester_id,
        'WORK_COMPLETED',
        v_request.request_no || ' 출고 작업이 완료되었습니다.',
        now()
      );
    end if;

    if not exists (
      select 1
      from public.work_request_events e
      where e.work_request_id = v_request.id
        and e.event_type = 'WORK_COMPLETED'
    ) then
      insert into public.work_request_events(
        work_request_id,
        event_type,
        actor_id,
        actor_name_snapshot,
        before_data,
        after_data,
        note
      ) values (
        v_request.id,
        'WORK_COMPLETED',
        null,
        'SYSTEM',
        null,
        jsonb_build_object('document_id', v_doc),
        '기존 100% 처리 업무요청 상태 자동 보정'
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.reconcile_work_request_completion_after_change() from public, anon;

notify pgrst, 'reload schema';

commit;

select
  count(*) filter (where status = 'COMPLETED') as completed_requests,
  count(*) filter (
    where status in ('IN_PROGRESS', 'PARTIAL')
      and exists (
        select 1
        from public.work_request_items i
        where i.work_request_id = work_requests.id
      )
      and not exists (
        select 1
        from public.work_request_items i
        where i.work_request_id = work_requests.id
          and i.processed_qty < i.requested_qty
      )
  ) as fulfilled_but_open_requests
from public.work_requests;

select 'SAN WMS V4.5.7 work request auto-complete after change migration completed' as result;
