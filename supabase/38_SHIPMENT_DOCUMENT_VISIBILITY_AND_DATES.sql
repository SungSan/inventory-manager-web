-- SAN WMS V4.6.2
-- 통합 출고명세서 관리자 전용 공개범위 + 작성일/출고일 분리
-- 선행 조건: 37_UNIFIED_SHIPMENT_DOCUMENTS_HARDENING.sql
--
-- 원칙
--   1) 출고명세서 삭제 대신 관리자 전용 표시를 지원한다.
--   2) 관리자 전용 문서는 admin 외 사용자에게 목록/상세/직접 URL을 모두 차단한다.
--   3) 작성일(created_at)은 문서 생성 시 자동 기록되며 변경하지 않는다.
--   4) 출고일(shipment_date)은 실제 출고 일정에 맞게 직접 수정할 수 있다.
--   5) OUT 문서번호의 날짜는 변경 가능한 출고일이 아니라 작성일 기준으로 발급한다.
--   6) 기존 출고/재고/스캔/요청 기록은 수정하거나 삭제하지 않는다.

begin;

do $$
begin
  if to_regclass('public.shipment_document_registry') is null then
    raise exception '통합 출고명세서 SQL 37을 먼저 실행하세요.';
  end if;
end $$;

alter table public.shipment_document_registry
  add column if not exists admin_only boolean not null default false,
  add column if not exists admin_only_updated_at timestamptz,
  add column if not exists admin_only_updated_by uuid references auth.users(id);

-- 신규 OUT 번호는 작성일 기준으로 발급한다.
create or replace function public.prepare_unified_shipment_document_no()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_authored_date date;
begin
  v_authored_date := (coalesce(new.created_at, now()) at time zone 'Asia/Seoul')::date;
  new.document_no := public.next_shipment_document_no(v_authored_date);
  return new;
end;
$$;

-- 공통 접근 판정. 관리자 전용이면 admin만 허용한다.
create or replace function public.shipment_document_can_access(p_registry_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.shipment_document_registry r
    left join public.external_shipment_documents e
      on r.source_type='EXTERNAL_TRANSFER' and e.id=r.source_document_id
    left join public.work_request_documents w
      on r.source_type='WORK_REQUEST' and w.id=r.source_document_id
    where r.id=p_registry_id
      and (
        public.current_role()='admin'
        or (
          coalesce(r.admin_only,false)=false
          and (
            (r.source_type='EXTERNAL_TRANSFER' and public.current_role() in ('manager','operator'))
            or
            (r.source_type='WORK_REQUEST' and (
              public.current_role()='manager'
              or w.requester_id=auth.uid()
              or w.worker_id=auth.uid()
            ))
          )
        )
      )
  );
$$;

