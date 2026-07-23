import { getSupabaseClient, isDemoMode } from "@/lib/supabase";

export type ExternalTransferStatus = "DRAFT" | "ALLOCATING" | "COMPLETED" | "CANCELLED";

export interface ExternalLocationOption {
  locationId: string;
  locationCode: string;
  zone: string;
  availableQty: number;
  allocatedQty: number;
}

export interface ExternalTransferItem {
  productId: string;
  requestedQty: number;
  pCodeNo: string;
  codeNo: string;
  masterCodeNo: string;
  artist: string;
  nameVer: string;
  productBarcode: string;
  availableTotal: number;
  allocatedTotal: number;
  locationCount: number;
  allocationRequired: boolean;
  locationOptions: ExternalLocationOption[];
}

export interface ExternalTransferJob {
  id: string;
  status: ExternalTransferStatus;
  vendorName: string;
  vendorContact: string;
  vendorPhone: string;
  vendorAddress: string;
  purpose: string;
  note: string;
  createdBy?: string;
  assignedTo: string;
  assignedToLabel: string;
  documentId?: string;
  itemCount: number;
  totalQty: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  items?: ExternalTransferItem[];
}

export interface ExternalShipmentAllocation {
  locationId?: string;
  locationCode: string;
  qty: number;
}

export interface ExternalShipmentItem {
  lineNo: number;
  productId?: string;
  pCodeNo: string;
  codeNo: string;
  masterCodeNo: string;
  artist: string;
  nameVer: string;
  productBarcode: string;
  qty: number;
  note: string;
  allocations: ExternalShipmentAllocation[];
}

export interface ExternalShipmentDocument {
  id: string;
  documentNo: string;
  shipmentDate: string;
  vendorName: string;
  vendorContact: string;
  vendorPhone: string;
  vendorAddress: string;
  purpose: string;
  note: string;
  createdBy?: string;
  createdByLabel: string;
  sourceJobId: string;
  totalSku: number;
  totalQty: number;
  createdAt: string;
  items?: ExternalShipmentItem[];
}

export interface ExternalTransferHeaderInput {
  vendorName: string;
  vendorContact?: string;
  vendorPhone?: string;
  vendorAddress?: string;
  purpose?: string;
  note?: string;
}

export interface ExternalAllocationInput {
  productId: string;
  locationId: string;
  qty: number;
}

function client() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");
  return supabase;
}

function ensureLiveMode(): void {
  if (isDemoMode()) throw new Error("외부업체 이관은 LIVE 모드에서만 사용할 수 있습니다.");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionalString(value: unknown): string | undefined {
  return value === undefined || value === null || value === "" ? undefined : String(value);
}

function mapLocationOption(value: unknown): ExternalLocationOption {
  const row = record(value);
  return {
    locationId: String(row.location_id ?? row.locationId ?? ""),
    locationCode: String(row.location_code ?? row.locationCode ?? ""),
    zone: String(row.zone ?? ""),
    availableQty: Number(row.available_qty ?? row.availableQty ?? 0),
    allocatedQty: Number(row.allocated_qty ?? row.allocatedQty ?? 0),
  };
}

function mapExternalItem(value: unknown): ExternalTransferItem {
  const row = record(value);
  return {
    productId: String(row.product_id ?? row.productId ?? ""),
    requestedQty: Number(row.requested_qty ?? row.requestedQty ?? 0),
    pCodeNo: String(row.p_code_no ?? row.pCodeNo ?? ""),
    codeNo: String(row.code_no ?? row.codeNo ?? ""),
    masterCodeNo: String(row.master_code_no ?? row.masterCodeNo ?? ""),
    artist: String(row.artist ?? ""),
    nameVer: String(row.name_ver ?? row.nameVer ?? ""),
    productBarcode: String(row.product_barcode ?? row.productBarcode ?? ""),
    availableTotal: Number(row.available_total ?? row.availableTotal ?? 0),
    allocatedTotal: Number(row.allocated_total ?? row.allocatedTotal ?? 0),
    locationCount: Number(row.location_count ?? row.locationCount ?? 0),
    allocationRequired: Boolean(row.allocation_required ?? row.allocationRequired),
    locationOptions: array(row.location_options ?? row.locationOptions).map(mapLocationOption),
  };
}

function mapExternalJob(value: unknown): ExternalTransferJob {
  const row = record(value);
  const items = array(row.items).map(mapExternalItem);
  const itemCount = Number(row.item_count ?? row.itemCount ?? items.length);
  const totalQty = Number(
    row.total_qty
    ?? row.totalQty
    ?? items.reduce((sum, item) => sum + item.requestedQty, 0),
  );
  return {
    id: String(row.id ?? ""),
    status: String(row.status ?? "DRAFT") as ExternalTransferStatus,
    vendorName: String(row.vendor_name ?? row.vendorName ?? ""),
    vendorContact: String(row.vendor_contact ?? row.vendorContact ?? ""),
    vendorPhone: String(row.vendor_phone ?? row.vendorPhone ?? ""),
    vendorAddress: String(row.vendor_address ?? row.vendorAddress ?? ""),
    purpose: String(row.purpose ?? ""),
    note: String(row.note ?? ""),
    createdBy: optionalString(row.created_by ?? row.createdBy),
    assignedTo: String(row.assigned_to ?? row.assignedTo ?? ""),
    assignedToLabel: String(row.assigned_to_label ?? row.assignedToLabel ?? "사용자"),
    documentId: optionalString(row.document_id ?? row.documentId),
    itemCount,
    totalQty,
    createdAt: String(row.created_at ?? row.createdAt ?? ""),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? ""),
    completedAt: optionalString(row.completed_at ?? row.completedAt),
    cancelledAt: optionalString(row.cancelled_at ?? row.cancelledAt),
    cancelReason: optionalString(row.cancel_reason ?? row.cancelReason),
    items,
  };
}

