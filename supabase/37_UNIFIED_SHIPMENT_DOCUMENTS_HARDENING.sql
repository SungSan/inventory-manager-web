-- SAN WMS V4.5.10
-- 통합 출고명세서 보안·감사로그 보정
-- 선행 조건: 36_UNIFIED_SHIPMENT_DOCUMENTS.sql
--
-- 1) 통합 명세서 RPC에서 require_user_ready() 강제
-- 2) 외부이관 신규 OUT 번호를 완료 감사로그에도 정확히 기록
-- 3) 기존 재고 차감/LOC 배정/락/idempotency 로직은 그대로 유지

begin;

create or replace function public.list_shipment_documents(
  p_source_type text default 'ALL',
  p_search text default '',
  p_date_from date default null,
  p_date_to date default null,
  p_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_source text:=upper(btrim(coalesce(p_source_type,'ALL')));
  v_search text:=btrim(coalesce(p_search,''));
  v_result jsonb;
begin
  perform public.require_user_ready();
  if v_source not in ('ALL','WORK_REQUEST','EXTERNAL_TRANSFER') then
    raise exception '출고명세서 구분값이 올바르지 않습니다.';
  end if;

  with unified as (
    select
      r.id,r.document_no,r.source_type,'외부이관'::text source_label,r.source_job_id source_entity_id,
      ('EXT JOB · '||upper(left(r.source_job_id::text,8)))::text source_reference_no,
      d.shipment_date,d.vendor_name,d.purpose,d.created_by_label,
      coalesce(nullif(r.shipment_manager_name,''),d.created_by_label,'사용자') worker_name,
      d.total_sku,d.total_qty,d.total_qty requested_total_qty,0::integer unfulfilled_total_qty,
      'NORMAL'::text completion_type,d.created_at,
      concat_ws(' ',r.document_no,d.vendor_name,d.purpose,d.created_by_label,r.writer_name,r.shipment_manager_name,
        coalesce((select string_agg(concat_ws(' ',i.product_barcode,i.p_code_no,i.code_no,i.master_code_no,i.artist,i.name_ver),' ')
          from public.external_shipment_items i where i.document_id=d.id),'')
      ) search_text
    from public.shipment_document_registry r
    join public.external_shipment_documents d on d.id=r.source_document_id
    where r.source_type='EXTERNAL_TRANSFER'
      and public.current_role() in ('admin','manager','operator')

    union all

    select
      r.id,r.document_no,r.source_type,'업무요청'::text source_label,r.source_job_id source_entity_id,
      wr.request_no source_reference_no,
      d.shipment_date,d.vendor_name,d.purpose,d.requester_name_snapshot created_by_label,
      coalesce(nullif(r.shipment_manager_name,''),d.worker_name_snapshot,'사용자') worker_name,
      d.total_sku,d.total_qty,coalesce(d.requested_total_qty,d.total_qty) requested_total_qty,
      coalesce(d.unfulfilled_total_qty,0) unfulfilled_total_qty,
      coalesce(d.completion_type,'NORMAL') completion_type,d.created_at,
      concat_ws(' ',r.document_no,wr.request_no,d.vendor_name,d.purpose,d.requester_name_snapshot,d.worker_name_snapshot,
        r.writer_name,r.shipment_manager_name,
        coalesce((select string_agg(concat_ws(' ',i.product_barcode,i.p_code_no,i.code_no,i.master_code_no,i.artist,i.name_ver),' ')
          from public.work_request_document_items i where i.document_id=d.id),'')
      ) search_text
    from public.shipment_document_registry r
    join public.work_request_documents d on d.id=r.source_document_id
    join public.work_requests wr on wr.id=d.work_request_id
    where r.source_type='WORK_REQUEST'
      and (
        public.current_role() in ('admin','manager')
        or d.requester_id=auth.uid()
        or d.worker_id=auth.uid()
      )
  ), filtered as (
    select * from unified
    where (v_source='ALL' or source_type=v_source)
      and (p_date_from is null or shipment_date>=p_date_from)
      and (p_date_to is null or shipment_date<=p_date_to)
      and (v_search='' or search_text ilike '%'||v_search||'%')
    order by shipment_date desc,created_at desc
    limit greatest(1,least(coalesce(p_limit,1000),2000))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'document_no',document_no,'source_type',source_type,'source_label',source_label,
    'source_entity_id',source_entity_id,'source_reference_no',source_reference_no,
    'shipment_date',shipment_date,'vendor_name',vendor_name,'purpose',purpose,
    'created_by_label',created_by_label,'worker_name',worker_name,'total_sku',total_sku,
    'total_qty',total_qty,'requested_total_qty',requested_total_qty,
    'unfulfilled_total_qty',unfulfilled_total_qty,'completion_type',completion_type,'created_at',created_at
  ) order by shipment_date desc,created_at desc),'[]'::jsonb)
  into v_result from filtered;

  return v_result;
