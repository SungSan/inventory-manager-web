-- SAN WMS V4.8.0: ALBUM/MD product category + per-location facility + per-user access
begin;

alter table public.products add column if not exists product_category text not null default 'ALBUM';
alter table public.locations add column if not exists facility text not null default 'UNASSIGNED';

alter table public.products drop constraint if exists products_product_category_check;
alter table public.products add constraint products_product_category_check check (product_category in ('ALBUM','MD'));
alter table public.locations drop constraint if exists locations_facility_check;
alter table public.locations add constraint locations_facility_check check (facility in ('DAEJA','GWANSAN','UNASSIGNED'));

-- 명확한 기존 코드만 초기 분류한다. 나머지는 로케이션 관리에서 직접 지정한다.
update public.locations set facility='DAEJA' where facility='UNASSIGNED' and regexp_replace(upper(location_code),'[^A-Z0-9]','','g') like 'D1%';
update public.locations set facility='GWANSAN' where facility='UNASSIGNED' and (regexp_replace(upper(location_code),'[^A-Z0-9]','','g') like 'K1%' or regexp_replace(upper(location_code),'[^A-Z0-9]','','g') like 'KN%');

create or replace function public.create_product_with_target_v2(
  p_p_code_no text,p_code_no text,p_master_code_no text,p_artist text,p_name_ver text,p_primary_barcode text,
  p_product_category text default 'ALBUM',p_barcode_source text default 'manufacturer',p_symbology text default 'AUTO'
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_target uuid; v_product uuid; v_category text:=upper(trim(coalesce(p_product_category,'ALBUM')));
begin
  perform public.require_role(array['admin','manager','operator']);
  if v_category not in ('ALBUM','MD') then raise exception '상품 구분은 앨범 또는 MD여야 합니다.'; end if;
  if nullif(trim(p_code_no),'') is null or nullif(trim(p_primary_barcode),'') is null then raise exception 'CODE_NO와 대표 바코드는 필수입니다.'; end if;
  if exists(select 1 from public.barcodes b join public.scan_targets st on st.id=b.scan_target_id where b.normalized_value=public.normalize_barcode(p_primary_barcode) and st.target_type<>'product') then raise exception '같은 번호를 상품과 로케이션에 동시에 사용할 수 없습니다.'; end if;
  insert into public.scan_targets(target_type) values('product') returning id into v_target;
  insert into public.products(scan_target_id,p_code_no,code_no,master_code_no,artist,name_ver,product_category)
  values(v_target,coalesce(trim(p_p_code_no),''),trim(p_code_no),coalesce(trim(p_master_code_no),''),coalesce(trim(p_artist),''),coalesce(trim(p_name_ver),''),v_category) returning id into v_product;
  insert into public.barcodes(scan_target_id,barcode_value,source,symbology,is_primary,created_by) values(v_target,trim(p_primary_barcode),p_barcode_source,p_symbology,true,auth.uid());
  perform public.write_audit('PRODUCT_CREATED','product',v_product::text,concat_ws(' · ',p_artist,p_name_ver),null,jsonb_build_object('code_no',p_code_no,'barcode',p_primary_barcode,'product_category',v_category));
  return v_product;
end; $$;

create or replace function public.update_product_v2(
  p_product_id uuid,p_new_p_code_no text default null,p_new_code_no text default null,p_new_master_code_no text default null,
  p_new_artist text default null,p_new_name_ver text default null,p_new_product_category text default null,p_new_active boolean default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_before public.products%rowtype; v_after public.products%rowtype; v_category text;
begin
  perform public.require_role(array['admin','manager','operator']);
  select * into v_before from public.products where id=p_product_id for update;
  if not found then raise exception '상품을 찾을 수 없습니다.'; end if;
  v_category:=coalesce(upper(trim(p_new_product_category)),v_before.product_category);
  if v_category not in ('ALBUM','MD') then raise exception '상품 구분은 앨범 또는 MD여야 합니다.'; end if;
  update public.products p set p_code_no=coalesce(p_new_p_code_no,p.p_code_no),code_no=coalesce(p_new_code_no,p.code_no),master_code_no=coalesce(p_new_master_code_no,p.master_code_no),artist=coalesce(p_new_artist,p.artist),name_ver=coalesce(p_new_name_ver,p.name_ver),product_category=v_category,active=coalesce(p_new_active,p.active),updated_at=now() where p.id=p_product_id returning p.* into v_after;
  update public.scan_targets set active=v_after.active where id=v_after.scan_target_id;
  perform public.write_audit('PRODUCT_UPDATED','product',p_product_id::text,concat_ws(' · ',v_after.artist,v_after.name_ver),to_jsonb(v_before),to_jsonb(v_after));
  return to_jsonb(v_after);
end; $$;

create or replace function public.create_location_with_target_v2(p_location_code text,p_zone text default '',p_facility text default 'UNASSIGNED',p_barcode_value text default null,p_symbology text default 'CODE-128')
returns uuid language plpgsql security definer set search_path=public as $$
declare v_target uuid; v_location uuid; v_barcode text; v_facility text:=upper(trim(coalesce(p_facility,'UNASSIGNED')));
begin
  perform public.require_role(array['admin','manager','operator']);
  if v_facility not in ('DAEJA','GWANSAN','UNASSIGNED') then raise exception '올바른 사업장을 선택하세요.'; end if;
  v_barcode:=coalesce(nullif(trim(p_barcode_value),''),upper(trim(p_location_code)));
  if exists(select 1 from public.barcodes where normalized_value=public.normalize_barcode(v_barcode)) then raise exception '로케이션 바코드는 중복될 수 없습니다.'; end if;
  insert into public.scan_targets(target_type) values('location') returning id into v_target;
  insert into public.locations(scan_target_id,location_code,zone,facility) values(v_target,upper(trim(p_location_code)),coalesce(upper(trim(p_zone)),''),v_facility) returning id into v_location;
  insert into public.barcodes(scan_target_id,barcode_value,source,symbology,is_primary,created_by) values(v_target,v_barcode,'internal',p_symbology,true,auth.uid());
  perform public.write_audit('LOCATION_CREATED','location',v_location::text,upper(trim(p_location_code)),null,jsonb_build_object('barcode',v_barcode,'facility',v_facility));
  return v_location;
end; $$;

create or replace function public.update_location_v2(p_location_id uuid,p_new_location_code text default null,p_new_zone text default null,p_new_facility text default null,p_new_active boolean default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_before public.locations%rowtype; v_after public.locations%rowtype; v_facility text;
begin
  perform public.require_role(array['admin','manager','operator']);
  select * into v_before from public.locations where id=p_location_id for update;
  if not found then raise exception '로케이션을 찾을 수 없습니다.'; end if;
  v_facility:=coalesce(upper(trim(p_new_facility)),v_before.facility);
  if v_facility not in ('DAEJA','GWANSAN','UNASSIGNED') then raise exception '올바른 사업장을 선택하세요.'; end if;
  update public.locations l set location_code=coalesce(upper(trim(p_new_location_code)),l.location_code),zone=coalesce(upper(trim(p_new_zone)),l.zone),facility=v_facility,active=coalesce(p_new_active,l.active),updated_at=now() where l.id=p_location_id returning l.* into v_after;
  update public.scan_targets set active=v_after.active where id=v_after.scan_target_id;
  perform public.write_audit('LOCATION_UPDATED','location',p_location_id::text,v_after.location_code,to_jsonb(v_before),to_jsonb(v_after));
  return to_jsonb(v_after);
end; $$;

create or replace view public.inventory_stock_view with (security_invoker=true) as
select ib.product_id,ib.location_id,p.p_code_no,p.code_no,p.master_code_no,p.artist,p.name_ver,p.product_category,l.location_code,l.zone,l.facility,ib.qty,ib.updated_at
from public.inventory_balances ib join public.products p on p.id=ib.product_id join public.locations l on l.id=ib.location_id;

create or replace view public.inventory_transaction_view with (security_invoker=true) as
select t.*,concat_ws(' ',p.artist,p.name_ver) product_label,p.product_category,l.location_code,l.facility,pr.display_name actor_label,
  upper(concat_ws(' ',p.artist,p.name_ver,p.product_category,l.location_code,l.facility,t.product_barcode_value,t.location_barcode_value,pr.display_name,t.note)) search_text
from public.inventory_transactions t join public.products p on p.id=t.product_id join public.locations l on l.id=t.location_id left join public.profiles pr on pr.id=t.actor_id;

revoke all on function public.create_product_with_target_v2(text,text,text,text,text,text,text,text,text) from public,anon;
revoke all on function public.update_product_v2(uuid,text,text,text,text,text,text,boolean) from public,anon;
revoke all on function public.create_location_with_target_v2(text,text,text,text,text) from public,anon;
revoke all on function public.update_location_v2(uuid,text,text,text,boolean) from public,anon;
grant execute on function public.create_product_with_target_v2(text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.update_product_v2(uuid,text,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.create_location_with_target_v2(text,text,text,text,text) to authenticated;
grant execute on function public.update_location_v2(uuid,text,text,text,boolean) to authenticated;

create table if not exists public.user_menu_access (
  user_id uuid not null references public.profiles(id) on delete cascade,
  menu_key text not null,
  access_level text not null check (access_level in ('HIDDEN','VIEW','USE')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  primary key(user_id,menu_key)
);
create table if not exists public.user_product_scopes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_scope text not null check (product_scope in ('ALBUM','MD')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  primary key(user_id,product_scope)
);
alter table public.user_menu_access enable row level security;
alter table public.user_product_scopes enable row level security;
drop policy if exists user_menu_access_own_read on public.user_menu_access;
create policy user_menu_access_own_read on public.user_menu_access for select to authenticated using (user_id=auth.uid() or public.current_user_role()='admin');
drop policy if exists user_product_scopes_own_read on public.user_product_scopes;
create policy user_product_scopes_own_read on public.user_product_scopes for select to authenticated using (user_id=auth.uid() or public.current_user_role()='admin');

insert into public.user_product_scopes(user_id,product_scope)
select id,'ALBUM' from public.profiles on conflict do nothing;

create or replace function public.get_my_access_config() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'menu_access',coalesce((select jsonb_object_agg(menu_key,access_level) from public.user_menu_access where user_id=auth.uid()),'{}'::jsonb),
    'product_scopes',coalesce((select jsonb_agg(product_scope order by product_scope) from public.user_product_scopes where user_id=auth.uid()),'["ALBUM"]'::jsonb)
  );
$$;

create or replace function public.admin_get_user_access_config(p_user_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.require_role(array['admin']);
  return jsonb_build_object(
    'menu_access',coalesce((select jsonb_object_agg(menu_key,access_level) from public.user_menu_access where user_id=p_user_id),'{}'::jsonb),
    'product_scopes',coalesce((select jsonb_agg(product_scope order by product_scope) from public.user_product_scopes where user_id=p_user_id),'["ALBUM"]'::jsonb)
  );
end; $$;

create or replace function public.admin_save_user_access_config(p_user_id uuid,p_menu_access jsonb,p_product_scopes jsonb) returns void language plpgsql security definer set search_path=public as $$
declare v_key text; v_level text; v_scope text;
begin
  perform public.require_role(array['admin']);
  if p_user_id=auth.uid() then raise exception '현재 로그인한 관리자 자신의 세부권한은 변경할 수 없습니다.'; end if;
  if jsonb_array_length(coalesce(p_product_scopes,'[]'::jsonb))=0 then raise exception '최소 한 가지 상품 데이터 범위를 선택하세요.'; end if;
  delete from public.user_menu_access where user_id=p_user_id;
  for v_key,v_level in select key,value#>>'{}' from jsonb_each(coalesce(p_menu_access,'{}'::jsonb)) loop
    if v_level not in ('HIDDEN','VIEW','USE') then raise exception '잘못된 메뉴 권한입니다.'; end if;
    insert into public.user_menu_access(user_id,menu_key,access_level,updated_by) values(p_user_id,v_key,v_level,auth.uid());
  end loop;
  delete from public.user_product_scopes where user_id=p_user_id;
  for v_scope in select value#>>'{}' from jsonb_array_elements(p_product_scopes) loop
    if v_scope not in ('ALBUM','MD') then raise exception '잘못된 상품 범위입니다.'; end if;
    insert into public.user_product_scopes(user_id,product_scope,created_by) values(p_user_id,v_scope,auth.uid());
  end loop;
  perform public.write_audit('USER_ACCESS_UPDATED','profile',p_user_id::text,p_user_id::text,null,jsonb_build_object('menu_access',p_menu_access,'product_scopes',p_product_scopes));
end; $$;

revoke all on function public.get_my_access_config() from public,anon;
revoke all on function public.admin_get_user_access_config(uuid) from public,anon;
revoke all on function public.admin_save_user_access_config(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.get_my_access_config() to authenticated;
grant execute on function public.admin_get_user_access_config(uuid) to authenticated;
grant execute on function public.admin_save_user_access_config(uuid,jsonb,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
select 'SAN WMS V4.8.0 product category/facility/access schema ready' as result;