function mapShipmentAllocation(value: unknown): ExternalShipmentAllocation {
  const row = record(value);
  return {
    locationId: optionalString(row.location_id ?? row.locationId),
    locationCode: String(row.location_code ?? row.locationCode ?? ""),
    qty: Number(row.qty ?? 0),
  };
}

function mapShipmentItem(value: unknown): ExternalShipmentItem {
  const row = record(value);
  return {
    lineNo: Number(row.line_no ?? row.lineNo ?? 0),
    productId: optionalString(row.product_id ?? row.productId),
    pCodeNo: String(row.p_code_no ?? row.pCodeNo ?? ""),
    codeNo: String(row.code_no ?? row.codeNo ?? ""),
    masterCodeNo: String(row.master_code_no ?? row.masterCodeNo ?? ""),
    artist: String(row.artist ?? ""),
    nameVer: String(row.name_ver ?? row.nameVer ?? ""),
    productBarcode: String(row.product_barcode ?? row.productBarcode ?? ""),
    qty: Number(row.qty ?? 0),
    note: String(row.note ?? ""),
    allocations: array(row.allocations).map(mapShipmentAllocation),
  };
}

function mapShipmentDocument(value: unknown): ExternalShipmentDocument {
  const row = record(value);
  return {
    id: String(row.id ?? ""),
    documentNo: String(row.document_no ?? row.documentNo ?? ""),
    shipmentDate: String(row.shipment_date ?? row.shipmentDate ?? ""),
    vendorName: String(row.vendor_name ?? row.vendorName ?? ""),
    vendorContact: String(row.vendor_contact ?? row.vendorContact ?? ""),
    vendorPhone: String(row.vendor_phone ?? row.vendorPhone ?? ""),
    vendorAddress: String(row.vendor_address ?? row.vendorAddress ?? ""),
    purpose: String(row.purpose ?? ""),
    note: String(row.note ?? ""),
    createdBy: optionalString(row.created_by ?? row.createdBy),
    createdByLabel: String(row.created_by_label ?? row.createdByLabel ?? "사용자"),
    sourceJobId: String(row.source_job_id ?? row.sourceJobId ?? ""),
    totalSku: Number(row.total_sku ?? row.totalSku ?? 0),
    totalQty: Number(row.total_qty ?? row.totalQty ?? 0),
    createdAt: String(row.created_at ?? row.createdAt ?? ""),
    items: array(row.items).map(mapShipmentItem),
  };
}

export async function listExternalTransferJobs(includeClosed = false): Promise<ExternalTransferJob[]> {
  ensureLiveMode();
  const { data, error } = await client().rpc("list_external_transfer_jobs", {
    p_include_closed: includeClosed,
  });
  if (error) throw new Error(error.message);
  return array(data).map(mapExternalJob);
}

export async function createExternalTransferJob(
  input: ExternalTransferHeaderInput,
): Promise<ExternalTransferJob> {
  ensureLiveMode();
  const { data, error } = await client().rpc("create_external_transfer_job", {
    p_vendor_name: input.vendorName,
    p_vendor_contact: input.vendorContact ?? "",
    p_vendor_phone: input.vendorPhone ?? "",
    p_vendor_address: input.vendorAddress ?? "",
    p_purpose: input.purpose ?? "",
    p_note: input.note ?? "",
  });
  if (error) throw new Error(error.message);
  return mapExternalJob(data);
}

