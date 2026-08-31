-- SAN WMS V5.0.1: outbound picking must use the physically scanned LOC
-- Apply after SQL46. Existing stock and outbound transactions are preserved.

begin;

create or replace function public.resolve_outbound_location(p_barcode text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_location public.locations%rowtype; v_count int;
begin
  perform public.require_outbound_use(false);
  select count(distinct l.id) into v_count
  from public.locations l
  left join public.barcodes b on b.scan_target_id=l.scan_target_id and b.active
  where l.active and (
    b.normalized_value=public.normalize_barcode(p_barcode)
    or public.normalize_barcode(l.location_code)=public.normalize_barcode(p_barcode)
  );
  if v_count=0 then raise exception '등록된 활성 LOC 바코드가 아닙니다.'; end if;
  if v_count>1 then raise exception '같은 바코드가 여러 LOC에 연결되어 있습니다.'; end if;
  select distinct on(l.id) l.* into v_location
  from public.locations l
  left join public.barcodes b on b.scan_target_id=l.scan_target_id and b.active
  where l.active and (
    b.normalized_value=public.normalize_barcode(p_barcode)
    or public.normalize_barcode(l.location_code)=public.normalize_barcode(p_barcode)
  ) limit 1;
  return jsonb_build_object('id',v_location.id,'location_code',v_location.location_code);
end; $$;

create or replace function public.get_outbound_pick_candidates(p_item_id uuid,p_location_barcode text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_item public.outbound_items%rowtype; v_location_id uuid; v_result jsonb;
begin
  perform public.require_outbound_use(false);
  select * into v_item from public.outbound_items where id=p_item_id;
  if not found then raise exception '피킹 품목을 찾을 수 없습니다.'; end if;
  select l.id into v_location_id
  from public.locations l left join public.barcodes b on b.scan_target_id=l.scan_target_id and b.active
  where l.active and (b.normalized_value=public.normalize_barcode(p_location_barcode) or public.normalize_barcode(l.location_code)=public.normalize_barcode(p_location_barcode))
  order by l.created_at limit 1;
  if v_location_id is null then raise exception '등록된 활성 LOC 바코드가 아닙니다.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',p.id,'artist',p.artist,'name_ver',p.name_ver,'code_no',p.code_no,'qty',ib.qty
  ) order by ib.qty desc,p.artist,p.name_ver),'[]'::jsonb) into v_result
  from public.inventory_balances ib join public.products p on p.id=ib.product_id and p.active
  where ib.location_id=v_location_id and ib.qty>0 and (
    (v_item.product_id is not null and p.id=v_item.product_id)
    or (v_item.product_id is null and exists(
      select 1 from public.barcodes pb where pb.scan_target_id=p.scan_target_id and pb.active
      and pb.normalized_value=public.normalize_barcode(v_item.product_barcode)
    ))
  );
  return v_result;
end; $$;

