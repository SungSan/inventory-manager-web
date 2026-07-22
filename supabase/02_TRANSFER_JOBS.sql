-- Barcode WMS v1.3 - persistent location transfer jobs
-- DATA-PRESERVING MIGRATION: does not delete existing products, locations, balances, or logs.
-- Run this entire file once in Supabase SQL Editor after 01_RESET_AND_INSTALL.sql.

create table if not exists public.transfer_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'DRAFT' check (status in ('DRAFT','READY','COMPLETED','CANCELLED')),
  source_location_id uuid not null references public.locations(id) on delete restrict,
  destination_location_id uuid references public.locations(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  assigned_to uuid not null references auth.users(id) on delete restrict default auth.uid(),
  note text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  check (destination_location_id is null or destination_location_id <> source_location_id)
);

create table if not exists public.transfer_job_items (
  transfer_job_id uuid not null references public.transfer_jobs(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  requested_qty integer not null check (requested_qty > 0),
  source_qty_snapshot integer not null check (source_qty_snapshot >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (transfer_job_id, product_id)
);

create unique index if not exists one_active_transfer_per_source_location
  on public.transfer_jobs(source_location_id)
  where status in ('DRAFT','READY');

create index if not exists transfer_jobs_assigned_status_idx
  on public.transfer_jobs(assigned_to, status, updated_at desc);

create index if not exists transfer_job_items_job_idx
  on public.transfer_job_items(transfer_job_id);

create or replace function public.get_transfer_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_job public.transfer_jobs%rowtype;
  v_role text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  v_role := public.current_role();

  select * into v_job from public.transfer_jobs where id=p_job_id;
  if not found then raise exception '이관 작업을 찾을 수 없습니다.'; end if;
  if v_job.assigned_to <> auth.uid() and v_role not in ('admin','manager') then
    raise exception '이 이관 작업을 열 권한이 없습니다.';
  end if;

  select jsonb_build_object(
    'id',j.id,
    'status',j.status,
    'source_location_id',j.source_location_id,
    'source_location_code',src.location_code,
    'source_zone',src.zone,
    'destination_location_id',j.destination_location_id,
    'destination_location_code',dst.location_code,
    'destination_zone',dst.zone,
    'created_by',j.created_by,
    'assigned_to',j.assigned_to,
    'assigned_to_label',coalesce(pr.display_name,pr.email,'사용자'),
    'note',j.note,
    'cancel_reason',j.cancel_reason,
    'created_at',j.created_at,
    'updated_at',j.updated_at,
    'completed_at',j.completed_at,
    'cancelled_at',j.cancelled_at,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id',i.product_id,
        'requested_qty',i.requested_qty,
        'source_qty_snapshot',i.source_qty_snapshot,
        'p_code_no',p.p_code_no,
        'code_no',p.code_no,
        'master_code_no',p.master_code_no,
        'artist',p.artist,
        'name_ver',p.name_ver
      ) order by p.artist,p.name_ver,p.code_no)
      from public.transfer_job_items i
      join public.products p on p.id=i.product_id
      where i.transfer_job_id=j.id
    ),'[]'::jsonb)
  ) into v_result
  from public.transfer_jobs j
  join public.locations src on src.id=j.source_location_id
  left join public.locations dst on dst.id=j.destination_location_id
  left join public.profiles pr on pr.id=j.assigned_to
  where j.id=p_job_id;

  return v_result;
end;
$$;

create or replace function public.list_transfer_jobs(p_include_closed boolean default false)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_role text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  v_role := public.current_role();

  select coalesce(jsonb_agg(job_row order by (job_row->>'updated_at')::timestamptz desc),'[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'id',j.id,
      'status',j.status,
      'source_location_id',j.source_location_id,
      'source_location_code',src.location_code,
      'destination_location_id',j.destination_location_id,
      'destination_location_code',dst.location_code,
      'assigned_to',j.assigned_to,
      'assigned_to_label',coalesce(pr.display_name,pr.email,'사용자'),
      'item_count',count(i.product_id),
      'total_qty',coalesce(sum(i.requested_qty),0),
      'note',j.note,
      'created_at',j.created_at,
      'updated_at',j.updated_at,
      'completed_at',j.completed_at,
      'cancelled_at',j.cancelled_at
    ) as job_row
    from public.transfer_jobs j
    join public.locations src on src.id=j.source_location_id
    left join public.locations dst on dst.id=j.destination_location_id
    left join public.profiles pr on pr.id=j.assigned_to
    left join public.transfer_job_items i on i.transfer_job_id=j.id
    where (p_include_closed or j.status in ('DRAFT','READY'))
      and (j.assigned_to=auth.uid() or v_role in ('admin','manager'))
    group by j.id,src.location_code,dst.location_code,pr.display_name,pr.email
  ) q;

  return v_result;