export async function getExternalTransferJob(jobId: string): Promise<ExternalTransferJob> {
  ensureLiveMode();
  const { data, error } = await client().rpc("get_external_transfer_job", { p_job_id: jobId });
  if (error) throw new Error(error.message);
  return mapExternalJob(data);
}

export async function updateExternalTransferHeader(
  jobId: string,
  input: ExternalTransferHeaderInput,
): Promise<ExternalTransferJob> {
  ensureLiveMode();
  const { data, error } = await client().rpc("update_external_transfer_header", {
    p_job_id: jobId,
    p_vendor_name: input.vendorName,
    p_vendor_contact: input.vendorContact ?? "",
    p_vendor_phone: input.vendorPhone ?? "",
    p_vendor_address: input.vendorAddress ?? "",
    p_purpose: input.purpose ?? "",
    p_note: input.note ?? "",
  });
  if (error) throw new Error(error.message);
  return mapExternalJob(data);
}

export async function incrementExternalTransferItem(
  jobId: string,
  productId: string,
  increment = 1,
): Promise<ExternalTransferJob> {
  ensureLiveMode();
  const { data, error } = await client().rpc("increment_external_transfer_item", {
    p_job_id: jobId,
    p_product_id: productId,
    p_increment: increment,
  });
  if (error) throw new Error(error.message);
  return mapExternalJob(data);
}

export async function setExternalTransferItemQty(
  jobId: string,
  productId: string,
  qty: number,
): Promise<ExternalTransferJob> {
  ensureLiveMode();
  const { data, error } = await client().rpc("set_external_transfer_item_qty", {
    p_job_id: jobId,
    p_product_id: productId,
    p_qty: Math.max(1, Math.trunc(qty)),
  });
  if (error) throw new Error(error.message);
  return mapExternalJob(data);
}

export async function removeExternalTransferItem(
  jobId: string,
  productId: string,
): Promise<ExternalTransferJob> {
  ensureLiveMode();
  const { data, error } = await client().rpc("remove_external_transfer_item", {
    p_job_id: jobId,
    p_product_id: productId,
  });
  if (error) throw new Error(error.message);
  return mapExternalJob(data);
}

export async function prepareExternalTransferAllocations(
  jobId: string,
): Promise<ExternalTransferJob> {
  ensureLiveMode();
  const { data, error } = await client().rpc("prepare_external_transfer_allocations", {
    p_job_id: jobId,
  });
  if (error) throw new Error(error.message);
  return mapExternalJob(data);
}

export async function saveExternalTransferAllocations(
  jobId: string,
  allocations: ExternalAllocationInput[],
): Promise<ExternalTransferJob> {
  ensureLiveMode();
  const { data, error } = await client().rpc("save_external_transfer_allocations", {
    p_job_id: jobId,
    p_allocations: allocations.map((item) => ({
      product_id: item.productId,
      location_id: item.locationId,
      qty: Math.max(0, Math.trunc(item.qty)),
    })),
  });
  if (error) throw new Error(error.message);
  return mapExternalJob(data);
}

export async function completeExternalTransferJob(
  jobId: string,
): Promise<ExternalShipmentDocument> {
  ensureLiveMode();
  const { data, error } = await client().rpc("complete_external_transfer_job", {
    p_job_id: jobId,
  });
  if (error) throw new Error(error.message);
  return mapShipmentDocument(data);
}

export async function cancelExternalTransferJob(
  jobId: string,
  reason: string,
): Promise<ExternalTransferJob> {
  ensureLiveMode();
  const { data, error } = await client().rpc("cancel_external_transfer_job", {
    p_job_id: jobId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return mapExternalJob(data);
}

export async function listExternalShipmentDocuments(
  search = "",
  dateFrom = "",
  dateTo = "",
): Promise<ExternalShipmentDocument[]> {
  ensureLiveMode();
  const { data, error } = await client().rpc("list_external_shipment_documents", {
    p_search: search,
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null,
    p_limit: 500,
  });
  if (error) throw new Error(error.message);
  return array(data).map(mapShipmentDocument);
}

export async function getExternalShipmentDocument(
  documentId: string,
): Promise<ExternalShipmentDocument> {
  ensureLiveMode();
  const { data, error } = await client().rpc("get_external_shipment_document", {
    p_document_id: documentId,
  });
  if (error) throw new Error(error.message);
  return mapShipmentDocument(data);
}
