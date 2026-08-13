-- SAN WMS V4.5.10
-- 통합 출고명세서 누적 설치본
--
-- 이 파일 하나만 실행하면 된다.
-- 36_UNIFIED_SHIPMENT_DOCUMENTS.sql을 실행하지 않은 DB에서도 단독 적용 가능하며,
-- 이미 36번을 실행한 DB에서도 재실행 안전하게 동작한다.
--
-- 기능
--   * 업무요청 + 외부이관 출고명세서 공통 레지스트리
--   * 기존 EXT-* / WR-SHIP-* 문서번호와 원본 보존
--   * 신규 문서는 OUT-YYYYMMDD-NNNN 공통 번호
--   * 공통 목록/상세/담당자 RPC
--   * require_user_ready() 보안 게이트
--   * 외부이관 감사로그에도 실제 OUT 번호 기록
--
-- 재고 차감/스캔/LOC 배정/row lock/idempotency 로직은 변경하지 않는다.

begin;

alter table public.external_shipment_documents
  add column if not exists writer_name text not null default '',
  add column if not exists shipment_manager_name text not null default '';

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
set completion_type=coalesce(completion_type,'NORMAL'),
    requested_total_qty=coalesce(requested_total_qty,total_qty),
    unfulfilled_total_qty=coalesce(unfulfilled_total_qty,0)
where completion_type is null
   or requested_total_qty is null
   or unfulfilled_total_qty is null;

update public.work_request_document_items
set requested_qty=coalesce(requested_qty,qty),
    unfulfilled_qty=coalesce(unfulfilled_qty,0)
where requested_qty is null
   or unfulfilled_qty is null;

create table if not exists public.shipment_document_daily_sequences (
  shipment_date date primary key,
  last_value integer not null check(last_value > 0)
);

create table if not exists public.shipment_document_registry (
  id uuid primary key default gen_random_uuid(),
  document_no text not null,
  source_type text not null check(source_type in ('WORK_REQUEST','EXTERNAL_TRANSFER')),
  source_document_id uuid not null,
  source_job_id uuid not null,
  shipment_date date not null,
  writer_name text not null default '',
  shipment_manager_name text not null default '',
  created_at timestamptz not null default now(),
  unique(source_type,source_document_id)
);

create index if not exists shipment_document_registry_date_idx
  on public.shipment_document_registry(shipment_date desc,created_at desc);
create index if not exists shipment_document_registry_source_idx
  on public.shipment_document_registry(source_type,source_job_id);
create unique index if not exists shipment_document_registry_out_no_unique
  on public.shipment_document_registry(document_no)
  where document_no like 'OUT-%';

alter table public.shipment_document_daily_sequences enable row level security;
alter table public.shipment_document_registry enable row level security;

-- 기존 외부이관 명세서를 번호 변경 없이 통합 레지스트리에 등록한다.
insert into public.shipment_document_registry(
  document_no,source_type,source_document_id,source_job_id,shipment_date,
  writer_name,shipment_manager_name,created_at
)
select
  d.document_no,'EXTERNAL_TRANSFER',d.id,d.source_job_id,d.shipment_date,
  coalesce(nullif(btrim(d.writer_name),''),d.created_by_label,''),
  coalesce(nullif(btrim(d.shipment_manager_name),''),d.created_by_label,''),
  d.created_at
from public.external_shipment_documents d
on conflict(source_type,source_document_id) do update
set document_no=excluded.document_no,
    source_job_id=excluded.source_job_id,
    shipment_date=excluded.shipment_date,
    writer_name=case when public.shipment_document_registry.writer_name='' then excluded.writer_name else public.shipment_document_registry.writer_name end,
    shipment_manager_name=case when public.shipment_document_registry.shipment_manager_name='' then excluded.shipment_manager_name else public.shipment_document_registry.shipment_manager_name end;

-- 기존 업무요청 명세서를 번호 변경 없이 통합 레지스트리에 등록한다.
insert into public.shipment_document_registry(
  document_no,source_type,source_document_id,source_job_id,shipment_date,
  writer_name,shipment_manager_name,created_at
)
select
  d.document_no,'WORK_REQUEST',d.id,d.work_request_id,d.shipment_date,
  coalesce(nullif(btrim(d.requester_name_snapshot),''),'사용자'),
  coalesce(nullif(btrim(d.worker_name_snapshot),''),'사용자'),
  d.created_at
