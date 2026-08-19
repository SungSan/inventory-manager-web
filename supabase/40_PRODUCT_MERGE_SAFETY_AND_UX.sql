-- SAN WMS V4.6.4
-- 상품 병합 안전성 보정 + SQL 39 누적 설치본
--
-- 이 파일은 SQL 39를 실행하지 않은 DB에서도 단독 실행할 수 있습니다.
-- 이미 SQL 39를 실행한 DB에서는 안전성 보정만 추가 적용됩니다.
--
-- 보정 핵심
--   1) 병합 상품의 현재 재고는 기준 상품으로 이동하되 총수량은 변경하지 않음
--   2) 병합 전 과거 거래의 취소·원복은 최종 기준 상품 재고에 반영
--   3) 재고 쓰기와 병합을 product advisory lock으로 직렬화
--   4) 병합 완료 상품으로 뒤늦게 재고가 쓰이는 것을 DB trigger에서 차단
--   5) SQL 39 적용 직후 동시 작업 등으로 source에 남은 재고가 있다면 기준 상품으로 복구
--   6) 병합 후보 LIMIT을 JSON 집계 전에 적용

begin;

alter table public.products
  add column if not exists merged_into_product_id uuid references public.products(id) on delete restrict,
  add column if not exists merged_at timestamptz,
  add column if not exists merged_by uuid references auth.users(id),
  add column if not exists merge_reason text;

create index if not exists products_merged_into_idx
  on public.products(merged_into_product_id)
  where merged_into_product_id is not null;

create or replace function public.canonical_product_id(p_product_id uuid)
returns uuid
language sql
stable
security definer
set search_path=public
as $$
  with recursive chain as (
    select p.id, p.merged_into_product_id, 0 as depth
    from public.products p
    where p.id=p_product_id

    union all

    select p.id, p.merged_into_product_id, c.depth+1
    from chain c
    join public.products p on p.id=c.merged_into_product_id
    where c.merged_into_product_id is not null
      and c.depth < 32
  )
  select coalesce(
    (select c.id from chain c order by c.depth desc limit 1),
    p_product_id
  );
$$;

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

-- 모든 inventory_balances 쓰기는 상품 단위 advisory lock을 공유한다.
-- 병합 완료 source로 INSERT/UPDATE가 뒤늦게 도착하면 재시도를 요구하여 숨은 재고 생성을 차단한다.
create or replace function public.guard_inventory_balance_for_product_merge()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_product_id uuid;
  v_merged_into uuid;
begin
  v_product_id := case when tg_op='DELETE' then old.product_id else new.product_id end;

  perform pg_advisory_xact_lock(hashtextextended(v_product_id::text,0));

  select p.merged_into_product_id
    into v_merged_into
  from public.products p
  where p.id=v_product_id;

  if tg_op <> 'DELETE' and v_merged_into is not null then
    raise exception '이 상품은 다른 상품으로 병합되었습니다. 화면을 새로고침하거나 상품을 다시 스캔한 뒤 작업하세요.';
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_inventory_balance_for_product_merge on public.inventory_balances;
create trigger trg_guard_inventory_balance_for_product_merge
before insert or update or delete on public.inventory_balances
for each row
execute function public.guard_inventory_balance_for_product_merge();

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

  with candidate_products as (
    select p.*
    from public.products p
    where (
      v_search=''
      or concat_ws(
        ' ',p.p_code_no,p.code_no,p.master_code_no,p.artist,p.name_ver,
        coalesce((
          select string_agg(b.barcode_value,' ')
          from public.barcodes b
          where b.scan_target_id=p.scan_target_id
        ),'')
      ) ilike '%'||v_search||'%'
    )
    order by p.artist,p.name_ver,p.code_no,p.id
    limit greatest(1,least(coalesce(p_limit,100),300))
  )
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
  ) order by p.artist,p.name_ver,p.code_no,p.id),'[]'::jsonb)
  into v_result
  from candidate_products p
  left join lateral (
    select coalesce(sum(ib.qty),0)::integer qty,
           count(*) filter (where ib.qty>0)::integer location_count
    from public.inventory_balances ib
    where ib.product_id=p.id
  ) stock on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'value',b.barcode_value,
      'normalized_value',b.normalized_value,
      'active',b.active,
      'is_primary',b.is_primary
    ) order by b.is_primary desc,b.created_at,b.id) values
    from public.barcodes b
    where b.scan_target_id=p.scan_target_id
  ) barcodes on true;

  return v_result;
end;
$$;

