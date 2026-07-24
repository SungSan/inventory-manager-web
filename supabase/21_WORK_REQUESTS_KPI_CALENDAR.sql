-- SAN WMS V4.0.0
-- 업무요청 · 영업일 검증 · 작업자 KPI · 자동배정 · 수정승인 · 실제 스캔 출고

begin;

create sequence if not exists public.work_request_no_seq;
create sequence if not exists public.work_request_document_no_seq;

create table if not exists public.business_calendar (
  business_date date primary key,
  is_working_day boolean not null,
  holiday_name text,
  source text not null default 'ADMIN',
  note text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.worker_kpi_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  metric_type text not null default 'WORKLOAD_POINTS' check (metric_type in ('REQUEST_COUNT','SKU_LINES','TOTAL_QTY','WORKLOAD_POINTS')),
  daily_capacity numeric not null default 100 check (daily_capacity >= 0),
  active boolean not null default true,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.worker_kpi_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  daily_capacity numeric not null check (daily_capacity >= 0),
  reason text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (user_id, work_date)
);

create table if not exists public.work_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique,
  requester_id uuid not null references auth.users(id) on delete restrict,
  requester_login_id_snapshot text not null,
  requester_name_snapshot text not null,
  requested_ship_date date not null,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','IN_PROGRESS','PARTIAL','COMPLETED','REJECTED','REQUESTER_CANCELLED','VOIDED')),
  assigned_to uuid references auth.users(id),
  assigned_name_snapshot text,
  reserved_user_id uuid references auth.users(id),
  vendor_name text not null,
  vendor_contact text not null default '',
  vendor_phone text not null default '',
  vendor_address text not null default '',
  purpose text not null default '',
  note text not null default '',
  item_count integer not null default 0,
  total_qty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  rejected_at timestamptz,
  rejected_by uuid references auth.users(id),
  reject_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancel_reason text,
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  void_reason text
);

create index if not exists idx_work_requests_requester on public.work_requests(requester_id,created_at desc);
create index if not exists idx_work_requests_assigned on public.work_requests(assigned_to,requested_ship_date,status);
create index if not exists idx_work_requests_reserved on public.work_requests(reserved_user_id,requested_ship_date,status);
create index if not exists idx_work_requests_ship_status on public.work_requests(requested_ship_date,status);

