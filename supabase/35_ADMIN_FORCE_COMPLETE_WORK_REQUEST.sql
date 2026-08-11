-- SAN WMS V4.5.8
-- 관리자 업무요청 강제 완료
--
-- 원칙
--   * 원 요청 수량은 절대 덮어쓰지 않는다.
--   * 실제 스캔 처리된 수량만 재고 차감/출고 수량으로 인정한다.
--   * 미처리 수량은 명세서와 감사정보에 남긴다.
--   * 관리자만 IN_PROGRESS / PARTIAL 업무를 강제 완료할 수 있다.
--   * 강제 완료 사유는 필수다.
--   * 100% 정상 처리 업무는 기존 자동 완료 경로를 사용한다.
--
-- 이 파일은 V4.5.7의 "수량 수정 승인 후 100% 자동 완료" 보정도 함께 포함하므로
-- 34번 SQL을 아직 실행하지 않았더라도 단독 실행 가능합니다.

begin;

alter table public.work_requests
  add column if not exists completion_type text,
  add column if not exists force_completed_at timestamptz,
  add column if not exists force_completed_by uuid references auth.users(id),
  add column if not exists force_completed_by_name_snapshot text,
  add column if not exists force_complete_reason text,
  add column if not exists force_completed_processed_qty integer,
  add column if not exists force_completed_unfulfilled_qty integer;

update public.work_requests
set completion_type = 'NORMAL'
where status = 'COMPLETED'
  and completion_type is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'work_requests_completion_type_check'
      and conrelid = 'public.work_requests'::regclass
  ) then
    alter table public.work_requests
      add constraint work_requests_completion_type_check
      check (completion_type is null or completion_type in ('NORMAL','ADMIN_FORCE'));
  end if;
end $$;

alter table public.work_request_documents
  add column if not exists completion_type text,
  add column if not exists requested_total_qty integer,
  add column if not exists unfulfilled_total_qty integer,
  add column if not exists force_complete_reason text,
  add column if not exists force_completed_by_name text;

alter table public.work_request_document_items
  add column if not exists requested_qty integer,
  add column if not exists unfulfilled_qty integer;

update public.work_request_documents
set completion_type = coalesce(completion_type, 'NORMAL'),
    requested_total_qty = coalesce(requested_total_qty, total_qty),
    unfulfilled_total_qty = coalesce(unfulfilled_total_qty, 0)
where completion_type is null
   or requested_total_qty is null
   or unfulfilled_total_qty is null;

update public.work_request_document_items
set requested_qty = coalesce(requested_qty, qty),
    unfulfilled_qty = coalesce(unfulfilled_qty, 0)
where requested_qty is null
   or unfulfilled_qty is null;