from public.work_request_documents d
on conflict(source_type,source_document_id) do update
set document_no=excluded.document_no,
    source_job_id=excluded.source_job_id,
    shipment_date=excluded.shipment_date,
    writer_name=case when public.shipment_document_registry.writer_name='' then excluded.writer_name else public.shipment_document_registry.writer_name end,
    shipment_manager_name=case when public.shipment_document_registry.shipment_manager_name='' then excluded.shipment_manager_name else public.shipment_document_registry.shipment_manager_name end;

-- 이전 실행에서 이미 OUT 번호가 있다면 일자별 다음 번호가 뒤로 가지 않도록 시퀀스를 보정한다.
insert into public.shipment_document_daily_sequences(shipment_date,last_value)
select
  r.shipment_date,
  max((regexp_match(r.document_no,'^OUT-[0-9]{8}-([0-9]+)$'))[1]::integer)
from public.shipment_document_registry r
where r.document_no ~ '^OUT-[0-9]{8}-[0-9]+$'
group by r.shipment_date
on conflict(shipment_date) do update
set last_value=greatest(
  public.shipment_document_daily_sequences.last_value,
  excluded.last_value
);

create or replace function public.next_shipment_document_no(p_shipment_date date default current_date)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  v_date date:=coalesce(p_shipment_date,current_date);
  v_sequence integer;
begin
  insert into public.shipment_document_daily_sequences(shipment_date,last_value)
  values(v_date,1)
  on conflict(shipment_date) do update
    set last_value=public.shipment_document_daily_sequences.last_value+1
  returning last_value into v_sequence;

  return 'OUT-'||to_char(v_date,'YYYYMMDD')||'-'||lpad(v_sequence::text,4,'0');
end;
$$;

create or replace function public.prepare_unified_shipment_document_no()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  new.document_no:=public.next_shipment_document_no(new.shipment_date);
  return new;
end;
$$;

create or replace function public.register_unified_shipment_document()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_table_name='external_shipment_documents' then
    insert into public.shipment_document_registry(
      document_no,source_type,source_document_id,source_job_id,shipment_date,
      writer_name,shipment_manager_name,created_at
    ) values(
      new.document_no,'EXTERNAL_TRANSFER',new.id,new.source_job_id,new.shipment_date,
      coalesce(nullif(btrim(new.writer_name),''),new.created_by_label,''),
      coalesce(nullif(btrim(new.shipment_manager_name),''),new.created_by_label,''),
      new.created_at
    ) on conflict(source_type,source_document_id) do update
      set document_no=excluded.document_no,
          source_job_id=excluded.source_job_id,
          shipment_date=excluded.shipment_date;
  elsif tg_table_name='work_request_documents' then
    insert into public.shipment_document_registry(
      document_no,source_type,source_document_id,source_job_id,shipment_date,
      writer_name,shipment_manager_name,created_at
    ) values(
      new.document_no,'WORK_REQUEST',new.id,new.work_request_id,new.shipment_date,
      coalesce(nullif(btrim(new.requester_name_snapshot),''),'사용자'),
      coalesce(nullif(btrim(new.worker_name_snapshot),''),'사용자'),
      new.created_at
    ) on conflict(source_type,source_document_id) do update
      set document_no=excluded.document_no,
          source_job_id=excluded.source_job_id,
          shipment_date=excluded.shipment_date;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_external_shipment_unified_no on public.external_shipment_documents;
create trigger trg_external_shipment_unified_no
before insert on public.external_shipment_documents
for each row execute function public.prepare_unified_shipment_document_no();

drop trigger if exists trg_work_request_shipment_unified_no on public.work_request_documents;
create trigger trg_work_request_shipment_unified_no
before insert on public.work_request_documents
for each row execute function public.prepare_unified_shipment_document_no();

drop trigger if exists trg_external_shipment_registry on public.external_shipment_documents;
create trigger trg_external_shipment_registry
after insert on public.external_shipment_documents
for each row execute function public.register_unified_shipment_document();

drop trigger if exists trg_work_request_shipment_registry on public.work_request_documents;
create trigger trg_work_request_shipment_registry
after insert on public.work_request_documents
for each row execute function public.register_unified_shipment_document();

