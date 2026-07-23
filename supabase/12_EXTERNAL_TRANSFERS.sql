-- SAN WMS V3.6.0 - 외부업체 이관 + 출고명세서
-- DATA-PRESERVING MIGRATION: 기존 상품, 재고, 로케이션, 입출고 이력은 삭제하지 않습니다.
-- 실행 후 외부업체 이관 작업, LOC별 출고 배정, 완료 명세서 저장·조회·출력이 활성화됩니다.

begin;

alter table public.locations
  add column if not exists unavailable boolean not null default false;

create table if not exists public.external_transfer_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'DRAFT'
    check (status in ('DRAFT','ALLOCATING','COMPLETED','CANCELLED')),
  vendor_name text not null default '',
  vendor_contact text not null default '',
  vendor_phone text not null default '',
  vendor_address text not null default '',
  purpose text not null default '',
  note text not null default '',
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  assigned_to uuid not null references auth.users(id) on delete restrict default auth.uid(),
  document_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text
);

create table if not exists public.external_transfer_items (
  job_id uuid not null references public.external_transfer_jobs(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  requested_qty integer not null check (requested_qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, product_id)
);

create table if not exists public.external_transfer_allocations (
  job_id uuid not null,
  product_id uuid not null,
  location_id uuid not null references public.locations(id) on delete restrict,
  qty integer not null check (qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, product_id, location_id),
  foreign key (job_id, product_id)
    references public.external_transfer_items(job_id, product_id)
    on delete cascade
);

create table if not exists public.external_document_daily_sequences (
  shipment_date date primary key,
  last_value integer not null check (last_value > 0)
);

create table if not exists public.external_shipment_documents (
  id uuid primary key default gen_random_uuid(),
  document_no text not null unique,
  shipment_date date not null,
  vendor_name text not null,
  vendor_contact text not null default '',
  vendor_phone text not null default '',
  vendor_address text not null default '',
  purpose text not null default '',
  note text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_by_label text not null default '',
  source_job_id uuid not null unique references public.external_transfer_jobs(id) on delete restrict,
  total_sku integer not null check (total_sku > 0),
  total_qty integer not null check (total_qty > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.external_shipment_items (
  document_id uuid not null references public.external_shipment_documents(id) on delete restrict,
  line_no integer not null check (line_no > 0),
  product_id uuid references public.products(id) on delete set null,
  p_code_no text not null default '',
  code_no text not null default '',
  master_code_no text not null default '',
  artist text not null default '',
  name_ver text not null default '',
  product_barcode text not null default '',
  qty integer not null check (qty > 0),
  note text not null default '',
  primary key (document_id, line_no)
);

create table if not exists public.external_shipment_allocations (
  document_id uuid not null,
  line_no integer not null,
  location_id uuid references public.locations(id) on delete set null,
  location_code text not null,
  qty integer not null check (qty > 0),
  primary key (document_id, line_no, location_code),
  foreign key (document_id, line_no)
    references public.external_shipment_items(document_id, line_no)
    on delete restrict
);

create index if not exists external_transfer_jobs_assigned_status_idx
  on public.external_transfer_jobs(assigned_to, status, updated_at desc);
create index if not exists external_transfer_items_product_idx
  on public.external_transfer_items(product_id);
create index if not exists external_transfer_allocations_location_idx
  on public.external_transfer_allocations(location_id);
create index if not exists external_shipment_documents_date_idx
  on public.external_shipment_documents(shipment_date desc, created_at desc);

alter table public.external_transfer_jobs enable row level security;
alter table public.external_transfer_items enable row level security;
alter table public.external_transfer_allocations enable row level security;
alter table public.external_document_daily_sequences enable row level security;
alter table public.external_shipment_documents enable row level security;
alter table public.external_shipment_items enable row level security;
alter table public.external_shipment_allocations enable row level security;

create or replace function public.external_can_access_job(p_job_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.external_transfer_jobs j
    where j.id=p_job_id
      and (j.assigned_to=auth.uid() or public.current_role() in ('admin','manager'))
  );
$$;

create or replace function public.external_primary_product_barcode(p_scan_target_id uuid)
returns text language sql stable security definer set search_path=public as $$
  select coalesce((
    select b.barcode_value from public.barcodes b
    where b.scan_target_id=p_scan_target_id and b.active
    order by b.is_primary desc,b.created_at,b.id limit 1
  ),'');
$$;

create or replace function public.get_external_transfer_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if not public.external_can_access_job(p_job_id) then raise exception '외부이관 작업을 열 권한이 없습니다.'; end if;

  select jsonb_build_object(
    'id',j.id,'status',j.status,'vendor_name',j.vendor_name,
    'vendor_contact',j.vendor_contact,'vendor_phone',j.vendor_phone,
    'vendor_address',j.vendor_address,'purpose',j.purpose,'note',j.note,
    'created_by',j.created_by,'assigned_to',j.assigned_to,
    'assigned_to_label',coalesce(pr.display_name,pr.email,'사용자'),
    'document_id',j.document_id,'created_at',j.created_at,'updated_at',j.updated_at,
    'completed_at',j.completed_at,'cancelled_at',j.cancelled_at,'cancel_reason',j.cancel_reason,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id',i.product_id,'requested_qty',i.requested_qty,
        'p_code_no',p.p_code_no,'code_no',p.code_no,'master_code_no',p.master_code_no,
        'artist',p.artist,'name_ver',p.name_ver,
        'product_barcode',public.external_primary_product_barcode(p.scan_target_id),
        'available_total',coalesce(stock.available_total,0),
        'allocated_total',coalesce(alloc.allocated_total,0),
        'location_count',coalesce(stock.location_count,0),
        'allocation_required',coalesce(stock.location_count,0)>1,
        'location_options',coalesce(stock.location_options,'[]'::jsonb)
      ) order by i.created_at,p.artist,p.name_ver,p.code_no)
      from public.external_transfer_items i
      join public.products p on p.id=i.product_id
      left join lateral (
        select coalesce(sum(ib.qty),0)::bigint available_total,
          count(*)::integer location_count,
          coalesce(jsonb_agg(jsonb_build_object(
            'location_id',l.id,'location_code',l.location_code,'zone',l.zone,
            'available_qty',ib.qty,'allocated_qty',coalesce(a.qty,0)
          ) order by l.location_code),'[]'::jsonb) location_options
        from public.inventory_balances ib
        join public.locations l on l.id=ib.location_id
        left join public.external_transfer_allocations a
          on a.job_id=i.job_id and a.product_id=i.product_id and a.location_id=ib.location_id
        where ib.product_id=i.product_id and ib.qty>0 and l.active and not l.unavailable
      ) stock on true
      left join lateral (
        select coalesce(sum(a.qty),0)::bigint allocated_total
        from public.external_transfer_allocations a
        where a.job_id=i.job_id and a.product_id=i.product_id
      ) alloc on true
      where i.job_id=j.id
    ),'[]'::jsonb)
  ) into v_result
  from public.external_transfer_jobs j
  left join public.profiles pr on pr.id=j.assigned_to
  where j.id=p_job_id;

  if v_result is null then raise exception '외부이관 작업을 찾을 수 없습니다.'; end if;
  return v_result;