create table if not exists public.work_request_items (
  id uuid primary key default gen_random_uuid(),
  work_request_id uuid not null references public.work_requests(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  p_code_no_snapshot text not null default '',
  code_no_snapshot text not null default '',
  master_code_no_snapshot text not null default '',
  artist_snapshot text not null default '',
  name_ver_snapshot text not null default '',
  product_barcode_snapshot text not null default '',
  requested_qty integer not null check (requested_qty > 0),
  processed_qty integer not null default 0 check (processed_qty >= 0 and processed_qty <= requested_qty),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(work_request_id,product_id)
);

create table if not exists public.work_request_candidates (
  work_request_id uuid not null references public.work_requests(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  added_at timestamptz not null default now(),
  primary key(work_request_id,user_id)
);

create table if not exists public.work_request_scans (
  id uuid primary key default gen_random_uuid(),
  work_request_id uuid not null references public.work_requests(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  inventory_transaction_id uuid not null unique references public.inventory_transactions(id) on delete restrict,
  product_barcode_snapshot text not null,
  location_barcode_snapshot text not null,
  qty integer not null check(qty > 0),
  scanned_by uuid not null references auth.users(id) on delete restrict,
  scanned_by_name_snapshot text not null,
  scanned_at timestamptz not null default now()
);

create index if not exists idx_work_request_scans_request on public.work_request_scans(work_request_id,scanned_at);

create table if not exists public.work_request_events (
  id uuid primary key default gen_random_uuid(),
  work_request_id uuid not null references public.work_requests(id) on delete restrict,
  event_type text not null,
  actor_id uuid references auth.users(id),
  actor_name_snapshot text,
  before_data jsonb,
  after_data jsonb,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.work_request_notifications (
  id uuid primary key default gen_random_uuid(),
  work_request_id uuid not null references public.work_requests(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null,
  message text not null,
  available_from timestamptz not null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_work_request_notifications_user on public.work_request_notifications(user_id,available_from,acknowledged_at);

create table if not exists public.work_request_change_requests (
  id uuid primary key default gen_random_uuid(),
  work_request_id uuid not null references public.work_requests(id) on delete restrict,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_by_name_snapshot text not null,
  proposed_header jsonb not null,
  proposed_items jsonb not null,
  reason text,
  status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED','CANCELLED')),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_by_name_snapshot text,
  decision_note text,
  decided_at timestamptz
);

create unique index if not exists one_pending_change_per_request
  on public.work_request_change_requests(work_request_id) where status='PENDING';

create table if not exists public.work_request_documents (
  id uuid primary key default gen_random_uuid(),
  document_no text not null unique,
  work_request_id uuid not null unique references public.work_requests(id) on delete restrict,
  shipment_date date not null,
  vendor_name text not null,
  vendor_contact text not null default '',
  vendor_phone text not null default '',
  vendor_address text not null default '',
  purpose text not null default '',
  note text not null default '',
  requester_id uuid not null references auth.users(id) on delete restrict,
  requester_login_id_snapshot text not null,
  requester_name_snapshot text not null,
  worker_id uuid not null references auth.users(id) on delete restrict,
  worker_name_snapshot text not null,
  total_sku integer not null,
  total_qty integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.work_request_document_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.work_request_documents(id) on delete restrict,
  line_no integer not null,
  product_id uuid references public.products(id) on delete restrict,
  p_code_no text not null default '',
  code_no text not null default '',
  master_code_no text not null default '',
  artist text not null default '',
  name_ver text not null default '',
  product_barcode text not null default '',
  qty integer not null check(qty > 0),
  unique(document_id,line_no)
);

create table if not exists public.work_request_document_allocations (
  id uuid primary key default gen_random_uuid(),
  document_item_id uuid not null references public.work_request_document_items(id) on delete restrict,
  location_id uuid references public.locations(id) on delete restrict,
  location_code text not null,
  qty integer not null check(qty > 0)
);

-- 2026·2027 대한민국 공휴일 기본값. 회사 자체 휴무일과 특별근무일은 관리자 화면에서 덮어쓸 수 있다.
insert into public.business_calendar(business_date,is_working_day,holiday_name,source,note)
values
('2026-01-01',false,'신정','KASA_2026','2026년 월력요항'),
('2026-02-16',false,'설날 연휴','KASA_2026','2026년 월력요항'),
('2026-02-17',false,'설날','KASA_2026','2026년 월력요항'),
('2026-02-18',false,'설날 연휴','KASA_2026','2026년 월력요항'),
('2026-03-01',false,'3·1절','KASA_2026','2026년 월력요항'),
('2026-03-02',false,'3·1절 대체공휴일','KASA_2026','2026년 월력요항'),
('2026-05-01',false,'노동절','KASA_2027_UPDATE','2026년부터 공휴일 적용'),
('2026-05-05',false,'어린이날','KASA_2026','2026년 월력요항'),
('2026-05-24',false,'부처님오신날','KASA_2026','2026년 월력요항'),
('2026-05-25',false,'부처님오신날 대체공휴일','KASA_2026','2026년 월력요항'),
('2026-06-03',false,'전국동시지방선거일','ELECTION_2026','법정 선거일'),
('2026-06-06',false,'현충일','KASA_2026','2026년 월력요항'),
('2026-07-17',false,'제헌절','KASA_2027_UPDATE','2026년부터 공휴일 적용'),
('2026-08-15',false,'광복절','KASA_2026','2026년 월력요항'),
('2026-08-17',false,'광복절 대체공휴일','KASA_2026','2026년 월력요항'),
('2026-09-24',false,'추석 연휴','KASA_2026','2026년 월력요항'),
('2026-09-25',false,'추석','KASA_2026','2026년 월력요항'),
('2026-09-26',false,'추석 연휴','KASA_2026','2026년 월력요항'),
('2026-10-03',false,'개천절','KASA_2026','2026년 월력요항'),
('2026-10-05',false,'개천절 대체공휴일','KASA_2026','2026년 월력요항'),
('2026-10-09',false,'한글날','KASA_2026','2026년 월력요항'),
('2026-12-25',false,'기독탄신일','KASA_2026','2026년 월력요항'),
('2027-01-01',false,'신정','KASA_2027','2027년 월력요항'),
('2027-02-06',false,'설날 연휴','KASA_2027','2027년 월력요항'),
('2027-02-07',false,'설날','KASA_2027','2027년 월력요항'),
('2027-02-08',false,'설날 연휴','KASA_2027','2027년 월력요항'),
('2027-02-09',false,'설날 대체공휴일','KASA_2027','2027년 월력요항'),
('2027-03-01',false,'3·1절','KASA_2027','2027년 월력요항'),
('2027-05-01',false,'노동절','KASA_2027','2027년 월력요항'),
('2027-05-03',false,'노동절 대체공휴일','KASA_2027','2027년 월력요항'),
('2027-05-05',false,'어린이날','KASA_2027','2027년 월력요항'),
('2027-05-13',false,'부처님오신날','KASA_2027','2027년 월력요항'),
('2027-06-06',false,'현충일','KASA_2027','2027년 월력요항'),
('2027-07-17',false,'제헌절','KASA_2027','2027년 월력요항'),
('2027-07-19',false,'제헌절 대체공휴일','KASA_2027','2027년 월력요항'),
('2027-08-15',false,'광복절','KASA_2027','2027년 월력요항'),
('2027-08-16',false,'광복절 대체공휴일','KASA_2027','2027년 월력요항'),
('2027-09-14',false,'추석 연휴','KASA_2027','2027년 월력요항'),
('2027-09-15',false,'추석','KASA_2027','2027년 월력요항'),
('2027-09-16',false,'추석 연휴','KASA_2027','2027년 월력요항'),
('2027-10-03',false,'개천절','KASA_2027','2027년 월력요항'),
('2027-10-04',false,'개천절 대체공휴일','KASA_2027','2027년 월력요항'),
('2027-10-09',false,'한글날','KASA_2027','2027년 월력요항'),
('2027-10-11',false,'한글날 대체공휴일','KASA_2027','2027년 월력요항'),
('2027-12-25',false,'기독탄신일','KASA_2027','2027년 월력요항'),
('2027-12-27',false,'기독탄신일 대체공휴일','KASA_2027','2027년 월력요항')
on conflict(business_date) do nothing;

create or replace function public.is_business_day(p_date date)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select b.is_working_day from public.business_calendar b where b.business_date=p_date),extract(isodow from p_date) between 1 and 5);
$$;

create or replace function public.next_business_date(p_from date,p_steps integer default 1)
returns date language plpgsql stable security definer set search_path=public as $$
declare v_date date:=p_from; v_found integer:=0;
begin
  if p_steps < 1 then return p_from; end if;
  while v_found < p_steps loop
    v_date:=v_date+1;
    if public.is_business_day(v_date) then v_found:=v_found+1; end if;
  end loop;
  return v_date;
end; $$;

create or replace function public.earliest_work_request_ship_date(p_requested_at timestamptz default now())
returns date language plpgsql stable security definer set search_path=public as $$
declare v_local timestamp; v_steps integer;
begin
  v_local:=p_requested_at at time zone 'Asia/Seoul';
  v_steps:=case when v_local::time >= time '15:00' then 2 else 1 end;
  return public.next_business_date(v_local::date,v_steps);
end; $$;

create or replace function public.worker_metric_type(p_user_id uuid)
returns text language sql stable security definer set search_path=public as $$
  select coalesce((select s.metric_type from public.worker_kpi_settings s where s.user_id=p_user_id and s.active),'WORKLOAD_POINTS');
$$;

create or replace function public.calculate_worker_load(p_user_id uuid,p_item_count integer,p_total_qty integer)
returns numeric language sql stable security definer set search_path=public as $$
  select case public.worker_metric_type(p_user_id)
    when 'REQUEST_COUNT' then 1
    when 'SKU_LINES' then greatest(0,p_item_count)
    when 'TOTAL_QTY' then greatest(0,p_total_qty)
    else 5 + greatest(0,p_item_count)*2 + ceil(greatest(0,p_total_qty)/10.0)
  end;
$$;

create or replace function public.worker_daily_capacity(p_user_id uuid,p_date date)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce(
    (select o.daily_capacity from public.worker_kpi_overrides o where o.user_id=p_user_id and o.work_date=p_date),
    (select s.daily_capacity from public.worker_kpi_settings s where s.user_id=p_user_id and s.active),
    100
  );
$$;

create or replace function public.worker_used_capacity(p_user_id uuid,p_date date,p_exclude_request_id uuid default null)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce(sum(public.calculate_worker_load(p_user_id,w.item_count,w.total_qty)),0)
  from public.work_requests w
  where w.requested_ship_date=p_date
    and w.id is distinct from p_exclude_request_id
    and w.status in ('SCHEDULED','IN_PROGRESS','PARTIAL')
    and coalesce(w.assigned_to,w.reserved_user_id)=p_user_id;
$$;

create or replace function public.worker_remaining_capacity(p_user_id uuid,p_date date,p_item_count integer default 0,p_total_qty integer default 0,p_exclude_request_id uuid default null)
returns numeric language sql stable security definer set search_path=public as $$
  select public.worker_daily_capacity(p_user_id,p_date)-public.worker_used_capacity(p_user_id,p_date,p_exclude_request_id)-public.calculate_worker_load(p_user_id,p_item_count,p_total_qty);
$$;

create or replace function public.can_view_work_request(p_request_id uuid,p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select
    p_user_id=w.requester_id
    or p_user_id=w.assigned_to
    or p_user_id=w.reserved_user_id
    or exists(select 1 from public.work_request_candidates c where c.work_request_id=w.id and c.user_id=p_user_id)
    or (select role from public.profiles where id=p_user_id and active) in ('admin','manager')
  from public.work_requests w where w.id=p_request_id),false);
$$;

create or replace function public.choose_work_request_worker(p_candidates uuid[],p_date date,p_item_count integer,p_total_qty integer,p_exclude_request_id uuid default null)
returns uuid language sql stable security definer set search_path=public as $$
  select p.id
  from public.profiles p
  where p.id=any(p_candidates)
    and p.active and p.role in ('admin','manager','operator')
    and public.user_access_ready(p.id)
    and public.worker_remaining_capacity(p.id,p_date,p_item_count,p_total_qty,p_exclude_request_id)>=0
  order by public.worker_remaining_capacity(p.id,p_date,p_item_count,p_total_qty,p_exclude_request_id) desc,p.id
  limit 1;
$$;

create or replace function public.write_work_request_event(p_request_id uuid,p_event_type text,p_before jsonb default null,p_after jsonb default null,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.work_request_events(work_request_id,event_type,actor_id,actor_name_snapshot,before_data,after_data,note)
  values(p_request_id,p_event_type,auth.uid(),public.user_label(auth.uid()),p_before,p_after,p_note);
end; $$;

create or replace function public.work_request_to_json(p_request_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
  'id',w.id,'request_no',w.request_no,'requester_id',w.requester_id,'requester_login_id',w.requester_login_id_snapshot,
  'requester_name',w.requester_name_snapshot,'requested_ship_date',w.requested_ship_date,'status',w.status,
  'assigned_to',w.assigned_to,'assigned_name',coalesce(w.assigned_name_snapshot,public.user_label(w.assigned_to)),
  'reserved_user_id',w.reserved_user_id,'reserved_user_name',public.user_label(w.reserved_user_id),
  'vendor_name',w.vendor_name,'vendor_contact',w.vendor_contact,'vendor_phone',w.vendor_phone,'vendor_address',w.vendor_address,
  'purpose',w.purpose,'note',w.note,'item_count',w.item_count,'total_qty',w.total_qty,
  'created_at',w.created_at,'updated_at',w.updated_at,'started_at',w.started_at,'completed_at',w.completed_at,
  'cancelled_at',w.cancelled_at,'cancel_reason',w.cancel_reason,'rejected_at',w.rejected_at,'reject_reason',w.reject_reason,
  'voided_at',w.voided_at,'void_reason',w.void_reason,
  'is_requester',w.requester_id=auth.uid(),'is_assigned',w.assigned_to=auth.uid(),
  'is_candidate',exists(select 1 from public.work_request_candidates c where c.work_request_id=w.id and c.user_id=auth.uid()),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',i.id,'product_id',i.product_id,'p_code_no',i.p_code_no_snapshot,'code_no',i.code_no_snapshot,
    'master_code_no',i.master_code_no_snapshot,'artist',i.artist_snapshot,'name_ver',i.name_ver_snapshot,
    'product_barcode',i.product_barcode_snapshot,'requested_qty',i.requested_qty,'processed_qty',i.processed_qty,
    'remaining_qty',i.requested_qty-i.processed_qty
  ) order by i.artist_snapshot,i.name_ver_snapshot) from public.work_request_items i where i.work_request_id=w.id),'[]'::jsonb),
  'candidates',coalesce((select jsonb_agg(jsonb_build_object('user_id',c.user_id,'name',public.user_label(c.user_id),'role',p.role) order by public.user_label(c.user_id))
    from public.work_request_candidates c join public.profiles p on p.id=c.user_id where c.work_request_id=w.id),'[]'::jsonb),
  'scans',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'product_id',s.product_id,'location_id',s.location_id,
    'location_code',l.location_code,'qty',s.qty,'scanned_by',s.scanned_by,'scanned_by_name',s.scanned_by_name_snapshot,'scanned_at',s.scanned_at)
    order by s.scanned_at desc) from public.work_request_scans s join public.locations l on l.id=s.location_id where s.work_request_id=w.id),'[]'::jsonb),
  'change_requests',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'status',c.status,'reason',c.reason,'proposed_header',c.proposed_header,
    'proposed_items',c.proposed_items,'requested_by_name',c.requested_by_name_snapshot,'requested_at',c.requested_at,
    'decided_by_name',c.decided_by_name_snapshot,'decision_note',c.decision_note,'decided_at',c.decided_at) order by c.requested_at desc)
    from public.work_request_change_requests c where c.work_request_id=w.id),'[]'::jsonb),
  'document_id',(select d.id from public.work_request_documents d where d.work_request_id=w.id)
)
from public.work_requests w where w.id=p_request_id;
$$;

