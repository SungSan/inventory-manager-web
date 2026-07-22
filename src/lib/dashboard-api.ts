import { listInventory, listLocations, listProducts } from "@/lib/inventory-api";
import { getSupabaseClient, isDemoMode } from "@/lib/supabase";

export interface DashboardMetrics {
  totalQty: number;
  skuCount: number;
  locationCount: number;
  lowStock: number;
}

const PAGE_SIZE = 1000;

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  if (isDemoMode()) {
    const [inventory, products, locations] = await Promise.all([
      listInventory(),
      listProducts("", false),
      listLocations("", false),
    ]);
    return {
      totalQty: inventory.reduce((sum, row) => sum + row.qty, 0),
      skuCount: products.length,
      locationCount: locations.length,
      lowStock: inventory.filter((row) => row.qty <= 5).length,
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");

  const [productCountResult, locationCountResult] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("locations").select("id", { count: "exact", head: true }).eq("active", true),
  ]);

  if (productCountResult.error) throw new Error(productCountResult.error.message);
  if (locationCountResult.error) throw new Error(locationCountResult.error.message);

  let totalQty = 0;
  let lowStock = 0;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("inventory_stock_view")
      .select("product_id,location_id,location_code,qty")
      .order("location_code")
      .order("product_id")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const rows = data ?? [];
    for (const row of rows) {
      const qty = Number(row.qty ?? 0);
      totalQty += qty;
      if (qty <= 5) lowStock += 1;
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return {
    totalQty,
    skuCount: productCountResult.count ?? 0,
    locationCount: locationCountResult.count ?? 0,
    lowStock,
  };
}
