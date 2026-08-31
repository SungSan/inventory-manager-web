-- SAN WMS V5.0.10: fast read-only snapshots for dashboard and inventory
begin;

create or replace function public.get_facility_dashboard_metrics_fast()
returns jsonb
language sql
security definer
set search_path=public
stable
as $$
  with allowed_products as (
    select p.id,p.product_category
    from public.products p
    where exists (
      select 1 from public.user_product_scopes s
      where s.user_id=auth.uid() and s.product_scope=p.product_category
    )
  ), facilities as (
    select unnest(array['DAEJA','GWANSAN','UNASSIGNED']) facility
  ), location_counts as (
    select l.facility,count(*)::bigint location_count
    from public.locations l where l.active group by l.facility
  ), stock_metrics as (
    select l.facility,coalesce(sum(ib.qty),0)::bigint total_qty,
      count(distinct ib.product_id)::bigint sku_count,
      count(*) filter(where ib.qty<=5)::bigint low_stock
    from public.inventory_balances ib
    join allowed_products p on p.id=ib.product_id
    join public.locations l on l.id=ib.location_id
    group by l.facility
  )
  select case when auth.uid() is null then null else jsonb_object_agg(f.facility,jsonb_build_object(
    'total_qty',coalesce(s.total_qty,0),'sku_count',coalesce(s.sku_count,0),
    'location_count',coalesce(l.location_count,0),'low_stock',coalesce(s.low_stock,0)
  )) end
  from facilities f
  left join location_counts l on l.facility=f.facility
  left join stock_metrics s on s.facility=f.facility;
$$;

create or replace function public.get_inventory_page_snapshot_fast()
returns jsonb
language sql
security definer
set search_path=public
stable
as $$
  with allowed_products as materialized (
    select p.* from public.products p
    where exists (
      select 1 from public.user_product_scopes s
      where s.user_id=auth.uid() and s.product_scope=p.product_category
    )
  ), inventory_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'product_id',ib.product_id,'location_id',ib.location_id,'p_code_no',p.p_code_no,
      'code_no',p.code_no,'master_code_no',p.master_code_no,'artist',p.artist,
      'name_ver',p.name_ver,'product_category',p.product_category,'location_code',l.location_code,
      'zone',l.zone,'facility',l.facility,'qty',ib.qty,'updated_at',ib.updated_at
    ) order by l.location_code,ib.product_id),'[]'::jsonb) value
    from public.inventory_balances ib
    join allowed_products p on p.id=ib.product_id
    join public.locations l on l.id=ib.location_id
  ), barcode_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',b.id,'scan_target_id',b.scan_target_id,'target_type','product','target_id',p.id,
      'target_label',concat_ws(' · ',p.artist,p.name_ver),'barcode_value',b.barcode_value,
      'normalized_value',b.normalized_value,'source',b.source,'symbology',b.symbology,
      'is_primary',b.is_primary,'active',b.active,'created_at',b.created_at
    ) order by concat_ws(' · ',p.artist,p.name_ver),b.created_at),'[]'::jsonb) value
    from public.barcodes b
    join allowed_products p on p.scan_target_id=b.scan_target_id
  )
  select case when auth.uid() is null then null else jsonb_build_object(
    'inventory',inventory_rows.value,'barcodes',barcode_rows.value
  ) end from inventory_rows cross join barcode_rows;
$$;

revoke all on function public.get_facility_dashboard_metrics_fast() from public,anon;
revoke all on function public.get_inventory_page_snapshot_fast() from public,anon;
grant execute on function public.get_facility_dashboard_metrics_fast() to authenticated;
grant execute on function public.get_inventory_page_snapshot_fast() to authenticated;

notify pgrst,'reload schema';
commit;

select 'SAN WMS V5.0.10 fast initial reads migration completed' as result;
