-- SAN WMS V4.4.0
-- 동시 작업 성능 안정화를 위한 조회 인덱스

begin;

create index if not exists idx_barcodes_normalized_active
  on public.barcodes(normalized_value)
  where active = true;

create index if not exists idx_inventory_transactions_created_at
  on public.inventory_transactions(created_at desc);

create index if not exists idx_scan_events_created_at
  on public.scan_events(created_at desc);

create index if not exists idx_audit_logs_created_at
  on public.audit_logs(created_at desc);

create index if not exists idx_inventory_balances_updated_at
  on public.inventory_balances(updated_at desc);

create index if not exists idx_work_requests_status_ship_date
  on public.work_requests(status, requested_ship_date);

create index if not exists idx_work_request_notifications_user_pending
  on public.work_request_notifications(user_id, available_from desc)
  where acknowledged_at is null;

analyze public.barcodes;
analyze public.inventory_transactions;
analyze public.scan_events;
analyze public.audit_logs;
analyze public.inventory_balances;
analyze public.work_requests;
analyze public.work_request_notifications;

commit;

select 'SAN WMS V4.4.0 realtime performance indexes completed' as result;