end;
$$;

create or replace function public.list_external_transfer_jobs(p_include_closed boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role text; v_result jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  v_role:=public.current_role();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',j.id,'status',j.status,'vendor_name',j.vendor_name,
    'vendor_contact',j.vendor_contact,'vendor_phone',j.vendor_phone,
    'vendor_address',j.vendor_address,'purpose',j.purpose,'note',j.note,
    'assigned_to',j.assigned_to,'assigned_to_label',coalesce(pr.display_name,pr.email,'사용자'),
    'document_id',j.document_id,'item_count',coalesce(s.item_count,0),
    'total_qty',coalesce(s.total_qty,0),'created_at',j.created_at,'updated_at',j.updated_at,
    'completed_at',j.completed_at,'cancelled_at',j.cancelled_at,'cancel_reason',j.cancel_reason
  ) order by j.updated_at desc),'[]'::jsonb) into v_result
  from public.external_transfer_jobs j
  left join public.profiles pr on pr.id=j.assigned_to
  left join lateral (
    select count(*)::integer item_count,coalesce(sum(requested_qty),0)::bigint total_qty
    from public.external_transfer_items i where i.job_id=j.id
  ) s on true
  where (p_include_closed or j.status in ('DRAFT','ALLOCATING'))
    and (j.assigned_to=auth.uid() or v_role in ('admin','manager'));
  return v_result;
end;
$$;

