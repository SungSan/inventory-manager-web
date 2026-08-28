import { getSupabaseClient, isDemoMode } from "@/lib/supabase";
import { listInventory } from "@/lib/inventory-api";
import type { InventoryRow, ProductCategory } from "@/types/domain";
import { getMyAccessConfig } from "@/lib/access-control-api";
import { inferFacility } from "@/lib/work-scope";

const PAGE_SIZE = 1000;
let inventoryLoadInFlight: Promise<InventoryRow[]> | null = null;

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
