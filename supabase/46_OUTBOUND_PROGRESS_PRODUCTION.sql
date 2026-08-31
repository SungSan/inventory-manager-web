-- SAN WMS V5.0.0: production outbound-progress persistence and atomic stock deduction
-- Data preserving. Does not modify existing inventory rows during installation.

begin;

create table if not exists public.outbound_jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'DRAFT' check(status in ('DRAFT','READY','IN_PROGRESS','COMPLETED')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id),
  archive_reason text
);

create table if not exists public.outbound_shipments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.outbound_jobs(id) on delete cascade,
  tracking_no text not null,
  status text not null default 'READY' check(status in ('READY','IN_PROGRESS','COMPLETED','REVIEW')),
  manual_quantity_allowed boolean not null default false,
  assigned_worker_id uuid references public.profiles(id),
  assigned_worker_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id,tracking_no)
);

create table if not exists public.outbound_items (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.outbound_shipments(id) on delete cascade,
  product_id uuid references public.products(id),
  product_barcode text not null,
  artist text not null default '',
  name_ver text not null default '',
  order_nos jsonb not null default '[]'::jsonb,
  required_qty integer not null check(required_qty>0),
  picked_qty integer not null default 0 check(picked_qty>=0 and picked_qty<=required_qty),
  resolution text not null check(resolution in ('MATCHED','UNREGISTERED','AMBIGUOUS','INSUFFICIENT_STOCK')),
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outbound_item_locations (
  item_id uuid not null references public.outbound_items(id) on delete cascade,
  location_id uuid not null references public.locations(id),
  location_code text not null,
  source_qty integer not null default 0,
  priority integer not null default 0,
  primary key(item_id,location_id)
);

create table if not exists public.outbound_pick_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.outbound_jobs(id),
  shipment_id uuid not null references public.outbound_shipments(id),
  item_id uuid not null references public.outbound_items(id),
  qty integer not null check(qty>0),
  input_method text not null check(input_method in ('SCAN','MANUAL')),
  idempotency_key text not null unique,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists outbound_shipments_job_idx on public.outbound_shipments(job_id,created_at);
create index if not exists outbound_shipments_tracking_idx on public.outbound_shipments(tracking_no);
create index if not exists outbound_items_shipment_idx on public.outbound_items(shipment_id);
create index if not exists outbound_pick_events_item_idx on public.outbound_pick_events(item_id,created_at);

alter table public.outbound_jobs enable row level security;
alter table public.outbound_shipments enable row level security;
alter table public.outbound_items enable row level security;
alter table public.outbound_item_locations enable row level security;
alter table public.outbound_pick_events enable row level security;

drop policy if exists outbound_jobs_read on public.outbound_jobs;
create policy outbound_jobs_read on public.outbound_jobs for select to authenticated using (true);
drop policy if exists outbound_shipments_read on public.outbound_shipments;
create policy outbound_shipments_read on public.outbound_shipments for select to authenticated using (true);
drop policy if exists outbound_items_read on public.outbound_items;
create policy outbound_items_read on public.outbound_items for select to authenticated using (true);
drop policy if exists outbound_item_locations_read on public.outbound_item_locations;
create policy outbound_item_locations_read on public.outbound_item_locations for select to authenticated using (true);
drop policy if exists outbound_pick_events_read on public.outbound_pick_events;
create policy outbound_pick_events_read on public.outbound_pick_events for select to authenticated using (true);

create or replace function public.require_outbound_use(p_manage boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare v_role text; v_access text;
begin
  perform public.require_user_ready();
  v_role:=public.current_role();
  select access_level into v_access from public.user_menu_access
  where user_id=auth.uid() and menu_key='outbound-progress';
  if coalesce(v_access,'USE')<>'USE' then raise exception '출고 진행 사용 권한이 없습니다.'; end if;
  if p_manage and v_role not in ('admin','manager') then raise exception '출고 작업 생성·수정은 관리자 또는 매니저만 가능합니다.'; end if;
  if not p_manage and v_role not in ('admin','manager','operator') then raise exception '출고 피킹 권한이 없습니다.'; end if;
end; $$;

create or replace function public.create_outbound_job(p_job jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_job_id uuid:=coalesce(nullif(p_job->>'id','')::uuid,gen_random_uuid()); v_shipment jsonb; v_item jsonb; v_sid uuid; v_iid uuid; v_loc jsonb; v_lid uuid;
begin
  perform public.require_outbound_use(true);
  insert into public.outbound_jobs(id,name,status,created_by)
  values(v_job_id,coalesce(nullif(trim(p_job->>'name'),''),'출고 작업'),coalesce(p_job->>'status','DRAFT'),auth.uid());
  for v_shipment in select value from jsonb_array_elements(coalesce(p_job->'shipments','[]'::jsonb)) loop
    v_sid:=coalesce(nullif(v_shipment->>'id','')::uuid,gen_random_uuid());
    insert into public.outbound_shipments(id,job_id,tracking_no,status,manual_quantity_allowed)
    values(v_sid,v_job_id,trim(v_shipment->>'trackingNo'),coalesce(v_shipment->>'status','READY'),coalesce((v_shipment->>'manualQuantityAllowed')::boolean,false));
    for v_item in select value from jsonb_array_elements(coalesce(v_shipment->'items','[]'::jsonb)) loop
      v_iid:=coalesce(nullif(v_item->>'id','')::uuid,gen_random_uuid());
      insert into public.outbound_items(id,shipment_id,product_id,product_barcode,artist,name_ver,order_nos,required_qty,picked_qty,resolution,review_reason)
      values(v_iid,v_sid,nullif(v_item->>'productId','')::uuid,v_item->>'productBarcode',coalesce(v_item->>'artist',''),coalesce(v_item->>'nameVer',''),coalesce(v_item->'orderNos','[]'::jsonb),(v_item->>'requiredQty')::integer,coalesce((v_item->>'pickedQty')::integer,0),v_item->>'resolution',nullif(v_item->>'reviewReason',''));
      for v_loc in select value from jsonb_array_elements(coalesce(v_item->'locations','[]'::jsonb)) loop
        select id into v_lid from public.locations where location_code=v_loc->>'locationCode' limit 1;
        if v_lid is not null then
          insert into public.outbound_item_locations(item_id,location_id,location_code,source_qty,priority)
          values(v_iid,v_lid,v_loc->>'locationCode',coalesce((v_loc->>'qty')::integer,0),coalesce((v_loc->>'priority')::integer,0)) on conflict do nothing;
        end if;
      end loop;
    end loop;
  end loop;
  perform public.write_audit('OUTBOUND_JOB_CREATED','outbound_job',v_job_id::text,p_job->>'name',null,jsonb_build_object('shipments',jsonb_array_length(coalesce(p_job->'shipments','[]'::jsonb))));
  return v_job_id;
end; $$;

create or replace function public.resolve_outbound_item(p_item_id uuid,p_product_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_product public.products%rowtype; v_shipment_id uuid; v_job_id uuid; v_required int; v_stock bigint;
begin
  perform public.require_outbound_use(true);
  select * into v_product from public.products where id=p_product_id and active;
  if not found then raise exception '활성 상품을 찾을 수 없습니다.'; end if;
  select shipment_id,required_qty into v_shipment_id,v_required from public.outbound_items where id=p_item_id for update;
  if not found then raise exception '확인 필요 품목을 찾을 수 없습니다.'; end if;
  select coalesce(sum(qty),0) into v_stock from public.inventory_balances where product_id=p_product_id;
  delete from public.outbound_item_locations where item_id=p_item_id;
  insert into public.outbound_item_locations(item_id,location_id,location_code,source_qty,priority)
  select p_item_id,ib.location_id,l.location_code,ib.qty,row_number() over(order by ib.qty desc,l.location_code)::int
  from public.inventory_balances ib join public.locations l on l.id=ib.location_id
  where ib.product_id=p_product_id and ib.qty>0 and l.active;
  update public.outbound_items set product_id=p_product_id,artist=coalesce(v_product.artist,''),name_ver=coalesce(v_product.name_ver,''),resolution=case when v_stock>=v_required then 'MATCHED' else 'INSUFFICIENT_STOCK' end,review_reason=case when v_stock>=v_required then null else format('재고 부족: 필요 %s개 / 현재 %s개',v_required,v_stock) end,updated_at=now() where id=p_item_id;
  update public.outbound_shipments s set status=case when exists(select 1 from public.outbound_items i where i.shipment_id=s.id and i.resolution<>'MATCHED') then 'REVIEW' else 'READY' end,updated_at=now() where id=v_shipment_id returning job_id into v_job_id;
  update public.outbound_jobs j set status=case when exists(select 1 from public.outbound_shipments s where s.job_id=j.id and s.status='REVIEW') then 'DRAFT' else 'READY' end,updated_at=now() where id=v_job_id and status in ('DRAFT','READY');
end; $$;

create or replace function public.set_outbound_manual_quantity(p_shipment_id uuid,p_allowed boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.require_outbound_use(true);
  update public.outbound_shipments set manual_quantity_allowed=p_allowed,updated_at=now() where id=p_shipment_id;
  if not found then raise exception '운송장을 찾을 수 없습니다.'; end if;
end; $$;

create or replace function public.archive_outbound_job(p_job_id uuid,p_archived boolean,p_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.require_outbound_use(true);
  if public.current_role()<>'admin' then raise exception '출고 작업 삭제·복원은 관리자만 가능합니다.'; end if;
  update public.outbound_jobs
  set archived_at=case when p_archived then now() else null end,
      archived_by=case when p_archived then auth.uid() else null end,
      archive_reason=case when p_archived then nullif(trim(coalesce(p_reason,'')),'') else null end,
      updated_at=now()
  where id=p_job_id;
  if not found then raise exception '출고 작업을 찾을 수 없습니다.'; end if;
  perform public.write_audit(
    case when p_archived then 'OUTBOUND_JOB_ARCHIVED' else 'OUTBOUND_JOB_RESTORED' end,
    'outbound_job',p_job_id::text,p_job_id::text,null,
    jsonb_build_object('reason',nullif(trim(coalesce(p_reason,'')),''))
  );
end; $$;

create or replace function public.pick_outbound_item(p_item_id uuid,p_qty integer,p_input_method text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_item public.outbound_items%rowtype; v_shipment public.outbound_shipments%rowtype; v_job_id uuid; v_job_archived_at timestamptz; v_remaining int; v_take int; v_balance record; v_after int; v_tx uuid; v_ids jsonb:='[]'::jsonb; v_existing public.outbound_pick_events%rowtype; v_barcode text;
begin
  perform public.require_outbound_use(false);
  if p_qty<=0 or p_input_method not in ('SCAN','MANUAL') or nullif(trim(p_idempotency_key),'') is null then raise exception '피킹 요청값이 올바르지 않습니다.'; end if;
  select * into v_existing from public.outbound_pick_events where idempotency_key=p_idempotency_key;
  if found then select * into v_item from public.outbound_items where id=v_existing.item_id; return jsonb_build_object('item_id',v_item.id,'picked_qty',v_item.picked_qty,'required_qty',v_item.required_qty,'duplicate',true); end if;
  select * into v_item from public.outbound_items where id=p_item_id for update;
  if not found then raise exception '피킹 품목을 찾을 수 없습니다.'; end if;
  select * into v_shipment from public.outbound_shipments where id=v_item.shipment_id for update;
  select archived_at into v_job_archived_at from public.outbound_jobs where id=v_shipment.job_id for update;
  if v_job_archived_at is not null then raise exception '삭제(숨김)된 출고 작업은 진행할 수 없습니다.'; end if;
  if v_item.resolution<>'MATCHED' or v_shipment.status='REVIEW' then raise exception '확인 필요 품목은 먼저 수정하세요.'; end if;
  if p_input_method='MANUAL' and not v_shipment.manual_quantity_allowed then raise exception '이 운송장은 직접 수량 입력이 허용되지 않았습니다.'; end if;
  if v_item.picked_qty+p_qty>v_item.required_qty then raise exception '필요 수량을 초과했습니다. 현재 %/%',v_item.picked_qty,v_item.required_qty; end if;
  v_remaining:=p_qty;
  select coalesce(b.barcode_value,v_item.product_barcode) into v_barcode from public.products p left join lateral(select barcode_value from public.barcodes where scan_target_id=p.scan_target_id and active order by is_primary desc,created_at limit 1)b on true where p.id=v_item.product_id;
  for v_balance in
    select ib.product_id,ib.location_id,ib.qty,l.location_code,coalesce(h.priority,2147483647) priority
    from public.inventory_balances ib join public.locations l on l.id=ib.location_id
    left join public.outbound_item_locations h on h.item_id=v_item.id and h.location_id=ib.location_id
    where ib.product_id=v_item.product_id and ib.qty>0 and l.active
    order by coalesce(h.priority,2147483647),ib.qty desc,l.location_code for update of ib
  loop
    exit when v_remaining=0; v_take:=least(v_remaining,v_balance.qty); v_after:=v_balance.qty-v_take;
    update public.inventory_balances set qty=v_after,updated_at=now() where product_id=v_balance.product_id and location_id=v_balance.location_id;
    v_tx:=gen_random_uuid();
    insert into public.inventory_transactions(id,operation,status,product_id,location_id,qty,before_qty,after_qty,product_barcode_value,location_barcode_value,reference_type,reference_id,idempotency_key,note,actor_id)
    values(v_tx,'OB','ACTIVE',v_item.product_id,v_balance.location_id,v_take,v_balance.qty,v_after,coalesce(v_barcode,v_item.product_barcode),v_balance.location_code,'OUTBOUND_PROGRESS',v_shipment.id::text,p_idempotency_key||':'||v_balance.location_id::text,'출고 진행 피킹',auth.uid());
    v_ids:=v_ids||jsonb_build_array(v_tx); v_remaining:=v_remaining-v_take;
  end loop;
  if v_remaining>0 then raise exception '재고 부족: 추가로 %개가 필요합니다.',v_remaining; end if;
  update public.outbound_items set picked_qty=picked_qty+p_qty,updated_at=now() where id=v_item.id returning * into v_item;
  insert into public.outbound_pick_events(job_id,shipment_id,item_id,qty,input_method,idempotency_key,actor_id)
  select s.job_id,s.id,v_item.id,p_qty,p_input_method,p_idempotency_key,auth.uid() from public.outbound_shipments s where s.id=v_item.shipment_id returning job_id into v_job_id;
  update public.outbound_shipments s set assigned_worker_id=coalesce(assigned_worker_id,auth.uid()),assigned_worker_label=coalesce(assigned_worker_label,public.user_label(auth.uid())),status=case when not exists(select 1 from public.outbound_items i where i.shipment_id=s.id and i.picked_qty<i.required_qty) then 'COMPLETED' else 'IN_PROGRESS' end,updated_at=now() where s.id=v_item.shipment_id returning * into v_shipment;
  update public.outbound_jobs j set status=case when not exists(select 1 from public.outbound_shipments s where s.job_id=j.id and s.status<>'COMPLETED') then 'COMPLETED' else 'IN_PROGRESS' end,updated_at=now() where id=v_job_id;
  return jsonb_build_object('item_id',v_item.id,'picked_qty',v_item.picked_qty,'required_qty',v_item.required_qty,'shipment_status',v_shipment.status,'transaction_ids',v_ids,'duplicate',false);
end; $$;

revoke all on function public.require_outbound_use(boolean) from public,anon;
revoke all on function public.create_outbound_job(jsonb) from public,anon;
revoke all on function public.resolve_outbound_item(uuid,uuid) from public,anon;
revoke all on function public.set_outbound_manual_quantity(uuid,boolean) from public,anon;
revoke all on function public.archive_outbound_job(uuid,boolean,text) from public,anon;
revoke all on function public.pick_outbound_item(uuid,integer,text,text) from public,anon;
grant execute on function public.create_outbound_job(jsonb) to authenticated;
grant execute on function public.resolve_outbound_item(uuid,uuid) to authenticated;
grant execute on function public.set_outbound_manual_quantity(uuid,boolean) to authenticated;
grant execute on function public.archive_outbound_job(uuid,boolean,text) to authenticated;
grant execute on function public.pick_outbound_item(uuid,integer,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
select 'SAN WMS V5.0.0 outbound progress production schema ready' as result;
