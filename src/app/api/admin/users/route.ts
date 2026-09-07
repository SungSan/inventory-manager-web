import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
function reply(message: string, status: number) { return NextResponse.json({ message }, { status }); }

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publicKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const pepper = process.env.PASSWORD_HISTORY_PEPPER?.trim();
  if (!url || !publicKey || !serviceKey || !pepper) return reply("사용자 생성 서버 설정이 완료되지 않았습니다.", 503);

  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return reply("로그인이 필요합니다.", 401);
  const auth = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: callerData, error: callerError } = await auth.auth.getUser(bearer);
  const caller = callerData.user;
  if (callerError || !caller) return reply("로그인이 만료되었습니다.", 401);
  const { data: callerProfile } = await admin.from("profiles").select("role,active,deleted_at").eq("id", caller.id).single();
  if (!callerProfile || callerProfile.role !== "admin" || !callerProfile.active || callerProfile.deleted_at) {
    return reply("관리자 권한이 필요합니다.", 403);
  }

  const body = await request.json().catch(() => null) as {
    email?: unknown; assignedName?: unknown; temporaryPassword?: unknown; role?: unknown;
  } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const assignedName = typeof body?.assignedName === "string" ? body.assignedName.trim() : "";
  const temporaryPassword = typeof body?.temporaryPassword === "string" ? body.temporaryPassword : "";
  const role = typeof body?.role === "string" ? body.role : "";
  if (!/^\S+@\S+\.\S+$/.test(email)) return reply("로그인 ID는 올바른 이메일 형식으로 입력하세요.", 400);
  if (!assignedName || assignedName.length > 80) return reply("사용자 이름은 1~80자로 입력하세요.", 400);
  if (!["admin","manager","operator","viewer"].includes(role)) return reply("올바른 역할을 선택하세요.", 400);
  if (temporaryPassword.length < 10 || !/[a-z]/.test(temporaryPassword) || !/[A-Z]/.test(temporaryPassword) || !/\d/.test(temporaryPassword) || !/[^A-Za-z0-9]/.test(temporaryPassword)) {
    return reply("임시 비밀번호는 10자 이상이며 영문 대·소문자, 숫자, 특수문자를 모두 포함해야 합니다.", 400);
  }

  const created = await admin.auth.admin.createUser({
    email, password: temporaryPassword, email_confirm: true,
    user_metadata: { display_name: assignedName, assigned_name: assignedName },
  });
  if (created.error || !created.data.user) {
    const message = created.error?.message?.toLowerCase().includes("already")
      ? "이미 등록된 로그인 ID입니다." : created.error?.message || "인증 계정을 생성하지 못했습니다.";
    return reply(message, 400);
  }

  const userId = created.data.user.id;
  const profile = await admin.from("profiles").update({
    email, display_name: assignedName, assigned_name: assignedName, role,
    active: true, account_type: "HUMAN", is_service_account: false,
    password_changed_at: null, password_expires_at: null, password_auth_updated_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", userId).select("id").single();

  if (profile.error || !profile.data) {
    await admin.auth.admin.deleteUser(userId);
    return reply("사용자 프로필을 준비하지 못해 계정 생성을 취소했습니다.", 500);
  }
  const fingerprint = createHmac("sha256", pepper).update(`${userId}\0${temporaryPassword}`, "utf8").digest("hex");
  const history = await admin.from("password_history").insert({ user_id: userId, password_fingerprint: fingerprint });
  if (history.error) {
    await admin.auth.admin.deleteUser(userId);
    return reply("비밀번호 이력을 준비하지 못해 계정 생성을 취소했습니다.", 500);
  }
  await admin.from("audit_logs").insert({
    actor_id: caller.id, action: "USER_CREATED", entity_type: "user", entity_id: userId,
    entity_label: assignedName, after_data: { email, role, account_type: "HUMAN" },
    note: role === "admin" ? "관리자 화면에서 관리자 계정을 생성했습니다." : "관리자 화면에서 사용자를 생성하고 최초 로그인 비밀번호 변경을 요구했습니다.",
  });
  return NextResponse.json({ ok: true });
}
