import { getSupabaseClient, isDemoMode } from "@/lib/supabase";

export type ShipmentDocumentSourceType = "WORK_REQUEST" | "EXTERNAL_TRANSFER";
export type ShipmentDocumentCompletionType = "NORMAL" | "ADMIN_FORCE";

export interface ShipmentDocumentSummary {
  id: string;
  documentNo: string;
  sourceType: ShipmentDocumentSourceType;
  sourceLabel: string;
  sourceEntityId: string;
  sourceReferenceNo: string;
  shipmentDate: string;
  vendorName: string;
  purpose: string;
  createdByLabel: string;
  workerName: string;
  totalSku: number;
  totalQty: number;
  requestedTotalQty: number;
  unfulfilledTotalQty: number;
  completionType: ShipmentDocumentCompletionType;
  createdAt: string;
}

export interface ShipmentDocumentAllocation {
  locationId?: string;
  locationCode: string;
  qty: number;
}

export interface ShipmentDocumentItem {
  lineNo: number;
  productId?: string;
  pCodeNo: string;
  codeNo: string;
  masterCodeNo: string;
  artist: string;
  nameVer: string;
  productBarcode: string;
  requestedQty: number;
  qty: number;
  unfulfilledQty: number;
  note: string;
  allocations: ShipmentDocumentAllocation[];
}

export interface ShipmentDocument extends ShipmentDocumentSummary {
  vendorContact: string;
  vendorPhone: string;
  vendorAddress: string;
  note: string;
  writerName: string;
  shipmentManagerName: string;
  forceCompleteReason?: string;
  forceCompletedByName?: string;
  items: ShipmentDocumentItem[];
}

function client() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");
  return supabase;
}

function ensureLive(): void {
  if (isDemoMode()) throw new Error("통합 출고명세서는 LIVE 모드에서만 사용할 수 있습니다.");
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function txt(value: unknown): string {
  return value == null ? "" : String(value);
}

function opt(value: unknown): string | undefined {
  const result = txt(value);
  return result || undefined;
}

function mapAllocation(value: unknown): ShipmentDocumentAllocation {
  const row = rec(value);
  return {
    locationId: opt(row.location_id ?? row.locationId),
    locationCode: txt(row.location_code ?? row.locationCode),
    qty: Number(row.qty ?? 0),
  };
}

function mapItem(value: unknown): ShipmentDocumentItem {
  const row = rec(value);
  const qty = Number(row.qty ?? 0);
  return {
    lineNo: Number(row.line_no ?? row.lineNo ?? 0),
    productId: opt(row.product_id ?? row.productId),
    pCodeNo: txt(row.p_code_no ?? row.pCodeNo),
    codeNo: txt(row.code_no ?? row.codeNo),
    masterCodeNo: txt(row.master_code_no ?? row.masterCodeNo),
    artist: txt(row.artist),
    nameVer: txt(row.name_ver ?? row.nameVer),
    productBarcode: txt(row.product_barcode ?? row.productBarcode),
    requestedQty: Number(row.requested_qty ?? row.requestedQty ?? qty),
    qty,
    unfulfilledQty: Number(row.unfulfilled_qty ?? row.unfulfilledQty ?? 0),
    note: txt(row.note),
    allocations: arr(row.allocations).map(mapAllocation),
  };
}

function mapSummary(value: unknown): ShipmentDocumentSummary {
  const row = rec(value);
  const totalQty = Number(row.total_qty ?? row.totalQty ?? 0);
  return {
    id: txt(row.id),
    documentNo: txt(row.document_no ?? row.documentNo),
    sourceType: txt(row.source_type ?? row.sourceType) as ShipmentDocumentSourceType,
    sourceLabel: txt(row.source_label ?? row.sourceLabel),
    sourceEntityId: txt(row.source_entity_id ?? row.sourceEntityId),
    sourceReferenceNo: txt(row.source_reference_no ?? row.sourceReferenceNo),
    shipmentDate: txt(row.shipment_date ?? row.shipmentDate),
    vendorName: txt(row.vendor_name ?? row.vendorName),
    purpose: txt(row.purpose),
    createdByLabel: txt(row.created_by_label ?? row.createdByLabel),
    workerName: txt(row.worker_name ?? row.workerName),
    totalSku: Number(row.total_sku ?? row.totalSku ?? 0),
    totalQty,
    requestedTotalQty: Number(row.requested_total_qty ?? row.requestedTotalQty ?? totalQty),
    unfulfilledTotalQty: Number(row.unfulfilled_total_qty ?? row.unfulfilledTotalQty ?? 0),
    completionType: txt(row.completion_type ?? row.completionType ?? "NORMAL") as ShipmentDocumentCompletionType,
    createdAt: txt(row.created_at ?? row.createdAt),
  };
}

function mapDocument(value: unknown): ShipmentDocument {
  const row = rec(value);
  return {
    ...mapSummary(row),
    vendorContact: txt(row.vendor_contact ?? row.vendorContact),
    vendorPhone: txt(row.vendor_phone ?? row.vendorPhone),
    vendorAddress: txt(row.vendor_address ?? row.vendorAddress),
    note: txt(row.note),
    writerName: txt(row.writer_name ?? row.writerName),
    shipmentManagerName: txt(row.shipment_manager_name ?? row.shipmentManagerName),
    forceCompleteReason: opt(row.force_complete_reason ?? row.forceCompleteReason),
    forceCompletedByName: opt(row.force_completed_by_name ?? row.forceCompletedByName),
    items: arr(row.items).map(mapItem),
  };
}

export async function listShipmentDocuments(
  sourceType: "ALL" | ShipmentDocumentSourceType = "ALL",
  search = "",
  dateFrom = "",
  dateTo = "",
): Promise<ShipmentDocumentSummary[]> {
  ensureLive();
  const { data, error } = await client().rpc("list_shipment_documents", {
    p_source_type: sourceType,
    p_search: search,
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null,
    p_limit: 1000,
  });
  if (error) throw new Error(error.message);
  return arr(data).map(mapSummary);
}

export async function getShipmentDocument(documentId: string): Promise<ShipmentDocument> {
  ensureLive();
  const { data, error } = await client().rpc("get_shipment_document", {
    p_document_id: documentId,
  });
  if (error) throw new Error(error.message);
  return mapDocument(data);
}

export async function updateShipmentDocumentPersonnel(
  documentId: string,
  writerName: string,
  shipmentManagerName: string,
): Promise<{ writerName: string; shipmentManagerName: string }> {
  ensureLive();
  const { data, error } = await client().rpc("update_shipment_document_personnel", {
    p_document_id: documentId,
    p_writer_name: writerName.trim(),
    p_shipment_manager_name: shipmentManagerName.trim(),
  });
  if (error) throw new Error(error.message);
  const row = rec(data);
  return {
    writerName: txt(row.writer_name ?? row.writerName),
    shipmentManagerName: txt(row.shipment_manager_name ?? row.shipmentManagerName),
  };
}