-- SQL 39 상태에서 이미 병합됐지만 source에 재고가 남은 경우 기준 상품으로 복구한다.
do $$
declare
  v_source record;
  v_target_id uuid;
begin
  for v_source in
    select p.id
    from public.products p
    where p.merged_into_product_id is not null
      and exists(
        select 1 from public.inventory_balances ib
        where ib.product_id=p.id and ib.qty<>0
      )
    order by p.id::text
  loop
    v_target_id:=public.canonical_product_id(v_source.id);

    if v_target_id is distinct from v_source.id then
      if v_source.id::text < v_target_id::text then
        perform pg_advisory_xact_lock(hashtextextended(v_source.id::text,0));
        perform pg_advisory_xact_lock(hashtextextended(v_target_id::text,0));
      else
        perform pg_advisory_xact_lock(hashtextextended(v_target_id::text,0));
        perform pg_advisory_xact_lock(hashtextextended(v_source.id::text,0));
      end if;

      insert into public.inventory_balances(product_id,location_id,qty,updated_at)
      select v_target_id,ib.location_id,ib.qty,now()
      from public.inventory_balances ib
      where ib.product_id=v_source.id and ib.qty>0
      on conflict(product_id,location_id) do update
      set qty=public.inventory_balances.qty+excluded.qty,
          updated_at=now();

      delete from public.inventory_balances
      where product_id=v_source.id;
    end if;
  end loop;
end;
$$;

