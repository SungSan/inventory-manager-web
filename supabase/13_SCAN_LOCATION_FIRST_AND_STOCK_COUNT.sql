-- SAN WMS V3.6.1
-- 로케이션 우선 다품목 입출고 + 재고 실사 남은 수량 확정
-- DATA-PRESERVING MIGRATION: 기존 재고와 이력을 삭제하지 않습니다.

begin;

create or replace function public.post_location_inventory_batch(
  p_operation text,
  p_location_id uuid,
  p_items jsonb,
  p_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_location public.locations%rowtype;
  v_product public.products%rowtype;
  v_item jsonb;
  v_product_id uuid;
  v_qty integer;
  v_before integer;
  v_after integer;
  v_transaction_id uuid;
  v_product_barcode text;
  v_location_barcode text;
  v_batch_key text;
  v_note text;
  v_seen uuid[] := array[]::uuid[];
  v_results jsonb := '[]'::jsonb;
  v_item_count integer := 0;
  v_total_qty integer := 0;
begin
  perform public.require_role(array['admin','manager','operator']);

  if p_operation is null or p_operation not in ('IB','OB') then
    raise exception '입출고 구분이 올바르지 않습니다.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception '처리할 상품을 하나 이상 선택하세요.';
  end if;

  select *
  into v_location
  from public.locations
  where id=p_location_id
  for update;

  if not found then
    raise exception '로케이션을 찾을 수 없습니다.';
  end if;

  v_batch_key := coalesce(nullif(trim(p_idempotency_key),''),gen_random_uuid()::text);
  v_note := nullif(trim(coalesce(p_note,'')),'');

  select b.barcode_value
  into v_location_barcode
  from public.barcodes b
  where b.scan_target_id=v_location.scan_target_id
    and b.active
  order by b.is_primary desc,b.created_at
  limit 1;

  v_location_barcode := coalesce(v_location_barcode,v_location.location_code);

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id','')::uuid;
    v_qty := coalesce(nullif(v_item->>'qty','')::integer,0);

    if v_product_id is null or v_qty <= 0 then
      raise exception '상품 ID와 수량을 확인하세요.';
    end if;

    if v_product_id = any(v_seen) then
      raise exception '같은 상품이 두 번 선택되었습니다.';
    end if;
    v_seen := array_append(v_seen,v_product_id);

    select *
    into v_product
    from public.products
    where id=v_product_id;

    if not found then
      raise exception '상품을 찾을 수 없습니다.';
    end if;

    insert into public.inventory_balances(product_id,location_id,qty,updated_at)
    values(v_product_id,p_location_id,0,now())
    on conflict(product_id,location_id) do nothing;

    select qty
    into v_before
    from public.inventory_balances
    where product_id=v_product_id
      and location_id=p_location_id
    for update;

    if p_operation='OB' and v_before < v_qty then
      raise exception '% · %의 현재 재고는 %개입니다. %개를 출고할 수 없습니다.',
        coalesce(nullif(v_product.artist,''),'아티스트 미입력'),
        coalesce(nullif(v_product.name_ver,''),v_product.code_no),
        v_before,
        v_qty;
    end if;

    v_after := case
      when p_operation='IB' then v_before+v_qty
      else v_before-v_qty
    end;

    update public.inventory_balances
    set qty=v_after,updated_at=now()
    where product_id=v_product_id
      and location_id=p_location_id;

    select b.barcode_value
    into v_product_barcode
    from public.barcodes b
    where b.scan_target_id=v_product.scan_target_id
      and b.active
    order by b.is_primary desc,b.created_at
    limit 1;

    v_product_barcode := coalesce(v_product_barcode,v_product.code_no);
    v_transaction_id := gen_random_uuid();

    insert into public.inventory_transactions(
      id,operation,status,product_id,location_id,qty,before_qty,after_qty,
      product_barcode_value,location_barcode_value,reference_type,reference_id,
      idempotency_key,note,actor_id,created_at
    ) values(
      v_transaction_id,p_operation,'ACTIVE',v_product_id,p_location_id,v_qty,v_before,v_after,
      v_product_barcode,v_location_barcode,'LOCATION_BATCH',v_batch_key,
      v_batch_key||':'||v_product_id::text,v_note,auth.uid(),now()
    );

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'transaction_id',v_transaction_id,
      'product_id',v_product_id,
      'artist',v_product.artist,
      'name_ver',v_product.name_ver,
      'qty',v_qty,
      'before_qty',v_before,
      'after_qty',v_after
    ));
    v_item_count := v_item_count+1;
    v_total_qty := v_total_qty+v_qty;
  end loop;

  perform public.write_audit(
    'LOCATION_BATCH_MOVEMENT',
    'location',
    p_location_id::text,
    v_location.location_code,
    null,
    jsonb_build_object(
      'operation',p_operation,
      'item_count',v_item_count,
      'total_qty',v_total_qty,
      'batch_key',v_batch_key,
      'results',v_results
    ),
    v_note
  );

  return jsonb_build_object(
    'operation',p_operation,
    'location_id',v_location.id,
    'location_code',v_location.location_code,
    'item_count',v_item_count,
    'total_qty',v_total_qty,
    'results',v_results
  );