-- 업무요청 JSON에 완료 방식/강제완료 감사정보를 포함한다.
create or replace function public.work_request_to_json(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
select jsonb_build_object(
  'id',w.id,'request_no',w.request_no,'requester_id',w.requester_id,'requester_login_id',w.requester_login_id_snapshot,
  'requester_name',w.requester_name_snapshot,'requested_ship_date',w.requested_ship_date,'status',w.status,
  'assigned_to',w.assigned_to,'assigned_name',coalesce(w.assigned_name_snapshot,public.user_label(w.assigned_to)),
  'reserved_user_id',w.reserved_user_id,'reserved_user_name',public.user_label(w.reserved_user_id),
  'vendor_name',w.vendor_name,'vendor_contact',w.vendor_contact,'vendor_phone',w.vendor_phone,'vendor_address',w.vendor_address,
  'purpose',w.purpose,'note',w.note,'item_count',w.item_count,'total_qty',w.total_qty,
  'created_at',w.created_at,'updated_at',w.updated_at,'started_at',w.started_at,'completed_at',w.completed_at,
  'completion_type',w.completion_type,
  'force_completed_at',w.force_completed_at,
  'force_completed_by',w.force_completed_by,
  'force_completed_by_name',w.force_completed_by_name_snapshot,
  'force_complete_reason',w.force_complete_reason,
  'force_completed_processed_qty',w.force_completed_processed_qty,
  'force_completed_unfulfilled_qty',w.force_completed_unfulfilled_qty,
  'cancelled_at',w.cancelled_at,'cancel_reason',w.cancel_reason,'rejected_at',w.rejected_at,'reject_reason',w.reject_reason,
  'voided_at',w.voided_at,'void_reason',w.void_reason,
  'is_requester',w.requester_id=auth.uid(),'is_assigned',w.assigned_to=auth.uid(),
  'is_candidate',exists(select 1 from public.work_request_candidates c where c.work_request_id=w.id and c.user_id=auth.uid()),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',i.id,'product_id',i.product_id,'p_code_no',i.p_code_no_snapshot,'code_no',i.code_no_snapshot,
    'master_code_no',i.master_code_no_snapshot,'artist',i.artist_snapshot,'name_ver',i.name_ver_snapshot,
    'product_barcode',i.product_barcode_snapshot,'requested_qty',i.requested_qty,'processed_qty',i.processed_qty,
    'remaining_qty',greatest(i.requested_qty-i.processed_qty,0)
  ) order by i.artist_snapshot,i.name_ver_snapshot) from public.work_request_items i where i.work_request_id=w.id),'[]'::jsonb),
  'candidates',coalesce((select jsonb_agg(jsonb_build_object('user_id',c.user_id,'name',public.user_label(c.user_id),'role',p.role) order by public.user_label(c.user_id))
    from public.work_request_candidates c join public.profiles p on p.id=c.user_id where c.work_request_id=w.id),'[]'::jsonb),
  'scans',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'product_id',s.product_id,'location_id',s.location_id,
    'location_code',l.location_code,'qty',s.qty,'scanned_by',s.scanned_by,'scanned_by_name',s.scanned_by_name_snapshot,'scanned_at',s.scanned_at)
    order by s.scanned_at desc) from public.work_request_scans s join public.locations l on l.id=s.location_id where s.work_request_id=w.id),'[]'::jsonb),
  'change_requests',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'status',c.status,'reason',c.reason,'proposed_header',c.proposed_header,
    'proposed_items',c.proposed_items,'requested_by_name',c.requested_by_name_snapshot,'requested_at',c.requested_at,
    'decided_by_name',c.decided_by_name_snapshot,'decision_note',c.decision_note,'decided_at',c.decided_at) order by c.requested_at desc)
    from public.work_request_change_requests c where c.work_request_id=w.id),'[]'::jsonb),
  'document_id',(select d.id from public.work_request_documents d where d.work_request_id=w.id)
)
from public.work_requests w where w.id=p_request_id;
$$;

