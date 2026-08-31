-- SAN WMS V5.0.6: preserve ALBUM/MD category during CSV inventory migration
-- Apply after SQL47. Existing products and inventory are not changed until an import is run.

begin;

create or replace function public.import_inventory_rows(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  r jsonb;
  v_product public.products%rowtype;
  v_location public.locations%rowtype;
  v_target uuid;
  v_products int:=0;
  v_locations int:=0;
  v_barcodes int:=0;
  v_balances int:=0;
  v_rows int:=0;
  v_barcode text;
  v_category text;
begin
  perform public.require_role(array['admin','manager']);
  for r in select * from jsonb_array_elements(p_rows) loop
    v_product:=null;
    v_location:=null;
    v_category:=upper(trim(coalesce(r->>'productCategory','')));
    if v_category='' then
      v_category:=case when upper(coalesce(r->>'locationCode','')) like 'K%' then 'MD' else 'ALBUM' end;
    end if;
    if v_category not in ('ALBUM','MD') then
      raise exception '상품 구분은 ALBUM 또는 MD만 사용할 수 있습니다: %',v_category;
    end if;

    select * into v_product from public.products
    where upper(p_code_no)=upper(coalesce(r->>'pCodeNo',''))
      and upper(code_no)=upper(coalesce(r->>'codeNo',''))
      and upper(master_code_no)=upper(coalesce(r->>'masterCodeNo',''))
      and upper(artist)=upper(coalesce(r->>'artist',''))
      and upper(name_ver)=upper(coalesce(r->>'nameVer',''))
      and product_category=v_category
    limit 1;

    if v_product.id is null then
      select * into v_product from public.products
      where upper(code_no)=upper(coalesce(r->>'codeNo',''))
        and product_category=v_category
        and (trim(artist)='' or trim(name_ver)='')
      limit 1;
      if v_product.id is not null then
        update public.products set
          p_code_no=coalesce(nullif(r->>'pCodeNo',''),p_code_no),
          master_code_no=coalesce(nullif(r->>'masterCodeNo',''),master_code_no),
          artist=coalesce(nullif(r->>'artist',''),artist),
          name_ver=coalesce(nullif(r->>'nameVer',''),name_ver),
          product_category=v_category,
          updated_at=now()
        where id=v_product.id returning * into v_product;
      end if;
    end if;

    if v_product.id is null then
      insert into public.scan_targets(target_type) values('product') returning id into v_target;
      insert into public.products(scan_target_id,p_code_no,code_no,master_code_no,artist,name_ver,product_category)
      values(v_target,coalesce(r->>'pCodeNo',''),r->>'codeNo',coalesce(r->>'masterCodeNo',''),coalesce(r->>'artist',''),coalesce(r->>'nameVer',''),v_category)
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
      insert into public.locations(scan_target_id,location_code,zone)
      values(v_target,upper(r->>'locationCode'),split_part(upper(r->>'locationCode'),'-',1))
      returning * into v_location;
      v_locations:=v_locations+1;
      v_barcode:=coalesce(nullif(r->>'locationBarcode',''),upper(r->>'locationCode'));
      if exists(select 1 from public.barcodes where normalized_value=public.normalize_barcode(v_barcode)) then
        raise exception '로케이션 바코드 %가 이미 사용 중입니다.',v_barcode;
      end if;
      insert into public.barcodes(scan_target_id,barcode_value,source,symbology,is_primary,created_by)
      values(v_location.scan_target_id,v_barcode,'internal','CODE-128',true,auth.uid());
      v_barcodes:=v_barcodes+1;
    end if;

    insert into public.inventory_balances(product_id,location_id,qty,updated_at)
    values(v_product.id,v_location.id,(r->>'qty')::int,now())
    on conflict(product_id,location_id) do update set qty=excluded.qty,updated_at=now();
    v_balances:=v_balances+1;
    v_rows:=v_rows+1;
  end loop;

  perform public.write_audit(
    'INVENTORY_IMPORTED','import',gen_random_uuid()::text,v_rows||' rows',null,
    jsonb_build_object('rowsProcessed',v_rows,'productsCreated',v_products,'locationsCreated',v_locations,'barcodesCreated',v_barcodes,'balancesUpserted',v_balances)
  );
  return jsonb_build_object('rowsProcessed',v_rows,'productsCreated',v_products,'locationsCreated',v_locations,'barcodesCreated',v_barcodes,'balancesUpserted',v_balances);
end; $$;

revoke all on function public.import_inventory_rows(jsonb) from public,anon;
grant execute on function public.import_inventory_rows(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

select 'SAN WMS V5.0.6 category-aware inventory import ready' as result;
