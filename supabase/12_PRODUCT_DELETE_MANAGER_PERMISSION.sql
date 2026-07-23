-- SAN WMS v3.5.6 - 상품 삭제 권한을 관리자 + 매니저로 확대
-- 11_PRODUCT_DELETE.sql을 이미 실행한 환경에서 한 번 실행하세요.
-- 기존 상품, 재고, 이력은 변경하지 않습니다.

create or replace function public.admin_delete_unused_product(
  p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_product public.products%rowtype;
  v_stock bigint:=0;
  v_transactions bigint:=0;
  v_transfer_items bigint:=0;
  v_barcode_count bigint:=0;
  v_label text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if public.current_role() not in ('admin','manager') then
    raise exception '관리자 또는 매니저만 상품을 삭제할 수 있습니다.';
  end if;

  select * into v_product
  from public.products
  where id=p_product_id
  for update;

  if not found then raise exception '상품을 찾을 수 없습니다.'; end if;

  v_label:=concat_ws(' · ',nullif(v_product.artist,''),nullif(v_product.name_ver,''));
  if v_label='' then v_label:=v_product.code_no; end if;

  select coalesce(sum(qty),0) into v_stock
  from public.inventory_balances
  where product_id=p_product_id and qty>0;

  if v_stock>0 then
    raise exception '현재 재고가 %개 남아 있어 삭제할 수 없습니다. 먼저 재고를 출고하거나 이관하세요.',v_stock;
  end if;

  select count(*) into v_transactions
  from public.inventory_transactions
  where product_id=p_product_id;

  if v_transactions>0 then
    raise exception '입출고 이력이 %건 있어 삭제할 수 없습니다. 상품을 비활성화하세요.',v_transactions;
  end if;

  if to_regclass('public.transfer_job_items') is not null then
    execute 'select count(*) from public.transfer_job_items where product_id=$1'
    into v_transfer_items using p_product_id;
  end if;

  if v_transfer_items>0 then
    raise exception '재고이관 기록이 %건 있어 삭제할 수 없습니다. 상품을 비활성화하세요.',v_transfer_items;
  end if;

  select count(*) into v_barcode_count
  from public.barcodes
  where scan_target_id=v_product.scan_target_id;

  perform public.write_audit(
    'PRODUCT_DELETED','product',v_product.id::text,v_label,
    to_jsonb(v_product),
    jsonb_build_object('deleted',true,'barcode_count',v_barcode_count),
    '상품관리 화면에서 관리자 또는 매니저 삭제'
  );

  delete from public.inventory_balances
  where product_id=p_product_id;

  update public.scan_events
  set scan_target_id=null
  where scan_target_id=v_product.scan_target_id;

  delete from public.barcodes
  where scan_target_id=v_product.scan_target_id;

  delete from public.products
  where id=p_product_id;

  delete from public.scan_targets
  where id=v_product.scan_target_id;

  return jsonb_build_object(
    'id',v_product.id,
    'label',v_label,
    'barcode_count',v_barcode_count,
    'deleted',true
  );
end;
$$;

revoke all on function public.admin_delete_unused_product(uuid) from public;
grant execute on function public.admin_delete_unused_product(uuid) to authenticated;

notify pgrst, 'reload schema';
select 'SAN WMS manager product deletion permission completed' as result;
