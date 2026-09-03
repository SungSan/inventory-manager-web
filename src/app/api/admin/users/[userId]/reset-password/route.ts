import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
function reply(message: string, status: number) { return NextResponse.json({ message }, { status }); }

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publicKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const pepper = process.env.PASSWORD_HISTORY_PEPPER?.trim();
  if (!url || !publicKey || !serviceKey || !pepper) return reply("비밀번호 보안 서버 설정이 완료되지 않았습니다.", 503);
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return reply("로그인이 필요합니다.", 401);
  const auth = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: callerData, error: callerError } = await auth.auth.getUser(bearer);
  const caller = callerData.user;
  if (callerError || !caller) return reply("로그인이 만료되었습니다.", 401);
  const { data: callerProfile } = await admin.from("profiles").select("role,active,deleted_at").eq("id", caller.id).single();
  if (!callerProfile || callerProfile.role !== "admin" || !callerProfile.active || callerProfile.deleted_at) return reply("관리자 권한이 필요합니다.", 403);

  const { userId } = await context.params;
  const { data: target } = await admin.from("profiles").select("id,role,active,deleted_at,account_type,is_service_account").eq("id", userId).single();
  if (!target || !target.active || target.deleted_at) return reply("초기화할 활성 사용자를 찾을 수 없습니다.", 404);
  if (target.id === caller.id || target.role === "admin" || target.account_type !== "HUMAN" || target.is_service_account) return reply("일반 사용자 계정만 개별 초기화할 수 있습니다.", 400);

  const body = await request.json().catch(() => null) as { temporaryPassword?: unknown } | null;
  const temporaryPassword = typeof body?.temporaryPassword === "string" ? body.temporaryPassword : "";
  if (temporaryPassword.length < 10 || !/[a-z]/.test(temporaryPassword) || !/[A-Z]/.test(temporaryPassword) || !/\d/.test(temporaryPassword) || !/[^A-Za-z0-9]/.test(temporaryPassword)) {
    return reply("임시 비밀번호는 10자 이상이며 영문 대·소문자, 숫자, 특수문자를 모두 포함해야 합니다.", 400);
  }

  const targetAuth = await admin.auth.admin.getUserById(userId);
  if (targetAuth.error || !targetAuth.data.user?.email) return reply("인증 사용자를 찾을 수 없습니다.", 404);
  const verifier = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const sameAsCurrent = await verifier.auth.signInWithPassword({ email: targetAuth.data.user.email, password: temporaryPassword });
  if (!sameAsCurrent.error) return reply("현재 사용 중인 비밀번호는 임시 비밀번호로 설정할 수 없습니다.", 409);

  const fingerprint = createHmac("sha256", pepper).update(`${userId}\0${temporaryPassword}`, "utf8").digest("hex");
  const recent = await admin.from("password_history").select("password_fingerprint").eq("user_id", userId).order("created_at", { ascending: false }).limit(3);
  if (recent.error) return reply("비밀번호 이력을 확인하지 못했습니다.", 500);
  const candidate = Buffer.from(fingerprint, "hex");
  if ((recent.data ?? []).some((row) => { const prior = Buffer.from(String(row.password_fingerprint), "hex"); return prior.length === candidate.length && timingSafeEqual(prior, candidate); })) {
    return reply("최근 3회 사용한 비밀번호는 임시 비밀번호로 다시 설정할 수 없습니다.", 409);
  }
  const reserved = await admin.from("password_history").insert({ user_id: userId, password_fingerprint: fingerprint }).select("id").single();
  if (reserved.error || !reserved.data) return reply("비밀번호 초기화를 준비하지 못했습니다.", 500);
  const marked = await admin.rpc("admin_mark_password_reset_required", { p_actor_id: caller.id, p_user_id: userId });
  if (marked.error) {
    await admin.from("password_history").delete().eq("id", reserved.data.id);
    return reply(marked.error.message, 400);
  }
  const changed = await admin.auth.admin.updateUserById(userId, { password: temporaryPassword });
  if (changed.error) {
    await admin.from("password_history").delete().eq("id", reserved.data.id);
    return reply(changed.error.message, 400);
  }
  return NextResponse.json({ ok: true });
}
