-- SAN WMS - 운영 데이터 + 상품 마스터 전체 초기화
-- 삭제: 현재 재고, 입출고 이력, 스캔 로그, 감사로그, 모든 재고이관 업무,
--       활성/비활성 상품 전체, 상품 바코드, 상품용 scan_targets, 이전 재고 백업
-- 유지: 로케이션, 로케이션 바코드, LOC MAP, 용적률 설정, 사용자, 권한
-- 주의: 실행 후 삭제된 상품과 운영 데이터는 복구할 수 없습니다.

begin;

create temporary table _san_product_targets on commit drop as
select id
from public.scan_targets
where target_type = 'product';

-- 상품을 참조하는 업무 데이터부터 제거한다.
do $$
begin
  if to_regclass('public.transfer_job_items') is not null then
    execute 'delete from public.transfer_job_items';
  end if;

  if to_regclass('public.transfer_jobs') is not null then
    execute 'delete from public.transfer_jobs';
  end if;
end;
$$;

delete from public.inventory_transactions;
delete from public.inventory_balances;
delete from public.scan_events;

-- 상품 스캔 대상에 연결된 바코드만 삭제한다. 로케이션 바코드는 유지된다.
delete from public.barcodes
where scan_target_id in (select id from _san_product_targets);

-- 활성/비활성 상품을 모두 삭제한다.
delete from public.products;

-- 상품용 스캔 대상만 삭제한다. 로케이션용 스캔 대상은 유지된다.
delete from public.scan_targets
where id in (select id from _san_product_targets);

-- 기존 로그도 전부 비운다.
delete from public.audit_logs;

-- 이전 재고 초기화에서 만든 비공개 백업도 제거한다.
drop table if exists private.inventory_reset_backups;

commit;

select 'inventory_balances' as item, count(*)::bigint as remaining from public.inventory_balances
union all
select 'inventory_transactions', count(*)::bigint from public.inventory_transactions
union all
select 'scan_events', count(*)::bigint from public.scan_events
union all
select 'audit_logs', count(*)::bigint from public.audit_logs
union all
select 'products', count(*)::bigint from public.products
union all
select 'product_barcodes', count(*)::bigint
from public.barcodes b
join public.scan_targets st on st.id = b.scan_target_id
where st.target_type = 'product'
union all
select 'product_scan_targets', count(*)::bigint
from public.scan_targets
where target_type = 'product'
union all
select 'locations_preserved', count(*)::bigint from public.locations
union all
select 'location_barcodes_preserved', count(*)::bigint
from public.barcodes b
join public.scan_targets st on st.id = b.scan_target_id
where st.target_type = 'location';
