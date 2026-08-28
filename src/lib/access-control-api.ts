import { getSupabaseClient, isDemoMode } from "@/lib/supabase";
import type { MenuAccessLevel, ProductScope } from "@/types/domain";

export const menuDefinitions = [
  ["dashboard", "대시보드"], ["scan", "입고·출고"], ["inventory", "재고조회"],
  ["outbound-progress", "출고 진행"],
  ["transfers", "재고이관"], ["external-transfers", "외부이관"], ["work-requests", "업무요청"],
  ["benefits", "특전 자동계산"], ["shipment-documents", "출고명세서"], ["products", "상품관리"],
  ["barcodes", "바코드"], ["locations", "로케이션"], ["location-map", "로케이션맵"],
  ["utilization", "용적률"], ["stocktakes", "재고실사"], ["logs", "로그"],
  ["import", "데이터이전"], ["users", "사용자"], ["my-consent", "내 동의내역"],
] as const;

export interface UserAccessConfig { menuAccess: Record<string, MenuAccessLevel>; productScopes: ProductScope[]; }

export async function getMyAccessConfig(): Promise<UserAccessConfig | null> {
  if (isDemoMode()) return null;
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_my_access_config");
  if (error) return null; // SQL 44 미적용 Preview는 기존 역할 권한으로 동작
  const row = data as { menu_access?: Record<string, MenuAccessLevel>; product_scopes?: ProductScope[] } | null;
  return row ? { menuAccess: row.menu_access ?? {}, productScopes: row.product_scopes ?? ["ALBUM"] } : null;
}

export async function adminGetUserAccessConfig(userId: string): Promise<UserAccessConfig> {
  const { data, error } = await getSupabaseClient()!.rpc("admin_get_user_access_config", { p_user_id: userId });
  if (error) throw new Error(error.message);
  const row = data as { menu_access?: Record<string, MenuAccessLevel>; product_scopes?: ProductScope[] };
  return { menuAccess: row.menu_access ?? {}, productScopes: row.product_scopes ?? ["ALBUM"] };
}

export async function adminSaveUserAccessConfig(userId: string, config: UserAccessConfig): Promise<void> {
  const { error } = await getSupabaseClient()!.rpc("admin_save_user_access_config", { p_user_id: userId, p_menu_access: config.menuAccess, p_product_scopes: config.productScopes });
  if (error) throw new Error(error.message);
}
