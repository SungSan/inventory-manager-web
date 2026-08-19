-- SAN WMS V4.6.3
-- 상품 병합 + 재고 상세 0수량 LOC 정리 지원
--
-- 목적
--   1) 오타/중복 상품을 기준 상품 하나로 안전하게 병합
--   2) 과거 입출고/이관/명세서 감사 이력은 보존
--   3) 현재 재고와 바코드만 기준 상품으로 귀속
--   4) 진행 중 업무가 source 상품을 참조하면 병합 차단
--
-- 본 SQL은 재고 총수량을 변경하지 않습니다.

begin;

alter table public.products
  add column if not exists merged_into_product_id uuid references public.products(id) on delete restrict,
  add column if not exists merged_at timestamptz,
  add column if not exists merged_by uuid references auth.users(id),
  add column if not exists merge_reason text;

create index if not exists products_merged_into_idx
  on public.products(merged_into_product_id)
  where merged_into_product_id is not null;

create or replace function public.guard_merged_product_reactivation()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if old.merged_into_product_id is not null then
    if new.active is distinct from old.active
       or new.p_code_no is distinct from old.p_code_no
       or new.code_no is distinct from old.code_no
       or new.master_code_no is distinct from old.master_code_no
       or new.artist is distinct from old.artist
       or new.name_ver is distinct from old.name_ver
       or new.merged_into_product_id is distinct from old.merged_into_product_id then
      raise exception '이미 다른 상품으로 병합된 상품은 수정하거나 다시 활성화할 수 없습니다.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_merged_product_reactivation on public.products;
create trigger trg_guard_merged_product_reactivation
before update on public.products
for each row
execute function public.guard_merged_product_reactivation();

create or replace function public.list_product_merge_candidates(
  p_search text default '',
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_search text:=btrim(coalesce(p_search,''));
  v_result jsonb;
begin
  perform public.require_role(array['admin','manager']);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,
    'p_code_no',p.p_code_no,
    'code_no',p.code_no,
    'master_code_no',p.master_code_no,
    'artist',p.artist,
    'name_ver',p.name_ver,
    'active',p.active,
    'merged_into_product_id',p.merged_into_product_id,
    'merged_at',p.merged_at,
    'merge_reason',p.merge_reason,
    'stock_qty',coalesce(stock.qty,0),
    'stock_location_count',coalesce(stock.location_count,0),
    'barcodes',coalesce(barcodes.values,'[]'::jsonb)
  ) order by p.artist,p.name_ver,p.code_no),'[]'::jsonb)
  into v_result
  from public.products p
  left join lateral (
    select coalesce(sum(ib.qty),0)::integer qty,
           count(*) filter (where ib.qty>0)::integer location_count
    from public.inventory_balances ib
    where ib.product_id=p.id
  ) stock on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'value',b.barcode_value,'normalized_value',b.normalized_value,
      'active',b.active,'is_primary',b.is_primary
    ) order by b.is_primary desc,b.created_at) values
    from public.barcodes b
    where b.scan_target_id=p.scan_target_id
  ) barcodes on true
  where (
    v_search=''
    or concat_ws(' ',p.p_code_no,p.code_no,p.master_code_no,p.artist,p.name_ver,
      coalesce((select string_agg(b.barcode_value,' ') from public.barcodes b where b.scan_target_id=p.scan_target_id),'')
    ) ilike '%'||v_search||'%'
  )
  limit greatest(1,least(coalesce(p_limit,100),300));

  return v_result;
end;
$$;

