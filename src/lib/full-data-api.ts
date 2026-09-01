import { getSupabaseClient, isDemoMode } from "@/lib/supabase";
import { listInventory } from "@/lib/inventory-api";
import type { BarcodeRecord, InventoryRow, ProductCategory } from "@/types/domain";
import { getMyAccessConfig } from "@/lib/access-control-api";
import { inferFacility } from "@/lib/work-scope";

const PAGE_SIZE = 1000;
let inventoryLoadInFlight: Promise<InventoryRow[]> | null = null;
let inventoryPageCache: { rows: InventoryRow[]; barcodes: BarcodeRecord[]; loadedAt: number } | null = null;
let inventoryPageInFlight: Promise<{ rows: InventoryRow[]; barcodes: BarcodeRecord[] }> | null = null;
const INVENTORY_PAGE_CACHE_MS = 30_000;

function valueRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function valueArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(valueRecord) : [];
}

export async function listInventoryPageData(force = false): Promise<{ rows: InventoryRow[]; barcodes: BarcodeRecord[] }> {
  if (isDemoMode()) {
    const { listBarcodes } = await import("@/lib/inventory-api");
    return { rows: await listInventory(""), barcodes: await listBarcodes("", "product") };
  }
  if (!force && inventoryPageCache && Date.now() - inventoryPageCache.loadedAt < INVENTORY_PAGE_CACHE_MS) {
    return { rows: inventoryPageCache.rows, barcodes: inventoryPageCache.barcodes };
  }
  if (inventoryPageInFlight) return inventoryPageInFlight;
  inventoryPageInFlight = (async () => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");
    const { data, error } = await supabase.rpc("get_inventory_page_snapshot_fast");
    if (error) throw new Error(error.message);
    const snapshot = valueRecord(data);
    const rows: InventoryRow[] = valueArray(snapshot.inventory).map((row) => ({
      productId: String(row.product_id ?? ""), locationId: String(row.location_id ?? ""),
      pCodeNo: String(row.p_code_no ?? ""), codeNo: String(row.code_no ?? ""),
      masterCodeNo: String(row.master_code_no ?? ""), artist: String(row.artist ?? ""),
      nameVer: String(row.name_ver ?? ""), productCategory: row.product_category === "MD" ? "MD" : "ALBUM",
      locationCode: String(row.location_code ?? ""), zone: String(row.zone ?? ""),
      facility: row.facility === "DAEJA" || row.facility === "GWANSAN" ? row.facility : inferFacility(String(row.location_code ?? "")),
      qty: Number(row.qty ?? 0), updatedAt: String(row.updated_at ?? ""),
    }));
    const barcodes: BarcodeRecord[] = valueArray(snapshot.barcodes).map((row) => ({
      id: String(row.id ?? ""), scanTargetId: String(row.scan_target_id ?? ""), targetType: "product",
      targetId: String(row.target_id ?? ""), targetLabel: String(row.target_label ?? ""),
      value: String(row.barcode_value ?? ""), normalizedValue: String(row.normalized_value ?? ""),
      source: String(row.source ?? "manufacturer") as BarcodeRecord["source"], symbology: String(row.symbology ?? ""),
      isPrimary: Boolean(row.is_primary), active: Boolean(row.active), createdAt: String(row.created_at ?? ""),
    }));
    inventoryPageCache = { rows, barcodes, loadedAt: Date.now() };
    return { rows, barcodes };
  })();
  try { return await inventoryPageInFlight; }
  finally { inventoryPageInFlight = null; }
}

async function loadAllInventoryRows(): Promise<InventoryRow[]> {
  if (isDemoMode()) return listInventory("");

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");

  const result: InventoryRow[] = [];
  const access = await getMyAccessConfig();
  let offset = 0;

  while (true) {
    let query = supabase
      .from("inventory_stock_view")
      .select("*")
      .order("location_code")
      .order("product_id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (access?.productScopes.length) query = query.in("product_category", access.productScopes);
    const { data, error } = await query;

    if (error) throw new Error(error.message);

    const rows = data ?? [];
    result.push(...rows.map((row) => ({
      productId: row.product_id,
      locationId: row.location_id,
      pCodeNo: row.p_code_no ?? "",
      codeNo: row.code_no ?? "",
      masterCodeNo: row.master_code_no ?? "",
      artist: row.artist ?? "",
      nameVer: row.name_ver ?? "",
      productCategory: (row.product_category === "MD" ? "MD" : "ALBUM") as ProductCategory,
      locationCode: row.location_code,
      zone: row.zone ?? "",
      facility: row.facility === "DAEJA" || row.facility === "GWANSAN" ? row.facility : inferFacility(row.location_code),
      qty: Number(row.qty),
      updatedAt: row.updated_at,
    })));

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return result;
}

export async function listAllInventoryRows(): Promise<InventoryRow[]> {
  if (inventoryLoadInFlight) return inventoryLoadInFlight;

  inventoryLoadInFlight = loadAllInventoryRows();
  try {
    return await inventoryLoadInFlight;
  } finally {
    inventoryLoadInFlight = null;
  }
}
