import { getSupabaseClient, isDemoMode } from "@/lib/supabase";
import type { ExternalTransferJob } from "@/lib/external-transfer-api";

export interface ExternalTransferBatchItemInput {
  productId: string;
  qty: number;
}

function client() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");
  return supabase;
}

function ensureLiveMode(): void {
  if (isDemoMode()) throw new Error("외부이관 다품목 등록은 LIVE 모드에서만 사용할 수 있습니다.");
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

function mapJob(value: unknown): ExternalTransferJob {
  const row = record(value);
  const items = array(row.items).map((itemValue) => {
    const item = record(itemValue);
    return {
      productId: String(item.product_id ?? item.productId ?? ""),
      requestedQty: Number(item.requested_qty ?? item.requestedQty ?? 0),
      pCodeNo: String(item.p_code_no ?? item.pCodeNo ?? ""),
      codeNo: String(item.code_no ?? item.codeNo ?? ""),
      masterCodeNo: String(item.master_code_no ?? item.masterCodeNo ?? ""),
      artist: String(item.artist ?? ""),
      nameVer: String(item.name_ver ?? item.nameVer ?? ""),
      productBarcode: String(item.product_barcode ?? item.productBarcode ?? ""),
      availableTotal: Number(item.available_total ?? item.availableTotal ?? 0),
      allocatedTotal: Number(item.allocated_total ?? item.allocatedTotal ?? 0),
      locationCount: Number(item.location_count ?? item.locationCount ?? 0),
      allocationRequired: Boolean(item.allocation_required ?? item.allocationRequired),
      locationOptions: array(item.location_options ?? item.locationOptions).map((optionValue) => {
        const option = record(optionValue);
        return {
          locationId: String(option.location_id ?? option.locationId ?? ""),
          locationCode: String(option.location_code ?? option.locationCode ?? ""),
          zone: String(option.zone ?? ""),
          availableQty: Number(option.available_qty ?? option.availableQty ?? 0),
          allocatedQty: Number(option.allocated_qty ?? option.allocatedQty ?? 0),
        };
      }),
    };
  });

  return {
    id: String(row.id ?? ""),
    status: String(row.status ?? "DRAFT") as ExternalTransferJob["status"],
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
    itemCount: Number(row.item_count ?? row.itemCount ?? items.length),
    totalQty: Number(
      row.total_qty
      ?? row.totalQty
      ?? items.reduce((sum, item) => sum + item.requestedQty, 0),
    ),
    createdAt: String(row.created_at ?? row.createdAt ?? ""),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? ""),
    completedAt: optionalString(row.completed_at ?? row.completedAt),
    cancelledAt: optionalString(row.cancelled_at ?? row.cancelledAt),
    cancelReason: optionalString(row.cancel_reason ?? row.cancelReason),
    items,
  };
}

export async function setExternalTransferItemsBatch(
  jobId: string,
  items: ExternalTransferBatchItemInput[],
): Promise<ExternalTransferJob> {
  ensureLiveMode();
  const { data, error } = await client().rpc("set_external_transfer_items_batch", {
    p_job_id: jobId,
    p_items: items.map((item) => ({
      product_id: item.productId,
      qty: Math.max(1, Math.trunc(item.qty)),
    })),
  });
  if (error) throw new Error(error.message);
  return mapJob(data);
}