-- 명세서는 실제 processed_qty만 출고 수량으로 기록하면서 요청/미출고 수량도 스냅샷으로 남긴다.
create or replace function public.finalize_work_request_document(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_request public.work_requests%rowtype;
  v_doc uuid;
  v_no text;
  v_item public.work_request_items%rowtype;
  v_doc_item uuid;
  v_line integer:=0;
  v_alloc record;
  v_requested_total integer:=0;
  v_processed_total integer:=0;
  v_unfulfilled_total integer:=0;
begin
  select * into v_request from public.work_requests where id=p_request_id;
  if not found then raise exception '업무요청을 찾을 수 없습니다.'; end if;

  select id into v_doc from public.work_request_documents where work_request_id=p_request_id;
  if v_doc is not null then return v_doc; end if;

  select
    coalesce(sum(requested_qty),0)::integer,
    coalesce(sum(processed_qty),0)::integer,
    coalesce(sum(greatest(requested_qty-processed_qty,0)),0)::integer
  into v_requested_total,v_processed_total,v_unfulfilled_total
  from public.work_request_items
  where work_request_id=p_request_id;

  v_no:='WR-SHIP-'||to_char(clock_timestamp() at time zone 'Asia/Seoul','YYYYMMDD')||'-'||lpad(nextval('public.work_request_document_no_seq')::text,6,'0');

  insert into public.work_request_documents(
    document_no,work_request_id,shipment_date,vendor_name,vendor_contact,vendor_phone,vendor_address,purpose,note,
    requester_id,requester_login_id_snapshot,requester_name_snapshot,worker_id,worker_name_snapshot,total_sku,total_qty,
    completion_type,requested_total_qty,unfulfilled_total_qty,force_complete_reason,force_completed_by_name
  ) values (
    v_no,p_request_id,current_date,v_request.vendor_name,v_request.vendor_contact,v_request.vendor_phone,v_request.vendor_address,v_request.purpose,v_request.note,
    v_request.requester_id,v_request.requester_login_id_snapshot,v_request.requester_name_snapshot,v_request.assigned_to,
    coalesce(v_request.assigned_name_snapshot,public.user_label(v_request.assigned_to)),
    (select count(*) from public.work_request_items where work_request_id=p_request_id and processed_qty>0),
    v_processed_total,
    coalesce(v_request.completion_type,'NORMAL'),v_requested_total,v_unfulfilled_total,
    v_request.force_complete_reason,v_request.force_completed_by_name_snapshot
  ) returning id into v_doc;

  for v_item in
    select * from public.work_request_items
    where work_request_id=p_request_id and processed_qty>0
    order by artist_snapshot,name_ver_snapshot
  loop
    v_line:=v_line+1;
    insert into public.work_request_document_items(
      document_id,line_no,product_id,p_code_no,code_no,master_code_no,artist,name_ver,product_barcode,qty,requested_qty,unfulfilled_qty
    ) values (
      v_doc,v_line,v_item.product_id,v_item.p_code_no_snapshot,v_item.code_no_snapshot,v_item.master_code_no_snapshot,
      v_item.artist_snapshot,v_item.name_ver_snapshot,v_item.product_barcode_snapshot,v_item.processed_qty,
      v_item.requested_qty,greatest(v_item.requested_qty-v_item.processed_qty,0)
    ) returning id into v_doc_item;

    for v_alloc in
      select s.location_id,l.location_code,sum(s.qty)::integer qty
      from public.work_request_scans s
      join public.locations l on l.id=s.location_id
      where s.work_request_id=p_request_id and s.product_id=v_item.product_id
      group by s.location_id,l.location_code
    loop
      insert into public.work_request_document_allocations(document_item_id,location_id,location_code,qty)
      values(v_doc_item,v_alloc.location_id,v_alloc.location_code,v_alloc.qty);
    end loop;
  end loop;

  return v_doc;
end;
$$;

-- 관리자 강제 완료 RPC
create or replace function public.admin_force_complete_work_request(
  p_request_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_request public.work_requests%rowtype;
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_processed integer:=0;
  v_unfulfilled integer:=0;
  v_doc uuid;
begin
  perform public.require_role(array['admin']);

  if v_reason is null then
    raise exception '강제 완료 사유를 입력하세요.';
  end if;

  select * into v_request
  from public.work_requests
  where id=p_request_id
  for update;

  if not found then raise exception '업무요청을 찾을 수 없습니다.'; end if;
  if v_request.status not in ('IN_PROGRESS','PARTIAL') then
    raise exception '작업 중 또는 부분 처리 상태의 업무요청만 강제 완료할 수 있습니다.';
  end if;
  if v_request.assigned_to is null then
    raise exception '배정된 작업자가 없는 업무요청은 강제 완료할 수 없습니다.';
  end if;

  select
    coalesce(sum(processed_qty),0)::integer,
    coalesce(sum(greatest(requested_qty-processed_qty,0)),0)::integer
  into v_processed,v_unfulfilled
  from public.work_request_items
  where work_request_id=p_request_id;

  if v_unfulfilled <= 0 then
    raise exception '미처리 수량이 없습니다. 정상 완료 처리 대상입니다.';
  end if;

  -- 완료와 동시에 승인 대기 수정 요청은 더 이상 적용할 수 없으므로 감사정보를 남기고 취소한다.
  update public.work_request_change_requests
  set status='CANCELLED',
      decided_by=auth.uid(),
      decided_by_name_snapshot=public.user_label(auth.uid()),
      decision_note=concat_ws(' · ',nullif(decision_note,''),'관리자 강제 완료로 자동 취소'),
      decided_at=now()
  where work_request_id=p_request_id
    and status='PENDING';

  update public.work_requests
  set status='COMPLETED',
      completed_at=now(),
      completion_type='ADMIN_FORCE',
      force_completed_at=now(),
      force_completed_by=auth.uid(),
      force_completed_by_name_snapshot=public.user_label(auth.uid()),
      force_complete_reason=v_reason,
      force_completed_processed_qty=v_processed,
      force_completed_unfulfilled_qty=v_unfulfilled,
      updated_at=now()
  where id=p_request_id;

  v_doc:=public.finalize_work_request_document(p_request_id);

  if not exists (
    select 1 from public.work_request_notifications
    where work_request_id=p_request_id and notification_type='WORK_COMPLETED'
  ) then
    insert into public.work_request_notifications(work_request_id,user_id,notification_type,message,available_from)
    values(
      p_request_id,v_request.requester_id,'WORK_COMPLETED',
      v_request.request_no||' 업무가 관리자 판단으로 완료되었습니다. 실제 출고 '||v_processed||' / 요청 '||v_request.total_qty||'개.',now()
    );
  end if;

  perform public.write_work_request_event(
    p_request_id,
    'ADMIN_FORCE_COMPLETED',
    to_jsonb(v_request),
    public.work_request_to_json(p_request_id),
    v_reason
  );

  return public.work_request_to_json(p_request_id);
end;
$$;

-- 명세서 조회에도 요청/실제/미출고 및 강제완료 정보를 포함한다.
create or replace function public.get_work_request_document(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_doc public.work_request_documents%rowtype;
  v_role text;
begin
  perform public.require_user_ready();
  v_role:=public.current_role();
  select * into v_doc from public.work_request_documents where id=p_document_id;
  if not found or not (v_role in ('admin','manager') or v_doc.requester_id=auth.uid() or v_doc.worker_id=auth.uid()) then
    raise exception '명세서를 조회할 권한이 없습니다.';
  end if;

  return jsonb_build_object(
    'id',v_doc.id,'document_no',v_doc.document_no,'work_request_id',v_doc.work_request_id,
    'request_no',(select request_no from public.work_requests where id=v_doc.work_request_id),
    'shipment_date',v_doc.shipment_date,'vendor_name',v_doc.vendor_name,'vendor_contact',v_doc.vendor_contact,
    'vendor_phone',v_doc.vendor_phone,'vendor_address',v_doc.vendor_address,'purpose',v_doc.purpose,'note',v_doc.note,
    'requester_login_id',v_doc.requester_login_id_snapshot,'requester_name',v_doc.requester_name_snapshot,
    'worker_name',v_doc.worker_name_snapshot,'total_sku',v_doc.total_sku,'total_qty',v_doc.total_qty,'created_at',v_doc.created_at,
    'completion_type',coalesce(v_doc.completion_type,'NORMAL'),
    'requested_total_qty',coalesce(v_doc.requested_total_qty,v_doc.total_qty),
    'unfulfilled_total_qty',coalesce(v_doc.unfulfilled_total_qty,0),
    'force_complete_reason',v_doc.force_complete_reason,
    'force_completed_by_name',v_doc.force_completed_by_name,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'line_no',i.line_no,'product_id',i.product_id,'p_code_no',i.p_code_no,'code_no',i.code_no,'master_code_no',i.master_code_no,
      'artist',i.artist,'name_ver',i.name_ver,'product_barcode',i.product_barcode,'qty',i.qty,
      'requested_qty',coalesce(i.requested_qty,i.qty),'unfulfilled_qty',coalesce(i.unfulfilled_qty,0),
      'allocations',coalesce((select jsonb_agg(jsonb_build_object('location_id',a.location_id,'location_code',a.location_code,'qty',a.qty))
        from public.work_request_document_allocations a where a.document_item_id=i.id),'[]'::jsonb)
      ) order by i.line_no)
      from public.work_request_document_items i where i.document_id=v_doc.id),'[]'::jsonb)
  );