create or replace function public.create_external_transfer_job(
  p_vendor_name text,p_vendor_contact text default '',p_vendor_phone text default '',
  p_vendor_address text default '',p_purpose text default '',p_note text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_job_id uuid;
begin
  perform public.require_role(array['admin','manager','operator']);
  if nullif(trim(coalesce(p_vendor_name,'')),'') is null then raise exception '외부업체명을 입력하세요.'; end if;
  insert into public.external_transfer_jobs(
    vendor_name,vendor_contact,vendor_phone,vendor_address,purpose,note,created_by,assigned_to
  ) values(
    trim(p_vendor_name),trim(coalesce(p_vendor_contact,'')),trim(coalesce(p_vendor_phone,'')),
    trim(coalesce(p_vendor_address,'')),trim(coalesce(p_purpose,'')),trim(coalesce(p_note,'')),
    auth.uid(),auth.uid()
  ) returning id into v_job_id;
  perform public.write_audit('EXTERNAL_TRANSFER_CREATED','external_transfer',v_job_id::text,
    trim(p_vendor_name),null,jsonb_build_object('vendor_name',trim(p_vendor_name)),null);
  return public.get_external_transfer_job(v_job_id);
end;
$$;

create or replace function public.update_external_transfer_header(
  p_job_id uuid,p_vendor_name text default null,p_vendor_contact text default null,
  p_vendor_phone text default null,p_vendor_address text default null,
  p_purpose text default null,p_note text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_job public.external_transfer_jobs%rowtype;
begin
  perform public.require_role(array['admin','manager','operator']);
  select * into v_job from public.external_transfer_jobs where id=p_job_id for update;
  if not found then raise exception '외부이관 작업을 찾을 수 없습니다.'; end if;
  if not public.external_can_access_job(p_job_id) then raise exception '이 작업을 수정할 권한이 없습니다.'; end if;
  if v_job.status not in ('DRAFT','ALLOCATING') then raise exception '완료·취소된 작업은 수정할 수 없습니다.'; end if;
  update public.external_transfer_jobs j set
    vendor_name=coalesce(nullif(trim(p_vendor_name),''),j.vendor_name),
    vendor_contact=coalesce(trim(p_vendor_contact),j.vendor_contact),
    vendor_phone=coalesce(trim(p_vendor_phone),j.vendor_phone),
    vendor_address=coalesce(trim(p_vendor_address),j.vendor_address),
    purpose=coalesce(trim(p_purpose),j.purpose),note=coalesce(trim(p_note),j.note),updated_at=now()
  where j.id=p_job_id;
  return public.get_external_transfer_job(p_job_id);
end;
$$;

create or replace function public.set_external_transfer_item_qty(p_job_id uuid,p_product_id uuid,p_qty integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_status text;
begin
  perform public.require_role(array['admin','manager','operator']);
  if p_qty is null or p_qty<1 then raise exception '출고 수량은 1개 이상이어야 합니다.'; end if;
  if not public.external_can_access_job(p_job_id) then raise exception '이 작업을 수정할 권한이 없습니다.'; end if;
  select status into v_status from public.external_transfer_jobs where id=p_job_id for update;
  if v_status is null then raise exception '외부이관 작업을 찾을 수 없습니다.'; end if;
  if v_status not in ('DRAFT','ALLOCATING') then raise exception '완료·취소된 작업은 수정할 수 없습니다.'; end if;
  if not exists(select 1 from public.products where id=p_product_id and active) then
    raise exception '사용 가능한 상품을 찾을 수 없습니다.';
  end if;
  insert into public.external_transfer_items(job_id,product_id,requested_qty)
  values(p_job_id,p_product_id,p_qty)
  on conflict(job_id,product_id) do update set requested_qty=excluded.requested_qty,updated_at=now();
  delete from public.external_transfer_allocations where job_id=p_job_id and product_id=p_product_id;
  update public.external_transfer_jobs set status='DRAFT',updated_at=now() where id=p_job_id;
  return public.get_external_transfer_job(p_job_id);
end;
$$;

create or replace function public.increment_external_transfer_item(
  p_job_id uuid,p_product_id uuid,p_increment integer default 1
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_current integer;
begin
  if coalesce(p_increment,0)<1 then raise exception '증가 수량은 1개 이상이어야 합니다.'; end if;
  select requested_qty into v_current from public.external_transfer_items
  where job_id=p_job_id and product_id=p_product_id;
  return public.set_external_transfer_item_qty(p_job_id,p_product_id,coalesce(v_current,0)+p_increment);
end;
$$;

create or replace function public.remove_external_transfer_item(p_job_id uuid,p_product_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_status text;
begin
  perform public.require_role(array['admin','manager','operator']);
  if not public.external_can_access_job(p_job_id) then raise exception '이 작업을 수정할 권한이 없습니다.'; end if;
  select status into v_status from public.external_transfer_jobs where id=p_job_id for update;
  if v_status is null then raise exception '외부이관 작업을 찾을 수 없습니다.'; end if;
  if v_status not in ('DRAFT','ALLOCATING') then raise exception '완료·취소된 작업은 수정할 수 없습니다.'; end if;
  delete from public.external_transfer_items where job_id=p_job_id and product_id=p_product_id;
  update public.external_transfer_jobs set status='DRAFT',updated_at=now() where id=p_job_id;
  return public.get_external_transfer_job(p_job_id);
end;
$$;

create or replace function public.prepare_external_transfer_allocations(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_status text; v_item record; v_location record; v_location_count integer;
  v_available_total bigint; v_allocated_total bigint; v_item_count integer;
begin
  perform public.require_role(array['admin','manager','operator']);
  if not public.external_can_access_job(p_job_id) then raise exception '이 작업을 수정할 권한이 없습니다.'; end if;
  select status into v_status from public.external_transfer_jobs where id=p_job_id for update;
  if v_status is null then raise exception '외부이관 작업을 찾을 수 없습니다.'; end if;
  if v_status not in ('DRAFT','ALLOCATING') then raise exception '완료·취소된 작업은 수정할 수 없습니다.'; end if;
  select count(*) into v_item_count from public.external_transfer_items where job_id=p_job_id;
  if v_item_count=0 then raise exception '출고할 상품을 하나 이상 스캔하세요.'; end if;

  for v_item in
    select i.product_id,i.requested_qty,p.artist,p.name_ver
    from public.external_transfer_items i join public.products p on p.id=i.product_id
    where i.job_id=p_job_id order by i.created_at,p.artist,p.name_ver
  loop
    select count(*)::integer,coalesce(sum(ib.qty),0)::bigint
    into v_location_count,v_available_total
    from public.inventory_balances ib join public.locations l on l.id=ib.location_id
    where ib.product_id=v_item.product_id and ib.qty>0 and l.active and not l.unavailable;
    if v_available_total<v_item.requested_qty then
      raise exception '% · %의 가용 재고가 부족합니다. 요청 %개 / 가용 %개',
        v_item.artist,v_item.name_ver,v_item.requested_qty,v_available_total;
    end if;
    if v_location_count=1 then
      select ib.location_id,ib.qty into v_location
      from public.inventory_balances ib join public.locations l on l.id=ib.location_id
      where ib.product_id=v_item.product_id and ib.qty>0 and l.active and not l.unavailable limit 1;
      delete from public.external_transfer_allocations where job_id=p_job_id and product_id=v_item.product_id;
      insert into public.external_transfer_allocations(job_id,product_id,location_id,qty)
      values(p_job_id,v_item.product_id,v_location.location_id,v_item.requested_qty);
    else
      delete from public.external_transfer_allocations a using public.locations l
      where a.job_id=p_job_id and a.product_id=v_item.product_id and l.id=a.location_id
        and (not l.active or l.unavailable or a.qty>coalesce((
          select ib.qty from public.inventory_balances ib
          where ib.product_id=a.product_id and ib.location_id=a.location_id
        ),0));
      select coalesce(sum(qty),0)::bigint into v_allocated_total
      from public.external_transfer_allocations where job_id=p_job_id and product_id=v_item.product_id;
      if v_allocated_total<>v_item.requested_qty then
        delete from public.external_transfer_allocations where job_id=p_job_id and product_id=v_item.product_id;
      end if;
    end if;
  end loop;
  update public.external_transfer_jobs set status='ALLOCATING',updated_at=now() where id=p_job_id;
  return public.get_external_transfer_job(p_job_id);
end;
$$;

create or replace function public.save_external_transfer_allocations(p_job_id uuid,p_allocations jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_status text; v_entry jsonb; v_product_id uuid; v_location_id uuid;
  v_qty integer; v_item record; v_allocated bigint; v_available integer;
begin
  perform public.require_role(array['admin','manager','operator']);
  if not public.external_can_access_job(p_job_id) then raise exception '이 작업을 수정할 권한이 없습니다.'; end if;
  if p_allocations is null or jsonb_typeof(p_allocations)<>'array' then raise exception '로케이션 배정 형식이 올바르지 않습니다.'; end if;
  select status into v_status from public.external_transfer_jobs where id=p_job_id for update;
  if v_status is null then raise exception '외부이관 작업을 찾을 수 없습니다.'; end if;
  if v_status not in ('DRAFT','ALLOCATING') then raise exception '완료·취소된 작업은 수정할 수 없습니다.'; end if;
  delete from public.external_transfer_allocations where job_id=p_job_id;
  for v_entry in select * from jsonb_array_elements(p_allocations)
  loop
    v_product_id:=(v_entry->>'product_id')::uuid;
    v_location_id:=(v_entry->>'location_id')::uuid;
    v_qty:=coalesce((v_entry->>'qty')::integer,0);
    if v_qty<=0 then continue; end if;
    if not exists(select 1 from public.external_transfer_items where job_id=p_job_id and product_id=v_product_id) then
      raise exception '선택되지 않은 상품의 LOC 배정이 포함되어 있습니다.';
    end if;
    select ib.qty into v_available
    from public.inventory_balances ib join public.locations l on l.id=ib.location_id
    where ib.product_id=v_product_id and ib.location_id=v_location_id
      and ib.qty>0 and l.active and not l.unavailable;
    if v_available is null or v_qty>v_available then raise exception '선택한 LOC의 가용 재고보다 많은 수량을 배정했습니다.'; end if;
    insert into public.external_transfer_allocations(job_id,product_id,location_id,qty)
    values(p_job_id,v_product_id,v_location_id,v_qty)
    on conflict(job_id,product_id,location_id) do update set qty=excluded.qty,updated_at=now();
  end loop;
  for v_item in select product_id,requested_qty from public.external_transfer_items where job_id=p_job_id
  loop
    select coalesce(sum(qty),0)::bigint into v_allocated
    from public.external_transfer_allocations where job_id=p_job_id and product_id=v_item.product_id;
    if v_allocated<>v_item.requested_qty then raise exception '모든 상품의 배정 합계가 요청 수량과 같아야 합니다.'; end if;
  end loop;
  update public.external_transfer_jobs set status='ALLOCATING',updated_at=now() where id=p_job_id;
  return public.get_external_transfer_job(p_job_id);
end;
$$;

create or replace function public.get_external_shipment_document(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  perform public.require_role(array['admin','manager','operator']);
  select jsonb_build_object(
    'id',d.id,'document_no',d.document_no,'shipment_date',d.shipment_date,
    'vendor_name',d.vendor_name,'vendor_contact',d.vendor_contact,'vendor_phone',d.vendor_phone,
    'vendor_address',d.vendor_address,'purpose',d.purpose,'note',d.note,
    'created_by',d.created_by,'created_by_label',d.created_by_label,'source_job_id',d.source_job_id,
    'total_sku',d.total_sku,'total_qty',d.total_qty,'created_at',d.created_at,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'line_no',i.line_no,'product_id',i.product_id,'p_code_no',i.p_code_no,
        'code_no',i.code_no,'master_code_no',i.master_code_no,'artist',i.artist,
        'name_ver',i.name_ver,'product_barcode',i.product_barcode,'qty',i.qty,'note',i.note,
        'allocations',coalesce((
          select jsonb_agg(jsonb_build_object(
            'location_id',a.location_id,'location_code',a.location_code,'qty',a.qty
          ) order by a.location_code)
          from public.external_shipment_allocations a
          where a.document_id=i.document_id and a.line_no=i.line_no
        ),'[]'::jsonb)
      ) order by i.line_no)
      from public.external_shipment_items i where i.document_id=d.id
    ),'[]'::jsonb)
  ) into v_result from public.external_shipment_documents d where d.id=p_document_id;
  if v_result is null then raise exception '출고명세서를 찾을 수 없습니다.'; end if;
  return v_result;
end;
$$;

create or replace function public.list_external_shipment_documents(
  p_search text default '',p_date_from date default null,p_date_to date default null,p_limit integer default 500
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; v_search text:=trim(coalesce(p_search,''));
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  perform public.require_role(array['admin','manager','operator']);
  select coalesce(jsonb_agg(row_data order by (row_data->>'shipment_date')::date desc,
    (row_data->>'created_at')::timestamptz desc),'[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'id',d.id,'document_no',d.document_no,'shipment_date',d.shipment_date,
      'vendor_name',d.vendor_name,'vendor_contact',d.vendor_contact,'vendor_phone',d.vendor_phone,
      'vendor_address',d.vendor_address,'purpose',d.purpose,'note',d.note,
      'created_by_label',d.created_by_label,'source_job_id',d.source_job_id,
      'total_sku',d.total_sku,'total_qty',d.total_qty,'created_at',d.created_at
    ) row_data
    from public.external_shipment_documents d
    where (p_date_from is null or d.shipment_date>=p_date_from)
      and (p_date_to is null or d.shipment_date<=p_date_to)
      and (v_search='' or d.document_no ilike '%'||v_search||'%' or d.vendor_name ilike '%'||v_search||'%'
        or d.created_by_label ilike '%'||v_search||'%'
        or exists(select 1 from public.external_shipment_items i
          where i.document_id=d.id and concat_ws(' ',i.product_barcode,i.p_code_no,i.code_no,
            i.master_code_no,i.artist,i.name_ver) ilike '%'||v_search||'%'))
    order by d.shipment_date desc,d.created_at desc
    limit greatest(1,least(coalesce(p_limit,500),1000))
  ) q;
  return v_result;
end;
$$;

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
  ) returning id into v_document_id;

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

create or replace function public.cancel_external_transfer_job(p_job_id uuid,p_reason text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_job public.external_transfer_jobs%rowtype;
begin
  perform public.require_role(array['admin','manager','operator']);
  select * into v_job from public.external_transfer_jobs where id=p_job_id for update;
  if not found then raise exception '외부이관 작업을 찾을 수 없습니다.'; end if;
  if not public.external_can_access_job(p_job_id) then raise exception '이 작업을 취소할 권한이 없습니다.'; end if;
  if v_job.status not in ('DRAFT','ALLOCATING') then raise exception '완료·취소된 작업은 변경할 수 없습니다.'; end if;
  update public.external_transfer_jobs set status='CANCELLED',cancel_reason=trim(coalesce(p_reason,'')),
    cancelled_at=now(),updated_at=now() where id=p_job_id;
  perform public.write_audit('EXTERNAL_TRANSFER_CANCELLED','external_transfer',p_job_id::text,
    v_job.vendor_name,to_jsonb(v_job),jsonb_build_object('status','CANCELLED'),p_reason);
  return public.get_external_transfer_job(p_job_id);
end;
$$;

revoke all on function public.external_can_access_job(uuid) from public;
revoke all on function public.external_primary_product_barcode(uuid) from public;
revoke all on function public.get_external_transfer_job(uuid) from public;
revoke all on function public.list_external_transfer_jobs(boolean) from public;
revoke all on function public.create_external_transfer_job(text,text,text,text,text,text) from public;
revoke all on function public.update_external_transfer_header(uuid,text,text,text,text,text,text) from public;
revoke all on function public.set_external_transfer_item_qty(uuid,uuid,integer) from public;
revoke all on function public.increment_external_transfer_item(uuid,uuid,integer) from public;
revoke all on function public.remove_external_transfer_item(uuid,uuid) from public;
revoke all on function public.prepare_external_transfer_allocations(uuid) from public;
revoke all on function public.save_external_transfer_allocations(uuid,jsonb) from public;
revoke all on function public.get_external_shipment_document(uuid) from public;
revoke all on function public.list_external_shipment_documents(text,date,date,integer) from public;
revoke all on function public.complete_external_transfer_job(uuid) from public;
revoke all on function public.cancel_external_transfer_job(uuid,text) from public;

grant execute on function public.get_external_transfer_job(uuid) to authenticated;
grant execute on function public.list_external_transfer_jobs(boolean) to authenticated;
grant execute on function public.create_external_transfer_job(text,text,text,text,text,text) to authenticated;
grant execute on function public.update_external_transfer_header(uuid,text,text,text,text,text,text) to authenticated;
grant execute on function public.set_external_transfer_item_qty(uuid,uuid,integer) to authenticated;
grant execute on function public.increment_external_transfer_item(uuid,uuid,integer) to authenticated;
grant execute on function public.remove_external_transfer_item(uuid,uuid) to authenticated;
grant execute on function public.prepare_external_transfer_allocations(uuid) to authenticated;
grant execute on function public.save_external_transfer_allocations(uuid,jsonb) to authenticated;
grant execute on function public.get_external_shipment_document(uuid) to authenticated;
grant execute on function public.list_external_shipment_documents(text,date,date,integer) to authenticated;
grant execute on function public.complete_external_transfer_job(uuid) to authenticated;
grant execute on function public.cancel_external_transfer_job(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
select 'SAN WMS external transfer migration completed' as result;