create or replace function public.list_shipment_documents(
  p_source_type text default 'ALL',
  p_search text default '',
  p_date_from date default null,
  p_date_to date default null,
  p_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_source text:=upper(btrim(coalesce(p_source_type,'ALL')));
  v_search text:=btrim(coalesce(p_search,''));
  v_result jsonb;
begin
  perform public.require_user_ready();
  if v_source not in ('ALL','WORK_REQUEST','EXTERNAL_TRANSFER') then
    raise exception '출고명세서 구분값이 올바르지 않습니다.';
  end if;

  with unified as (
    select
      r.id,r.document_no,r.source_type,'외부이관'::text source_label,r.source_job_id source_entity_id,
      ('EXT JOB · '||upper(left(r.source_job_id::text,8)))::text source_reference_no,
      d.shipment_date,d.vendor_name,d.purpose,d.created_by_label,
      coalesce(nullif(r.shipment_manager_name,''),d.created_by_label,'사용자') worker_name,
      d.total_sku,d.total_qty,d.total_qty requested_total_qty,0::integer unfulfilled_total_qty,
      'NORMAL'::text completion_type,coalesce(r.admin_only,false) admin_only,d.created_at,
      concat_ws(' ',r.document_no,d.vendor_name,d.purpose,d.created_by_label,r.writer_name,r.shipment_manager_name,
        coalesce((select string_agg(concat_ws(' ',i.product_barcode,i.p_code_no,i.code_no,i.master_code_no,i.artist,i.name_ver),' ')
          from public.external_shipment_items i where i.document_id=d.id),'')
      ) search_text
    from public.shipment_document_registry r
    join public.external_shipment_documents d on d.id=r.source_document_id
    where r.source_type='EXTERNAL_TRANSFER'
      and public.shipment_document_can_access(r.id)

    union all

    select
      r.id,r.document_no,r.source_type,'업무요청'::text source_label,r.source_job_id source_entity_id,
      wr.request_no source_reference_no,
      d.shipment_date,d.vendor_name,d.purpose,d.requester_name_snapshot created_by_label,
      coalesce(nullif(r.shipment_manager_name,''),d.worker_name_snapshot,'사용자') worker_name,
      d.total_sku,d.total_qty,coalesce(d.requested_total_qty,d.total_qty) requested_total_qty,
      coalesce(d.unfulfilled_total_qty,0) unfulfilled_total_qty,
      coalesce(d.completion_type,'NORMAL') completion_type,coalesce(r.admin_only,false) admin_only,d.created_at,
      concat_ws(' ',r.document_no,wr.request_no,d.vendor_name,d.purpose,d.requester_name_snapshot,d.worker_name_snapshot,
        r.writer_name,r.shipment_manager_name,
        coalesce((select string_agg(concat_ws(' ',i.product_barcode,i.p_code_no,i.code_no,i.master_code_no,i.artist,i.name_ver),' ')
          from public.work_request_document_items i where i.document_id=d.id),'')
      ) search_text
    from public.shipment_document_registry r
    join public.work_request_documents d on d.id=r.source_document_id
    join public.work_requests wr on wr.id=d.work_request_id
    where r.source_type='WORK_REQUEST'
      and public.shipment_document_can_access(r.id)
  ), filtered as (
    select * from unified
    where (v_source='ALL' or source_type=v_source)
      and (p_date_from is null or shipment_date>=p_date_from)
      and (p_date_to is null or shipment_date<=p_date_to)
      and (v_search='' or search_text ilike '%'||v_search||'%')
    order by shipment_date desc,created_at desc
    limit greatest(1,least(coalesce(p_limit,1000),2000))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'document_no',document_no,'source_type',source_type,'source_label',source_label,
    'source_entity_id',source_entity_id,'source_reference_no',source_reference_no,
    'shipment_date',shipment_date,'vendor_name',vendor_name,'purpose',purpose,
    'created_by_label',created_by_label,'worker_name',worker_name,'total_sku',total_sku,
    'total_qty',total_qty,'requested_total_qty',requested_total_qty,
    'unfulfilled_total_qty',unfulfilled_total_qty,'completion_type',completion_type,
    'admin_only',admin_only,'created_at',created_at
  ) order by shipment_date desc,created_at desc),'[]'::jsonb)
  into v_result from filtered;

  return v_result;
end;
$$;