-- 과거 원거래가 병합 전 product_id를 가리키더라도 최종 기준 상품 재고에서 원복한다.
create or replace function public.reverse_inventory_transaction(p_transaction_id uuid,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_original public.inventory_transactions%rowtype;
  v_effective_product_id uuid;
  v_before int;
  v_after int;
  v_reverse_op text;
  v_reverse_id uuid;
begin
  perform public.require_role(array['admin','manager']);

  select * into v_original
  from public.inventory_transactions
  where id=p_transaction_id
  for update;

  if not found or v_original.status<>'ACTIVE' then
    raise exception '취소 가능한 원거래가 아닙니다.';
  end if;

  v_effective_product_id:=public.canonical_product_id(v_original.product_id);
  perform pg_advisory_xact_lock(hashtextextended(v_effective_product_id::text,0));

  insert into public.inventory_balances(product_id,location_id,qty,updated_at)
  values(v_effective_product_id,v_original.location_id,0,now())
  on conflict(product_id,location_id) do nothing;

  select qty into v_before
  from public.inventory_balances
  where product_id=v_effective_product_id
    and location_id=v_original.location_id
  for update;

  v_reverse_op:=case when v_original.operation='IB' then 'OB' else 'IB' end;
  v_after:=case when v_reverse_op='IB' then v_before+v_original.qty else v_before-v_original.qty end;

  if v_after<0 then
    raise exception '현재 재고가 부족해 입고 거래를 취소할 수 없습니다.';
  end if;

  update public.inventory_balances
  set qty=v_after,updated_at=now()
  where product_id=v_effective_product_id
    and location_id=v_original.location_id;

  insert into public.inventory_transactions(
    operation,status,product_id,location_id,qty,before_qty,after_qty,
    product_barcode_value,location_barcode_value,reference_type,reference_id,
    idempotency_key,note,actor_id,reversal_of
  ) values (
    v_reverse_op,'REVERSAL',v_effective_product_id,v_original.location_id,v_original.qty,v_before,v_after,
    v_original.product_barcode_value,v_original.location_barcode_value,'REVERSAL',v_original.id::text,
    gen_random_uuid()::text,p_reason,auth.uid(),v_original.id
  ) returning id into v_reverse_id;

  update public.inventory_transactions
  set status='REVERSED',reversed_by=v_reverse_id
  where id=v_original.id;

  perform public.write_audit(
    'TRANSACTION_REVERSED','inventory_transaction',v_original.id::text,null,
    jsonb_build_object('status','ACTIVE','qty',v_before,'original_product_id',v_original.product_id),
    jsonb_build_object(
      'status','REVERSED','qty',v_after,'reversal_id',v_reverse_id,
      'effective_product_id',v_effective_product_id
    ),
    p_reason
  );

  return jsonb_build_object(
    'id',v_reverse_id,
    'operation',v_reverse_op,
    'status','REVERSAL',
    'product_id',v_effective_product_id,
    'original_product_id',v_original.product_id,
    'location_id',v_original.location_id,
    'qty',v_original.qty,
    'before_qty',v_before,
    'after_qty',v_after,
    'product_barcode_value',v_original.product_barcode_value,
    'location_barcode_value',v_original.location_barcode_value,
    'created_at',now(),
    'note',p_reason,
    'reversal_of',v_original.id
  );
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

  -- 모든 balance writer가 사용하는 것과 같은 advisory lock을 UUID 문자열 순서로 잡아 deadlock을 줄인다.
  if p_source_product_id::text < p_target_product_id::text then
    perform pg_advisory_xact_lock(hashtextextended(p_source_product_id::text,0));
    perform pg_advisory_xact_lock(hashtextextended(p_target_product_id::text,0));
  else
    perform pg_advisory_xact_lock(hashtextextended(p_target_product_id::text,0));
    perform pg_advisory_xact_lock(hashtextextended(p_source_product_id::text,0));
  end if;

  select * into v_source
  from public.products
  where id=p_source_product_id
  for update;
  if not found then raise exception '병합할 원본 상품을 찾을 수 없습니다.'; end if;

  select * into v_target
  from public.products
  where id=p_target_product_id
  for update;
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

  -- 현재 source/target balance row도 잠가 advisory lock 도입 전 방식과의 호환성을 보강한다.
  perform 1
  from public.inventory_balances ib
  where ib.product_id in (p_source_product_id,p_target_product_id)
  order by ib.product_id::text,ib.location_id::text
  for update;

  if to_regclass('public.transfer_job_items') is not null and to_regclass('public.transfer_jobs') is not null then
    execute 'select exists(select 1 from public.transfer_job_items i join public.transfer_jobs j on j.id=i.transfer_job_id where i.product_id=$1 and j.status in (''DRAFT'',''READY''))'
      into v_blocked using p_source_product_id;
    if v_blocked then raise exception '진행 중인 재고이관에 포함된 상품입니다. 해당 이관을 완료 또는 취소한 뒤 병합하세요.'; end if;
  end if;

  if to_regclass('public.external_transfer_items') is not null and to_regclass('public.external_transfer_jobs') is not null then
    execute 'select exists(select 1 from public.external_transfer_items i join public.external_transfer_jobs j on j.id=i.job_id where i.product_id=$1 and j.status in (''DRAFT'',''ALLOCATING''))'
      into v_blocked using p_source_product_id;
    if v_blocked then raise exception '진행 중인 외부이관에 포함된 상품입니다. 해당 작업을 완료 또는 취소한 뒤 병합하세요.'; end if;
  end if;

  if to_regclass('public.work_request_items') is not null and to_regclass('public.work_requests') is not null then
    execute 'select exists(select 1 from public.work_request_items i join public.work_requests w on w.id=i.work_request_id where i.product_id=$1 and w.status in (''SCHEDULED'',''IN_PROGRESS'',''PARTIAL''))'
      into v_blocked using p_source_product_id;
    if v_blocked then raise exception '진행 중인 업무요청에 포함된 상품입니다. 해당 업무를 완료 또는 종료한 뒤 병합하세요.'; end if;
  end if;

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

  insert into public.inventory_balances(product_id,location_id,qty,updated_at)
  select p_target_product_id,location_id,qty,now()
  from public.inventory_balances
  where product_id=p_source_product_id and qty>0
  on conflict(product_id,location_id) do update
  set qty=public.inventory_balances.qty+excluded.qty,
      updated_at=now();

  delete from public.inventory_balances
  where product_id=p_source_product_id;

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

  update public.barcodes
  set active=false,is_primary=false
  where scan_target_id=v_source.scan_target_id;

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

  if to_regclass('public.inventory_cycle_item_profiles') is not null then
    delete from public.inventory_cycle_item_profiles
    where product_id=p_source_product_id;
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
      'duplicate_barcodes_disabled',v_duplicate_barcodes,
      'reversal_product_id',p_target_product_id
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

revoke all on function public.canonical_product_id(uuid) from public,anon;
grant execute on function public.canonical_product_id(uuid) to authenticated;

revoke all on function public.list_product_merge_candidates(text,integer) from public,anon;
grant execute on function public.list_product_merge_candidates(text,integer) to authenticated;

revoke all on function public.admin_merge_product(uuid,uuid,text) from public,anon;
grant execute on function public.admin_merge_product(uuid,uuid,text) to authenticated;

revoke all on function public.guard_inventory_balance_for_product_merge() from public,anon;
revoke all on function public.guard_merged_product_reactivation() from public,anon;

notify pgrst,'reload schema';
commit;

select 'SAN WMS V4.6.4 safe product merge cumulative migration completed' as result;
