-- SAN WMS V5.0.12: require notes for inbound, outbound, and outbound job creation.
-- Existing inventory transactions are preserved. Existing outbound jobs receive a migration label.

begin;

alter table public.outbound_jobs add column if not exists note text;
update public.outbound_jobs
set note = '기존 출고 작업'
where nullif(btrim(coalesce(note, '')), '') is null;
alter table public.outbound_jobs alter column note set not null;

alter table public.outbound_jobs
  drop constraint if exists outbound_jobs_note_required;
alter table public.outbound_jobs
  add constraint outbound_jobs_note_required check (btrim(note) <> '');

alter table public.inventory_transactions
  drop constraint if exists inventory_transactions_operation_note_required;
alter table public.inventory_transactions
  add constraint inventory_transactions_operation_note_required
  check (
    operation not in ('IB', 'OB')
    or nullif(btrim(coalesce(note, '')), '') is not null
  ) not valid;

create or replace function public.create_outbound_job(p_job jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_job_id uuid:=coalesce(nullif(p_job->>'id','')::uuid,gen_random_uuid());
  v_note text:=nullif(btrim(coalesce(p_job->>'note','')),'');
  v_shipment jsonb;
  v_item jsonb;
  v_sid uuid;
  v_iid uuid;
  v_loc jsonb;
  v_lid uuid;
begin
  perform public.require_outbound_use(true);
  if v_note is null then raise exception '출고 작업 메모를 입력하세요.'; end if;

  insert into public.outbound_jobs(id,name,note,status,created_by)
  values(v_job_id,coalesce(nullif(trim(p_job->>'name'),''),'출고 작업'),v_note,coalesce(p_job->>'status','DRAFT'),auth.uid());

  for v_shipment in select value from jsonb_array_elements(coalesce(p_job->'shipments','[]'::jsonb)) loop
    v_sid:=coalesce(nullif(v_shipment->>'id','')::uuid,gen_random_uuid());
    insert into public.outbound_shipments(id,job_id,tracking_no,status,manual_quantity_allowed)
    values(v_sid,v_job_id,trim(v_shipment->>'trackingNo'),coalesce(v_shipment->>'status','READY'),coalesce((v_shipment->>'manualQuantityAllowed')::boolean,false));
    for v_item in select value from jsonb_array_elements(coalesce(v_shipment->'items','[]'::jsonb)) loop
      v_iid:=coalesce(nullif(v_item->>'id','')::uuid,gen_random_uuid());
      insert into public.outbound_items(id,shipment_id,product_id,product_barcode,artist,name_ver,order_nos,required_qty,picked_qty,resolution,review_reason)
      values(v_iid,v_sid,nullif(v_item->>'productId','')::uuid,v_item->>'productBarcode',coalesce(v_item->>'artist',''),coalesce(v_item->>'nameVer',''),coalesce(v_item->'orderNos','[]'::jsonb),(v_item->>'requiredQty')::integer,coalesce((v_item->>'pickedQty')::integer,0),v_item->>'resolution',nullif(v_item->>'reviewReason',''));
      for v_loc in select value from jsonb_array_elements(coalesce(v_item->'locations','[]'::jsonb)) loop
        select id into v_lid from public.locations where location_code=v_loc->>'locationCode' limit 1;
        if v_lid is not null then
          insert into public.outbound_item_locations(item_id,location_id,location_code,source_qty,priority)
          values(v_iid,v_lid,v_loc->>'locationCode',coalesce((v_loc->>'qty')::integer,0),coalesce((v_loc->>'priority')::integer,0)) on conflict do nothing;
        end if;
      end loop;
    end loop;
  end loop;

  perform public.write_audit(
    'OUTBOUND_JOB_CREATED','outbound_job',v_job_id::text,p_job->>'name',null,
    jsonb_build_object('shipments',jsonb_array_length(coalesce(p_job->'shipments','[]'::jsonb))),v_note
  );
  return v_job_id;
end; $$;

revoke all on function public.create_outbound_job(jsonb) from public,anon;
grant execute on function public.create_outbound_job(jsonb) to authenticated;

commit;
