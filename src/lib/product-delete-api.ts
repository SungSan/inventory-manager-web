import { getSupabaseClient, isDemoMode } from "@/lib/supabase";

function client() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");
  return supabase;
}

export async function deleteUnusedProduct(productId: string): Promise<void> {
  if (isDemoMode()) throw new Error("DEMO 모드에서는 상품을 삭제할 수 없습니다.");

  const { error } = await client().rpc("admin_delete_unused_product", {
    p_product_id: productId,
  });

  if (error) throw new Error(error.message);
}
