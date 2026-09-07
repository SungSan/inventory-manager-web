import { getSupabaseClient } from "@/lib/supabase";
import type { UserRole } from "@/types/domain";

export interface CreateAdminUserInput {
  email: string;
  assignedName: string;
  temporaryPassword: string;
  role: UserRole;
}

export async function adminCreateUser(input: CreateAdminUserInput): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("로그인이 만료되었습니다. 다시 로그인하세요.");
  const response = await fetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  const result = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(result.message || "사용자를 생성하지 못했습니다.");
}
