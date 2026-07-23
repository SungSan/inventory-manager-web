import { getSupabaseClient, isDemoMode } from "@/lib/supabase";
import type { InventoryRow, MovementType } from "@/types/domain";

export interface LocationBatchItemInput {
  productId: string;
  qty: number;
}

export interface LocationBatchResult {
  operation: MovementType;
  locationId: string;
  locationCode: string;
  itemCount: number;
  totalQty: number;
}

export interface RemainingStockResult {
  changed: boolean;
  transactionId?: string;
  productId: string;
  locationId: string;
  locationCode: string;
  beforeQty: number;
  afterQty: number;
  outboundQty: number;
  note: string;
}

function client() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");
  return supabase;
}

function ensureLiveMode(): void {
  if (isDemoMode()) {
    throw new Error("로케이션 다품목 작업과 남은 수량 확정은 LIVE 모드에서만 사용할 수 있습니다.");
  }
}

function mapInventoryRow(row: Record<string, unknown>): InventoryRow {
  return {
    productId: String(row.product_id ?? ""),
    locationId: String(row.location_id ?? ""),
    pCodeNo: String(row.p_code_no ?? ""),
    codeNo: String(row.code_no ?? ""),
    masterCodeNo: String(row.master_code_no ?? ""),
    artist: String(row.artist ?? ""),
    nameVer: String(row.name_ver ?? ""),
    locationCode: String(row.location_code ?? ""),
    zone: String(row.zone ?? ""),
    qty: Number(row.qty ?? 0),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function listLocationInventory(locationId: string): Promise<InventoryRow[]> {
  ensureLiveMode();
  const { data, error } = await client()
    .from("inventory_stock_view")
    .select("*")
    .eq("location_id", locationId)
    .gt("qty", 0)
    .order("artist")
    .order("name_ver");

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapInventoryRow(row as Record<string, unknown>));
}

export async function getLocationProductStock(
  productId: string,
  locationId: string,
): Promise<number> {
  ensureLiveMode();
  const { data, error } = await client()
    .from("inventory_balances")
    .select("qty")
    .eq("product_id", productId)
    .eq("location_id", locationId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Number(data?.qty ?? 0);
}

export async function postLocationInventoryBatch(input: {
  operation: MovementType;
  locationId: string;
  items: LocationBatchItemInput[];
  note?: string;
  idempotencyKey: string;
}): Promise<LocationBatchResult> {
  ensureLiveMode();
  const { data, error } = await client().rpc("post_location_inventory_batch", {
    p_operation: input.operation,
    p_location_id: input.locationId,
    p_items: input.items.map((item) => ({
      product_id: item.productId,
      qty: Math.max(1, Math.trunc(item.qty)),
    })),
    p_note: input.note?.trim() || null,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown>;
  return {
    operation: String(row.operation ?? input.operation) as MovementType,
    locationId: String(row.location_id ?? input.locationId),
    locationCode: String(row.location_code ?? ""),
    itemCount: Number(row.item_count ?? input.items.length),
    totalQty: Number(row.total_qty ?? input.items.reduce((sum, item) => sum + item.qty, 0)),
  };
}

export async function confirmRemainingStock(input: {
  productId: string;
  locationId: string;
  remainingQty: number;
  reason?: string;
  idempotencyKey: string;
}): Promise<RemainingStockResult> {
  ensureLiveMode();
  const { data, error } = await client().rpc("confirm_remaining_stock", {
    p_product_id: input.productId,
    p_location_id: input.locationId,
    p_remaining_qty: Math.max(0, Math.trunc(input.remainingQty)),
    p_reason: input.reason?.trim() || null,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown>;
  return {
    changed: Boolean(row.changed),
    transactionId: row.transaction_id ? String(row.transaction_id) : undefined,
    productId: String(row.product_id ?? input.productId),
    locationId: String(row.location_id ?? input.locationId),
    locationCode: String(row.location_code ?? ""),
    beforeQty: Number(row.before_qty ?? 0),
    afterQty: Number(row.after_qty ?? input.remainingQty),
    outboundQty: Number(row.outbound_qty ?? 0),
    note: String(row.note ?? input.reason ?? "재고 실사 수량"),
  };
}