end;
$$;

create or replace function public.confirm_remaining_stock(
  p_product_id uuid,
  p_location_id uuid,
  p_remaining_qty integer,
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_location public.locations%rowtype;
  v_product public.products%rowtype;
  v_before integer;
  v_difference integer;
  v_transaction_id uuid;
  v_product_barcode text;
  v_location_barcode text;
  v_note text;
  v_key text;
begin
  perform public.require_role(array['admin','manager','operator']);

  if p_remaining_qty is null or p_remaining_qty < 0 then
    raise exception '남은 수량은 0 이상이어야 합니다.';
  end if;

  select * into v_product
  from public.products
  where id=p_product_id;

  if not found then
    raise exception '상품을 찾을 수 없습니다.';
  end if;

  select * into v_location
  from public.locations
  where id=p_location_id;

  if not found then
    raise exception '로케이션을 찾을 수 없습니다.';
  end if;

  insert into public.inventory_balances(product_id,location_id,qty,updated_at)
  values(p_product_id,p_location_id,0,now())
  on conflict(product_id,location_id) do nothing;

  select qty
  into v_before
  from public.inventory_balances
  where product_id=p_product_id
    and location_id=p_location_id
  for update;

  if p_remaining_qty > v_before then
    raise exception '현재 전산 재고는 %개입니다. 남은 수량을 더 크게 입력할 수 없습니다.',v_before;
  end if;

  v_difference := v_before-p_remaining_qty;
  v_note := coalesce(nullif(trim(coalesce(p_reason,'')),''),'재고 실사 수량');
  v_key := coalesce(nullif(trim(p_idempotency_key),''),gen_random_uuid()::text);

  if v_difference=0 then
    return jsonb_build_object(
      'changed',false,
      'transaction_id',null,
      'product_id',p_product_id,
      'location_id',p_location_id,
      'location_code',v_location.location_code,
      'before_qty',v_before,
      'after_qty',p_remaining_qty,
      'outbound_qty',0,
      'note',v_note
    );
  end if;

  update public.inventory_balances
  set qty=p_remaining_qty,updated_at=now()
  where product_id=p_product_id
    and location_id=p_location_id;

  select b.barcode_value
  into v_product_barcode
  from public.barcodes b
  where b.scan_target_id=v_product.scan_target_id
    and b.active
  order by b.is_primary desc,b.created_at
  limit 1;

  select b.barcode_value
  into v_location_barcode
  from public.barcodes b
  where b.scan_target_id=v_location.scan_target_id
    and b.active
  order by b.is_primary desc,b.created_at
  limit 1;

  v_product_barcode := coalesce(v_product_barcode,v_product.code_no);
  v_location_barcode := coalesce(v_location_barcode,v_location.location_code);
  v_transaction_id := gen_random_uuid();

  insert into public.inventory_transactions(
    id,operation,status,product_id,location_id,qty,before_qty,after_qty,
    product_barcode_value,location_barcode_value,reference_type,reference_id,
    idempotency_key,note,actor_id,created_at
  ) values(
    v_transaction_id,'OB','ACTIVE',p_product_id,p_location_id,v_difference,v_before,p_remaining_qty,
    v_product_barcode,v_location_barcode,'STOCK_COUNT',
    p_location_id::text||':'||p_product_id::text,
    v_key,v_note,auth.uid(),now()
  );

  perform public.write_audit(
    'STOCK_COUNT_REMAINING_CONFIRMED',
    'inventory_balance',
    p_location_id::text||':'||p_product_id::text,
    concat_ws(' · ',v_location.location_code,v_product.artist,v_product.name_ver),
    jsonb_build_object('qty',v_before),
    jsonb_build_object('qty',p_remaining_qty,'outbound_qty',v_difference,'transaction_id',v_transaction_id),
    v_note
  );

  return jsonb_build_object(
    'changed',true,
    'transaction_id',v_transaction_id,
    'product_id',p_product_id,
    'location_id',p_location_id,
    'location_code',v_location.location_code,
    'before_qty',v_before,
    'after_qty',p_remaining_qty,
    'outbound_qty',v_difference,
    'note',v_note
  );
end;
$$;

revoke all on function public.post_location_inventory_batch(text,uuid,jsonb,text,text) from public;
revoke all on function public.confirm_remaining_stock(uuid,uuid,integer,text,text) from public;

grant execute on function public.post_location_inventory_batch(text,uuid,jsonb,text,text) to authenticated;
grant execute on function public.confirm_remaining_stock(uuid,uuid,integer,text,text) to authenticated;

notify pgrst, 'reload schema';

commit;

select 'SAN WMS location-first scan and remaining-stock migration completed' as result;