end;
$$;

create or replace function public.get_shipment_document(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_registry public.shipment_document_registry%rowtype;
  v_result jsonb;
begin
  perform public.require_user_ready();

  select * into v_registry
  from public.shipment_document_registry r
  where r.id=p_document_id or r.source_document_id=p_document_id
  order by case when r.id=p_document_id then 0 else 1 end
  limit 1;

  if not found then raise exception '출고명세서를 찾을 수 없습니다.'; end if;
  if not public.shipment_document_can_access(v_registry.id) then
    raise exception '출고명세서를 조회할 권한이 없습니다.';
  end if;

  if v_registry.source_type='EXTERNAL_TRANSFER' then
    select jsonb_build_object(
      'id',v_registry.id,'document_no',v_registry.document_no,
      'source_type','EXTERNAL_TRANSFER','source_label','외부이관',
      'source_entity_id',v_registry.source_job_id,
      'source_reference_no','EXT JOB · '||upper(left(v_registry.source_job_id::text,8)),
      'shipment_date',d.shipment_date,'vendor_name',d.vendor_name,'vendor_contact',d.vendor_contact,
      'vendor_phone',d.vendor_phone,'vendor_address',d.vendor_address,'purpose',d.purpose,'note',d.note,
      'created_by_label',d.created_by_label,
      'worker_name',coalesce(nullif(v_registry.shipment_manager_name,''),d.created_by_label,'사용자'),
      'writer_name',coalesce(nullif(v_registry.writer_name,''),d.created_by_label,'사용자'),
      'shipment_manager_name',coalesce(nullif(v_registry.shipment_manager_name,''),d.created_by_label,'사용자'),
      'total_sku',d.total_sku,'total_qty',d.total_qty,'requested_total_qty',d.total_qty,
      'unfulfilled_total_qty',0,'completion_type','NORMAL','created_at',d.created_at,
      'force_complete_reason',null,'force_completed_by_name',null,
      'items',coalesce((
        select jsonb_agg(jsonb_build_object(
          'line_no',i.line_no,'product_id',i.product_id,'p_code_no',i.p_code_no,'code_no',i.code_no,
          'master_code_no',i.master_code_no,'artist',i.artist,'name_ver',i.name_ver,
          'product_barcode',i.product_barcode,'requested_qty',i.qty,'qty',i.qty,'unfulfilled_qty',0,'note',i.note,
          'allocations',coalesce((select jsonb_agg(jsonb_build_object(
            'location_id',a.location_id,'location_code',a.location_code,'qty',a.qty
          ) order by a.location_code) from public.external_shipment_allocations a
          where a.document_id=i.document_id and a.line_no=i.line_no),'[]'::jsonb)
        ) order by i.line_no)
        from public.external_shipment_items i where i.document_id=d.id
      ),'[]'::jsonb)
    ) into v_result
    from public.external_shipment_documents d
    where d.id=v_registry.source_document_id;
  else
    select jsonb_build_object(
      'id',v_registry.id,'document_no',v_registry.document_no,
      'source_type','WORK_REQUEST','source_label','업무요청',
      'source_entity_id',v_registry.source_job_id,'source_reference_no',wr.request_no,
      'shipment_date',d.shipment_date,'vendor_name',d.vendor_name,'vendor_contact',d.vendor_contact,
      'vendor_phone',d.vendor_phone,'vendor_address',d.vendor_address,'purpose',d.purpose,'note',d.note,
      'created_by_label',d.requester_name_snapshot,
      'worker_name',coalesce(nullif(v_registry.shipment_manager_name,''),d.worker_name_snapshot,'사용자'),
      'writer_name',coalesce(nullif(v_registry.writer_name,''),d.requester_name_snapshot,'사용자'),
      'shipment_manager_name',coalesce(nullif(v_registry.shipment_manager_name,''),d.worker_name_snapshot,'사용자'),
      'total_sku',d.total_sku,'total_qty',d.total_qty,
      'requested_total_qty',coalesce(d.requested_total_qty,d.total_qty),
      'unfulfilled_total_qty',coalesce(d.unfulfilled_total_qty,0),
      'completion_type',coalesce(d.completion_type,'NORMAL'),'created_at',d.created_at,
      'force_complete_reason',d.force_complete_reason,'force_completed_by_name',d.force_completed_by_name,
      'items',coalesce((
        select jsonb_agg(jsonb_build_object(
          'line_no',i.line_no,'product_id',i.product_id,'p_code_no',i.p_code_no,'code_no',i.code_no,
          'master_code_no',i.master_code_no,'artist',i.artist,'name_ver',i.name_ver,
          'product_barcode',i.product_barcode,'requested_qty',coalesce(i.requested_qty,i.qty),
          'qty',i.qty,'unfulfilled_qty',coalesce(i.unfulfilled_qty,0),'note','',
          'allocations',coalesce((select jsonb_agg(jsonb_build_object(
            'location_id',a.location_id,'location_code',a.location_code,'qty',a.qty
          ) order by a.location_code) from public.work_request_document_allocations a
          where a.document_item_id=i.id),'[]'::jsonb)
        ) order by i.line_no)
        from public.work_request_document_items i where i.document_id=d.id
      ),'[]'::jsonb)
    ) into v_result
    from public.work_request_documents d
    join public.work_requests wr on wr.id=d.work_request_id
    where d.id=v_registry.source_document_id;
  end if;

  if v_result is null then raise exception '출고명세서 원본을 찾을 수 없습니다.'; end if;
  return v_result;
end;
$$;

create or replace function public.update_shipment_document_personnel(
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
  v_registry public.shipment_document_registry%rowtype;
  v_writer text:=btrim(coalesce(p_writer_name,''));
  v_manager text:=btrim(coalesce(p_shipment_manager_name,''));
begin
  perform public.require_user_ready();
  if v_writer='' then raise exception '작성자를 입력하세요.'; end if;
  if v_manager='' then raise exception '출고 담당을 입력하세요.'; end if;

  select * into v_registry
  from public.shipment_document_registry r
  where r.id=p_document_id or r.source_document_id=p_document_id
  order by case when r.id=p_document_id then 0 else 1 end
  limit 1
  for update;

  if not found then raise exception '출고명세서를 찾을 수 없습니다.'; end if;
  if not public.shipment_document_can_access(v_registry.id) then
    raise exception '출고명세서를 수정할 권한이 없습니다.';
  end if;

  update public.shipment_document_registry
  set writer_name=v_writer,shipment_manager_name=v_manager
  where id=v_registry.id;

  if v_registry.source_type='EXTERNAL_TRANSFER' then
    update public.external_shipment_documents
    set writer_name=v_writer,shipment_manager_name=v_manager
    where id=v_registry.source_document_id;
  end if;

  perform public.write_audit(
    'SHIPMENT_DOCUMENT_PERSONNEL_UPDATED','shipment_document',v_registry.id::text,
    v_registry.document_no,null,
    jsonb_build_object('writer_name',v_writer,'shipment_manager_name',v_manager,'source_type',v_registry.source_type),
    '통합 출고명세서 작성자·출고 담당 수정'
  );

  return jsonb_build_object('writer_name',v_writer,'shipment_manager_name',v_manager);
end;
$$;

-- 외부이관 완료 함수의 기존 재고 로직은 유지하되, BEFORE INSERT 트리거가
-- 실제로 부여한 OUT 문서번호를 RETURNING으로 다시 받아 감사로그에 사용한다.
create or replace function public.complete_external_transfer_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_job public.external_transfer_jobs%rowtype; v_profile_label text; v_document_id uuid;
  v_document_no text; v_sequence integer; v_item record; v_allocation record;
  v_line_no integer:=0; v_item_count integer; v_total_qty bigint; v_allocated bigint;
  v_before integer; v_after integer; v_product_barcode text; v_location_barcode text;
  v_active_transfer_count integer:=0;
begin
  perform public.require_role(array['admin','manager','operator']);
  select * into v_job from public.external_transfer_jobs where id=p_job_id for update;
  if not found then raise exception '외부이관 작업을 찾을 수 없습니다.'; end if;
  if not public.external_can_access_job(p_job_id) then raise exception '이 작업을 완료할 권한이 없습니다.'; end if;
  if v_job.status not in ('DRAFT','ALLOCATING') then raise exception '이미 완료되었거나 취소된 작업입니다.'; end if;
  if nullif(trim(v_job.vendor_name),'') is null then raise exception '외부업체명을 입력하세요.'; end if;
  select count(*)::integer,coalesce(sum(requested_qty),0)::bigint into v_item_count,v_total_qty
  from public.external_transfer_items where job_id=p_job_id;
  if v_item_count=0 or v_total_qty<=0 then raise exception '출고할 상품을 하나 이상 등록하세요.'; end if;

  insert into public.external_document_daily_sequences(shipment_date,last_value)
  values(current_date,1)
  on conflict(shipment_date) do update set last_value=public.external_document_daily_sequences.last_value+1
  returning last_value into v_sequence;
  v_document_no:='EXT-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(v_sequence::text,4,'0');
  select coalesce(display_name,email,'사용자') into v_profile_label from public.profiles where id=auth.uid();
  insert into public.external_shipment_documents(
    document_no,shipment_date,vendor_name,vendor_contact,vendor_phone,vendor_address,
    purpose,note,created_by,created_by_label,source_job_id,total_sku,total_qty
  ) values(
    v_document_no,current_date,v_job.vendor_name,v_job.vendor_contact,v_job.vendor_phone,
    v_job.vendor_address,v_job.purpose,v_job.note,auth.uid(),coalesce(v_profile_label,'사용자'),
    p_job_id,v_item_count,v_total_qty
  ) returning id,document_no into v_document_id,v_document_no;

  for v_item in
    select i.product_id,i.requested_qty,p.p_code_no,p.code_no,p.master_code_no,
      p.artist,p.name_ver,p.scan_target_id
    from public.external_transfer_items i join public.products p on p.id=i.product_id
    where i.job_id=p_job_id order by i.created_at,p.artist,p.name_ver,p.code_no
  loop
    select coalesce(sum(qty),0)::bigint into v_allocated
    from public.external_transfer_allocations where job_id=p_job_id and product_id=v_item.product_id;
    if v_allocated<>v_item.requested_qty then
      raise exception '% · %의 LOC 배정 합계가 출고 수량과 다릅니다.',v_item.artist,v_item.name_ver;
    end if;
    v_line_no:=v_line_no+1;
    v_product_barcode:=public.external_primary_product_barcode(v_item.scan_target_id);
    insert into public.external_shipment_items(
      document_id,line_no,product_id,p_code_no,code_no,master_code_no,artist,name_ver,
      product_barcode,qty,note
    ) values(
      v_document_id,v_line_no,v_item.product_id,v_item.p_code_no,v_item.code_no,
      v_item.master_code_no,v_item.artist,v_item.name_ver,v_product_barcode,v_item.requested_qty,''
    );

    for v_allocation in
      select a.location_id,a.qty,l.location_code,l.scan_target_id,l.active,l.unavailable
      from public.external_transfer_allocations a join public.locations l on l.id=a.location_id
      where a.job_id=p_job_id and a.product_id=v_item.product_id order by l.location_code
    loop
      if not v_allocation.active or v_allocation.unavailable then
        raise exception '% 로케이션은 현재 사용할 수 없습니다.',v_allocation.location_code;
      end if;
      if to_regclass('public.transfer_jobs') is not null then
        execute 'select count(*) from public.transfer_jobs where status in (''DRAFT'',''READY'')
          and (source_location_id=$1 or destination_location_id=$1)'
        into v_active_transfer_count using v_allocation.location_id;
        if v_active_transfer_count>0 then raise exception '% 로케이션은 현재 재고이관 작업 중입니다.',v_allocation.location_code; end if;
      end if;
      select qty into v_before from public.inventory_balances
      where product_id=v_item.product_id and location_id=v_allocation.location_id for update;
      if v_before is null or v_before<v_allocation.qty then
        raise exception '% · % / %의 재고가 변경되었습니다. 현재 %개, 출고 요청 %개',
          v_item.artist,v_item.name_ver,v_allocation.location_code,coalesce(v_before,0),v_allocation.qty;
      end if;
      v_after:=v_before-v_allocation.qty;
      update public.inventory_balances set qty=v_after,updated_at=now()
      where product_id=v_item.product_id and location_id=v_allocation.location_id;
      v_location_barcode:=coalesce((select b.barcode_value from public.barcodes b
        where b.scan_target_id=v_allocation.scan_target_id and b.active
        order by b.is_primary desc,b.created_at,b.id limit 1),v_allocation.location_code);
      insert into public.inventory_transactions(
        operation,status,product_id,location_id,qty,before_qty,after_qty,
        product_barcode_value,location_barcode_value,reference_type,reference_id,
        idempotency_key,note,actor_id
      ) values(
        'OB','ACTIVE',v_item.product_id,v_allocation.location_id,v_allocation.qty,
        v_before,v_after,v_product_barcode,v_location_barcode,'EXTERNAL_TRANSFER',v_document_id::text,
        'external:'||v_document_id::text||':'||v_item.product_id::text||':'||v_allocation.location_id::text,
        v_job.vendor_name||' 외부업체 이관',auth.uid()
      );
      insert into public.external_shipment_allocations(document_id,line_no,location_id,location_code,qty)
      values(v_document_id,v_line_no,v_allocation.location_id,v_allocation.location_code,v_allocation.qty);
    end loop;
  end loop;

  update public.external_transfer_jobs set status='COMPLETED',document_id=v_document_id,
    completed_at=now(),updated_at=now() where id=p_job_id;
  perform public.write_audit('EXTERNAL_TRANSFER_COMPLETED','external_shipment',v_document_id::text,
    v_document_no,null,jsonb_build_object('vendor_name',v_job.vendor_name,'total_sku',v_item_count,
    'total_qty',v_total_qty,'document_no',v_document_no),v_job.note);
  return public.get_external_shipment_document(v_document_id);
end;
$$;

revoke all on function public.list_shipment_documents(text,text,date,date,integer) from public,anon;
revoke all on function public.get_shipment_document(uuid) from public,anon;
revoke all on function public.update_shipment_document_personnel(uuid,text,text) from public,anon;
revoke all on function public.complete_external_transfer_job(uuid) from public,anon;

grant execute on function public.list_shipment_documents(text,text,date,date,integer) to authenticated;
grant execute on function public.get_shipment_document(uuid) to authenticated;
grant execute on function public.update_shipment_document_personnel(uuid,text,text) to authenticated;
grant execute on function public.complete_external_transfer_job(uuid) to authenticated;

notify pgrst,'reload schema';
commit;

select 'SAN WMS V4.5.10 unified shipment document hardening completed' as result;