create or replace function public.pick_outbound_item_v2(
  p_item_id uuid,
  p_location_barcode text,
  p_qty integer,
  p_input_method text,
  p_idempotency_key text,
  p_selected_product_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_item public.outbound_items%rowtype;
  v_shipment public.outbound_shipments%rowtype;
  v_location public.locations%rowtype;
  v_job_id uuid;
  v_job_archived_at timestamptz;
  v_remaining int;
  v_take int;
  v_total_stock bigint;
  v_balance record;
  v_after int;
  v_tx uuid;
  v_ids jsonb:='[]'::jsonb;
  v_existing public.outbound_pick_events%rowtype;
begin
  perform public.require_outbound_use(false);
  if p_qty<=0 or p_input_method not in ('SCAN','MANUAL') or nullif(trim(p_idempotency_key),'') is null then
    raise exception '피킹 요청값이 올바르지 않습니다.';
  end if;

  select * into v_existing from public.outbound_pick_events where idempotency_key=p_idempotency_key;
  if found then
    select * into v_item from public.outbound_items where id=v_existing.item_id;
    return jsonb_build_object('item_id',v_item.id,'picked_qty',v_item.picked_qty,'required_qty',v_item.required_qty,'duplicate',true);
  end if;

  select * into v_item from public.outbound_items where id=p_item_id for update;
  if not found then raise exception '피킹 품목을 찾을 수 없습니다.'; end if;
  select * into v_shipment from public.outbound_shipments where id=v_item.shipment_id for update;
  select archived_at into v_job_archived_at from public.outbound_jobs where id=v_shipment.job_id for update;
  if v_job_archived_at is not null then raise exception '삭제(숨김)된 출고 작업은 진행할 수 없습니다.'; end if;
  if v_item.resolution<>'MATCHED' or v_shipment.status='REVIEW' then raise exception '확인 필요 품목은 먼저 수정하세요.'; end if;
  if p_input_method='MANUAL' and not v_shipment.manual_quantity_allowed then raise exception '이 운송장은 직접 수량 입력이 허용되지 않았습니다.'; end if;
  if v_item.picked_qty+p_qty>v_item.required_qty then raise exception '필요 수량을 초과했습니다. 현재 %/%',v_item.picked_qty,v_item.required_qty; end if;

  select l.* into v_location
  from public.locations l
  left join public.barcodes b on b.scan_target_id=l.scan_target_id and b.active
  where l.active and (
    b.normalized_value=public.normalize_barcode(p_location_barcode)
    or public.normalize_barcode(l.location_code)=public.normalize_barcode(p_location_barcode)
  ) order by l.created_at limit 1 for update of l;
  if not found then raise exception '등록된 활성 LOC 바코드가 아닙니다.'; end if;

  select coalesce(sum(ib.qty),0) into v_total_stock
  from public.inventory_balances ib
  where ib.location_id=v_location.id and ib.qty>0 and (
    (v_item.product_id is not null and ib.product_id=v_item.product_id)
    or (v_item.product_id is null and (p_selected_product_id is null or ib.product_id=p_selected_product_id) and exists(
      select 1 from public.products p join public.barcodes b on b.scan_target_id=p.scan_target_id and b.active
      where p.id=ib.product_id and p.active and b.normalized_value=public.normalize_barcode(v_item.product_barcode)
    ))
  );
  if v_total_stock<p_qty then
    raise exception '% LOC의 해당 상품 재고는 %개입니다. %개를 차감할 수 없습니다.',v_location.location_code,v_total_stock,p_qty;
  end if;

  v_remaining:=p_qty;
  for v_balance in
    select ib.product_id,ib.qty
    from public.inventory_balances ib
    where ib.location_id=v_location.id and ib.qty>0 and (
      (v_item.product_id is not null and ib.product_id=v_item.product_id)
      or (v_item.product_id is null and (p_selected_product_id is null or ib.product_id=p_selected_product_id) and exists(
        select 1 from public.products p join public.barcodes b on b.scan_target_id=p.scan_target_id and b.active
        where p.id=ib.product_id and p.active and b.normalized_value=public.normalize_barcode(v_item.product_barcode)
      ))
    ) order by ib.qty desc,ib.product_id for update of ib
  loop
    exit when v_remaining=0;
    v_take:=least(v_remaining,v_balance.qty);
    v_after:=v_balance.qty-v_take;
    update public.inventory_balances set qty=v_after,updated_at=now()
    where product_id=v_balance.product_id and location_id=v_location.id;
    v_tx:=gen_random_uuid();
    insert into public.inventory_transactions(
      id,operation,status,product_id,location_id,qty,before_qty,after_qty,
      product_barcode_value,location_barcode_value,reference_type,reference_id,
      idempotency_key,note,actor_id
    ) values(
      v_tx,'OB','ACTIVE',v_balance.product_id,v_location.id,v_take,v_balance.qty,v_after,
      v_item.product_barcode,v_location.location_code,'OUTBOUND_PROGRESS',v_shipment.id::text,
      p_idempotency_key||':'||v_balance.product_id::text,'출고 진행 LOC 지정 피킹',auth.uid()
    );
    v_ids:=v_ids||jsonb_build_array(v_tx);
    v_remaining:=v_remaining-v_take;
  end loop;

  update public.outbound_items set picked_qty=picked_qty+p_qty,updated_at=now()
  where id=v_item.id returning * into v_item;
  insert into public.outbound_pick_events(job_id,shipment_id,item_id,qty,input_method,idempotency_key,actor_id)
  select s.job_id,s.id,v_item.id,p_qty,p_input_method,p_idempotency_key,auth.uid()
  from public.outbound_shipments s where s.id=v_item.shipment_id returning job_id into v_job_id;
  update public.outbound_shipments s
  set assigned_worker_id=coalesce(assigned_worker_id,auth.uid()),
      assigned_worker_label=coalesce(assigned_worker_label,public.user_label(auth.uid())),
      status=case when not exists(select 1 from public.outbound_items i where i.shipment_id=s.id and i.picked_qty<i.required_qty) then 'COMPLETED' else 'IN_PROGRESS' end,
      updated_at=now()
  where s.id=v_item.shipment_id returning * into v_shipment;
  update public.outbound_jobs j
  set status=case when not exists(select 1 from public.outbound_shipments s where s.job_id=j.id and s.status<>'COMPLETED') then 'COMPLETED' else 'IN_PROGRESS' end,updated_at=now()
  where id=v_job_id;
  return jsonb_build_object(
    'item_id',v_item.id,'picked_qty',v_item.picked_qty,'required_qty',v_item.required_qty,
    'shipment_status',v_shipment.status,'location_id',v_location.id,'location_code',v_location.location_code,
    'transaction_ids',v_ids,'duplicate',false
  );
end; $$;

-- Existing ambiguous rows represent one physical barcode split over product records/LOCs.
-- They become location-resolved items; unregistered and insufficient-stock reviews remain blocked.
update public.outbound_items i
set resolution='MATCHED',review_reason=null,updated_at=now()
where i.resolution='AMBIGUOUS'
  and exists(
    select 1 from public.products p join public.barcodes b on b.scan_target_id=p.scan_target_id and b.active
    where p.active and b.normalized_value=public.normalize_barcode(i.product_barcode)
  );

insert into public.outbound_item_locations(item_id,location_id,location_code,source_qty,priority)
select i.id,ib.location_id,l.location_code,sum(ib.qty)::int,
       row_number() over(partition by i.id order by sum(ib.qty) desc,l.location_code)::int
from public.outbound_items i
join public.products p on p.active
join public.barcodes b on b.scan_target_id=p.scan_target_id and b.active
  and b.normalized_value=public.normalize_barcode(i.product_barcode)
join public.inventory_balances ib on ib.product_id=p.id and ib.qty>0
join public.locations l on l.id=ib.location_id and l.active
where i.product_id is null and i.resolution='MATCHED'
group by i.id,ib.location_id,l.location_code
on conflict(item_id,location_id) do update set source_qty=excluded.source_qty,priority=excluded.priority;

update public.outbound_shipments s
set status=case when exists(select 1 from public.outbound_items i where i.shipment_id=s.id and i.resolution<>'MATCHED') then 'REVIEW' else case when s.status='REVIEW' then 'READY' else s.status end end,
    updated_at=now();
update public.outbound_jobs j
set status=case when exists(select 1 from public.outbound_shipments s where s.job_id=j.id and s.status='REVIEW') then 'DRAFT' else case when j.status='DRAFT' then 'READY' else j.status end end,
    updated_at=now();

revoke execute on function public.pick_outbound_item(uuid,integer,text,text) from authenticated;
revoke all on function public.resolve_outbound_location(text) from public,anon;
revoke all on function public.get_outbound_pick_candidates(uuid,text) from public,anon;
revoke all on function public.pick_outbound_item_v2(uuid,text,integer,text,text,uuid) from public,anon;
grant execute on function public.resolve_outbound_location(text) to authenticated;
grant execute on function public.get_outbound_pick_candidates(uuid,text) to authenticated;
grant execute on function public.pick_outbound_item_v2(uuid,text,integer,text,text,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
select 'SAN WMS V5.0.1 outbound LOC-first picking ready' as result;
