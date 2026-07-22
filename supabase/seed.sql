-- Sample data for SQL Editor. This script does not require an authenticated session.
do $$
declare pt1 uuid:=gen_random_uuid(); pt2 uuid:=gen_random_uuid(); lt1 uuid:=gen_random_uuid(); lt2 uuid:=gen_random_uuid(); p1 uuid; p2 uuid; l1 uuid; l2 uuid;
begin
  select id into p1 from public.products where code_no='C-10001';
  if p1 is null then
    insert into public.scan_targets(id,target_type) values(pt1,'product');
    insert into public.products(scan_target_id,p_code_no,code_no,master_code_no,artist,name_ver)
    values(pt1,'P-10001','C-10001','M-100','AESPA','6TH MINI ALBUM / VER.A') returning id into p1;
    insert into public.barcodes(scan_target_id,barcode_value,source,symbology,is_primary)
    values(pt1,'8801234567890','manufacturer','EAN-13',true);
  end if;

  select id into p2 from public.products where code_no='C-10002';
  if p2 is null then
    insert into public.scan_targets(id,target_type) values(pt2,'product');
    insert into public.products(scan_target_id,p_code_no,code_no,master_code_no,artist,name_ver)
    values(pt2,'P-10002','C-10002','M-100','AESPA','6TH MINI ALBUM / VER.B') returning id into p2;
    insert into public.barcodes(scan_target_id,barcode_value,source,symbology,is_primary)
    values(pt2,'8801234567891','manufacturer','EAN-13',true);
  end if;

  insert into public.barcodes(scan_target_id,barcode_value,source,symbology,is_primary)
  select scan_target_id,'8801234567000','manufacturer','EAN-13',false from public.products where id=p1
  on conflict(scan_target_id,normalized_value) do nothing;

  insert into public.barcodes(scan_target_id,barcode_value,source,symbology,is_primary)
  select scan_target_id,'8801234567000','manufacturer','EAN-13',false from public.products where id=p2
  on conflict(scan_target_id,normalized_value) do nothing;

  select id into l1 from public.locations where location_code='D1A-01-02-03';
  if l1 is null then
    insert into public.scan_targets(id,target_type) values(lt1,'location');
    insert into public.locations(scan_target_id,location_code,zone)
    values(lt1,'D1A-01-02-03','D1A') returning id into l1;
    insert into public.barcodes(scan_target_id,barcode_value,source,symbology,is_primary)
    values(lt1,'D1A-01-02-03','internal','CODE-128',true);
  end if;

  select id into l2 from public.locations where location_code='ANGLE-01-01-01';
  if l2 is null then
    insert into public.scan_targets(id,target_type) values(lt2,'location');
    insert into public.locations(scan_target_id,location_code,zone)
    values(lt2,'ANGLE-01-01-01','ANGLE') returning id into l2;
    insert into public.barcodes(scan_target_id,barcode_value,source,symbology,is_primary)
    values(lt2,'ANGLE-01-01-01','internal','CODE-128',true);
  end if;

  insert into public.inventory_balances(product_id,location_id,qty)
  values(p1,l1,24)
  on conflict(product_id,location_id) do update set qty=24,updated_at=now();
end $$;