end;
$$;

-- V4.5.7 보정: 작업 중 수량 수정 승인 후 100%면 자동 완료한다.
create or replace function public.reconcile_work_request_completion_after_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_request public.work_requests%rowtype;
  v_fulfilled boolean:=false;
  v_has_processed boolean:=false;
  v_doc uuid;
begin
  if new.status<>'APPROVED' or old.status='APPROVED' then return new; end if;

  select * into v_request from public.work_requests where id=new.work_request_id for update;
  if not found or v_request.status not in ('IN_PROGRESS','PARTIAL') then return new; end if;

  select
    exists(select 1 from public.work_request_items where work_request_id=v_request.id)
    and not exists(select 1 from public.work_request_items where work_request_id=v_request.id and processed_qty<requested_qty),
    exists(select 1 from public.work_request_items where work_request_id=v_request.id and processed_qty>0)
  into v_fulfilled,v_has_processed;

  if v_fulfilled then
    update public.work_requests
    set status='COMPLETED',completed_at=coalesce(completed_at,now()),completion_type=coalesce(completion_type,'NORMAL'),updated_at=now()
    where id=v_request.id;
    v_doc:=public.finalize_work_request_document(v_request.id);

    if not exists(select 1 from public.work_request_notifications where work_request_id=v_request.id and notification_type='WORK_COMPLETED') then
      insert into public.work_request_notifications(work_request_id,user_id,notification_type,message,available_from)
      values(v_request.id,v_request.requester_id,'WORK_COMPLETED',v_request.request_no||' 출고 작업이 완료되었습니다.',now());
    end if;
    if not exists(select 1 from public.work_request_events where work_request_id=v_request.id and event_type='WORK_COMPLETED') then
      perform public.write_work_request_event(v_request.id,'WORK_COMPLETED',null,jsonb_build_object('document_id',v_doc),'수정 승인 후 전체 요청 수량 충족으로 자동 완료');
    end if;
  elsif v_has_processed and v_request.status='IN_PROGRESS' then
    update public.work_requests set status='PARTIAL',updated_at=now() where id=v_request.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_work_request_reconcile_after_change_approval on public.work_request_change_requests;