create or replace function public.admin_merge_product(
  p_source_product_id uuid,
  p_target_product_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_source public.products%rowtype;
  v_target public.products%rowtype;
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_blocked boolean:=false;
  v_moved_qty integer:=0;
  v_moved_locations integer:=0;
  v_moved_barcodes integer:=0;
  v_duplicate_barcodes integer:=0;
  v_before_source jsonb;
  v_before_target jsonb;
begin
  perform public.require_role(array['admin','manager']);

  if p_source_product_id is null or p_target_product_id is null then
    raise exception '병합할 원본 상품과 기준 상품을 선택하세요.';
  end if;
  if p_source_product_id=p_target_product_id then
    raise exception '같은 상품끼리는 병합할 수 없습니다.';
  end if;

  select * into v_source from public.products where id=p_source_product_id for update;
  if not found then raise exception '병합할 원본 상품을 찾을 수 없습니다.'; end if;
  select * into v_target from public.products where id=p_target_product_id for update;
  if not found then raise exception '기준 상품을 찾을 수 없습니다.'; end if;

  if v_source.merged_into_product_id is not null then
    raise exception '원본 상품은 이미 다른 상품으로 병합되었습니다.';
  end if;
  if v_target.merged_into_product_id is not null then
    raise exception '병합된 상품을 기준 상품으로 사용할 수 없습니다.';
  end if;
  if not v_target.active then
    raise exception '기준 상품은 활성 상태여야 합니다.';
  end if;

  -- 진행 중 일반 재고이관
  if to_regclass('public.transfer_job_items') is not null and to_regclass('public.transfer_jobs') is not null then
    execute 'select exists(select 1 from public.transfer_job_items i join public.transfer_jobs j on j.id=i.transfer_job_id where i.product_id=$1 and j.status in (''DRAFT'',''READY''))'
      into v_blocked using p_source_product_id;
    if v_blocked then raise exception '진행 중인 재고이관에 포함된 상품입니다. 해당 이관을 완료 또는 취소한 뒤 병합하세요.'; end if;
  end if;

  -- 진행 중 외부이관
  if to_regclass('public.external_transfer_items') is not null and to_regclass('public.external_transfer_jobs') is not null then
    execute 'select exists(select 1 from public.external_transfer_items i join public.external_transfer_jobs j on j.id=i.job_id where i.product_id=$1 and j.status in (''DRAFT'',''ALLOCATING''))'
      into v_blocked using p_source_product_id;
    if v_blocked then raise exception '진행 중인 외부이관에 포함된 상품입니다. 해당 작업을 완료 또는 취소한 뒤 병합하세요.'; end if;
  end if;

  -- 진행 중 업무요청
  if to_regclass('public.work_request_items') is not null and to_regclass('public.work_requests') is not null then
    execute 'select exists(select 1 from public.work_request_items i join public.work_requests w on w.id=i.work_request_id where i.product_id=$1 and w.status in (''SCHEDULED'',''IN_PROGRESS'',''PARTIAL''))'
      into v_blocked using p_source_product_id;
    if v_blocked then raise exception '진행 중인 업무요청에 포함된 상품입니다. 해당 업무를 완료 또는 종료한 뒤 병합하세요.'; end if;
  end if;

  -- 진행 중 재고실사 LOC에서 현재 source 재고가 있으면 차단
  if to_regclass('public.inventory_count_sessions') is not null
     and to_regclass('public.inventory_count_locations') is not null then
    execute 'select exists(
      select 1
      from public.inventory_balances ib
      join public.inventory_count_locations cl on cl.location_id=ib.location_id
      join public.inventory_count_sessions s on s.id=cl.session_id
      where ib.product_id=$1 and ib.qty>0 and s.status=''IN_PROGRESS'' and cl.status in (''PENDING'',''IN_PROGRESS'')
    )' into v_blocked using p_source_product_id;
    if v_blocked then raise exception '진행 중인 재고실사 대상 LOC에 이 상품 재고가 있습니다. 실사를 완료한 뒤 병합하세요.'; end if;
  end if;

  v_before_source:=to_jsonb(v_source);
  v_before_target:=to_jsonb(v_target);

  select coalesce(sum(qty),0)::integer,
         count(*) filter (where qty>0)::integer
  into v_moved_qty,v_moved_locations
  from public.inventory_balances
  where product_id=p_source_product_id;

  -- 현재 재고만 기준 상품으로 합산. 총수량은 변하지 않는다.
  insert into public.inventory_balances(product_id,location_id,qty,updated_at)
  select p_target_product_id,location_id,qty,now()
  from public.inventory_balances
  where product_id=p_source_product_id and qty>0
  on conflict(product_id,location_id) do update
  set qty=public.inventory_balances.qty+excluded.qty,
      updated_at=now();

  delete from public.inventory_balances
  where product_id=p_source_product_id;

  -- 중복되지 않은 source 바코드는 target의 추가 바코드로 이전한다.
  select count(*) into v_moved_barcodes
  from public.barcodes sb
  where sb.scan_target_id=v_source.scan_target_id
    and not exists(
      select 1 from public.barcodes tb
      where tb.scan_target_id=v_target.scan_target_id
        and tb.normalized_value=sb.normalized_value
    );

  select count(*) into v_duplicate_barcodes
  from public.barcodes sb
  where sb.scan_target_id=v_source.scan_target_id
    and exists(
      select 1 from public.barcodes tb
      where tb.scan_target_id=v_target.scan_target_id
        and tb.normalized_value=sb.normalized_value
    );

  update public.barcodes sb
  set scan_target_id=v_target.scan_target_id,
      is_primary=false
  where sb.scan_target_id=v_source.scan_target_id
    and not exists(
      select 1 from public.barcodes tb
      where tb.scan_target_id=v_target.scan_target_id
        and tb.normalized_value=sb.normalized_value
    );

  -- target에 이미 같은 번호가 있으면 source 쪽 중복 바코드는 감사 보존용 비활성 상태로 남긴다.
  update public.barcodes
  set active=false,is_primary=false
  where scan_target_id=v_source.scan_target_id;

  -- 혹시 target 대표 바코드가 없으면 이전된 활성 바코드 하나를 대표로 지정한다.
  if not exists(
    select 1 from public.barcodes
    where scan_target_id=v_target.scan_target_id and active and is_primary
  ) then
    update public.barcodes
    set is_primary=true
    where id=(
      select id from public.barcodes
      where scan_target_id=v_target.scan_target_id and active
      order by created_at,id
      limit 1
    );
  end if;

  -- source는 삭제하지 않고 병합 이력을 남긴 채 영구 비활성화한다.
  update public.products
  set active=false,
      merged_into_product_id=p_target_product_id,
      merged_at=now(),
      merged_by=auth.uid(),
      merge_reason=v_reason,
      updated_at=now()
  where id=p_source_product_id;

  update public.scan_targets
  set active=false
  where id=v_source.scan_target_id;

  -- 사이클 프로필은 현재 재고 기준으로 재생성되도록 source 흔적 제거/dirty 처리한다.
  if to_regclass('public.inventory_cycle_item_profiles') is not null then
    delete from public.inventory_cycle_item_profiles where product_id=p_source_product_id;
  end if;
  if to_regclass('public.inventory_cycle_dirty_locations') is not null then
    insert into public.inventory_cycle_dirty_locations(location_id,changed_at)
    select distinct location_id,now()
    from public.inventory_balances
    where product_id=p_target_product_id
    on conflict(location_id) do update set changed_at=excluded.changed_at;
  end if;

  perform public.write_audit(
    'PRODUCT_MERGED','product',p_source_product_id::text,
    concat_ws(' · ',v_source.artist,v_source.name_ver),
    jsonb_build_object('source',v_before_source,'target',v_before_target),
    jsonb_build_object(
      'merged_into_product_id',p_target_product_id,
      'moved_qty',v_moved_qty,
      'moved_locations',v_moved_locations,
      'moved_barcodes',v_moved_barcodes,
      'duplicate_barcodes_disabled',v_duplicate_barcodes
    ),
    coalesce(v_reason,'오타/중복 상품 병합')
  );

  return jsonb_build_object(
    'source_product_id',p_source_product_id,
    'target_product_id',p_target_product_id,
    'moved_qty',v_moved_qty,
    'moved_locations',v_moved_locations,
    'moved_barcodes',v_moved_barcodes,
    'duplicate_barcodes_disabled',v_duplicate_barcodes,
    'merged',true
  );
end;
$$;

revoke all on function public.list_product_merge_candidates(text,integer) from public,anon;
grant execute on function public.list_product_merge_candidates(text,integer) to authenticated;

revoke all on function public.admin_merge_product(uuid,uuid,text) from public,anon;
grant execute on function public.admin_merge_product(uuid,uuid,text) to authenticated;

notify pgrst,'reload schema';
commit;

select 'SAN WMS V4.6.3 product merge migration completed' as result;
