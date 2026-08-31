import { getSupabaseClient } from "@/lib/supabase";
import type { OutboundJob } from "@/types/outbound-progress";

type Row = Record<string, unknown>;
const client = () => {
  const value = getSupabaseClient();
  if (!value) throw new Error("Supabase 연결 설정을 확인하세요.");
  return value;
};
const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

function setupError(message: string): Error {
  return new Error(
    /outbound_|schema cache|Could not find/i.test(message)
      ? "출고 진행 운영 DB가 아직 적용되지 않았습니다. SQL46을 실행하세요."
      : message,
  );
}

export async function listOutboundJobs(includeArchived = false): Promise<OutboundJob[]> {
  let query = client()
    .from("outbound_jobs")
    .select(
      "id,name,status,created_at,archived_at,archive_reason,outbound_shipments(id,tracking_no,status,manual_quantity_allowed,assigned_worker_label,outbound_items(id,product_id,product_barcode,artist,name_ver,order_nos,required_qty,picked_qty,resolution,review_reason,outbound_item_locations(location_code,source_qty,priority)))",
    )
    .order("created_at", { ascending: false });
  if (!includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) throw setupError(error.message);
  return rows(data).map((job) => ({
    id: String(job.id),
    name: String(job.name),
    status: String(job.status) as OutboundJob["status"],
    createdAt: String(job.created_at),
    archivedAt: job.archived_at ? String(job.archived_at) : undefined,
    archiveReason: job.archive_reason ? String(job.archive_reason) : undefined,
    shipments: rows(job.outbound_shipments).map((shipment) => ({
      id: String(shipment.id),
      trackingNo: String(shipment.tracking_no),
      status: String(shipment.status) as OutboundJob["shipments"][number]["status"],
      manualQuantityAllowed: Boolean(shipment.manual_quantity_allowed),
      assignedWorker: shipment.assigned_worker_label
        ? String(shipment.assigned_worker_label)
        : undefined,
      items: rows(shipment.outbound_items).map((item) => ({
        id: String(item.id),
        productId: item.product_id ? String(item.product_id) : undefined,
        productBarcode: String(item.product_barcode),
        artist: String(item.artist ?? ""),
        nameVer: String(item.name_ver ?? ""),
        orderNos: Array.isArray(item.order_nos)
          ? item.order_nos.map(String)
          : [],
        requiredQty: Number(item.required_qty),
        pickedQty: Number(item.picked_qty),
        resolution: String(item.resolution) as OutboundJob["shipments"][number]["items"][number]["resolution"],
        reviewReason: item.review_reason
          ? String(item.review_reason)
          : undefined,
        locations: rows(item.outbound_item_locations)
          .sort((a, b) => Number(a.priority) - Number(b.priority))
          .map((location) => ({
            locationCode: String(location.location_code),
            qty: Number(location.source_qty),
          })),
      })),
    })),
  }));
}

export async function archiveOutboundJob(
  jobId: string,
  archived: boolean,
  reason = "",
): Promise<void> {
  const { error } = await client().rpc("archive_outbound_job", {
    p_job_id: jobId,
    p_archived: archived,
    p_reason: reason,
  });
  if (error) throw setupError(error.message);
}

export async function createOutboundJob(job: OutboundJob): Promise<string> {
  const { data, error } = await client().rpc("create_outbound_job", {
    p_job: job,
  });
  if (error) throw setupError(error.message);
  return String(data);
}

export async function resolveOutboundItem(
  itemId: string,
  productId: string,
): Promise<void> {
  const { error } = await client().rpc("resolve_outbound_item", {
    p_item_id: itemId,
    p_product_id: productId,
  });
  if (error) throw setupError(error.message);
}

export async function setOutboundManualQuantity(
  shipmentId: string,
  allowed: boolean,
): Promise<void> {
  const { error } = await client().rpc("set_outbound_manual_quantity", {
    p_shipment_id: shipmentId,
    p_allowed: allowed,
  });
  if (error) throw setupError(error.message);
}

export async function pickOutboundItem(input: {
  itemId: string;
  locationBarcode: string;
  qty: number;
  inputMethod: "SCAN" | "MANUAL";
  idempotencyKey: string;
  selectedProductId?: string;
}): Promise<{ pickedQty: number; shipmentStatus: string }> {
  const { data, error } = await client().rpc("pick_outbound_item_v2", {
    p_item_id: input.itemId,
    p_location_barcode: input.locationBarcode,
    p_qty: input.qty,
    p_input_method: input.inputMethod,
    p_idempotency_key: input.idempotencyKey,
    p_selected_product_id: input.selectedProductId ?? null,
  });
  if (error) throw setupError(error.message);
  const value = (data ?? {}) as Row;
  return {
    pickedQty: Number(value.picked_qty),
    shipmentStatus: String(value.shipment_status ?? "IN_PROGRESS"),
  };
}

export interface OutboundPickLocation {
  id: string;
  locationCode: string;
  scannedBarcode: string;
}

export interface OutboundPickCandidate {
  productId: string;
  artist: string;
  nameVer: string;
  codeNo: string;
  qty: number;
  currentLocationQty: number;
  locationCodes: string;
}

export async function resolveOutboundLocation(barcode: string): Promise<OutboundPickLocation> {
  const { data, error } = await client().rpc("resolve_outbound_location", { p_barcode: barcode });
  if (error) throw setupError(error.message);
  const row = (data ?? {}) as Row;
  return { id: String(row.id), locationCode: String(row.location_code), scannedBarcode: barcode };
}

export async function getOutboundPickCandidates(
  itemId: string,
  locationBarcode: string,
): Promise<OutboundPickCandidate[]> {
  const { data, error } = await client().rpc("get_outbound_pick_candidates", {
    p_item_id: itemId,
    p_location_barcode: locationBarcode,
  });
  if (error) throw setupError(error.message);
  return rows(data).map((row) => ({
    productId: String(row.product_id),
    artist: String(row.artist ?? ""),
    nameVer: String(row.name_ver ?? ""),
    codeNo: String(row.code_no ?? ""),
    qty: Number(row.qty),
    currentLocationQty: Number(row.current_location_qty ?? 0),
    locationCodes: String(row.location_codes ?? "재고 LOC 없음"),
  }));
}