create trigger trg_work_request_reconcile_after_change_approval
after update of status on public.work_request_change_requests
for each row when (new.status='APPROVED')
execute function public.reconcile_work_request_completion_after_change();

-- 이미 100%인데 열린 상태로 남은 기존 건은 정상 완료로 보정한다.
do $$
declare
  v_request public.work_requests%rowtype;
  v_doc uuid;
begin
  for v_request in
    select wr.* from public.work_requests wr
    where wr.status in ('IN_PROGRESS','PARTIAL')
      and exists(select 1 from public.work_request_items i where i.work_request_id=wr.id)
      and not exists(select 1 from public.work_request_items i where i.work_request_id=wr.id and i.processed_qty<i.requested_qty)
    for update
  loop
    update public.work_requests
    set status='COMPLETED',completed_at=coalesce(completed_at,now()),completion_type=coalesce(completion_type,'NORMAL'),updated_at=now()
    where id=v_request.id;
    v_doc:=public.finalize_work_request_document(v_request.id);
    if not exists(select 1 from public.work_request_events where work_request_id=v_request.id and event_type='WORK_COMPLETED') then
      insert into public.work_request_events(work_request_id,event_type,actor_id,actor_name_snapshot,before_data,after_data,note)
      values(v_request.id,'WORK_COMPLETED',null,'SYSTEM',null,jsonb_build_object('document_id',v_doc),'기존 100% 처리 업무요청 상태 자동 보정');
    end if;
  end loop;
end;
$$;

revoke all on function public.admin_force_complete_work_request(uuid,text) from public,anon;
grant execute on function public.admin_force_complete_work_request(uuid,text) to authenticated;

revoke all on function public.reconcile_work_request_completion_after_change() from public,anon;

notify pgrst,'reload schema';
commit;

select
  'SAN WMS V4.5.8 admin force complete work request migration completed' as result;
