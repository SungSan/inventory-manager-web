import { getSupabaseClient, isDemoMode } from "@/lib/supabase";
import type {
  TransferItemInput,
  TransferJob,
  TransferJobDetail,
  TransferJobItem,
  TransferJobStatus,
} from "@/types/domain";

function client() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");
  return supabase;
}

function ensureLiveMode(): void {
  if (isDemoMode()) {
    throw new Error("재고 이관은 LIVE 모드에서만 사용할 수 있습니다.");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

function mapTransferItem(value: unknown): TransferJobItem {
  const row = asRecord(value);
  return {
    productId: String(row.product_id ?? row.productId ?? ""),
    requestedQty: Number(row.requested_qty ?? row.requestedQty ?? 0),
    sourceQtySnapshot: Number(row.source_qty_snapshot ?? row.sourceQtySnapshot ?? 0),
    pCodeNo: String(row.p_code_no ?? row.pCodeNo ?? ""),
    codeNo: String(row.code_no ?? row.codeNo ?? ""),
    masterCodeNo: String(row.master_code_no ?? row.masterCodeNo ?? ""),
    artist: String(row.artist ?? ""),
    nameVer: String(row.name_ver ?? row.nameVer ?? ""),
  };
}

function mapTransferJob(value: unknown): TransferJob {
  const row = asRecord(value);
  return {
    id: String(row.id ?? ""),
    status: String(row.status ?? "DRAFT") as TransferJobStatus,
    sourceLocationId: String(row.source_location_id ?? row.sourceLocationId ?? ""),
    sourceLocationCode: String(row.source_location_code ?? row.sourceLocationCode ?? ""),
    sourceZone: optionalString(row.source_zone ?? row.sourceZone),
    destinationLocationId: optionalString(row.destination_location_id ?? row.destinationLocationId),
    destinationLocationCode: optionalString(row.destination_location_code ?? row.destinationLocationCode),
    destinationZone: optionalString(row.destination_zone ?? row.destinationZone),
    createdBy: optionalString(row.created_by ?? row.createdBy),
    assignedTo: String(row.assigned_to ?? row.assignedTo ?? ""),
    assignedToLabel: String(row.assigned_to_label ?? row.assignedToLabel ?? "사용자"),
    itemCount: Number(row.item_count ?? row.itemCount ?? 0),
    totalQty: Number(row.total_qty ?? row.totalQty ?? 0),
    note: optionalString(row.note),
    cancelReason: optionalString(row.cancel_reason ?? row.cancelReason),
    createdAt: String(row.created_at ?? row.createdAt ?? ""),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? ""),
    completedAt: optionalString(row.completed_at ?? row.completedAt),
    cancelledAt: optionalString(row.cancelled_at ?? row.cancelledAt),
  };
}

function mapTransferJobDetail(value: unknown): TransferJobDetail {
  const row = asRecord(value);
  const base = mapTransferJob(row);
  const items = asArray(row.items).map(mapTransferItem);
  return {
    ...base,
    itemCount: items.length,
    totalQty: items.reduce((sum, item) => sum + item.requestedQty, 0),
    items,
  };
}

export async function listTransferJobs(includeClosed = false): Promise<TransferJob[]> {
  ensureLiveMode();
  const { data, error } = await client().rpc("list_transfer_jobs", {
    p_include_closed: includeClosed,
  });
  if (error) throw new Error(error.message);
  return asArray(data).map(mapTransferJob);
}

export async function getTransferJob(jobId: string): Promise<TransferJobDetail> {
  ensureLiveMode();
  const { data, error } = await client().rpc("get_transfer_job", { p_job_id: jobId });
  if (error) throw new Error(error.message);
  const job = mapTransferJobDetail(data);
  if (!job.id) throw new Error("이관 작업 정보를 불러오지 못했습니다.");
  return job;
}

export async function createTransferJob(sourceBarcode: string, note = ""): Promise<TransferJobDetail> {
  ensureLiveMode();
  const { data, error } = await client().rpc("create_transfer_job", {
    p_source_barcode: sourceBarcode,
    p_note: note || null,
  });
  if (error) throw new Error(error.message);
  return mapTransferJobDetail(data);
}

export async function saveTransferJobItems(
  jobId: string,
  items: TransferItemInput[],
): Promise<TransferJobDetail> {
  ensureLiveMode();
  const { data, error } = await client().rpc("save_transfer_job_items", {
    p_job_id: jobId,
    p_items: items.map((item) => ({ product_id: item.productId, qty: item.qty })),
  });
  if (error) throw new Error(error.message);
  return mapTransferJobDetail(data);
}

export async function setTransferDestination(
  jobId: string,
  destinationBarcode: string,
): Promise<TransferJobDetail> {
  ensureLiveMode();
  const { data, error } = await client().rpc("set_transfer_destination", {
    p_job_id: jobId,
    p_destination_barcode: destinationBarcode,
  });
  if (error) throw new Error(error.message);
  return mapTransferJobDetail(data);
}

export async function completeTransferJob(jobId: string): Promise<TransferJobDetail> {
  ensureLiveMode();
  const { data, error } = await client().rpc("complete_transfer_job", { p_job_id: jobId });
  if (error) throw new Error(error.message);
  return mapTransferJobDetail(data);
}

export async function cancelTransferJob(jobId: string, reason = ""): Promise<TransferJobDetail> {
  ensureLiveMode();
  const { data, error } = await client().rpc("cancel_transfer_job", {
    p_job_id: jobId,
    p_reason: reason || null,
  });
  if (error) throw new Error(error.message);
  return mapTransferJobDetail(data);
}
