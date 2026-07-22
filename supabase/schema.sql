-- Barcode WMS v1.2 production schema
-- WARNING: this installer resets only Barcode WMS public objects.
-- Run the entire file once in Supabase SQL Editor.

create extension if not exists pgcrypto;

-- RESET SECTION: removes only Barcode WMS objects in the public schema.
drop trigger if exists on_auth_user_created on auth.users;
drop view if exists public.audit_log_view cascade;
drop view if exists public.scan_event_view cascade;
drop view if exists public.barcode_registry_view cascade;
drop view if exists public.scannable_targets_view cascade;
drop view if exists public.inventory_transaction_view cascade;
drop view if exists public.inventory_stock_view cascade;
drop table if exists public.audit_logs cascade;
drop table if exists public.scan_events cascade;
drop table if exists public.inventory_transactions cascade;
drop table if exists public.inventory_balances cascade;
drop table if exists public.barcodes cascade;
drop table if exists public.locations cascade;
drop table if exists public.products cascade;
drop table if exists public.scan_targets cascade;
drop table if exists public.profiles cascade;



create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'viewer' check (role in ('admin','manager','operator','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_role text;
begin
  v_role := case when exists(select 1 from public.profiles where role='admin' and active) then 'viewer' else 'admin' end;
  insert into public.profiles(id,email,display_name,role)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'display_name',new.email),v_role)
  on conflict(id) do update set email=excluded.email, display_name=coalesce(public.profiles.display_name, excluded.display_name);
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create table if not exists public.scan_targets (
  id uuid primary key default gen_random_uuid(),
  target_type text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  scan_target_id uuid not null unique references public.scan_targets(id) on delete restrict,
  p_code_no text not null default '',
  code_no text not null,
  master_code_no text not null default '',
  artist text not null default '',
  name_ver text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  scan_target_id uuid not null unique references public.scan_targets(id) on delete restrict,
  location_code text not null unique,
  zone text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.normalize_barcode(p_value text)
returns text language sql immutable as $$
  select upper(regexp_replace(trim(coalesce(p_value,'')), '\s+', '', 'g'));
$$;

create table if not exists public.barcodes (
  id uuid primary key default gen_random_uuid(),
  scan_target_id uuid not null references public.scan_targets(id) on delete restrict,
  barcode_value text not null,
  normalized_value text generated always as (public.normalize_barcode(barcode_value)) stored,
  source text not null default 'custom' check (source in ('manufacturer','internal','custom','future')),
  symbology text,
  is_primary boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(scan_target_id, normalized_value)
);
alter table public.products drop constraint if exists products_code_no_key;
alter table public.barcodes drop constraint if exists barcodes_normalized_value_key;
create unique index if not exists barcode_value_per_target on public.barcodes(scan_target_id,normalized_value);
create unique index if not exists one_primary_barcode_per_target on public.barcodes(scan_target_id) where is_primary and active;

create table if not exists public.inventory_balances (
  product_id uuid not null references public.products(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  qty integer not null default 0 check(qty>=0),
  updated_at timestamptz not null default now(),
  primary key(product_id,location_id)
);

create table if not exists public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  operation text not null check(operation in ('IB','OB')),
  status text not null default 'ACTIVE' check(status in ('ACTIVE','REVERSED','REVERSAL')),
  product_id uuid not null references public.products(id),
  location_id uuid not null references public.locations(id),
  qty integer not null check(qty>0),
  before_qty integer not null check(before_qty>=0),
  after_qty integer not null check(after_qty>=0),
  product_barcode_value text not null,
  location_barcode_value text not null,
  reference_type text,
  reference_id text,
  idempotency_key text not null unique,
  note text,
  actor_id uuid references auth.users(id),
  reversal_of uuid references public.inventory_transactions(id),
  reversed_by uuid references public.inventory_transactions(id),
  created_at timestamptz not null default now()
);

create table if not exists public.scan_events (
  id uuid primary key default gen_random_uuid(),
  raw_value text not null,
  normalized_value text not null,
  expected_target_type text,
  resolved_target_type text,
  scan_target_id uuid references public.scan_targets(id),
  target_label text,
  result text not null check(result in ('SUCCESS','NOT_FOUND','WRONG_TYPE','ERROR')),
  context text,
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entity_type text not null,
  entity_id text,
  entity_label text,
  before_data jsonb,
  after_data jsonb,
  note text,
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create or replace function public.current_role()
returns text language sql stable security definer set search_path=public as $$
  select coalesce((select role from public.profiles where id=auth.uid() and active),'viewer');
$$;

create or replace function public.require_role(p_roles text[])
returns void language plpgsql stable security definer set search_path=public as $$
begin
  if auth.uid() is null or not (public.current_role() = any(p_roles)) then
    raise exception '권한이 없습니다.';
  end if;
end; $$;

create or replace function public.write_audit(p_action text,p_entity_type text,p_entity_id text,p_entity_label text,p_before jsonb,p_after jsonb,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.audit_logs(action,entity_type,entity_id,entity_label,before_data,after_data,note,actor_id)
  values(p_action,p_entity_type,p_entity_id,p_entity_label,p_before,p_after,p_note,auth.uid());
end; $$;

create or replace function public.create_product_with_target(
  p_p_code_no text,p_code_no text,p_master_code_no text,p_artist text,p_name_ver text,
  p_primary_barcode text,p_barcode_source text default 'manufacturer',p_symbology text default 'AUTO'
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_target uuid; v_product uuid;
begin
  perform public.require_role(array['admin','manager','operator']);
  if nullif(trim(p_code_no),'') is null or nullif(trim(p_primary_barcode),'') is null then raise exception 'CODE_NO와 대표 바코드는 필수입니다.'; end if;
  if exists(select 1 from public.barcodes b join public.scan_targets st on st.id=b.scan_target_id where b.normalized_value=public.normalize_barcode(p_primary_barcode) and st.target_type<>'product') then
    raise exception '같은 번호를 상품과 로케이션에 동시에 사용할 수 없습니다.';
  end if;
  insert into public.scan_targets(target_type) values('product') returning id into v_target;
  insert into public.products(scan_target_id,p_code_no,code_no,master_code_no,artist,name_ver)
  values(v_target,coalesce(trim(p_p_code_no),''),trim(p_code_no),coalesce(trim(p_master_code_no),''),coalesce(trim(p_artist),''),coalesce(trim(p_name_ver),'')) returning id into v_product;
  insert into public.barcodes(scan_target_id,barcode_value,source,symbology,is_primary,created_by)
  values(v_target,trim(p_primary_barcode),p_barcode_source,p_symbology,true,auth.uid());
  perform public.write_audit('PRODUCT_CREATED','product',v_product::text,concat_ws(' · ',p_artist,p_name_ver),null,jsonb_build_object('code_no',p_code_no,'barcode',p_primary_barcode));
  return v_product;
end; $$;

create or replace function public.create_location_with_target(p_location_code text,p_zone text default '',p_barcode_value text default null,p_symbology text default 'CODE-128')
returns uuid language plpgsql security definer set search_path=public as $$
declare v_target uuid; v_location uuid; v_barcode text;
begin
  perform public.require_role(array['admin','manager','operator']);
  v_barcode:=coalesce(nullif(trim(p_barcode_value),''),upper(trim(p_location_code)));
  if exists(select 1 from public.barcodes where normalized_value=public.normalize_barcode(v_barcode)) then raise exception '로케이션 바코드는 중복될 수 없습니다.'; end if;
  insert into public.scan_targets(target_type) values('location') returning id into v_target;
  insert into public.locations(scan_target_id,location_code,zone) values(v_target,upper(trim(p_location_code)),coalesce(upper(trim(p_zone)),'')) returning id into v_location;
  insert into public.barcodes(scan_target_id,barcode_value,source,symbology,is_primary,created_by) values(v_target,v_barcode,'internal',p_symbology,true,auth.uid());
  perform public.write_audit('LOCATION_CREATED','location',v_location::text,upper(trim(p_location_code)),null,jsonb_build_object('barcode',v_barcode));
  return v_location;
end; $$;


create or replace function public.update_product(
  p_product_id uuid,p_new_p_code_no text default null,p_new_code_no text default null,p_new_master_code_no text default null,
  p_new_artist text default null,p_new_name_ver text default null,p_new_active boolean default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_before public.products%rowtype; v_after public.products%rowtype;
begin
  perform public.require_role(array['admin','manager','operator']);
  select * into v_before from public.products where id=p_product_id for update;
  if not found then raise exception '상품을 찾을 수 없습니다.'; end if;
  update public.products p set
    p_code_no=coalesce(p_new_p_code_no,p.p_code_no),
    code_no=coalesce(p_new_code_no,p.code_no),
    master_code_no=coalesce(p_new_master_code_no,p.master_code_no),
    artist=coalesce(p_new_artist,p.artist),
    name_ver=coalesce(p_new_name_ver,p.name_ver),
    active=coalesce(p_new_active,p.active),updated_at=now()
  where p.id=p_product_id returning p.* into v_after;
  update public.scan_targets set active=v_after.active where id=v_after.scan_target_id;
  perform public.write_audit('PRODUCT_UPDATED','product',p_product_id::text,concat_ws(' · ',v_after.artist,v_after.name_ver),to_jsonb(v_before),to_jsonb(v_after));
  return to_jsonb(v_after);
end; $$;

create or replace function public.update_location(
  p_location_id uuid,p_new_location_code text default null,p_new_zone text default null,p_new_active boolean default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_before public.locations%rowtype; v_after public.locations%rowtype;
begin
  perform public.require_role(array['admin','manager','operator']);
  select * into v_before from public.locations where id=p_location_id for update;
  if not found then raise exception '로케이션을 찾을 수 없습니다.'; end if;
  update public.locations l set location_code=coalesce(upper(trim(p_new_location_code)),l.location_code),zone=coalesce(upper(trim(p_new_zone)),l.zone),active=coalesce(p_new_active,l.active),updated_at=now()
  where l.id=p_location_id returning l.* into v_after;
  update public.scan_targets set active=v_after.active where id=v_after.scan_target_id;
  perform public.write_audit('LOCATION_UPDATED','location',p_location_id::text,v_after.location_code,to_jsonb(v_before),to_jsonb(v_after));
  return to_jsonb(v_after);
end; $$;

create or replace function public.register_barcode(p_target_type text,p_target_id uuid,p_barcode_value text,p_source text default 'custom',p_symbology text default null,p_make_primary boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_target uuid; v_id uuid;
begin
  perform public.require_role(array['admin','manager','operator']);
  if p_target_type='product' then select scan_target_id into v_target from public.products where id=p_target_id;
  elsif p_target_type='location' then select scan_target_id into v_target from public.locations where id=p_target_id;
  else raise exception '지원되지 않는 대상 유형'; end if;
  if v_target is null then raise exception '대상을 찾을 수 없습니다.'; end if;
  if exists(select 1 from public.barcodes where scan_target_id=v_target and normalized_value=public.normalize_barcode(p_barcode_value)) then raise exception '이 대상에는 이미 같은 바코드가 연결되어 있습니다.'; end if;
  if p_target_type='location' and exists(select 1 from public.barcodes where normalized_value=public.normalize_barcode(p_barcode_value)) then raise exception '로케이션 바코드는 중복될 수 없습니다.'; end if;
  if p_target_type='product' and exists(select 1 from public.barcodes b join public.scan_targets st on st.id=b.scan_target_id where b.normalized_value=public.normalize_barcode(p_barcode_value) and st.target_type<>'product') then raise exception '같은 번호를 상품과 로케이션에 동시에 사용할 수 없습니다.'; end if;
  if p_make_primary then update public.barcodes set is_primary=false where scan_target_id=v_target; end if;
  insert into public.barcodes(scan_target_id,barcode_value,source,symbology,is_primary,created_by)
  values(v_target,trim(p_barcode_value),p_source,p_symbology,p_make_primary,auth.uid()) returning id into v_id;
  perform public.write_audit('BARCODE_CREATED','barcode',v_id::text,p_barcode_value,null,jsonb_build_object('target_type',p_target_type,'target_id',p_target_id,'primary',p_make_primary));
  return v_id;
end; $$;

create or replace function public.update_barcode_status(p_barcode_id uuid,p_active boolean default null,p_make_primary boolean default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_before public.barcodes%rowtype; v_after public.barcodes%rowtype;
begin
  perform public.require_role(array['admin','manager','operator']);
  select * into v_before from public.barcodes where id=p_barcode_id for update;
  if not found then raise exception '바코드를 찾을 수 없습니다.'; end if;
  if p_make_primary is true then
    update public.barcodes set is_primary=false where scan_target_id=v_before.scan_target_id;
    update public.barcodes set is_primary=true,active=true where id=p_barcode_id;
  end if;
  if p_active is not null then update public.barcodes set active=p_active,is_primary=case when p_active then is_primary else false end where id=p_barcode_id; end if;
  select * into v_after from public.barcodes where id=p_barcode_id;
  perform public.write_audit('BARCODE_UPDATED','barcode',p_barcode_id::text,v_after.barcode_value,to_jsonb(v_before),to_jsonb(v_after));
end; $$;

create or replace function public.resolve_barcode_logged(
  p_barcode_value text,p_expected_target_type text default null,p_context text default 'LOOKUP'
)
returns table(barcode_id uuid,barcode_value text,scan_target_id uuid,target_type text,target_id uuid,target_data jsonb)
language plpgsql security definer set search_path=public as $$
declare
  v_total int:=0;
  v_expected int:=0;
  v_result text;
  v_label text;
  v_type text;
  v_target uuid;
begin
  select count(*),
    count(*) filter (where p_expected_target_type is null or st.target_type=p_expected_target_type),
    string_agg(
      case when st.target_type='product' then concat_ws(' · ',p.artist,p.name_ver)
           when st.target_type='location' then l.location_code
           else b.barcode_value end,
      ', ' order by b.created_at
    ),
    (array_agg(st.target_type order by st.target_type))[1],
    (array_agg(st.id order by st.id))[1]
  into v_total,v_expected,v_label,v_type,v_target
  from public.barcodes b
  join public.scan_targets st on st.id=b.scan_target_id
  left join public.products p on p.scan_target_id=st.id
  left join public.locations l on l.scan_target_id=st.id
  where b.normalized_value=public.normalize_barcode(p_barcode_value) and b.active and st.active;

  if v_total=0 then v_result:='NOT_FOUND';
  elsif p_expected_target_type is not null and v_expected=0 then v_result:='WRONG_TYPE';
  else v_result:='SUCCESS'; end if;

  insert into public.scan_events(raw_value,normalized_value,expected_target_type,resolved_target_type,scan_target_id,target_label,result,context,actor_id)
  values(
    p_barcode_value,public.normalize_barcode(p_barcode_value),p_expected_target_type,v_type,v_target,
    case when v_expected>1 then left(v_label,500) else v_label end,v_result,
    case when v_expected>1 then p_context||'_MULTI_MATCH_'||v_expected else p_context end,auth.uid()
  );

  return query
  select b.id,b.barcode_value,st.id,st.target_type,
    case when st.target_type='product' then p.id when st.target_type='location' then l.id else st.id end,
    case when st.target_type='product' then jsonb_build_object(
      'id',p.id,'scan_target_id',p.scan_target_id,'p_code_no',p.p_code_no,'code_no',p.code_no,
      'master_code_no',p.master_code_no,'artist',p.artist,'name_ver',p.name_ver,'active',p.active,
      'created_at',p.created_at,'updated_at',p.updated_at
    ) when st.target_type='location' then jsonb_build_object(
      'id',l.id,'scan_target_id',l.scan_target_id,'location_code',l.location_code,'zone',l.zone,
      'active',l.active,'created_at',l.created_at,'updated_at',l.updated_at
    ) else jsonb_build_object('label',b.barcode_value) end
  from public.barcodes b
  join public.scan_targets st on st.id=b.scan_target_id
  left join public.products p on p.scan_target_id=st.id
  left join public.locations l on l.scan_target_id=st.id
  where b.normalized_value=public.normalize_barcode(p_barcode_value) and b.active and st.active
    and (p_expected_target_type is null or st.target_type=p_expected_target_type)
  order by case when st.target_type='product' then concat_ws(' ',p.artist,p.name_ver) else l.location_code end;
end; $$;

create or replace function public.post_inventory_movement(
  p_operation text,p_product_barcode text,p_location_barcode text,p_quantity integer,p_idempotency_key text,p_note text default null,
  p_reference_type text default null,p_reference_id text default null,p_product_id uuid default null,p_location_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_product public.products%rowtype;
  v_location public.locations%rowtype;
  v_pb text;
  v_lb text;
  v_before int;
  v_after int;
  v_id uuid;
  v_existing public.inventory_transactions%rowtype;
  v_product_count int;
  v_location_count int;
begin
  perform public.require_role(array['admin','manager','operator']);
  if p_operation not in('IB','OB') or p_quantity<=0 then raise exception '작업 구분 또는 수량 오류'; end if;

  select * into v_existing from public.inventory_transactions where idempotency_key=p_idempotency_key;
  if found then
    select * into v_product from public.products where id=v_existing.product_id;
    select * into v_location from public.locations where id=v_existing.location_id;
    return jsonb_build_object('transaction_id',v_existing.id,'quantity',v_existing.qty,'before_qty',v_existing.before_qty,'after_qty',v_existing.after_qty,'product',to_jsonb(v_product),'location',to_jsonb(v_location));
  end if;

  select count(*) into v_product_count
  from public.barcodes b join public.scan_targets st on st.id=b.scan_target_id and st.target_type='product'
  join public.products p on p.scan_target_id=st.id and p.active
  where b.normalized_value=public.normalize_barcode(p_product_barcode) and b.active and (p_product_id is null or p.id=p_product_id);
  if v_product_count=0 then raise exception '등록되지 않았거나 상품이 아닌 바코드입니다.'; end if;
  if v_product_count>1 and p_product_id is null then raise exception '공통 상품 바코드입니다. 상품/버전을 선택하세요.'; end if;

  select p.* into v_product
  from public.barcodes b join public.scan_targets st on st.id=b.scan_target_id and st.target_type='product'
  join public.products p on p.scan_target_id=st.id and p.active
  where b.normalized_value=public.normalize_barcode(p_product_barcode) and b.active and (p_product_id is null or p.id=p_product_id)
  order by p.created_at limit 1;
  select b.barcode_value into v_pb
  from public.barcodes b where b.scan_target_id=v_product.scan_target_id and b.normalized_value=public.normalize_barcode(p_product_barcode) and b.active
  order by b.is_primary desc,b.created_at limit 1;

  select count(*) into v_location_count
  from public.barcodes b join public.scan_targets st on st.id=b.scan_target_id and st.target_type='location'
  join public.locations l on l.scan_target_id=st.id and l.active
  where b.normalized_value=public.normalize_barcode(p_location_barcode) and b.active and (p_location_id is null or l.id=p_location_id);
  if v_location_count=0 then raise exception '등록되지 않았거나 로케이션이 아닌 바코드입니다.'; end if;
  if v_location_count>1 and p_location_id is null then raise exception '로케이션 바코드가 중복되어 있습니다.'; end if;

  select l.* into v_location
  from public.barcodes b join public.scan_targets st on st.id=b.scan_target_id and st.target_type='location'
  join public.locations l on l.scan_target_id=st.id and l.active
  where b.normalized_value=public.normalize_barcode(p_location_barcode) and b.active and (p_location_id is null or l.id=p_location_id)
  order by l.created_at limit 1;
  select b.barcode_value into v_lb
  from public.barcodes b where b.scan_target_id=v_location.scan_target_id and b.normalized_value=public.normalize_barcode(p_location_barcode) and b.active
  order by b.is_primary desc,b.created_at limit 1;

  insert into public.inventory_balances(product_id,location_id,qty) values(v_product.id,v_location.id,0) on conflict do nothing;
  select qty into v_before from public.inventory_balances where product_id=v_product.id and location_id=v_location.id for update;
  v_after:=case when p_operation='IB' then v_before+p_quantity else v_before-p_quantity end;
  if v_after<0 then raise exception '재고 부족: 현재 %, 출고 요청 %',v_before,p_quantity; end if;
  update public.inventory_balances set qty=v_after,updated_at=now() where product_id=v_product.id and location_id=v_location.id;

  insert into public.inventory_transactions(operation,product_id,location_id,qty,before_qty,after_qty,product_barcode_value,location_barcode_value,reference_type,reference_id,idempotency_key,note,actor_id)
  values(p_operation,v_product.id,v_location.id,p_quantity,v_before,v_after,v_pb,v_lb,p_reference_type,p_reference_id,p_idempotency_key,p_note,auth.uid()) returning id into v_id;
  perform public.write_audit(case when p_operation='IB' then 'INVENTORY_INBOUND' else 'INVENTORY_OUTBOUND' end,'inventory_transaction',v_id::text,concat_ws(' @ ',concat_ws(' ',v_product.artist,v_product.name_ver),v_location.location_code),jsonb_build_object('qty',v_before),jsonb_build_object('qty',v_after),p_note);
  return jsonb_build_object('transaction_id',v_id,'quantity',p_quantity,'before_qty',v_before,'after_qty',v_after,'product',to_jsonb(v_product),'location',to_jsonb(v_location));
end; $$;

create or replace function public.reverse_inventory_transaction(p_transaction_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_original public.inventory_transactions%rowtype; v_before int; v_after int; v_reverse_op text; v_reverse_id uuid;
begin
  perform public.require_role(array['admin','manager']);
  select * into v_original from public.inventory_transactions where id=p_transaction_id for update;
  if not found or v_original.status<>'ACTIVE' then raise exception '취소 가능한 원거래가 아닙니다.'; end if;
  select qty into v_before from public.inventory_balances where product_id=v_original.product_id and location_id=v_original.location_id for update;
  v_reverse_op:=case when v_original.operation='IB' then 'OB' else 'IB' end;
  v_after:=case when v_reverse_op='IB' then v_before+v_original.qty else v_before-v_original.qty end;
  if v_after<0 then raise exception '현재 재고가 부족해 입고 거래를 취소할 수 없습니다.'; end if;
  update public.inventory_balances set qty=v_after,updated_at=now() where product_id=v_original.product_id and location_id=v_original.location_id;
  insert into public.inventory_transactions(operation,status,product_id,location_id,qty,before_qty,after_qty,product_barcode_value,location_barcode_value,idempotency_key,note,actor_id,reversal_of)
  values(v_reverse_op,'REVERSAL',v_original.product_id,v_original.location_id,v_original.qty,v_before,v_after,v_original.product_barcode_value,v_original.location_barcode_value,gen_random_uuid()::text,p_reason,auth.uid(),v_original.id) returning id into v_reverse_id;
  update public.inventory_transactions set status='REVERSED',reversed_by=v_reverse_id where id=v_original.id;
  perform public.write_audit('TRANSACTION_REVERSED','inventory_transaction',v_original.id::text,null,jsonb_build_object('status','ACTIVE','qty',v_before),jsonb_build_object('status','REVERSED','qty',v_after,'reversal_id',v_reverse_id),p_reason);
  return jsonb_build_object('id',v_reverse_id,'operation',v_reverse_op,'status','REVERSAL','product_id',v_original.product_id,'location_id',v_original.location_id,'qty',v_original.qty,'before_qty',v_before,'after_qty',v_after,'product_barcode_value',v_original.product_barcode_value,'location_barcode_value',v_original.location_barcode_value,'created_at',now(),'note',p_reason,'reversal_of',v_original.id);
end; $$;

create or replace function public.update_user_role(p_user_id uuid,p_role text)
returns void language plpgsql security definer set search_path=public as $$
declare v_before text;
begin
  perform public.require_role(array['admin']);
  if p_role not in('admin','manager','operator','viewer') then raise exception '역할 오류'; end if;
  select role into v_before from public.profiles where id=p_user_id;
  update public.profiles set role=p_role,updated_at=now() where id=p_user_id;
  perform public.write_audit('USER_ROLE_CHANGED','user',p_user_id::text,null,jsonb_build_object('role',v_before),jsonb_build_object('role',p_role));
end; $$;

create or replace function public.import_inventory_rows(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb; v_product public.products%rowtype; v_location public.locations%rowtype; v_target uuid; v_products int:=0; v_locations int:=0; v_barcodes int:=0; v_balances int:=0; v_rows int:=0; v_barcode text;
begin
  perform public.require_role(array['admin','manager']);
  for r in select * from jsonb_array_elements(p_rows) loop
    select * into v_product from public.products
    where upper(p_code_no)=upper(coalesce(r->>'pCodeNo',''))
      and upper(code_no)=upper(coalesce(r->>'codeNo',''))
      and upper(master_code_no)=upper(coalesce(r->>'masterCodeNo',''))
      and upper(artist)=upper(coalesce(r->>'artist',''))
      and upper(name_ver)=upper(coalesce(r->>'nameVer',''))
    limit 1;

    if v_product.id is null then
      select * into v_product from public.products
      where upper(code_no)=upper(coalesce(r->>'codeNo','')) and (trim(artist)='' or trim(name_ver)='')
      limit 1;
      if v_product.id is not null then
        update public.products set
          p_code_no=coalesce(nullif(r->>'pCodeNo',''),p_code_no),
          master_code_no=coalesce(nullif(r->>'masterCodeNo',''),master_code_no),
          artist=coalesce(nullif(r->>'artist',''),artist),
          name_ver=coalesce(nullif(r->>'nameVer',''),name_ver),updated_at=now()
        where id=v_product.id returning * into v_product;
      end if;
    end if;

    if v_product.id is null then
      insert into public.scan_targets(target_type) values('product') returning id into v_target;
      insert into public.products(scan_target_id,p_code_no,code_no,master_code_no,artist,name_ver)
      values(v_target,coalesce(r->>'pCodeNo',''),r->>'codeNo',coalesce(r->>'masterCodeNo',''),coalesce(r->>'artist',''),coalesce(r->>'nameVer',''))
      returning * into v_product;
      v_products:=v_products+1;
    end if;

    v_barcode:=coalesce(nullif(r->>'productBarcode',''),nullif(r->>'codeNo',''));
    if v_barcode is not null and not exists(
      select 1 from public.barcodes where scan_target_id=v_product.scan_target_id and normalized_value=public.normalize_barcode(v_barcode)
    ) then
      if exists(
        select 1 from public.barcodes b join public.scan_targets st on st.id=b.scan_target_id
        where b.normalized_value=public.normalize_barcode(v_barcode) and st.target_type<>'product'
      ) then raise exception '상품 바코드 %가 로케이션 바코드와 충돌합니다.',v_barcode; end if;
      insert into public.barcodes(scan_target_id,barcode_value,source,symbology,is_primary,created_by)
      values(v_product.scan_target_id,v_barcode,'manufacturer','AUTO',not exists(select 1 from public.barcodes where scan_target_id=v_product.scan_target_id),auth.uid());
      v_barcodes:=v_barcodes+1;
    end if;

    select * into v_location from public.locations where location_code=upper(r->>'locationCode') limit 1;
    if v_location.id is null then
      insert into public.scan_targets(target_type) values('location') returning id into v_target;
      insert into public.locations(scan_target_id,location_code,zone) values(v_target,upper(r->>'locationCode'),split_part(upper(r->>'locationCode'),'-',1)) returning * into v_location;
      v_locations:=v_locations+1;
      v_barcode:=coalesce(nullif(r->>'locationBarcode',''),upper(r->>'locationCode'));
      if exists(select 1 from public.barcodes where normalized_value=public.normalize_barcode(v_barcode)) then
        raise exception '로케이션 바코드 %가 이미 사용 중입니다.',v_barcode;
      end if;
      insert into public.barcodes(scan_target_id,barcode_value,source,symbology,is_primary,created_by) values(v_location.scan_target_id,v_barcode,'internal','CODE-128',true,auth.uid());
      v_barcodes:=v_barcodes+1;
    end if;

    insert into public.inventory_balances(product_id,location_id,qty,updated_at)
    values(v_product.id,v_location.id,(r->>'qty')::int,now())
    on conflict(product_id,location_id) do update set qty=excluded.qty,updated_at=now();
    v_balances:=v_balances+1; v_rows:=v_rows+1;
  end loop;
  perform public.write_audit('INVENTORY_IMPORTED','import',gen_random_uuid()::text,v_rows||' rows',null,jsonb_build_object('rowsProcessed',v_rows,'productsCreated',v_products,'locationsCreated',v_locations,'barcodesCreated',v_barcodes,'balancesUpserted',v_balances));
  return jsonb_build_object('rowsProcessed',v_rows,'productsCreated',v_products,'locationsCreated',v_locations,'barcodesCreated',v_barcodes,'balancesUpserted',v_balances);
end; $$;

create or replace view public.inventory_stock_view with (security_invoker=true) as
select ib.product_id,ib.location_id,p.p_code_no,p.code_no,p.master_code_no,p.artist,p.name_ver,l.location_code,l.zone,ib.qty,ib.updated_at
from public.inventory_balances ib join public.products p on p.id=ib.product_id join public.locations l on l.id=ib.location_id;

create or replace view public.inventory_transaction_view with (security_invoker=true) as
select t.*,concat_ws(' ',p.artist,p.name_ver) product_label,l.location_code,pr.display_name actor_label,
  upper(concat_ws(' ',p.artist,p.name_ver,l.location_code,t.product_barcode_value,t.location_barcode_value,pr.display_name,t.note)) search_text
from public.inventory_transactions t join public.products p on p.id=t.product_id join public.locations l on l.id=t.location_id left join public.profiles pr on pr.id=t.actor_id;

create or replace view public.scannable_targets_view with (security_invoker=true) as
select 'product'::text target_type,p.id target_id,p.scan_target_id,concat_ws(' · ',p.artist,p.name_ver) label,concat_ws(' / ',p.code_no,p.p_code_no) description,upper(concat_ws(' ',p.code_no,p.p_code_no,p.master_code_no,p.artist,p.name_ver)) search_text from public.products p where p.active
union all
select 'location',l.id,l.scan_target_id,l.location_code,l.zone,upper(concat_ws(' ',l.location_code,l.zone)) from public.locations l where l.active;

create or replace view public.barcode_registry_view with (security_invoker=true) as
select b.id,b.scan_target_id,st.target_type,case when st.target_type='product' then p.id else l.id end target_id,
 case when st.target_type='product' then concat_ws(' · ',p.artist,p.name_ver) else l.location_code end target_label,
 b.barcode_value,b.normalized_value,b.source,b.symbology,b.is_primary,b.active,b.created_at,
 upper(concat_ws(' ',b.barcode_value,p.artist,p.name_ver,p.code_no,l.location_code,b.source,b.symbology)) search_text
from public.barcodes b join public.scan_targets st on st.id=b.scan_target_id left join public.products p on p.scan_target_id=st.id left join public.locations l on l.scan_target_id=st.id;

create or replace view public.scan_event_view with (security_invoker=true) as
select s.*,pr.display_name actor_label,upper(concat_ws(' ',s.raw_value,s.target_label,s.context,pr.display_name)) search_text from public.scan_events s left join public.profiles pr on pr.id=s.actor_id;
create or replace view public.audit_log_view with (security_invoker=true) as
select a.*,pr.display_name actor_label,upper(concat_ws(' ',a.action,a.entity_type,a.entity_label,a.note,pr.display_name)) search_text from public.audit_logs a left join public.profiles pr on pr.id=a.actor_id;

alter table public.profiles enable row level security;
alter table public.scan_targets enable row level security;
alter table public.products enable row level security;
alter table public.locations enable row level security;
alter table public.barcodes enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.scan_events enable row level security;
alter table public.audit_logs enable row level security;

-- Read policies. All writes are performed through the security-definer RPCs above.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
using (id=auth.uid() or public.current_role()='admin');

do $$ declare t text; begin
  foreach t in array array['scan_targets','products','locations','barcodes','inventory_balances','inventory_transactions'] loop
    execute format('drop policy if exists authenticated_read on public.%I',t);
    execute format('create policy authenticated_read on public.%I for select to authenticated using (true)',t);
  end loop;
end $$;

drop policy if exists scan_events_read on public.scan_events;
create policy scan_events_read on public.scan_events for select to authenticated
using (public.current_role() in ('admin','manager','operator','viewer'));

drop policy if exists audit_logs_read on public.audit_logs;
create policy audit_logs_read on public.audit_logs for select to authenticated
using (public.current_role() in ('admin','manager'));

grant select on public.inventory_stock_view,public.inventory_transaction_view,public.scannable_targets_view,public.barcode_registry_view,public.scan_event_view,public.audit_log_view to authenticated;

revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.current_role() to authenticated;
grant execute on function public.create_product_with_target(text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.create_location_with_target(text,text,text,text) to authenticated;
grant execute on function public.update_product(uuid,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.update_location(uuid,text,text,boolean) to authenticated;
grant execute on function public.register_barcode(text,uuid,text,text,text,boolean) to authenticated;
grant execute on function public.update_barcode_status(uuid,boolean,boolean) to authenticated;
grant execute on function public.resolve_barcode_logged(text,text,text) to authenticated;
grant execute on function public.post_inventory_movement(text,text,text,integer,text,text,text,text,uuid,uuid) to authenticated;
grant execute on function public.reverse_inventory_transaction(uuid,text) to authenticated;
grant execute on function public.update_user_role(uuid,text) to authenticated;
grant execute on function public.import_inventory_rows(jsonb) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['inventory_balances','inventory_transactions','barcodes','products','locations'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;


-- Bootstrap profiles for Auth users that already existed before this installer ran.
insert into public.profiles(id,email,display_name,role)
select u.id,u.email,coalesce(u.raw_user_meta_data->>'display_name',u.email),
       case when row_number() over(order by u.created_at,u.id)=1 then 'admin' else 'viewer' end
from auth.users u
where not exists(select 1 from public.profiles p where p.id=u.id)
on conflict(id) do nothing;

select 'Barcode WMS v1.2 installation completed' as result;