create or replace function public.get_shipment_document(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_registry public.shipment_document_registry%rowtype;
  v_result jsonb;
begin
  perform public.require_user_ready();

  select * into v_registry
  from public.shipment_document_registry r
  where r.id=p_document_id or r.source_document_id=p_document_id
  order by case when r.id=p_document_id then 0 else 1 end
  limit 1;

  if not found then raise exception '출고명세서를 찾을 수 없습니다.'; end if;
  if not public.shipment_document_can_access(v_registry.id) then
    raise exception '출고명세서를 조회할 권한이 없습니다.';
  end if;

  if v_registry.source_type='EXTERNAL_TRANSFER' then
    select jsonb_build_object(
      'id',v_registry.id,'document_no',v_registry.document_no,
      'source_type','EXTERNAL_TRANSFER','source_label','외부이관',
      'source_entity_id',v_registry.source_job_id,
      'source_reference_no','EXT JOB · '||upper(left(v_registry.source_job_id::text,8)),
      'shipment_date',d.shipment_date,'vendor_name',d.vendor_name,'vendor_contact',d.vendor_contact,
      'vendor_phone',d.vendor_phone,'vendor_address',d.vendor_address,'purpose',d.purpose,'note',d.note,
      'created_by_label',d.created_by_label,
      'worker_name',coalesce(nullif(v_registry.shipment_manager_name,''),d.created_by_label,'사용자'),
      'writer_name',coalesce(nullif(v_registry.writer_name,''),d.created_by_label,'사용자'),
      'shipment_manager_name',coalesce(nullif(v_registry.shipment_manager_name,''),d.created_by_label,'사용자'),
      'total_sku',d.total_sku,'total_qty',d.total_qty,'requested_total_qty',d.total_qty,
      'unfulfilled_total_qty',0,'completion_type','NORMAL','admin_only',coalesce(v_registry.admin_only,false),
      'created_at',d.created_at,'force_complete_reason',null,'force_completed_by_name',null,
      'items',coalesce((
        select jsonb_agg(jsonb_build_object(
          'line_no',i.line_no,'product_id',i.product_id,'p_code_no',i.p_code_no,'code_no',i.code_no,
          'master_code_no',i.master_code_no,'artist',i.artist,'name_ver',i.name_ver,
          'product_barcode',i.product_barcode,'requested_qty',i.qty,'qty',i.qty,'unfulfilled_qty',0,'note',i.note,
          'allocations',coalesce((select jsonb_agg(jsonb_build_object(
            'location_id',a.location_id,'location_code',a.location_code,'qty',a.qty
          ) order by a.location_code) from public.external_shipment_allocations a
          where a.document_id=i.document_id and a.line_no=i.line_no),'[]'::jsonb)
        ) order by i.line_no)
        from public.external_shipment_items i where i.document_id=d.id
      ),'[]'::jsonb)
    ) into v_result
    from public.external_shipment_documents d
    where d.id=v_registry.source_document_id;
  else
    select jsonb_build_object(
      'id',v_registry.id,'document_no',v_registry.document_no,
      'source_type','WORK_REQUEST','source_label','업무요청',
      'source_entity_id',v_registry.source_job_id,'source_reference_no',wr.request_no,
      'shipment_date',d.shipment_date,'vendor_name',d.vendor_name,'vendor_contact',d.vendor_contact,
      'vendor_phone',d.vendor_phone,'vendor_address',d.vendor_address,'purpose',d.purpose,'note',d.note,
      'created_by_label',d.requester_name_snapshot,
      'worker_name',coalesce(nullif(v_registry.shipment_manager_name,''),d.worker_name_snapshot,'사용자'),
      'writer_name',coalesce(nullif(v_registry.writer_name,''),d.requester_name_snapshot,'사용자'),
      'shipment_manager_name',coalesce(nullif(v_registry.shipment_manager_name,''),d.worker_name_snapshot,'사용자'),
      'total_sku',d.total_sku,'total_qty',d.total_qty,
      'requested_total_qty',coalesce(d.requested_total_qty,d.total_qty),
      'unfulfilled_total_qty',coalesce(d.unfulfilled_total_qty,0),
      'completion_type',coalesce(d.completion_type,'NORMAL'),'admin_only',coalesce(v_registry.admin_only,false),
      'created_at',d.created_at,'force_complete_reason',d.force_complete_reason,
      'force_completed_by_name',d.force_completed_by_name,
      'items',coalesce((
        select jsonb_agg(jsonb_build_object(
          'line_no',i.line_no,'product_id',i.product_id,'p_code_no',i.p_code_no,'code_no',i.code_no,
          'master_code_no',i.master_code_no,'artist',i.artist,'name_ver',i.name_ver,
          'product_barcode',i.product_barcode,'requested_qty',coalesce(i.requested_qty,i.qty),
          'qty',i.qty,'unfulfilled_qty',coalesce(i.unfulfilled_qty,0),'note','',
          'allocations',coalesce((select jsonb_agg(jsonb_build_object(
            'location_id',a.location_id,'location_code',a.location_code,'qty',a.qty
          ) order by a.location_code) from public.work_request_document_allocations a
          where a.document_item_id=i.id),'[]'::jsonb)
        ) order by i.line_no)
        from public.work_request_document_items i where i.document_id=d.id
      ),'[]'::jsonb)
    ) into v_result
    from public.work_request_documents d
    join public.work_requests wr on wr.id=d.work_request_id
    where d.id=v_registry.source_document_id;
  end if;

  if v_result is null then raise exception '출고명세서 원본을 찾을 수 없습니다.'; end if;
  return v_result;
end;
$$;

-- 작성일은 건드리지 않고 출고일/작성자/출고담당만 원자적으로 저장한다.
create or replace function public.update_shipment_document_metadata(
  p_document_id uuid,
  p_shipment_date date,
  p_writer_name text,
  p_shipment_manager_name text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_registry public.shipment_document_registry%rowtype;
  v_date date:=p_shipment_date;
  v_writer text:=btrim(coalesce(p_writer_name,''));
  v_manager text:=btrim(coalesce(p_shipment_manager_name,''));
  v_before jsonb;
begin
  perform public.require_user_ready();
  if v_date is null then raise exception '출고일을 입력하세요.'; end if;
  if v_writer='' then raise exception '작성자를 입력하세요.'; end if;
  if v_manager='' then raise exception '출고 담당을 입력하세요.'; end if;

  select * into v_registry
  from public.shipment_document_registry r
  where r.id=p_document_id or r.source_document_id=p_document_id
  order by case when r.id=p_document_id then 0 else 1 end
  limit 1
  for update;

  if not found then raise exception '출고명세서를 찾을 수 없습니다.'; end if;
  if not public.shipment_document_can_access(v_registry.id) then
    raise exception '출고명세서를 수정할 권한이 없습니다.';
  end if;

  v_before:=jsonb_build_object(
    'shipment_date',v_registry.shipment_date,
    'writer_name',v_registry.writer_name,
    'shipment_manager_name',v_registry.shipment_manager_name
  );

  update public.shipment_document_registry
  set shipment_date=v_date,
      writer_name=v_writer,
      shipment_manager_name=v_manager
  where id=v_registry.id;

  if v_registry.source_type='EXTERNAL_TRANSFER' then
    update public.external_shipment_documents
    set shipment_date=v_date,
        writer_name=v_writer,
        shipment_manager_name=v_manager
    where id=v_registry.source_document_id;
  else
    update public.work_request_documents
    set shipment_date=v_date
    where id=v_registry.source_document_id;
  end if;

  perform public.write_audit(
    'SHIPMENT_DOCUMENT_METADATA_UPDATED','shipment_document',v_registry.id::text,
    v_registry.document_no,v_before,
    jsonb_build_object('shipment_date',v_date,'writer_name',v_writer,'shipment_manager_name',v_manager,'source_type',v_registry.source_type),
    '통합 출고명세서 출고일·작성자·출고 담당 수정'
  );

  return jsonb_build_object(
    'shipment_date',v_date,
    'writer_name',v_writer,
    'shipment_manager_name',v_manager
  );
end;
$$;

-- 삭제 대신 관리자 전용/기존 권한 공개를 전환한다.
create or replace function public.admin_set_shipment_document_visibility(
  p_document_id uuid,
  p_admin_only boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_registry public.shipment_document_registry%rowtype;
  v_next boolean:=coalesce(p_admin_only,false);
begin
  perform public.require_role(array['admin']);

  select * into v_registry
  from public.shipment_document_registry r
  where r.id=p_document_id or r.source_document_id=p_document_id
  order by case when r.id=p_document_id then 0 else 1 end
  limit 1
  for update;

  if not found then raise exception '출고명세서를 찾을 수 없습니다.'; end if;

  update public.shipment_document_registry
  set admin_only=v_next,
      admin_only_updated_at=now(),
      admin_only_updated_by=auth.uid()
  where id=v_registry.id;

  perform public.write_audit(
    'SHIPMENT_DOCUMENT_VISIBILITY_UPDATED','shipment_document',v_registry.id::text,
    v_registry.document_no,
    jsonb_build_object('admin_only',coalesce(v_registry.admin_only,false)),
    jsonb_build_object('admin_only',v_next),
    case when v_next then '출고명세서를 관리자 전용으로 변경' else '출고명세서를 기존 권한 사용자에게 공개' end
  );

  return jsonb_build_object('admin_only',v_next);
end;
$$;

-- 레거시 개별 명세서 URL은 V4.6.2 앱에서 통합 URL로 리다이렉트한다.
-- 직접 RPC 우회 조회를 막기 위해 과거 read-only 명세서 RPC의 authenticated 실행권한도 회수한다.
do $$
declare
  v_proc record;
begin
  for v_proc in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'get_external_shipment_document',
        'list_external_shipment_documents',
        'get_work_request_document',
        'list_work_request_documents'
      )
  loop
    execute format('revoke execute on function %s from public',v_proc.signature);
    execute format('revoke execute on function %s from anon',v_proc.signature);
    execute format('revoke execute on function %s from authenticated',v_proc.signature);
  end loop;
end $$;

revoke all on function public.update_shipment_document_metadata(uuid,date,text,text) from public,anon;
grant execute on function public.update_shipment_document_metadata(uuid,date,text,text) to authenticated;

revoke all on function public.admin_set_shipment_document_visibility(uuid,boolean) from public,anon;
grant execute on function public.admin_set_shipment_document_visibility(uuid,boolean) to authenticated;

notify pgrst,'reload schema';
commit;

select
  count(*) as unified_documents,
  count(*) filter (where admin_only) as admin_only_documents
from public.shipment_document_registry;

select 'SAN WMS V4.6.2 shipment visibility and authored/shipment date migration completed' as result;
