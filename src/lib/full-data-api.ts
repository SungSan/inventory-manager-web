import { getSupabaseClient, isDemoMode } from "@/lib/supabase";
import { listInventory } from "@/lib/inventory-api";
import type { InventoryRow } from "@/types/domain";

const PAGE_SIZE = 1000;

export async function listAllInventoryRows(): Promise<InventoryRow[]> {
  if (isDemoMode()) return listInventory("");

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");

  const result: InventoryRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("inventory_stock_view")
      .select("*")
      .order("location_code")
      .order("product_id")
      .range(offset, offset + PAGE_SIZE - 1);

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
      locationCode: row.location_code,
      zone: row.zone ?? "",
      qty: Number(row.qty),
      updatedAt: row.updated_at,
    })));

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return result;
}