end;
$$;

create or replace function public.create_transfer_job(p_source_barcode text,p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_source public.locations%rowtype;
  v_count integer;
  v_existing public.transfer_jobs%rowtype;
  v_owner_label text;
  v_job_id uuid;
begin
  perform public.require_role(array['admin','manager','operator']);

  select count(*) into v_count
  from public.barcodes b
  join public.scan_targets st on st.id=b.scan_target_id and st.target_type='location' and st.active
  join public.locations l on l.scan_target_id=st.id and l.active
  where b.normalized_value=public.normalize_barcode(p_source_barcode) and b.active;

  if v_count=0 then raise exception '등록되지 않았거나 로케이션이 아닌 바코드입니다.'; end if;
  if v_count>1 then raise exception '로케이션 바코드가 중복되어 있습니다.'; end if;

  select l.* into v_source
  from public.barcodes b
  join public.scan_targets st on st.id=b.scan_target_id and st.target_type='location' and st.active
  join public.locations l on l.scan_target_id=st.id and l.active
  where b.normalized_value=public.normalize_barcode(p_source_barcode) and b.active
  limit 1;

  select * into v_existing
  from public.transfer_jobs
  where source_location_id=v_source.id and status in ('DRAFT','READY')
  order by updated_at desc limit 1;

  if found then
    if v_existing.assigned_to=auth.uid() or public.current_role() in ('admin','manager') then
      return public.get_transfer_job(v_existing.id);
    end if;
    select coalesce(display_name,email,'다른 작업자') into v_owner_label from public.profiles where id=v_existing.assigned_to;
    raise exception '% 로케이션은 % 작업자가 이관 진행 중입니다.',v_source.location_code,coalesce(v_owner_label,'다른 작업자');
  end if;

  insert into public.transfer_jobs(source_location_id,created_by,assigned_to,note)
  values(v_source.id,auth.uid(),auth.uid(),nullif(trim(p_note),''))
  returning id into v_job_id;

  insert into public.scan_events(raw_value,normalized_value,expected_target_type,resolved_target_type,scan_target_id,target_label,result,context,actor_id)
  values(p_source_barcode,public.normalize_barcode(p_source_barcode),'location','location',v_source.scan_target_id,v_source.location_code,'SUCCESS','TRANSFER_SOURCE',auth.uid());

  perform public.write_audit(
    'TRANSFER_JOB_CREATED','transfer_job',v_job_id::text,v_source.location_code,
    null,jsonb_build_object('source_location_id',v_source.id,'source_location_code',v_source.location_code),p_note
  );

  return public.get_transfer_job(v_job_id);
exception
  when unique_violation then
    select * into v_existing
    from public.transfer_jobs
    where source_location_id=v_source.id and status in ('DRAFT','READY')
    order by updated_at desc limit 1;
    if found and (v_existing.assigned_to=auth.uid() or public.current_role() in ('admin','manager')) then
      return public.get_transfer_job(v_existing.id);
    end if;
    raise exception '해당 출발 로케이션에서 이미 이관 작업이 진행 중입니다.';
end;
$$;

create or replace function public.save_transfer_job_items(p_job_id uuid,p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_job public.transfer_jobs%rowtype;
  v_role text;
  v_invalid integer;
begin
  perform public.require_role(array['admin','manager','operator']);
  v_role := public.current_role();

  select * into v_job from public.transfer_jobs where id=p_job_id for update;
  if not found then raise exception '이관 작업을 찾을 수 없습니다.'; end if;
  if v_job.status not in ('DRAFT','READY') then raise exception '완료 또는 취소된 작업은 수정할 수 없습니다.'; end if;
  if v_job.assigned_to<>auth.uid() and v_role not in ('admin','manager') then raise exception '작업 수정 권한이 없습니다.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception '이관 품목 형식이 올바르지 않습니다.'; end if;

  with requested as (
    select (x->>'product_id')::uuid product_id,(x->>'qty')::integer qty
    from jsonb_array_elements(p_items) x
  )
  select count(*) into v_invalid
  from requested r
  left join public.inventory_balances ib
    on ib.product_id=r.product_id and ib.location_id=v_job.source_location_id
  where r.qty<=0 or ib.product_id is null or ib.qty<r.qty;

  if v_invalid>0 then raise exception '출발 로케이션의 최신 재고보다 이관 수량이 많거나 품목이 유효하지 않습니다.'; end if;

  with requested as (
    select (x->>'product_id')::uuid product_id,max((x->>'qty')::integer) qty
    from jsonb_array_elements(p_items) x
    group by (x->>'product_id')::uuid
  )
  delete from public.transfer_job_items i
  where i.transfer_job_id=p_job_id
    and not exists(select 1 from requested r where r.product_id=i.product_id);

  with requested as (
    select (x->>'product_id')::uuid product_id,max((x->>'qty')::integer) qty
    from jsonb_array_elements(p_items) x
    group by (x->>'product_id')::uuid
  )
  insert into public.transfer_job_items(transfer_job_id,product_id,requested_qty,source_qty_snapshot)
  select p_job_id,r.product_id,r.qty,ib.qty
  from requested r
  join public.inventory_balances ib on ib.product_id=r.product_id and ib.location_id=v_job.source_location_id
  on conflict(transfer_job_id,product_id) do update set
    requested_qty=excluded.requested_qty,
    source_qty_snapshot=excluded.source_qty_snapshot,
    updated_at=now();

  update public.transfer_jobs j set
    status=case
      when j.destination_location_id is not null and exists(select 1 from public.transfer_job_items i where i.transfer_job_id=j.id) then 'READY'
      else 'DRAFT'
    end,
    updated_at=now()
  where j.id=p_job_id;

  return public.get_transfer_job(p_job_id);
end;
$$;

create or replace function public.set_transfer_destination(p_job_id uuid,p_destination_barcode text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_job public.transfer_jobs%rowtype;
  v_destination public.locations%rowtype;
  v_count integer;
  v_role text;
begin
  perform public.require_role(array['admin','manager','operator']);
  v_role := public.current_role();

  select * into v_job from public.transfer_jobs where id=p_job_id for update;
  if not found then raise exception '이관 작업을 찾을 수 없습니다.'; end if;
  if v_job.status not in ('DRAFT','READY') then raise exception '완료 또는 취소된 작업은 수정할 수 없습니다.'; end if;
  if v_job.assigned_to<>auth.uid() and v_role not in ('admin','manager') then raise exception '작업 수정 권한이 없습니다.'; end if;

  select count(*) into v_count
  from public.barcodes b
  join public.scan_targets st on st.id=b.scan_target_id and st.target_type='location' and st.active
  join public.locations l on l.scan_target_id=st.id and l.active
  where b.normalized_value=public.normalize_barcode(p_destination_barcode) and b.active;
  if v_count=0 then raise exception '등록되지 않았거나 로케이션이 아닌 바코드입니다.'; end if;
  if v_count>1 then raise exception '로케이션 바코드가 중복되어 있습니다.'; end if;

  select l.* into v_destination
  from public.barcodes b
  join public.scan_targets st on st.id=b.scan_target_id and st.target_type='location' and st.active
  join public.locations l on l.scan_target_id=st.id and l.active
  where b.normalized_value=public.normalize_barcode(p_destination_barcode) and b.active
  limit 1;

  if v_destination.id=v_job.source_location_id then raise exception '출발 로케이션과 도착 로케이션은 같을 수 없습니다.'; end if;

  update public.transfer_jobs j set
    destination_location_id=v_destination.id,
    status=case when exists(select 1 from public.transfer_job_items i where i.transfer_job_id=j.id) then 'READY' else 'DRAFT' end,
    updated_at=now()
  where j.id=p_job_id;

  insert into public.scan_events(raw_value,normalized_value,expected_target_type,resolved_target_type,scan_target_id,target_label,result,context,actor_id)
  values(p_destination_barcode,public.normalize_barcode(p_destination_barcode),'location','location',v_destination.scan_target_id,v_destination.location_code,'SUCCESS','TRANSFER_DESTINATION',auth.uid());

  perform public.write_audit(
    'TRANSFER_DESTINATION_SET','transfer_job',p_job_id::text,v_destination.location_code,
    jsonb_build_object('destination_location_id',v_job.destination_location_id),
    jsonb_build_object('destination_location_id',v_destination.id,'destination_location_code',v_destination.location_code)
  );

  return public.get_transfer_job(p_job_id);
end;
$$;

create or replace function public.complete_transfer_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_job public.transfer_jobs%rowtype;
  v_role text;
  v_item record;
  v_source_qty integer;
  v_destination_qty integer;
  v_source_after integer;
  v_destination_after integer;
  v_product public.products%rowtype;
  v_source public.locations%rowtype;
  v_destination public.locations%rowtype;
  v_product_barcode text;
  v_source_barcode text;
  v_destination_barcode text;
  v_item_count integer;
  v_total_qty integer;
begin
  perform public.require_role(array['admin','manager','operator']);
  v_role := public.current_role();

  select * into v_job from public.transfer_jobs where id=p_job_id for update;
  if not found then raise exception '이관 작업을 찾을 수 없습니다.'; end if;
  if v_job.status not in ('DRAFT','READY') then raise exception '이미 완료 또는 취소된 작업입니다.'; end if;
  if v_job.assigned_to<>auth.uid() and v_role not in ('admin','manager') then raise exception '작업 확정 권한이 없습니다.'; end if;
  if v_job.destination_location_id is null then raise exception '도착 로케이션을 먼저 스캔하세요.'; end if;
  if v_job.destination_location_id=v_job.source_location_id then raise exception '출발 로케이션과 도착 로케이션은 같을 수 없습니다.'; end if;

  select count(*),coalesce(sum(requested_qty),0) into v_item_count,v_total_qty
  from public.transfer_job_items where transfer_job_id=p_job_id;
  if v_item_count=0 then raise exception '이관할 상품을 하나 이상 선택하세요.'; end if;

  select * into v_source from public.locations where id=v_job.source_location_id;
  select * into v_destination from public.locations where id=v_job.destination_location_id;
  select barcode_value into v_source_barcode from public.barcodes where scan_target_id=v_source.scan_target_id and active order by is_primary desc,created_at limit 1;
  select barcode_value into v_destination_barcode from public.barcodes where scan_target_id=v_destination.scan_target_id and active order by is_primary desc,created_at limit 1;

  for v_item in
    select * from public.transfer_job_items where transfer_job_id=p_job_id order by product_id
  loop
    insert into public.inventory_balances(product_id,location_id,qty)
    values(v_item.product_id,v_job.destination_location_id,0)
    on conflict(product_id,location_id) do nothing;

    perform 1 from public.inventory_balances ib
    where ib.product_id=v_item.product_id
      and ib.location_id in (v_job.source_location_id,v_job.destination_location_id)
    order by ib.location_id
    for update;

    select qty into v_source_qty from public.inventory_balances
    where product_id=v_item.product_id and location_id=v_job.source_location_id;
    select qty into v_destination_qty from public.inventory_balances
    where product_id=v_item.product_id and location_id=v_job.destination_location_id;

    if v_source_qty is null or v_source_qty<>v_item.source_qty_snapshot then
      raise exception '출발 로케이션 재고가 작업 저장 이후 변경되었습니다. 작업을 다시 열어 최신 수량을 확인하세요.';
    end if;
    if v_source_qty<v_item.requested_qty then
      raise exception '이관 수량이 현재 재고보다 많습니다.';
    end if;

    v_source_after:=v_source_qty-v_item.requested_qty;
    v_destination_after:=coalesce(v_destination_qty,0)+v_item.requested_qty;

    update public.inventory_balances set qty=v_source_after,updated_at=now()
    where product_id=v_item.product_id and location_id=v_job.source_location_id;
    update public.inventory_balances set qty=v_destination_after,updated_at=now()
    where product_id=v_item.product_id and location_id=v_job.destination_location_id;

    select * into v_product from public.products where id=v_item.product_id;
    select barcode_value into v_product_barcode from public.barcodes
    where scan_target_id=v_product.scan_target_id and active order by is_primary desc,created_at limit 1;
    v_product_barcode:=coalesce(v_product_barcode,v_product.code_no);

    insert into public.inventory_transactions(
      operation,status,product_id,location_id,qty,before_qty,after_qty,
      product_barcode_value,location_barcode_value,reference_type,reference_id,idempotency_key,note,actor_id
    ) values(
      'OB','ACTIVE',v_item.product_id,v_job.source_location_id,v_item.requested_qty,v_source_qty,v_source_after,
      v_product_barcode,coalesce(v_source_barcode,v_source.location_code),'TRANSFER',p_job_id::text,
      p_job_id::text||':'||v_item.product_id::text||':OUT','재고 이관 출발',auth.uid()
    );

    insert into public.inventory_transactions(
      operation,status,product_id,location_id,qty,before_qty,after_qty,
      product_barcode_value,location_barcode_value,reference_type,reference_id,idempotency_key,note,actor_id
    ) values(
      'IB','ACTIVE',v_item.product_id,v_job.destination_location_id,v_item.requested_qty,coalesce(v_destination_qty,0),v_destination_after,
      v_product_barcode,coalesce(v_destination_barcode,v_destination.location_code),'TRANSFER',p_job_id::text,
      p_job_id::text||':'||v_item.product_id::text||':IN','재고 이관 도착',auth.uid()
    );
  end loop;

  update public.transfer_jobs set status='COMPLETED',completed_at=now(),updated_at=now()
  where id=p_job_id;

  perform public.write_audit(
    'TRANSFER_COMPLETED','transfer_job',p_job_id::text,
    v_source.location_code||' → '||v_destination.location_code,
    jsonb_build_object('source_location_id',v_source.id,'source_location_code',v_source.location_code),
    jsonb_build_object('destination_location_id',v_destination.id,'destination_location_code',v_destination.location_code,'item_count',v_item_count,'total_qty',v_total_qty),
    v_job.note
  );

  return public.get_transfer_job(p_job_id);
end;
$$;

create or replace function public.cancel_transfer_job(p_job_id uuid,p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_job public.transfer_jobs%rowtype;
  v_role text;
begin
  perform public.require_role(array['admin','manager','operator']);
  v_role:=public.current_role();
  select * into v_job from public.transfer_jobs where id=p_job_id for update;
  if not found then raise exception '이관 작업을 찾을 수 없습니다.'; end if;
  if v_job.status not in ('DRAFT','READY') then raise exception '진행 중인 작업만 취소할 수 있습니다.'; end if;
  if v_job.assigned_to<>auth.uid() and v_role not in ('admin','manager') then raise exception '작업 취소 권한이 없습니다.'; end if;

  update public.transfer_jobs set status='CANCELLED',cancel_reason=nullif(trim(p_reason),''),cancelled_at=now(),updated_at=now()
  where id=p_job_id;

  perform public.write_audit(
    'TRANSFER_CANCELLED','transfer_job',p_job_id::text,v_job.source_location_id::text,
    to_jsonb(v_job),jsonb_build_object('status','CANCELLED','reason',p_reason),p_reason
  );
  return public.get_transfer_job(p_job_id);
end;
$$;

alter table public.transfer_jobs enable row level security;
alter table public.transfer_job_items enable row level security;

drop policy if exists transfer_jobs_read on public.transfer_jobs;
create policy transfer_jobs_read on public.transfer_jobs for select to authenticated
using (assigned_to=auth.uid() or public.current_role() in ('admin','manager'));

drop policy if exists transfer_job_items_read on public.transfer_job_items;
create policy transfer_job_items_read on public.transfer_job_items for select to authenticated
using (exists(
  select 1 from public.transfer_jobs j
  where j.id=transfer_job_id and (j.assigned_to=auth.uid() or public.current_role() in ('admin','manager'))
));

revoke all on public.transfer_jobs,public.transfer_job_items from anon;
grant select on public.transfer_jobs,public.transfer_job_items to authenticated;

revoke execute on function public.get_transfer_job(uuid) from public,anon;
revoke execute on function public.list_transfer_jobs(boolean) from public,anon;
revoke execute on function public.create_transfer_job(text,text) from public,anon;
revoke execute on function public.save_transfer_job_items(uuid,jsonb) from public,anon;
revoke execute on function public.set_transfer_destination(uuid,text) from public,anon;
revoke execute on function public.complete_transfer_job(uuid) from public,anon;
revoke execute on function public.cancel_transfer_job(uuid,text) from public,anon;

grant execute on function public.get_transfer_job(uuid) to authenticated;
grant execute on function public.list_transfer_jobs(boolean) to authenticated;
grant execute on function public.create_transfer_job(text,text) to authenticated;
grant execute on function public.save_transfer_job_items(uuid,jsonb) to authenticated;
grant execute on function public.set_transfer_destination(uuid,text) to authenticated;
grant execute on function public.complete_transfer_job(uuid) to authenticated;
grant execute on function public.cancel_transfer_job(uuid,text) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['transfer_jobs','transfer_job_items'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=t
    ) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;

select 'Barcode WMS transfer jobs migration completed' as result;
