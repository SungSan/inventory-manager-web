-- SAN WMS - 현재 재고 수량 전체 초기화
-- 유지: 상품, 로케이션, 바코드, 사용자, 권한, 용적률 설정, LOC MAP, 입출고 이력, 감사로그
-- 처리: 현재 재고 전량 삭제 + 진행 중(DRAFT/READY) 이관 업무 취소
-- 복구 대비: 삭제 직전 재고를 private.inventory_reset_backups에 백업

begin;

create schema if not exists private;

create table if not exists private.inventory_reset_backups (
  reset_id uuid not null,
  backed_up_at timestamptz not null default now(),
  product_id uuid not null,
  location_id uuid not null,
  qty integer not null,
  inventory_updated_at timestamptz,
  primary key (reset_id, product_id, location_id)
);

lock table public.inventory_balances in access exclusive mode;

do $$
declare
  v_reset_id uuid := gen_random_uuid();
  v_balance_rows bigint := 0;
  v_total_qty bigint := 0;
  v_cancelled_jobs integer := 0;
begin
  select count(*), coalesce(sum(qty), 0)
  into v_balance_rows, v_total_qty
  from public.inventory_balances
  where qty > 0;

  insert into private.inventory_reset_backups (
    reset_id,
    backed_up_at,
    product_id,
    location_id,
    qty,
    inventory_updated_at
  )
  select
    v_reset_id,
    now(),
    product_id,
    location_id,
    qty,
    updated_at
  from public.inventory_balances
  where qty > 0;

  if to_regclass('public.transfer_jobs') is not null then
    update public.transfer_jobs
    set
      status = 'CANCELLED',
      cancel_reason = '관리자 재고 전체 초기화',
      cancelled_at = now(),
      updated_at = now()
    where status in ('DRAFT', 'READY');

    get diagnostics v_cancelled_jobs = row_count;
  end if;

  delete from public.inventory_balances;

  insert into public.audit_logs (
    action,
    entity_type,
    entity_id,
    entity_label,
    before_data,
    after_data,
    note,
    actor_id
  ) values (
    'INVENTORY_RESET',
    'inventory',
    v_reset_id::text,
    '현재 재고 전체 초기화',
    jsonb_build_object(
      'balance_rows', v_balance_rows,
      'total_qty', v_total_qty,
      'backup_reset_id', v_reset_id,
      'cancelled_active_transfer_jobs', v_cancelled_jobs
    ),
    jsonb_build_object(
      'balance_rows', 0,
      'total_qty', 0
    ),
    '상품·로케이션·바코드·사용자·설정·입출고 이력은 유지됨',
    null
  );

  raise notice '재고 초기화 완료: %개 재고행, 총 %개 수량, 진행 중 이관 %건 취소, 백업 ID=%',
    v_balance_rows, v_total_qty, v_cancelled_jobs, v_reset_id;
end;
$$;

commit;

select
  count(*) as remaining_balance_rows,
  coalesce(sum(qty), 0) as remaining_total_qty
from public.inventory_balances;
