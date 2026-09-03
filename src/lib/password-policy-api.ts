import { getSupabaseClient, isDemoMode } from "@/lib/supabase";

export interface PasswordPolicyStatus {
  required: boolean;
  changedAt?: string;
  expiresAt?: string;
}

export async function changeMyPassword(currentPassword: string, newPassword: string): Promise<void> {
  if (isDemoMode()) return;
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("로그인이 만료되었습니다. 다시 로그인하세요.");
  const response = await fetch("/api/account/password", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const result = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(result.message || "비밀번호를 변경하지 못했습니다.");
  await supabase.auth.refreshSession();
}
