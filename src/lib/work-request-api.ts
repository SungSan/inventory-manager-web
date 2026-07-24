import { getSupabaseClient, isDemoMode } from "@/lib/supabase";

export type WorkRequestStatus = "SCHEDULED" | "IN_PROGRESS" | "PARTIAL" | "COMPLETED" | "REJECTED" | "REQUESTER_CANCELLED" | "VOIDED";
export type KpiMetricType = "REQUEST_COUNT" | "SKU_LINES" | "TOTAL_QTY" | "WORKLOAD_POINTS";

export interface WorkRequestItem {
  id: string;
  productId: string;
  pCodeNo: string;
  codeNo: string;
  masterCodeNo: string;
  artist: string;
  nameVer: string;
  productBarcode: string;
  requestedQty: number;
  processedQty: number;
  remainingQty: number;
}

export interface WorkRequestCandidate { userId: string; name: string; role: string; }
export interface WorkRequestScan { id: string; productId: string; locationId: string; locationCode: string; qty: number; scannedBy: string; scannedByName: string; scannedAt: string; }
export interface WorkRequestChange {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  reason: string;
  proposedHeader: Record<string, unknown>;
  proposedItems: Array<{ product_id: string; qty: number }>;
  requestedByName: string;
  requestedAt: string;
  decidedByName?: string;
  decisionNote?: string;
  decidedAt?: string;
}

export interface WorkRequest {
  id: string;
  requestNo: string;
  requesterId: string;
  requesterLoginId: string;
  requesterName: string;
  requestedShipDate: string;
  status: WorkRequestStatus;
  assignedTo?: string;
  assignedName?: string;
  reservedUserId?: string;
  reservedUserName?: string;
  vendorName: string;
  vendorContact: string;
  vendorPhone: string;
  vendorAddress: string;
  purpose: string;
  note: string;
  itemCount: number;
  totalQty: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  rejectedAt?: string;
  rejectReason?: string;
  voidedAt?: string;
  voidReason?: string;
  isRequester: boolean;
  isAssigned: boolean;
  isCandidate: boolean;
  documentId?: string;
  items: WorkRequestItem[];
  candidates: WorkRequestCandidate[];
  scans: WorkRequestScan[];
  changeRequests: WorkRequestChange[];
}

export interface WorkRequestHeaderInput {
  requestedShipDate: string;
  vendorName: string;
  vendorContact?: string;
  vendorPhone?: string;
  vendorAddress?: string;
  purpose?: string;
  note?: string;
}

export interface WorkRequestProductInput { productId: string; qty: number; }

export interface WorkRequestAssignee {
  userId: string;
  userName: string;
  role: string;
  metricType: KpiMetricType;
  dailyCapacity: number;
  usedCapacity: number;
  newRequestLoad: number;
  remainingAfter: number;
  canAccept: boolean;
}

export interface WorkRequestNotification { id: string; workRequestId: string; requestNo: string; type: string; message: string; availableFrom: string; acknowledgedAt?: string; createdAt: string; }
export interface WorkRequestBadge { pending: number; today: number; tomorrow: number; changeApprovals: number; }

export interface WorkRequestDocumentSummary {
  id: string; documentNo: string; workRequestId: string; requestNo: string; shipmentDate: string; vendorName: string; purpose: string;
  requesterName: string; workerName: string; totalSku: number; totalQty: number; createdAt: string;
}
export interface WorkRequestDocumentAllocation { locationId?: string; locationCode: string; qty: number; }
export interface WorkRequestDocumentItem { lineNo: number; productId?: string; pCodeNo: string; codeNo: string; masterCodeNo: string; artist: string; nameVer: string; productBarcode: string; qty: number; allocations: WorkRequestDocumentAllocation[]; }
export interface WorkRequestDocument extends WorkRequestDocumentSummary {
  vendorContact: string; vendorPhone: string; vendorAddress: string; note: string; requesterLoginId: string; items: WorkRequestDocumentItem[];
}