create or replace function public.sync_external_shipment_personnel_to_registry()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.shipment_document_registry
  set writer_name=new.writer_name,
      shipment_manager_name=new.shipment_manager_name
  where source_type='EXTERNAL_TRANSFER'
    and source_document_id=new.id;
  return new;
end;
$$;

drop trigger if exists trg_external_shipment_personnel_registry on public.external_shipment_documents;
create trigger trg_external_shipment_personnel_registry
after update of writer_name,shipment_manager_name on public.external_shipment_documents
for each row execute function public.sync_external_shipment_personnel_to_registry();

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
    left join public.work_request_documents w
      on r.source_type='WORK_REQUEST' and w.id=r.source_document_id
    where r.id=p_registry_id
      and (
        (r.source_type='EXTERNAL_TRANSFER' and public.current_role() in ('admin','manager','operator'))
        or
        (r.source_type='WORK_REQUEST' and (
          public.current_role() in ('admin','manager')
          or w.requester_id=auth.uid()
          or w.worker_id=auth.uid()
        ))
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
      'NORMAL'::text completion_type,d.created_at,
      concat_ws(' ',r.document_no,d.vendor_name,d.purpose,d.created_by_label,r.writer_name,r.shipment_manager_name,
        coalesce((select string_agg(concat_ws(' ',i.product_barcode,i.p_code_no,i.code_no,i.master_code_no,i.artist,i.name_ver),' ')
          from public.external_shipment_items i where i.document_id=d.id),'')
      ) search_text
    from public.shipment_document_registry r
    join public.external_shipment_documents d on d.id=r.source_document_id
    where r.source_type='EXTERNAL_TRANSFER'
      and public.current_role() in ('admin','manager','operator')

    union all

    select
      r.id,r.document_no,r.source_type,'업무요청'::text source_label,r.source_job_id source_entity_id,
      wr.request_no source_reference_no,
      d.shipment_date,d.vendor_name,d.purpose,d.requester_name_snapshot created_by_label,
      coalesce(nullif(r.shipment_manager_name,''),d.worker_name_snapshot,'사용자') worker_name,
      d.total_sku,d.total_qty,coalesce(d.requested_total_qty,d.total_qty) requested_total_qty,
      coalesce(d.unfulfilled_total_qty,0) unfulfilled_total_qty,
      coalesce(d.completion_type,'NORMAL') completion_type,d.created_at,
      concat_ws(' ',r.document_no,wr.request_no,d.vendor_name,d.purpose,d.requester_name_snapshot,d.worker_name_snapshot,
        r.writer_name,r.shipment_manager_name,
        coalesce((select string_agg(concat_ws(' ',i.product_barcode,i.p_code_no,i.code_no,i.master_code_no,i.artist,i.name_ver),' ')
          from public.work_request_document_items i where i.document_id=d.id),'')
      ) search_text
    from public.shipment_document_registry r
    join public.work_request_documents d on d.id=r.source_document_id
    join public.work_requests wr on wr.id=d.work_request_id
    where r.source_type='WORK_REQUEST'
      and (
        public.current_role() in ('admin','manager')
        or d.requester_id=auth.uid()
        or d.worker_id=auth.uid()
      )
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
    'unfulfilled_total_qty',unfulfilled_total_qty,'completion_type',completion_type,'created_at',created_at
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
      'unfulfilled_total_qty',0,'completion_type','NORMAL','created_at',d.created_at,
      'force_complete_reason',null,'force_completed_by_name',null,
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
      'completion_type',coalesce(d.completion_type,'NORMAL'),'created_at',d.created_at,
      'force_complete_reason',d.force_complete_reason,'force_completed_by_name',d.force_completed_by_name,
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

create or replace function public.update_shipment_document_personnel(
  p_document_id uuid,
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
  v_writer text:=btrim(coalesce(p_writer_name,''));
  v_manager text:=btrim(coalesce(p_shipment_manager_name,''));
begin
  perform public.require_user_ready();
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

  update public.shipment_document_registry
  set writer_name=v_writer,shipment_manager_name=v_manager
  where id=v_registry.id;

  if v_registry.source_type='EXTERNAL_TRANSFER' then
    update public.external_shipment_documents
    set writer_name=v_writer,shipment_manager_name=v_manager
    where id=v_registry.source_document_id;
  end if;

  perform public.write_audit(
    'SHIPMENT_DOCUMENT_PERSONNEL_UPDATED','shipment_document',v_registry.id::text,
    v_registry.document_no,null,
    jsonb_build_object('writer_name',v_writer,'shipment_manager_name',v_manager,'source_type',v_registry.source_type),
    '통합 출고명세서 작성자·출고 담당 수정'
  );

  return jsonb_build_object('writer_name',v_writer,'shipment_manager_name',v_manager);
end;
$$;

-- 외부이관 완료 함수는 기존 로직을 그대로 유지하고 INSERT 후 실제 OUT 번호만 다시 받는다.
create or replace function public.complete_external_transfer_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_job public.external_transfer_jobs%rowtype; v_profile_label text; v_document_id uuid;
  v_document_no text; v_sequence integer; v_item record; v_allocation record;
  v_line_no integer:=0; v_item_count integer; v_total_qty bigint; v_allocated bigint;
  v_before integer; v_after integer; v_product_barcode text; v_location_barcode text;
  v_active_transfer_count integer:=0;
begin
  perform public.require_role(array['admin','manager','operator']);
  select * into v_job from public.external_transfer_jobs where id=p_job_id for update;
  if not found then raise exception '외부이관 작업을 찾을 수 없습니다.'; end if;
  if not public.external_can_access_job(p_job_id) then raise exception '이 작업을 완료할 권한이 없습니다.'; end if;
  if v_job.status not in ('DRAFT','ALLOCATING') then raise exception '이미 완료되었거나 취소된 작업입니다.'; end if;
  if nullif(trim(v_job.vendor_name),'') is null then raise exception '외부업체명을 입력하세요.'; end if;
  select count(*)::integer,coalesce(sum(requested_qty),0)::bigint into v_item_count,v_total_qty
  from public.external_transfer_items where job_id=p_job_id;
  if v_item_count=0 or v_total_qty<=0 then raise exception '출고할 상품을 하나 이상 등록하세요.'; end if;

  insert into public.external_document_daily_sequences(shipment_date,last_value)
  values(current_date,1)
  on conflict(shipment_date) do update set last_value=public.external_document_daily_sequences.last_value+1
  returning last_value into v_sequence;
  v_document_no:='EXT-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(v_sequence::text,4,'0');
  select coalesce(display_name,email,'사용자') into v_profile_label from public.profiles where id=auth.uid();
  insert into public.external_shipment_documents(
    document_no,shipment_date,vendor_name,vendor_contact,vendor_phone,vendor_address,
    purpose,note,created_by,created_by_label,source_job_id,total_sku,total_qty
  ) values(
    v_document_no,current_date,v_job.vendor_name,v_job.vendor_contact,v_job.vendor_phone,
    v_job.vendor_address,v_job.purpose,v_job.note,auth.uid(),coalesce(v_profile_label,'사용자'),
    p_job_id,v_item_count,v_total_qty
  ) returning id,document_no into v_document_id,v_document_no;

  for v_item in
    select i.product_id,i.requested_qty,p.p_code_no,p.code_no,p.master_code_no,
      p.artist,p.name_ver,p.scan_target_id
    from public.external_transfer_items i join public.products p on p.id=i.product_id
    where i.job_id=p_job_id order by i.created_at,p.artist,p.name_ver,p.code_no
  loop
    select coalesce(sum(qty),0)::bigint into v_allocated
    from public.external_transfer_allocations where job_id=p_job_id and product_id=v_item.product_id;
    if v_allocated<>v_item.requested_qty then
      raise exception '% · %의 LOC 배정 합계가 출고 수량과 다릅니다.',v_item.artist,v_item.name_ver;
    end if;
    v_line_no:=v_line_no+1;
    v_product_barcode:=public.external_primary_product_barcode(v_item.scan_target_id);
    insert into public.external_shipment_items(
      document_id,line_no,product_id,p_code_no,code_no,master_code_no,artist,name_ver,
      product_barcode,qty,note
    ) values(
      v_document_id,v_line_no,v_item.product_id,v_item.p_code_no,v_item.code_no,
      v_item.master_code_no,v_item.artist,v_item.name_ver,v_product_barcode,v_item.requested_qty,''
    );

    for v_allocation in
      select a.location_id,a.qty,l.location_code,l.scan_target_id,l.active,l.unavailable
      from public.external_transfer_allocations a join public.locations l on l.id=a.location_id
      where a.job_id=p_job_id and a.product_id=v_item.product_id order by l.location_code
    loop
      if not v_allocation.active or v_allocation.unavailable then
        raise exception '% 로케이션은 현재 사용할 수 없습니다.',v_allocation.location_code;
      end if;
      if to_regclass('public.transfer_jobs') is not null then
        execute 'select count(*) from public.transfer_jobs where status in (''DRAFT'',''READY'')
          and (source_location_id=$1 or destination_location_id=$1)'
        into v_active_transfer_count using v_allocation.location_id;
        if v_active_transfer_count>0 then raise exception '% 로케이션은 현재 재고이관 작업 중입니다.',v_allocation.location_code; end if;
      end if;
      select qty into v_before from public.inventory_balances
      where product_id=v_item.product_id and location_id=v_allocation.location_id for update;
      if v_before is null or v_before<v_allocation.qty then
        raise exception '% · % / %의 재고가 변경되었습니다. 현재 %개, 출고 요청 %개',
          v_item.artist,v_item.name_ver,v_allocation.location_code,coalesce(v_before,0),v_allocation.qty;
      end if;
      v_after:=v_before-v_allocation.qty;
      update public.inventory_balances set qty=v_after,updated_at=now()
      where product_id=v_item.product_id and location_id=v_allocation.location_id;
      v_location_barcode:=coalesce((select b.barcode_value from public.barcodes b
        where b.scan_target_id=v_allocation.scan_target_id and b.active
        order by b.is_primary desc,b.created_at,b.id limit 1),v_allocation.location_code);
      insert into public.inventory_transactions(
        operation,status,product_id,location_id,qty,before_qty,after_qty,
        product_barcode_value,location_barcode_value,reference_type,reference_id,
        idempotency_key,note,actor_id
      ) values(
        'OB','ACTIVE',v_item.product_id,v_allocation.location_id,v_allocation.qty,
        v_before,v_after,v_product_barcode,v_location_barcode,'EXTERNAL_TRANSFER',v_document_id::text,
        'external:'||v_document_id::text||':'||v_item.product_id::text||':'||v_allocation.location_id::text,
        v_job.vendor_name||' 외부업체 이관',auth.uid()
      );
      insert into public.external_shipment_allocations(document_id,line_no,location_id,location_code,qty)
      values(v_document_id,v_line_no,v_allocation.location_id,v_allocation.location_code,v_allocation.qty);
    end loop;
  end loop;

  update public.external_transfer_jobs set status='COMPLETED',document_id=v_document_id,
    completed_at=now(),updated_at=now() where id=p_job_id;
  perform public.write_audit('EXTERNAL_TRANSFER_COMPLETED','external_shipment',v_document_id::text,
    v_document_no,null,jsonb_build_object('vendor_name',v_job.vendor_name,'total_sku',v_item_count,
    'total_qty',v_total_qty,'document_no',v_document_no),v_job.note);
  return public.get_external_shipment_document(v_document_id);
end;
$$;

revoke all on function public.next_shipment_document_no(date) from public,anon,authenticated;
revoke all on function public.prepare_unified_shipment_document_no() from public,anon,authenticated;
revoke all on function public.register_unified_shipment_document() from public,anon,authenticated;
revoke all on function public.sync_external_shipment_personnel_to_registry() from public,anon,authenticated;
revoke all on function public.shipment_document_can_access(uuid) from public,anon;
revoke all on function public.list_shipment_documents(text,text,date,date,integer) from public,anon;
revoke all on function public.get_shipment_document(uuid) from public,anon;
revoke all on function public.update_shipment_document_personnel(uuid,text,text) from public,anon;
revoke all on function public.complete_external_transfer_job(uuid) from public,anon;

grant execute on function public.list_shipment_documents(text,text,date,date,integer) to authenticated;
grant execute on function public.get_shipment_document(uuid) to authenticated;
grant execute on function public.update_shipment_document_personnel(uuid,text,text) to authenticated;
grant execute on function public.complete_external_transfer_job(uuid) to authenticated;

notify pgrst,'reload schema';
commit;

select
  count(*) filter(where source_type='WORK_REQUEST') as work_request_documents,
  count(*) filter(where source_type='EXTERNAL_TRANSFER') as external_transfer_documents,
  count(*) as unified_documents
from public.shipment_document_registry;

select 'SAN WMS V4.5.10 cumulative unified shipment documents migration completed' as result;
