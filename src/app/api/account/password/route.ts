import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function reply(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const pepper = process.env.PASSWORD_HISTORY_PEPPER?.trim();
  if (!url || !publishableKey || !serviceKey || !pepper) return reply("비밀번호 보안 서버 설정이 완료되지 않았습니다.", 503);

  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return reply("로그인이 필요합니다.", 401);
  const authClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await authClient.auth.getUser(bearer);
  const user = userData.user;
  if (userError || !user?.email) return reply("로그인이 만료되었습니다. 다시 로그인하세요.", 401);

  const body = await request.json().catch(() => null) as { currentPassword?: unknown; newPassword?: unknown } | null;
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  if (!currentPassword || !newPassword) return reply("현재 비밀번호와 새 비밀번호를 모두 입력하세요.", 400);
  if (newPassword.length < 10 || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
    return reply("새 비밀번호는 10자 이상이며 영문 대·소문자, 숫자, 특수문자를 모두 포함해야 합니다.", 400);
  }

  const verifier = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const verified = await verifier.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (verified.error) return reply("현재 비밀번호가 올바르지 않습니다.", 400);
  const sameAsCurrent = await verifier.auth.signInWithPassword({ email: user.email, password: newPassword });
  if (!sameAsCurrent.error) return reply("현재 사용 중인 비밀번호는 다시 사용할 수 없습니다.", 409);

  const fingerprint = createHmac("sha256", pepper).update(`${user.id}\0${newPassword}`, "utf8").digest("hex");
  const { data: history, error: historyError } = await admin.from("password_history").select("password_fingerprint").eq("user_id", user.id).order("created_at", { ascending: false }).limit(3);
  if (historyError) return reply("비밀번호 이력을 확인하지 못했습니다.", 500);
  const candidate = Buffer.from(fingerprint, "hex");
  if ((history ?? []).some((row) => {
    const prior = Buffer.from(String(row.password_fingerprint), "hex");
    return prior.length === candidate.length && timingSafeEqual(prior, candidate);
  })) return reply("최근 3회 사용한 비밀번호는 다시 사용할 수 없습니다.", 409);

  const { data: reservation, error: reserveError } = await admin.from("password_history").insert({ user_id: user.id, password_fingerprint: fingerprint }).select("id").single();
  if (reserveError || !reservation) return reply("비밀번호 변경을 준비하지 못했습니다.", 500);
  const changed = await admin.auth.admin.updateUserById(user.id, { password: newPassword });
  if (changed.error || !changed.data.user?.updated_at) {
    await admin.from("password_history").delete().eq("id", reservation.id);
    return reply(changed.error?.message || "비밀번호를 변경하지 못했습니다.", 400);
  }
  const completed = await admin.rpc("complete_my_password_change", {
    p_user_id: user.id,
    p_auth_updated_at: changed.data.user.updated_at,
  });
  if (completed.error) {
    await admin.auth.admin.updateUserById(user.id, { password: currentPassword });
    await admin.from("password_history").delete().eq("id", reservation.id);
    return reply("정책 기록에 실패하여 비밀번호 변경을 취소했습니다.", 500);
  }
  return NextResponse.json({ ok: true });
}