export interface WorkerKpiStatus {
  userId: string; userName: string; role: string; metricType: KpiMetricType; dailyCapacity: number; usedCapacity: number; remainingCapacity: number; overrideCapacity?: number;
}
export interface BusinessCalendarEntry { businessDate: string; isWorkingDay: boolean; holidayName: string; source: string; note: string; }

function client() { const supabase = getSupabaseClient(); if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요."); return supabase; }
function ensureLive() { if (isDemoMode()) throw new Error("업무요청 기능은 LIVE 모드에서만 사용할 수 있습니다."); }
function rec(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function arr(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function txt(value: unknown): string { return value == null ? "" : String(value); }
function opt(value: unknown): string | undefined { const result = txt(value); return result || undefined; }

function mapItem(value: unknown): WorkRequestItem {
  const row = rec(value);
  return { id: txt(row.id), productId: txt(row.product_id), pCodeNo: txt(row.p_code_no), codeNo: txt(row.code_no), masterCodeNo: txt(row.master_code_no), artist: txt(row.artist), nameVer: txt(row.name_ver), productBarcode: txt(row.product_barcode), requestedQty: Number(row.requested_qty ?? 0), processedQty: Number(row.processed_qty ?? 0), remainingQty: Number(row.remaining_qty ?? 0) };
}
function mapChange(value: unknown): WorkRequestChange {
  const row = rec(value);
  return { id: txt(row.id), status: txt(row.status || "PENDING") as WorkRequestChange["status"], reason: txt(row.reason), proposedHeader: rec(row.proposed_header), proposedItems: arr(row.proposed_items).map((item) => ({ product_id: txt(rec(item).product_id), qty: Number(rec(item).qty ?? 0) })), requestedByName: txt(row.requested_by_name), requestedAt: txt(row.requested_at), decidedByName: opt(row.decided_by_name), decisionNote: opt(row.decision_note), decidedAt: opt(row.decided_at) };
}
function mapRequest(value: unknown): WorkRequest {
  const row = rec(value);
  return {
    id: txt(row.id), requestNo: txt(row.request_no), requesterId: txt(row.requester_id), requesterLoginId: txt(row.requester_login_id), requesterName: txt(row.requester_name), requestedShipDate: txt(row.requested_ship_date), status: txt(row.status || "SCHEDULED") as WorkRequestStatus,
    assignedTo: opt(row.assigned_to), assignedName: opt(row.assigned_name), reservedUserId: opt(row.reserved_user_id), reservedUserName: opt(row.reserved_user_name), vendorName: txt(row.vendor_name), vendorContact: txt(row.vendor_contact), vendorPhone: txt(row.vendor_phone), vendorAddress: txt(row.vendor_address), purpose: txt(row.purpose), note: txt(row.note), itemCount: Number(row.item_count ?? 0), totalQty: Number(row.total_qty ?? 0), createdAt: txt(row.created_at), updatedAt: txt(row.updated_at), startedAt: opt(row.started_at), completedAt: opt(row.completed_at), cancelledAt: opt(row.cancelled_at), cancelReason: opt(row.cancel_reason), rejectedAt: opt(row.rejected_at), rejectReason: opt(row.reject_reason), voidedAt: opt(row.voided_at), voidReason: opt(row.void_reason), isRequester: Boolean(row.is_requester), isAssigned: Boolean(row.is_assigned), isCandidate: Boolean(row.is_candidate), documentId: opt(row.document_id),
    items: arr(row.items).map(mapItem), candidates: arr(row.candidates).map((item) => { const r=rec(item); return { userId:txt(r.user_id),name:txt(r.name),role:txt(r.role) }; }), scans: arr(row.scans).map((item) => { const r=rec(item); return { id:txt(r.id),productId:txt(r.product_id),locationId:txt(r.location_id),locationCode:txt(r.location_code),qty:Number(r.qty??0),scannedBy:txt(r.scanned_by),scannedByName:txt(r.scanned_by_name),scannedAt:txt(r.scanned_at) }; }), changeRequests: arr(row.change_requests).map(mapChange),
  };
}

function requestArgs(header: WorkRequestHeaderInput, candidateUserIds: string[], items: WorkRequestProductInput[]) {
  return { p_requested_ship_date: header.requestedShipDate, p_vendor_name: header.vendorName, p_vendor_contact: header.vendorContact ?? "", p_vendor_phone: header.vendorPhone ?? "", p_vendor_address: header.vendorAddress ?? "", p_purpose: header.purpose ?? "", p_note: header.note ?? "", p_candidate_user_ids: candidateUserIds, p_items: items.map((item) => ({ product_id:item.productId, qty:Math.max(1,Math.trunc(item.qty)) })) };
}

export async function listWorkRequestAssignees(shipDate: string, itemCount = 0, totalQty = 0): Promise<WorkRequestAssignee[]> {
  ensureLive(); const {data,error}=await client().rpc("list_work_request_assignees",{p_ship_date:shipDate,p_item_count:itemCount,p_total_qty:totalQty}); if(error)throw new Error(error.message);
  return arr(data).map((value)=>{const r=rec(value);return{userId:txt(r.user_id),userName:txt(r.user_name),role:txt(r.role),metricType:txt(r.metric_type) as KpiMetricType,dailyCapacity:Number(r.daily_capacity??0),usedCapacity:Number(r.used_capacity??0),newRequestLoad:Number(r.new_request_load??0),remainingAfter:Number(r.remaining_after??0),canAccept:Boolean(r.can_accept)};});
}
export async function createWorkRequest(header:WorkRequestHeaderInput,candidateUserIds:string[],items:WorkRequestProductInput[]):Promise<WorkRequest>{ensureLive();const{data,error}=await client().rpc("create_work_request",requestArgs(header,candidateUserIds,items));if(error)throw new Error(error.message);return mapRequest(data);}
export async function listWorkRequests(scope:"ALL"|"OWN"|"WORK"="ALL",includeClosed=false):Promise<WorkRequest[]>{ensureLive();const{data,error}=await client().rpc("list_work_requests",{p_scope:scope,p_include_closed:includeClosed});if(error)throw new Error(error.message);return arr(data).map(mapRequest);}
export async function getWorkRequest(id:string):Promise<WorkRequest>{ensureLive();const{data,error}=await client().rpc("get_work_request",{p_request_id:id});if(error)throw new Error(error.message);return mapRequest(data);}
export async function updateWorkRequestBeforeStart(id:string,header:WorkRequestHeaderInput,candidateUserIds:string[],items:WorkRequestProductInput[]):Promise<WorkRequest>{const{data,error}=await client().rpc("update_work_request_before_start",{p_request_id:id,...requestArgs(header,candidateUserIds,items)});if(error)throw new Error(error.message);return mapRequest(data);}
export async function cancelWorkRequest(id:string,reason:string):Promise<WorkRequest>{const{data,error}=await client().rpc("cancel_work_request_by_requester",{p_request_id:id,p_reason:reason});if(error)throw new Error(error.message);return mapRequest(data);}
export async function startWorkRequest(id:string):Promise<WorkRequest>{const{data,error}=await client().rpc("start_work_request",{p_request_id:id});if(error)throw new Error(error.message);return mapRequest(data);}
export async function reassignWorkRequest(id:string,targetUserId:string,reason=""):Promise<WorkRequest>{const{data,error}=await client().rpc("reassign_work_request",{p_request_id:id,p_target_user_id:targetUserId,p_reason:reason});if(error)throw new Error(error.message);return mapRequest(data);}
export async function submitWorkRequestChange(id:string,header:WorkRequestHeaderInput,items:WorkRequestProductInput[],reason=""):Promise<WorkRequest>{const{data,error}=await client().rpc("submit_work_request_change",{p_request_id:id,p_proposed_header:{requested_ship_date:header.requestedShipDate,vendor_name:header.vendorName,vendor_contact:header.vendorContact??"",vendor_phone:header.vendorPhone??"",vendor_address:header.vendorAddress??"",purpose:header.purpose??"",note:header.note??""},p_proposed_items:items.map((item)=>({product_id:item.productId,qty:item.qty})),p_reason:reason});if(error)throw new Error(error.message);return mapRequest(data);}
export async function approveWorkRequestChange(changeId:string,note=""):Promise<WorkRequest>{const{data,error}=await client().rpc("approve_work_request_change",{p_change_request_id:changeId,p_note:note});if(error)throw new Error(error.message);return mapRequest(data);}
export async function rejectWorkRequestChange(changeId:string,note=""):Promise<WorkRequest>{const{data,error}=await client().rpc("reject_work_request_change",{p_change_request_id:changeId,p_note:note});if(error)throw new Error(error.message);return mapRequest(data);}
export async function scanWorkRequestItem(input:{requestId:string;productBarcode:string;locationBarcode:string;qty:number;productId?:string;locationId?:string;idempotencyKey:string}):Promise<WorkRequest>{const{data,error}=await client().rpc("scan_work_request_item",{p_request_id:input.requestId,p_product_barcode:input.productBarcode,p_location_barcode:input.locationBarcode,p_qty:Math.max(1,Math.trunc(input.qty)),p_idempotency_key:input.idempotencyKey,p_product_id:input.productId??null,p_location_id:input.locationId??null});if(error)throw new Error(error.message);return mapRequest(data);}
export async function adminVoidWorkRequest(id:string,reason:string):Promise<WorkRequest>{const{data,error}=await client().rpc("admin_void_work_request",{p_request_id:id,p_reason:reason});if(error)throw new Error(error.message);return mapRequest(data);}

export async function listMyWorkRequestNotifications():Promise<WorkRequestNotification[]>{if(isDemoMode())return[];const{data,error}=await client().rpc("list_my_work_request_notifications");if(error)throw new Error(error.message);return arr(data).map((value)=>{const r=rec(value);return{id:txt(r.id),workRequestId:txt(r.work_request_id),requestNo:txt(r.request_no),type:txt(r.type),message:txt(r.message),availableFrom:txt(r.available_from),acknowledgedAt:opt(r.acknowledged_at),createdAt:txt(r.created_at)};});}
export async function acknowledgeWorkRequestNotification(id:string):Promise<void>{const{error}=await client().rpc("acknowledge_work_request_notification",{p_notification_id:id});if(error)throw new Error(error.message);}
export async function getWorkRequestBadge():Promise<WorkRequestBadge>{if(isDemoMode())return{pending:0,today:0,tomorrow:0,changeApprovals:0};const{data,error}=await client().rpc("get_work_request_badge");if(error)throw new Error(error.message);const r=rec(data);return{pending:Number(r.pending??0),today:Number(r.today??0),tomorrow:Number(r.tomorrow??0),changeApprovals:Number(r.change_approvals??0)};}

export async function listWorkRequestDocuments(search="",dateFrom="",dateTo=""):Promise<WorkRequestDocumentSummary[]>{const{data,error}=await client().rpc("list_work_request_documents",{p_search:search,p_date_from:dateFrom||null,p_date_to:dateTo||null});if(error)throw new Error(error.message);return arr(data).map((value)=>{const r=rec(value);return{id:txt(r.id),documentNo:txt(r.document_no),workRequestId:txt(r.work_request_id),requestNo:txt(r.request_no),shipmentDate:txt(r.shipment_date),vendorName:txt(r.vendor_name),purpose:txt(r.purpose),requesterName:txt(r.requester_name),workerName:txt(r.worker_name),totalSku:Number(r.total_sku??0),totalQty:Number(r.total_qty??0),createdAt:txt(r.created_at)};});}
export async function getWorkRequestDocument(id:string):Promise<WorkRequestDocument>{const{data,error}=await client().rpc("get_work_request_document",{p_document_id:id});if(error)throw new Error(error.message);const r=rec(data);return{id:txt(r.id),documentNo:txt(r.document_no),workRequestId:txt(r.work_request_id),requestNo:txt(r.request_no),shipmentDate:txt(r.shipment_date),vendorName:txt(r.vendor_name),vendorContact:txt(r.vendor_contact),vendorPhone:txt(r.vendor_phone),vendorAddress:txt(r.vendor_address),purpose:txt(r.purpose),note:txt(r.note),requesterLoginId:txt(r.requester_login_id),requesterName:txt(r.requester_name),workerName:txt(r.worker_name),totalSku:Number(r.total_sku??0),totalQty:Number(r.total_qty??0),createdAt:txt(r.created_at),items:arr(r.items).map((value)=>{const i=rec(value);return{lineNo:Number(i.line_no??0),productId:opt(i.product_id),pCodeNo:txt(i.p_code_no),codeNo:txt(i.code_no),masterCodeNo:txt(i.master_code_no),artist:txt(i.artist),nameVer:txt(i.name_ver),productBarcode:txt(i.product_barcode),qty:Number(i.qty??0),allocations:arr(i.allocations).map((value2)=>{const a=rec(value2);return{locationId:opt(a.location_id),locationCode:txt(a.location_code),qty:Number(a.qty??0)};})};})};}

export async function adminListWorkerKpi(date:string):Promise<WorkerKpiStatus[]>{const{data,error}=await client().rpc("admin_list_worker_kpi",{p_work_date:date});if(error)throw new Error(error.message);return arr(data).map((value)=>{const r=rec(value);return{userId:txt(r.user_id),userName:txt(r.user_name),role:txt(r.role),metricType:txt(r.metric_type) as KpiMetricType,dailyCapacity:Number(r.daily_capacity??0),usedCapacity:Number(r.used_capacity??0),remainingCapacity:Number(r.remaining_capacity??0),overrideCapacity:r.override_capacity==null?undefined:Number(r.override_capacity)};});}
export async function adminUpsertWorkerKpi(userId:string,metricType:KpiMetricType,dailyCapacity:number,active=true):Promise<void>{const{error}=await client().rpc("admin_upsert_worker_kpi",{p_user_id:userId,p_metric_type:metricType,p_daily_capacity:dailyCapacity,p_active:active});if(error)throw new Error(error.message);}
export async function adminSetWorkerKpiOverride(userId:string,date:string,dailyCapacity:number,reason=""):Promise<void>{const{error}=await client().rpc("admin_set_worker_kpi_override",{p_user_id:userId,p_work_date:date,p_daily_capacity:dailyCapacity,p_reason:reason});if(error)throw new Error(error.message);}
export async function listBusinessCalendar(dateFrom:string,dateTo:string):Promise<BusinessCalendarEntry[]>{const{data,error}=await client().rpc("list_business_calendar",{p_date_from:dateFrom,p_date_to:dateTo});if(error)throw new Error(error.message);return arr(data).map((value)=>{const r=rec(value);return{businessDate:txt(r.business_date),isWorkingDay:Boolean(r.is_working_day),holidayName:txt(r.holiday_name),source:txt(r.source),note:txt(r.note)};});}
export async function adminSetBusinessCalendar(date:string,isWorkingDay:boolean,holidayName="",note=""):Promise<void>{const{error}=await client().rpc("admin_set_business_calendar",{p_business_date:date,p_is_working_day:isWorkingDay,p_holiday_name:holidayName,p_note:note});if(error)throw new Error(error.message);}