create or replace function public.list_work_request_assignees(p_ship_date date,p_item_count integer default 0,p_total_qty integer default 0)
returns table(user_id uuid,user_name text,role text,metric_type text,daily_capacity numeric,used_capacity numeric,new_request_load numeric,remaining_after numeric,can_accept boolean)
language plpgsql security definer set search_path=public as $$
begin
  perform public.require_user_ready();
  return query select p.id,public.user_label(p.id),p.role,public.worker_metric_type(p.id),
    public.worker_daily_capacity(p.id,p_ship_date),public.worker_used_capacity(p.id,p_ship_date,null),
    public.calculate_worker_load(p.id,p_item_count,p_total_qty),
    public.worker_remaining_capacity(p.id,p_ship_date,p_item_count,p_total_qty,null),
    public.worker_remaining_capacity(p.id,p_ship_date,p_item_count,p_total_qty,null)>=0
  from public.profiles p
  where p.active and p.role in ('admin','manager','operator') and public.user_access_ready(p.id)
  order by can_accept desc,remaining_after desc,user_name;
end; $$;

create or replace function public.create_work_request(
  p_requested_ship_date date,p_vendor_name text,p_vendor_contact text,p_vendor_phone text,p_vendor_address text,
  p_purpose text,p_note text,p_candidate_user_ids uuid[],p_items jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_profile public.profiles%rowtype; v_id uuid; v_no text; v_item jsonb; v_candidate uuid; v_item_count integer; v_total_qty integer; v_reserved uuid; v_assigned uuid; v_candidate_count integer; v_product public.products%rowtype; v_barcode text; v_earliest date;
begin
  perform public.require_user_ready();
  select * into v_profile from public.profiles where id=auth.uid() and active;
  if not found then raise exception '사용자 계정을 찾을 수 없습니다.'; end if;
  v_earliest:=public.earliest_work_request_ship_date(now());
  if p_requested_ship_date < v_earliest or not public.is_business_day(p_requested_ship_date) then
    raise exception '요청 가능한 가장 빠른 출고일은 %입니다. 영업일만 선택할 수 있습니다.',v_earliest;
  end if;
  if nullif(btrim(p_vendor_name),'') is null then raise exception '외부업체명을 입력하세요.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception '요청 상품을 1개 이상 등록하세요.'; end if;
  if coalesce(cardinality(p_candidate_user_ids),0)=0 then raise exception '담당 작업자를 1명 이상 선택하세요.'; end if;

  select count(*),coalesce(sum((x->>'qty')::integer),0) into v_item_count,v_total_qty from jsonb_array_elements(p_items) x;
  if exists(select 1 from jsonb_array_elements(p_items) x where coalesce((x->>'qty')::integer,0)<=0 or nullif(x->>'product_id','') is null) then raise exception '상품 또는 요청 수량이 올바르지 않습니다.'; end if;

  select count(distinct p.id) into v_candidate_count from public.profiles p where p.id=any(p_candidate_user_ids) and p.active and p.role in ('admin','manager','operator') and public.user_access_ready(p.id);
  if v_candidate_count <> (select count(distinct x) from unnest(p_candidate_user_ids) x) then raise exception '선택한 담당자 중 업무를 배정할 수 없는 계정이 있습니다.'; end if;

  v_reserved:=public.choose_work_request_worker(p_candidate_user_ids,p_requested_ship_date,v_item_count,v_total_qty,null);
  if v_reserved is null then raise exception '선택한 날짜에 KPI 여유가 있는 담당자가 없습니다.'; end if;
  if v_candidate_count=1 then v_assigned:=p_candidate_user_ids[1]; end if;

  v_no:='WR-'||to_char(clock_timestamp() at time zone 'Asia/Seoul','YYYYMMDD')||'-'||lpad(nextval('public.work_request_no_seq')::text,6,'0');
  insert into public.work_requests(request_no,requester_id,requester_login_id_snapshot,requester_name_snapshot,requested_ship_date,status,assigned_to,assigned_name_snapshot,reserved_user_id,
    vendor_name,vendor_contact,vendor_phone,vendor_address,purpose,note,item_count,total_qty)
  values(v_no,auth.uid(),coalesce(v_profile.email,''),public.user_label(auth.uid()),p_requested_ship_date,'SCHEDULED',v_assigned,public.user_label(v_assigned),v_reserved,
    btrim(p_vendor_name),coalesce(btrim(p_vendor_contact),''),coalesce(btrim(p_vendor_phone),''),coalesce(btrim(p_vendor_address),''),coalesce(btrim(p_purpose),''),coalesce(btrim(p_note),''),v_item_count,v_total_qty)
  returning id into v_id;

  foreach v_candidate in array p_candidate_user_ids loop
    insert into public.work_request_candidates(work_request_id,user_id) values(v_id,v_candidate) on conflict do nothing;
    insert into public.work_request_notifications(work_request_id,user_id,notification_type,message,available_from)
    values(v_id,v_candidate,'WORK_DUE',v_no||' 업무요청이 배정되었습니다.',((p_requested_ship_date-1)::timestamp at time zone 'Asia/Seoul'));
  end loop;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid and active;
    if not found then raise exception '등록되지 않았거나 비활성 상품이 포함되어 있습니다.'; end if;
    select b.barcode_value into v_barcode from public.barcodes b where b.scan_target_id=v_product.scan_target_id and b.active order by b.is_primary desc,b.created_at limit 1;
    insert into public.work_request_items(work_request_id,product_id,p_code_no_snapshot,code_no_snapshot,master_code_no_snapshot,artist_snapshot,name_ver_snapshot,product_barcode_snapshot,requested_qty)
    values(v_id,v_product.id,v_product.p_code_no,v_product.code_no,v_product.master_code_no,v_product.artist,v_product.name_ver,coalesce(v_barcode,''),(v_item->>'qty')::integer);
  end loop;

  perform public.write_work_request_event(v_id,'REQUEST_CREATED',null,public.work_request_to_json(v_id),null);
  perform public.write_audit('WORK_REQUEST_CREATED','work_request',v_id::text,v_no,null,jsonb_build_object('ship_date',p_requested_ship_date,'item_count',v_item_count,'total_qty',v_total_qty));
  return public.work_request_to_json(v_id);
end; $$;

create or replace function public.list_work_requests(p_scope text default 'ALL',p_include_closed boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role text;
begin
  perform public.require_user_ready(); v_role:=public.current_role();
  return coalesce((select jsonb_agg(public.work_request_to_json(w.id) order by w.requested_ship_date,w.created_at desc)
  from public.work_requests w
  where (p_include_closed or w.status in ('SCHEDULED','IN_PROGRESS','PARTIAL'))
    and (
      (p_scope='OWN' and w.requester_id=auth.uid())
      or (p_scope='WORK' and (w.assigned_to=auth.uid() or w.reserved_user_id=auth.uid() or exists(select 1 from public.work_request_candidates c where c.work_request_id=w.id and c.user_id=auth.uid())))
      or (p_scope='ALL' and (v_role in ('admin','manager') or w.requester_id=auth.uid() or w.assigned_to=auth.uid() or w.reserved_user_id=auth.uid() or exists(select 1 from public.work_request_candidates c where c.work_request_id=w.id and c.user_id=auth.uid())))
    )),'[]'::jsonb);
end; $$;

create or replace function public.get_work_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.require_user_ready();
  if not public.can_view_work_request(p_request_id,auth.uid()) then raise exception '업무요청을 조회할 권한이 없습니다.'; end if;
  return public.work_request_to_json(p_request_id);
end; $$;

create or replace function public.update_work_request_before_start(
  p_request_id uuid,p_requested_ship_date date,p_vendor_name text,p_vendor_contact text,p_vendor_phone text,p_vendor_address text,
  p_purpose text,p_note text,p_candidate_user_ids uuid[],p_items jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_request public.work_requests%rowtype; v_before jsonb; v_item jsonb; v_product public.products%rowtype; v_barcode text; v_candidate uuid; v_count integer; v_qty integer; v_reserved uuid; v_assigned uuid; v_candidate_count integer; v_earliest date;
begin
  perform public.require_user_ready();
  select * into v_request from public.work_requests where id=p_request_id for update;
  if not found then raise exception '업무요청을 찾을 수 없습니다.'; end if;
  if v_request.requester_id<>auth.uid() then raise exception '요청자만 작업 시작 전 내용을 수정할 수 있습니다.'; end if;
  if v_request.status<>'SCHEDULED' or v_request.started_at is not null then raise exception '작업 시작 전 요청만 직접 수정할 수 있습니다.'; end if;
  v_before:=public.work_request_to_json(p_request_id);
  v_earliest:=public.earliest_work_request_ship_date(now());
  if p_requested_ship_date < v_earliest or not public.is_business_day(p_requested_ship_date) then raise exception '요청 가능한 가장 빠른 출고일은 %입니다.',v_earliest; end if;
  if p_items is null or jsonb_array_length(p_items)=0 then raise exception '요청 상품을 1개 이상 등록하세요.'; end if;
  if coalesce(cardinality(p_candidate_user_ids),0)=0 then raise exception '담당 작업자를 선택하세요.'; end if;
  select count(*),coalesce(sum((x->>'qty')::integer),0) into v_count,v_qty from jsonb_array_elements(p_items)x;
  select count(distinct p.id) into v_candidate_count from public.profiles p where p.id=any(p_candidate_user_ids) and p.active and p.role in ('admin','manager','operator') and public.user_access_ready(p.id);
  if v_candidate_count<>(select count(distinct x) from unnest(p_candidate_user_ids)x) then raise exception '선택한 담당자 중 배정할 수 없는 계정이 있습니다.'; end if;
  v_reserved:=public.choose_work_request_worker(p_candidate_user_ids,p_requested_ship_date,v_count,v_qty,p_request_id);
  if v_reserved is null then raise exception '선택한 날짜에 KPI 여유가 있는 담당자가 없습니다.'; end if;
  if v_candidate_count=1 then v_assigned:=p_candidate_user_ids[1]; end if;

  update public.work_requests set requested_ship_date=p_requested_ship_date,vendor_name=btrim(p_vendor_name),vendor_contact=coalesce(btrim(p_vendor_contact),''),vendor_phone=coalesce(btrim(p_vendor_phone),''),
    vendor_address=coalesce(btrim(p_vendor_address),''),purpose=coalesce(btrim(p_purpose),''),note=coalesce(btrim(p_note),''),item_count=v_count,total_qty=v_qty,
    assigned_to=v_assigned,assigned_name_snapshot=public.user_label(v_assigned),reserved_user_id=v_reserved,updated_at=now() where id=p_request_id;
  delete from public.work_request_candidates where work_request_id=p_request_id;
  foreach v_candidate in array p_candidate_user_ids loop insert into public.work_request_candidates values(p_request_id,v_candidate,now()); end loop;
  delete from public.work_request_items where work_request_id=p_request_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid and active;
    if not found then raise exception '유효하지 않은 상품이 포함되어 있습니다.'; end if;
    select b.barcode_value into v_barcode from public.barcodes b where b.scan_target_id=v_product.scan_target_id and b.active order by b.is_primary desc,b.created_at limit 1;
    insert into public.work_request_items(work_request_id,product_id,p_code_no_snapshot,code_no_snapshot,master_code_no_snapshot,artist_snapshot,name_ver_snapshot,product_barcode_snapshot,requested_qty)
    values(p_request_id,v_product.id,v_product.p_code_no,v_product.code_no,v_product.master_code_no,v_product.artist,v_product.name_ver,coalesce(v_barcode,''),(v_item->>'qty')::integer);
  end loop;
  delete from public.work_request_notifications where work_request_id=p_request_id and acknowledged_at is null;
  foreach v_candidate in array p_candidate_user_ids loop
    insert into public.work_request_notifications(work_request_id,user_id,notification_type,message,available_from)
    values(p_request_id,v_candidate,'REQUEST_UPDATED',v_request.request_no||' 요청 내용이 수정되었습니다.',((p_requested_ship_date-1)::timestamp at time zone 'Asia/Seoul'));
  end loop;
  perform public.write_work_request_event(p_request_id,'REQUEST_UPDATED',v_before,public.work_request_to_json(p_request_id),'작업 시작 전 요청자 수정');
  return public.work_request_to_json(p_request_id);
end; $$;

create or replace function public.cancel_work_request_by_requester(p_request_id uuid,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_request public.work_requests%rowtype;
begin
  perform public.require_user_ready(); select * into v_request from public.work_requests where id=p_request_id for update;
  if not found or v_request.requester_id<>auth.uid() then raise exception '요청자 본인의 업무요청만 삭제할 수 있습니다.'; end if;
  if v_request.status<>'SCHEDULED' or v_request.started_at is not null then raise exception '작업 시작 전 요청만 삭제할 수 있습니다.'; end if;
  update public.work_requests set status='REQUESTER_CANCELLED',cancelled_at=now(),cancelled_by=auth.uid(),cancel_reason=coalesce(nullif(btrim(p_reason),''),'요청자 삭제'),updated_at=now() where id=p_request_id;
  perform public.write_work_request_event(p_request_id,'REQUESTER_CANCELLED',to_jsonb(v_request),public.work_request_to_json(p_request_id),p_reason);
  return public.work_request_to_json(p_request_id);
end; $$;

create or replace function public.start_work_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_request public.work_requests%rowtype; v_role text; v_allowed boolean; v_load numeric;
begin
  perform public.require_role(array['admin','manager','operator']); v_role:=public.current_role();
  select * into v_request from public.work_requests where id=p_request_id for update;
  if not found then raise exception '업무요청을 찾을 수 없습니다.'; end if;
  if v_request.status<>'SCHEDULED' then raise exception '작업 시작 가능한 상태가 아닙니다.'; end if;
  if current_date < v_request.requested_ship_date-1 then raise exception '요청 출고일 하루 전부터 작업을 시작할 수 있습니다.'; end if;
  v_allowed:=v_request.assigned_to=auth.uid() or exists(select 1 from public.work_request_candidates c where c.work_request_id=p_request_id and c.user_id=auth.uid()) or v_role in ('admin','manager');
  if not v_allowed then raise exception '이 업무요청의 담당 후보가 아닙니다.'; end if;
  if v_request.assigned_to is not null and v_request.assigned_to<>auth.uid() then raise exception '이미 다른 작업자에게 배정되었습니다. 담당자: %',public.user_label(v_request.assigned_to); end if;
  v_load:=public.worker_remaining_capacity(auth.uid(),v_request.requested_ship_date,v_request.item_count,v_request.total_qty,p_request_id);
  if v_load<0 then raise exception '해당 날짜의 KPI 한도를 초과하여 작업을 시작할 수 없습니다.'; end if;
  update public.work_requests set status='IN_PROGRESS',assigned_to=auth.uid(),assigned_name_snapshot=public.user_label(auth.uid()),reserved_user_id=auth.uid(),started_at=now(),updated_at=now() where id=p_request_id;
  perform public.write_work_request_event(p_request_id,'WORK_STARTED',to_jsonb(v_request),public.work_request_to_json(p_request_id),'먼저 작업 시작한 사용자에게 자동 배정');
  insert into public.work_request_notifications(work_request_id,user_id,notification_type,message,available_from)
  values(p_request_id,v_request.requester_id,'WORK_STARTED',v_request.request_no||' 작업이 시작되었습니다.',now());
  return public.work_request_to_json(p_request_id);
end; $$;

create or replace function public.reassign_work_request(p_request_id uuid,p_target_user_id uuid,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_request public.work_requests%rowtype; v_target public.profiles%rowtype;
begin
  perform public.require_role(array['admin','manager']);
  select * into v_request from public.work_requests where id=p_request_id for update;
  if not found or v_request.status not in ('SCHEDULED','IN_PROGRESS','PARTIAL') then raise exception '재배정할 수 없는 요청입니다.'; end if;
  select * into v_target from public.profiles where id=p_target_user_id and active and role in ('admin','manager','operator');
  if not found or not public.user_access_ready(p_target_user_id) then raise exception '업무를 배정할 수 없는 사용자입니다.'; end if;
  if public.worker_remaining_capacity(p_target_user_id,v_request.requested_ship_date,v_request.item_count,v_request.total_qty,p_request_id)<0 then raise exception '대상 작업자의 해당 날짜 KPI가 초과됩니다.'; end if;
  update public.work_requests set assigned_to=p_target_user_id,assigned_name_snapshot=public.user_label(p_target_user_id),reserved_user_id=p_target_user_id,updated_at=now() where id=p_request_id;
  insert into public.work_request_candidates(work_request_id,user_id) values(p_request_id,p_target_user_id) on conflict do nothing;
  insert into public.work_request_notifications(work_request_id,user_id,notification_type,message,available_from)
  values(p_request_id,p_target_user_id,'REASSIGNED',v_request.request_no||' 업무가 재배정되었습니다.',now());
  if v_request.assigned_to is not null and v_request.assigned_to<>p_target_user_id then
    insert into public.work_request_notifications(work_request_id,user_id,notification_type,message,available_from)
    values(p_request_id,v_request.assigned_to,'ASSIGNMENT_REMOVED',v_request.request_no||' 업무가 다른 작업자에게 이관되었습니다.',now());
  end if;
  perform public.write_work_request_event(p_request_id,'WORK_REASSIGNED',to_jsonb(v_request),public.work_request_to_json(p_request_id),p_reason);
  return public.work_request_to_json(p_request_id);
end; $$;

create or replace function public.submit_work_request_change(p_request_id uuid,p_proposed_header jsonb,p_proposed_items jsonb,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_request public.work_requests%rowtype; v_id uuid;
begin
  perform public.require_user_ready(); select * into v_request from public.work_requests where id=p_request_id for update;
  if not found or v_request.requester_id<>auth.uid() then raise exception '요청자만 수정 요청을 제출할 수 있습니다.'; end if;
  if v_request.status not in ('IN_PROGRESS','PARTIAL') then raise exception '작업 중인 요청만 작업자 승인 방식으로 수정할 수 있습니다.'; end if;
  if v_request.assigned_to is null then raise exception '배정된 작업자가 없습니다.'; end if;
  insert into public.work_request_change_requests(work_request_id,requested_by,requested_by_name_snapshot,proposed_header,proposed_items,reason)
  values(p_request_id,auth.uid(),public.user_label(auth.uid()),p_proposed_header,p_proposed_items,p_reason) returning id into v_id;
  insert into public.work_request_notifications(work_request_id,user_id,notification_type,message,available_from)
  values(p_request_id,v_request.assigned_to,'CHANGE_APPROVAL_REQUIRED',v_request.request_no||' 요청자가 수정 승인을 요청했습니다.',now());
  perform public.write_work_request_event(p_request_id,'CHANGE_REQUESTED',null,jsonb_build_object('change_request_id',v_id,'header',p_proposed_header,'items',p_proposed_items),p_reason);
  return public.work_request_to_json(p_request_id);
end; $$;

create or replace function public.approve_work_request_change(p_change_request_id uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_change public.work_request_change_requests%rowtype; v_request public.work_requests%rowtype; v_item jsonb; v_existing public.work_request_items%rowtype; v_product public.products%rowtype; v_barcode text; v_date date; v_count integer; v_qty integer; v_product_id uuid; v_new_qty integer;
begin
  perform public.require_role(array['admin','manager','operator']);
  select * into v_change from public.work_request_change_requests where id=p_change_request_id for update;
  if not found or v_change.status<>'PENDING' then raise exception '처리 가능한 수정 요청이 아닙니다.'; end if;
  select * into v_request from public.work_requests where id=v_change.work_request_id for update;
  if v_request.assigned_to<>auth.uid() then raise exception '현재 배정 작업자만 수정 요청을 승인할 수 있습니다.'; end if;
  v_date:=coalesce((v_change.proposed_header->>'requested_ship_date')::date,v_request.requested_ship_date);
  if v_date<>v_request.requested_ship_date and (v_date<public.earliest_work_request_ship_date(now()) or not public.is_business_day(v_date)) then raise exception '변경 출고일이 요청 가능 기준에 맞지 않습니다.'; end if;
  if v_change.proposed_items is null or jsonb_array_length(v_change.proposed_items)=0 then raise exception '수정 후 상품이 1개 이상이어야 합니다.'; end if;
  for v_existing in select * from public.work_request_items where work_request_id=v_request.id and processed_qty>0 loop
    select coalesce(max((x->>'qty')::integer),-1) into v_new_qty from jsonb_array_elements(v_change.proposed_items)x where (x->>'product_id')::uuid=v_existing.product_id;
    if v_new_qty < v_existing.processed_qty then raise exception '이미 처리한 수량보다 요청 수량을 작게 변경할 수 없습니다: %',v_existing.name_ver_snapshot; end if;
  end loop;
  for v_item in select * from jsonb_array_elements(v_change.proposed_items) loop
    v_product_id:=(v_item->>'product_id')::uuid; v_new_qty:=(v_item->>'qty')::integer;
    if v_new_qty<=0 then raise exception '요청 수량은 1개 이상이어야 합니다.'; end if;
    select * into v_existing from public.work_request_items where work_request_id=v_request.id and product_id=v_product_id;
    if found then
      update public.work_request_items set requested_qty=v_new_qty,updated_at=now() where id=v_existing.id;
    else
      select * into v_product from public.products where id=v_product_id and active;
      if not found then raise exception '유효하지 않은 상품이 포함되어 있습니다.'; end if;
      select b.barcode_value into v_barcode from public.barcodes b where b.scan_target_id=v_product.scan_target_id and b.active order by b.is_primary desc,b.created_at limit 1;
      insert into public.work_request_items(work_request_id,product_id,p_code_no_snapshot,code_no_snapshot,master_code_no_snapshot,artist_snapshot,name_ver_snapshot,product_barcode_snapshot,requested_qty)
      values(v_request.id,v_product.id,v_product.p_code_no,v_product.code_no,v_product.master_code_no,v_product.artist,v_product.name_ver,coalesce(v_barcode,''),v_new_qty);
    end if;
  end loop;
  delete from public.work_request_items i where i.work_request_id=v_request.id and i.processed_qty=0 and not exists(select 1 from jsonb_array_elements(v_change.proposed_items)x where (x->>'product_id')::uuid=i.product_id);
  select count(*),coalesce(sum(requested_qty),0) into v_count,v_qty from public.work_request_items where work_request_id=v_request.id;
  if public.worker_remaining_capacity(v_request.assigned_to,v_date,v_count,v_qty,v_request.id)<0 then raise exception '수정 후 업무량이 배정 작업자의 KPI를 초과합니다.'; end if;
  update public.work_requests set requested_ship_date=v_date,vendor_name=coalesce(nullif(btrim(v_change.proposed_header->>'vendor_name'),''),vendor_name),
    vendor_contact=coalesce(v_change.proposed_header->>'vendor_contact',vendor_contact),vendor_phone=coalesce(v_change.proposed_header->>'vendor_phone',vendor_phone),
    vendor_address=coalesce(v_change.proposed_header->>'vendor_address',vendor_address),purpose=coalesce(v_change.proposed_header->>'purpose',purpose),note=coalesce(v_change.proposed_header->>'note',note),
    item_count=v_count,total_qty=v_qty,updated_at=now() where id=v_request.id;
  update public.work_request_change_requests set status='APPROVED',decided_by=auth.uid(),decided_by_name_snapshot=public.user_label(auth.uid()),decision_note=p_note,decided_at=now() where id=p_change_request_id;
  insert into public.work_request_notifications(work_request_id,user_id,notification_type,message,available_from)
  values(v_request.id,v_request.requester_id,'CHANGE_APPROVED',v_request.request_no||' 수정 요청이 승인되었습니다.',now());
  perform public.write_work_request_event(v_request.id,'CHANGE_APPROVED',null,jsonb_build_object('change_request_id',p_change_request_id),p_note);
  return public.work_request_to_json(v_request.id);
end; $$;

create or replace function public.reject_work_request_change(p_change_request_id uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_change public.work_request_change_requests%rowtype; v_request public.work_requests%rowtype;
begin
  perform public.require_role(array['admin','manager','operator']);
  select * into v_change from public.work_request_change_requests where id=p_change_request_id for update;
  if not found or v_change.status<>'PENDING' then raise exception '처리 가능한 수정 요청이 아닙니다.'; end if;
  select * into v_request from public.work_requests where id=v_change.work_request_id;
  if v_request.assigned_to<>auth.uid() then raise exception '현재 배정 작업자만 수정 요청을 반려할 수 있습니다.'; end if;
  update public.work_request_change_requests set status='REJECTED',decided_by=auth.uid(),decided_by_name_snapshot=public.user_label(auth.uid()),decision_note=p_note,decided_at=now() where id=p_change_request_id;
  insert into public.work_request_notifications(work_request_id,user_id,notification_type,message,available_from)
  values(v_request.id,v_request.requester_id,'CHANGE_REJECTED',v_request.request_no||' 수정 요청이 반려되었습니다.',now());
  perform public.write_work_request_event(v_request.id,'CHANGE_REJECTED',null,jsonb_build_object('change_request_id',p_change_request_id),p_note);
  return public.work_request_to_json(v_request.id);
end; $$;

create or replace function public.finalize_work_request_document(p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_request public.work_requests%rowtype; v_doc uuid; v_no text; v_item public.work_request_items%rowtype; v_doc_item uuid; v_line integer:=0; v_alloc record;
begin
  select * into v_request from public.work_requests where id=p_request_id;
  select id into v_doc from public.work_request_documents where work_request_id=p_request_id;
  if v_doc is not null then return v_doc; end if;
  v_no:='WR-SHIP-'||to_char(clock_timestamp() at time zone 'Asia/Seoul','YYYYMMDD')||'-'||lpad(nextval('public.work_request_document_no_seq')::text,6,'0');
  insert into public.work_request_documents(document_no,work_request_id,shipment_date,vendor_name,vendor_contact,vendor_phone,vendor_address,purpose,note,
    requester_id,requester_login_id_snapshot,requester_name_snapshot,worker_id,worker_name_snapshot,total_sku,total_qty)
  values(v_no,p_request_id,current_date,v_request.vendor_name,v_request.vendor_contact,v_request.vendor_phone,v_request.vendor_address,v_request.purpose,v_request.note,
    v_request.requester_id,v_request.requester_login_id_snapshot,v_request.requester_name_snapshot,v_request.assigned_to,coalesce(v_request.assigned_name_snapshot,public.user_label(v_request.assigned_to)),
    (select count(*) from public.work_request_items where work_request_id=p_request_id and processed_qty>0),(select coalesce(sum(processed_qty),0) from public.work_request_items where work_request_id=p_request_id))
  returning id into v_doc;
  for v_item in select * from public.work_request_items where work_request_id=p_request_id and processed_qty>0 order by artist_snapshot,name_ver_snapshot loop
    v_line:=v_line+1;
    insert into public.work_request_document_items(document_id,line_no,product_id,p_code_no,code_no,master_code_no,artist,name_ver,product_barcode,qty)
    values(v_doc,v_line,v_item.product_id,v_item.p_code_no_snapshot,v_item.code_no_snapshot,v_item.master_code_no_snapshot,v_item.artist_snapshot,v_item.name_ver_snapshot,v_item.product_barcode_snapshot,v_item.processed_qty)
    returning id into v_doc_item;
    for v_alloc in select s.location_id,l.location_code,sum(s.qty)::integer qty from public.work_request_scans s join public.locations l on l.id=s.location_id where s.work_request_id=p_request_id and s.product_id=v_item.product_id group by s.location_id,l.location_code loop
      insert into public.work_request_document_allocations(document_item_id,location_id,location_code,qty) values(v_doc_item,v_alloc.location_id,v_alloc.location_code,v_alloc.qty);
    end loop;
  end loop;
  return v_doc;
end; $$;

create or replace function public.scan_work_request_item(
  p_request_id uuid,p_product_barcode text,p_location_barcode text,p_qty integer,p_idempotency_key text,p_product_id uuid default null,p_location_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_request public.work_requests%rowtype; v_item public.work_request_items%rowtype; v_product_id uuid; v_location_id uuid; v_result jsonb; v_transaction uuid; v_remaining integer; v_complete boolean; v_doc uuid;
begin
  perform public.require_role(array['admin','manager','operator']);
  if p_qty<=0 then raise exception '처리 수량은 1개 이상이어야 합니다.'; end if;
  select * into v_request from public.work_requests where id=p_request_id for update;
  if not found or v_request.status not in ('IN_PROGRESS','PARTIAL') then raise exception '스캔 처리 가능한 업무요청이 아닙니다.'; end if;
  if v_request.assigned_to<>auth.uid() then raise exception '현재 배정 작업자만 출고 스캔을 처리할 수 있습니다.'; end if;
  select p.id into v_product_id from public.barcodes b join public.scan_targets st on st.id=b.scan_target_id and st.target_type='product' join public.products p on p.scan_target_id=st.id and p.active
    where b.normalized_value=public.normalize_barcode(p_product_barcode) and b.active and (p_product_id is null or p.id=p_product_id) order by p.created_at limit 1;
  if v_product_id is null then raise exception '등록되지 않았거나 상품이 아닌 바코드입니다.'; end if;
  select l.id into v_location_id from public.barcodes b join public.scan_targets st on st.id=b.scan_target_id and st.target_type='location' join public.locations l on l.scan_target_id=st.id and l.active
    where b.normalized_value=public.normalize_barcode(p_location_barcode) and b.active and (p_location_id is null or l.id=p_location_id) order by l.created_at limit 1;
  if v_location_id is null then raise exception '등록되지 않았거나 로케이션이 아닌 바코드입니다.'; end if;
  select * into v_item from public.work_request_items where work_request_id=p_request_id and product_id=v_product_id for update;
  if not found then raise exception '이 업무요청에 포함되지 않은 상품입니다.'; end if;
  v_remaining:=v_item.requested_qty-v_item.processed_qty;
  if p_qty>v_remaining then raise exception '남은 요청 수량은 %개입니다.',v_remaining; end if;

  v_result:=public.post_inventory_movement('OB',p_product_barcode,p_location_barcode,p_qty,p_idempotency_key,'업무요청 '||v_request.request_no,'WORK_REQUEST',p_request_id::text,v_product_id,v_location_id);
  v_transaction:=(v_result->>'transaction_id')::uuid;
  if exists(select 1 from public.work_request_scans where inventory_transaction_id=v_transaction) then return public.work_request_to_json(p_request_id); end if;
  insert into public.work_request_scans(work_request_id,product_id,location_id,inventory_transaction_id,product_barcode_snapshot,location_barcode_snapshot,qty,scanned_by,scanned_by_name_snapshot)
  values(p_request_id,v_product_id,v_location_id,v_transaction,p_product_barcode,p_location_barcode,p_qty,auth.uid(),public.user_label(auth.uid()));
  update public.work_request_items set processed_qty=processed_qty+p_qty,updated_at=now() where id=v_item.id;
  select not exists(select 1 from public.work_request_items where work_request_id=p_request_id and processed_qty<requested_qty) into v_complete;
  if v_complete then
    update public.work_requests set status='COMPLETED',completed_at=now(),updated_at=now() where id=p_request_id;
    v_doc:=public.finalize_work_request_document(p_request_id);
    insert into public.work_request_notifications(work_request_id,user_id,notification_type,message,available_from)
    values(p_request_id,v_request.requester_id,'WORK_COMPLETED',v_request.request_no||' 출고 작업이 완료되었습니다.',now());
    perform public.write_work_request_event(p_request_id,'WORK_COMPLETED',null,jsonb_build_object('document_id',v_doc),'전체 요청 수량 스캔 완료');
  else
    update public.work_requests set status='PARTIAL',updated_at=now() where id=p_request_id;
    perform public.write_work_request_event(p_request_id,'ITEM_SCANNED',null,jsonb_build_object('product_id',v_product_id,'location_id',v_location_id,'qty',p_qty,'transaction_id',v_transaction),null);
  end if;
  return public.work_request_to_json(p_request_id);
end; $$;

create or replace function public.admin_void_work_request(p_request_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_request public.work_requests%rowtype;
begin
  perform public.require_role(array['admin']); select * into v_request from public.work_requests where id=p_request_id for update;
  if not found then raise exception '업무요청을 찾을 수 없습니다.'; end if;
  if v_request.status='VOIDED' then return public.work_request_to_json(p_request_id); end if;
  update public.work_requests set status='VOIDED',voided_at=now(),voided_by=auth.uid(),void_reason=nullif(btrim(p_reason),''),updated_at=now() where id=p_request_id;
  perform public.write_work_request_event(p_request_id,'ADMIN_VOIDED',to_jsonb(v_request),public.work_request_to_json(p_request_id),p_reason);
  return public.work_request_to_json(p_request_id);
end; $$;

create or replace function public.list_my_work_request_notifications()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.require_user_ready();
  return coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'work_request_id',n.work_request_id,'request_no',w.request_no,'type',n.notification_type,'message',n.message,
    'available_from',n.available_from,'acknowledged_at',n.acknowledged_at,'created_at',n.created_at) order by n.created_at desc)
  from public.work_request_notifications n join public.work_requests w on w.id=n.work_request_id
  where n.user_id=auth.uid() and n.available_from<=now() and w.status in ('SCHEDULED','IN_PROGRESS','PARTIAL')),'[]'::jsonb);
end; $$;

create or replace function public.acknowledge_work_request_notification(p_notification_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.require_user_ready(); update public.work_request_notifications set acknowledged_at=coalesce(acknowledged_at,now()) where id=p_notification_id and user_id=auth.uid();
end; $$;

create or replace function public.get_work_request_badge()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role text; v_pending integer; v_today integer; v_tomorrow integer; v_changes integer;
begin
  perform public.require_user_ready(); v_role:=public.current_role();
  if v_role='viewer' then return jsonb_build_object('pending',0,'today',0,'tomorrow',0,'change_approvals',0); end if;
  select count(*),count(*) filter(where w.requested_ship_date=current_date),count(*) filter(where w.requested_ship_date=current_date+1)
  into v_pending,v_today,v_tomorrow from public.work_requests w
  where w.status in ('SCHEDULED','IN_PROGRESS','PARTIAL') and w.requested_ship_date<=current_date+1
    and (w.assigned_to=auth.uid() or w.reserved_user_id=auth.uid() or exists(select 1 from public.work_request_candidates c where c.work_request_id=w.id and c.user_id=auth.uid()) or v_role in ('admin','manager'));
  select count(*) into v_changes from public.work_request_change_requests c join public.work_requests w on w.id=c.work_request_id where c.status='PENDING' and w.assigned_to=auth.uid();
  return jsonb_build_object('pending',v_pending,'today',v_today,'tomorrow',v_tomorrow,'change_approvals',v_changes);
end; $$;

create or replace function public.list_work_request_documents(p_search text default '',p_date_from date default null,p_date_to date default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role text;
begin
  perform public.require_user_ready(); v_role:=public.current_role();
  return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'document_no',d.document_no,'work_request_id',d.work_request_id,'request_no',w.request_no,'shipment_date',d.shipment_date,
    'vendor_name',d.vendor_name,'purpose',d.purpose,'requester_name',d.requester_name_snapshot,'worker_name',d.worker_name_snapshot,'total_sku',d.total_sku,'total_qty',d.total_qty,'created_at',d.created_at) order by d.created_at desc)
  from public.work_request_documents d join public.work_requests w on w.id=d.work_request_id
  where (v_role in ('admin','manager') or d.requester_id=auth.uid() or d.worker_id=auth.uid())
    and (coalesce(p_search,'')='' or upper(concat_ws(' ',d.document_no,w.request_no,d.vendor_name,d.purpose,d.requester_name_snapshot,d.worker_name_snapshot)) like '%'||upper(p_search)||'%')
    and (p_date_from is null or d.shipment_date>=p_date_from) and (p_date_to is null or d.shipment_date<=p_date_to)),'[]'::jsonb);
end; $$;

create or replace function public.get_work_request_document(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_doc public.work_request_documents%rowtype; v_role text;
begin
  perform public.require_user_ready(); v_role:=public.current_role(); select * into v_doc from public.work_request_documents where id=p_document_id;
  if not found or not (v_role in ('admin','manager') or v_doc.requester_id=auth.uid() or v_doc.worker_id=auth.uid()) then raise exception '명세서를 조회할 권한이 없습니다.'; end if;
  return jsonb_build_object('id',v_doc.id,'document_no',v_doc.document_no,'work_request_id',v_doc.work_request_id,'request_no',(select request_no from public.work_requests where id=v_doc.work_request_id),
    'shipment_date',v_doc.shipment_date,'vendor_name',v_doc.vendor_name,'vendor_contact',v_doc.vendor_contact,'vendor_phone',v_doc.vendor_phone,'vendor_address',v_doc.vendor_address,
    'purpose',v_doc.purpose,'note',v_doc.note,'requester_login_id',v_doc.requester_login_id_snapshot,'requester_name',v_doc.requester_name_snapshot,'worker_name',v_doc.worker_name_snapshot,
    'total_sku',v_doc.total_sku,'total_qty',v_doc.total_qty,'created_at',v_doc.created_at,
    'items',coalesce((select jsonb_agg(jsonb_build_object('line_no',i.line_no,'product_id',i.product_id,'p_code_no',i.p_code_no,'code_no',i.code_no,'master_code_no',i.master_code_no,
      'artist',i.artist,'name_ver',i.name_ver,'product_barcode',i.product_barcode,'qty',i.qty,'allocations',coalesce((select jsonb_agg(jsonb_build_object('location_id',a.location_id,'location_code',a.location_code,'qty',a.qty)) from public.work_request_document_allocations a where a.document_item_id=i.id),'[]'::jsonb)) order by i.line_no)
      from public.work_request_document_items i where i.document_id=v_doc.id),'[]'::jsonb));
end; $$;

create or replace function public.admin_list_worker_kpi(p_work_date date default current_date)
returns table(user_id uuid,user_name text,role text,metric_type text,daily_capacity numeric,used_capacity numeric,remaining_capacity numeric,override_capacity numeric)
language plpgsql security definer set search_path=public as $$
begin
  perform public.require_role(array['admin']);
  return query select p.id,public.user_label(p.id),p.role,public.worker_metric_type(p.id),public.worker_daily_capacity(p.id,p_work_date),public.worker_used_capacity(p.id,p_work_date,null),
    public.worker_daily_capacity(p.id,p_work_date)-public.worker_used_capacity(p.id,p_work_date,null),(select o.daily_capacity from public.worker_kpi_overrides o where o.user_id=p.id and o.work_date=p_work_date)
  from public.profiles p where p.active and p.role in ('admin','manager','operator') order by user_name;
end; $$;

create or replace function public.admin_upsert_worker_kpi(p_user_id uuid,p_metric_type text,p_daily_capacity numeric,p_active boolean default true)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.require_role(array['admin']);
  if p_metric_type not in ('REQUEST_COUNT','SKU_LINES','TOTAL_QTY','WORKLOAD_POINTS') or p_daily_capacity<0 then raise exception 'KPI 설정값 오류'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id and role<>'viewer') then raise exception '조회자는 KPI 설정 대상이 아닙니다.'; end if;
  insert into public.worker_kpi_settings(user_id,metric_type,daily_capacity,active,updated_by,updated_at)
  values(p_user_id,p_metric_type,p_daily_capacity,coalesce(p_active,true),auth.uid(),now())
  on conflict(user_id) do update set metric_type=excluded.metric_type,daily_capacity=excluded.daily_capacity,active=excluded.active,updated_by=auth.uid(),updated_at=now();
end; $$;

create or replace function public.admin_set_worker_kpi_override(p_user_id uuid,p_work_date date,p_daily_capacity numeric,p_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.require_role(array['admin']); if p_daily_capacity<0 then raise exception 'KPI는 0 이상이어야 합니다.'; end if;
  insert into public.worker_kpi_overrides(user_id,work_date,daily_capacity,reason,updated_by,updated_at)
  values(p_user_id,p_work_date,p_daily_capacity,p_reason,auth.uid(),now()) on conflict(user_id,work_date) do update set daily_capacity=excluded.daily_capacity,reason=excluded.reason,updated_by=auth.uid(),updated_at=now();
end; $$;

create or replace function public.list_business_calendar(p_date_from date,p_date_to date)
returns table(business_date date,is_working_day boolean,holiday_name text,source text,note text)
language plpgsql security definer set search_path=public as $$
begin
  perform public.require_user_ready(); return query select b.business_date,b.is_working_day,b.holiday_name,b.source,b.note from public.business_calendar b where b.business_date between p_date_from and p_date_to order by b.business_date;
end; $$;

create or replace function public.admin_set_business_calendar(p_business_date date,p_is_working_day boolean,p_holiday_name text default null,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.require_role(array['admin']);
  insert into public.business_calendar(business_date,is_working_day,holiday_name,source,note,updated_by,updated_at)
  values(p_business_date,p_is_working_day,nullif(btrim(p_holiday_name),''),'ADMIN',nullif(btrim(p_note),''),auth.uid(),now())
  on conflict(business_date) do update set is_working_day=excluded.is_working_day,holiday_name=excluded.holiday_name,source='ADMIN',note=excluded.note,updated_by=auth.uid(),updated_at=now();
end; $$;

-- RLS: 모든 변경은 제한된 RPC만 허용한다.
do $$ declare t text; begin
  foreach t in array array['business_calendar','worker_kpi_settings','worker_kpi_overrides','work_requests','work_request_items','work_request_candidates','work_request_scans','work_request_events','work_request_notifications','work_request_change_requests','work_request_documents','work_request_document_items','work_request_document_allocations'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists user_ready_restrictive on public.%I',t);
    execute format('create policy user_ready_restrictive on public.%I as restrictive for all to authenticated using (public.user_access_ready()) with check (public.user_access_ready())',t);
    execute format('revoke insert,update,delete on public.%I from public,anon,authenticated',t);
  end loop;
end $$;

drop policy if exists business_calendar_read on public.business_calendar;
create policy business_calendar_read on public.business_calendar for select to authenticated using (true);
drop policy if exists kpi_admin_read on public.worker_kpi_settings;
create policy kpi_admin_read on public.worker_kpi_settings for select to authenticated using (public.current_role()='admin');
drop policy if exists kpi_override_admin_read on public.worker_kpi_overrides;
create policy kpi_override_admin_read on public.worker_kpi_overrides for select to authenticated using (public.current_role()='admin');
drop policy if exists work_requests_access_read on public.work_requests;
create policy work_requests_access_read on public.work_requests for select to authenticated using (public.can_view_work_request(id,auth.uid()));

do $$ declare t text; begin
  foreach t in array array['work_request_items','work_request_candidates','work_request_scans','work_request_events','work_request_change_requests'] loop
    execute format('drop policy if exists work_request_child_read on public.%I',t);
    execute format('create policy work_request_child_read on public.%I for select to authenticated using (public.can_view_work_request(work_request_id,auth.uid()))',t);
  end loop;
end $$;

drop policy if exists own_notifications_read on public.work_request_notifications;
create policy own_notifications_read on public.work_request_notifications for select to authenticated using(user_id=auth.uid());
drop policy if exists work_request_documents_read on public.work_request_documents;
create policy work_request_documents_read on public.work_request_documents for select to authenticated using(public.can_view_work_request(work_request_id,auth.uid()));
drop policy if exists work_request_document_items_read on public.work_request_document_items;
create policy work_request_document_items_read on public.work_request_document_items for select to authenticated using(exists(select 1 from public.work_request_documents d where d.id=document_id and public.can_view_work_request(d.work_request_id,auth.uid())));
drop policy if exists work_request_document_allocations_read on public.work_request_document_allocations;
create policy work_request_document_allocations_read on public.work_request_document_allocations for select to authenticated using(exists(select 1 from public.work_request_document_items i join public.work_request_documents d on d.id=i.document_id where i.id=document_item_id and public.can_view_work_request(d.work_request_id,auth.uid())));

grant select on public.business_calendar,public.work_requests,public.work_request_items,public.work_request_candidates,public.work_request_scans,public.work_request_events,public.work_request_notifications,public.work_request_change_requests,public.work_request_documents,public.work_request_document_items,public.work_request_document_allocations to authenticated;
grant execute on function public.is_business_day(date) to authenticated;
grant execute on function public.earliest_work_request_ship_date(timestamptz) to authenticated;
grant execute on function public.list_work_request_assignees(date,integer,integer) to authenticated;
grant execute on function public.create_work_request(date,text,text,text,text,text,text,uuid[],jsonb) to authenticated;
grant execute on function public.list_work_requests(text,boolean) to authenticated;
grant execute on function public.get_work_request(uuid) to authenticated;
grant execute on function public.update_work_request_before_start(uuid,date,text,text,text,text,text,text,uuid[],jsonb) to authenticated;
grant execute on function public.cancel_work_request_by_requester(uuid,text) to authenticated;
grant execute on function public.start_work_request(uuid) to authenticated;
grant execute on function public.reassign_work_request(uuid,uuid,text) to authenticated;
grant execute on function public.submit_work_request_change(uuid,jsonb,jsonb,text) to authenticated;
grant execute on function public.approve_work_request_change(uuid,text) to authenticated;
grant execute on function public.reject_work_request_change(uuid,text) to authenticated;
grant execute on function public.scan_work_request_item(uuid,text,text,integer,text,uuid,uuid) to authenticated;
grant execute on function public.admin_void_work_request(uuid,text) to authenticated;
grant execute on function public.list_my_work_request_notifications() to authenticated;
grant execute on function public.acknowledge_work_request_notification(uuid) to authenticated;
grant execute on function public.get_work_request_badge() to authenticated;
grant execute on function public.list_work_request_documents(text,date,date) to authenticated;
grant execute on function public.get_work_request_document(uuid) to authenticated;
grant execute on function public.admin_list_worker_kpi(date) to authenticated;
grant execute on function public.admin_upsert_worker_kpi(uuid,text,numeric,boolean) to authenticated;
grant execute on function public.admin_set_worker_kpi_override(uuid,date,numeric,text) to authenticated;
grant execute on function public.list_business_calendar(date,date) to authenticated;
grant execute on function public.admin_set_business_calendar(date,boolean,text,text) to authenticated;

do $$ declare t text; begin
  foreach t in array array['work_requests','work_request_items','work_request_scans','work_request_notifications','work_request_change_requests','work_request_documents'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;

select 'SAN WMS V4.0.0 work request, KPI and calendar migration completed' as result;
