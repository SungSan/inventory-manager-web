-- SAN WMS V3.7.0 - 출고명세서 담당자 + 공통 바코드 복수 상품 등록
-- DATA-PRESERVING MIGRATION: 기존 재고, 상품, 로케이션, 출고명세서를 삭제하지 않습니다.
-- 선행 조건: 12_EXTERNAL_TRANSFERS.sql 실행 완료

begin;

alter table public.external_shipment_documents
  add column if not exists writer_name text not null default '',
  add column if not exists shipment_manager_name text not null default '';

create or replace function public.set_external_transfer_items_batch(
  p_job_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_status text;
  v_entry jsonb;
  v_product_id uuid;
  v_qty integer;
  v_count integer:=0;
begin
  perform public.require_role(array['admin','manager','operator']);
  if not public.external_can_access_job(p_job_id) then
    raise exception '이 작업을 수정할 권한이 없습니다.';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then
    raise exception '등록할 상품 형식이 올바르지 않습니다.';
  end if;
  if jsonb_array_length(p_items)=0 then
    raise exception '등록할 상품을 하나 이상 선택하세요.';
  end if;

  select status into v_status
  from public.external_transfer_jobs
  where id=p_job_id
  for update;

  if v_status is null then raise exception '외부이관 작업을 찾을 수 없습니다.'; end if;
  if v_status not in ('DRAFT','ALLOCATING') then
    raise exception '완료·취소된 작업은 수정할 수 없습니다.';
  end if;

  for v_entry in select * from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id:=(v_entry->>'product_id')::uuid;
      v_qty:=(v_entry->>'qty')::integer;
    exception when others then
      raise exception '상품 또는 수량 형식이 올바르지 않습니다.';
    end;

    if v_qty is null or v_qty<1 then
      raise exception '상품별 출고 수량은 1개 이상이어야 합니다.';
    end if;
    if not exists(select 1 from public.products where id=v_product_id and active) then
      raise exception '사용 가능한 상품을 찾을 수 없습니다.';
    end if;

    insert into public.external_transfer_items(job_id,product_id,requested_qty)
    values(p_job_id,v_product_id,v_qty)
    on conflict(job_id,product_id) do update
      set requested_qty=excluded.requested_qty,updated_at=now();

    delete from public.external_transfer_allocations
    where job_id=p_job_id and product_id=v_product_id;

    v_count:=v_count+1;
  end loop;

  update public.external_transfer_jobs
  set status='DRAFT',updated_at=now()
  where id=p_job_id;

  perform public.write_audit(
    'EXTERNAL_TRANSFER_ITEMS_BATCH_SET',
    'external_transfer',
    p_job_id::text,
    v_count::text||' SKU',
    null,
    jsonb_build_object('item_count',v_count,'items',p_items),
    '공통 바코드 복수 상품 등록'
  );

  return public.get_external_transfer_job(p_job_id);
end;
$$;

create or replace function public.get_external_shipment_personnel(
  p_document_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  perform public.require_role(array['admin','manager','operator']);

  select jsonb_build_object(
    'writer_name',d.writer_name,
    'shipment_manager_name',d.shipment_manager_name
  ) into v_result
  from public.external_shipment_documents d
  where d.id=p_document_id;

  if v_result is null then raise exception '출고명세서를 찾을 수 없습니다.'; end if;
  return v_result;
end;
$$;

create or replace function public.update_external_shipment_personnel(
  p_document_id uuid,
  p_writer_name text,
  p_shipment_manager_name text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_before jsonb;
  v_writer_name text;
  v_manager_name text;
begin
  perform public.require_role(array['admin','manager','operator']);

  v_writer_name:=trim(coalesce(p_writer_name,''));
  v_manager_name:=trim(coalesce(p_shipment_manager_name,''));

  if v_writer_name='' then raise exception '작성자를 입력하세요.'; end if;
  if v_manager_name='' then raise exception '출고 담당을 입력하세요.'; end if;

  select jsonb_build_object(
    'writer_name',d.writer_name,
    'shipment_manager_name',d.shipment_manager_name
  ) into v_before
  from public.external_shipment_documents d
  where d.id=p_document_id
  for update;

  if v_before is null then raise exception '출고명세서를 찾을 수 없습니다.'; end if;

  update public.external_shipment_documents
  set writer_name=v_writer_name,
      shipment_manager_name=v_manager_name
  where id=p_document_id;

  perform public.write_audit(
    'EXTERNAL_SHIPMENT_PERSONNEL_UPDATED',
    'external_shipment',
    p_document_id::text,
    v_writer_name||' / '||v_manager_name,
    v_before,
    jsonb_build_object(
      'writer_name',v_writer_name,
      'shipment_manager_name',v_manager_name
    ),
    '출고명세서 작성자·출고 담당 직접 입력'
  );

  return jsonb_build_object(
    'writer_name',v_writer_name,
    'shipment_manager_name',v_manager_name
  );
end;
$$;

revoke all on function public.set_external_transfer_items_batch(uuid,jsonb) from public;
revoke all on function public.get_external_shipment_personnel(uuid) from public;
revoke all on function public.update_external_shipment_personnel(uuid,text,text) from public;

grant execute on function public.set_external_transfer_items_batch(uuid,jsonb) to authenticated;
grant execute on function public.get_external_shipment_personnel(uuid) to authenticated;
grant execute on function public.update_external_shipment_personnel(uuid,text,text) to authenticated;

notify pgrst, 'reload schema';

commit;

select 'SAN WMS shipment personnel and multi barcode migration completed' as result;
