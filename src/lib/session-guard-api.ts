import { getSupabaseClient, isDemoMode } from "@/lib/supabase";

export interface DesktopSessionGuardStatus {
  enabled: boolean;
  pinConfigured: boolean;
  displayName?: string;
  message?: string;
}

export interface PinVerificationResult {
  ok: boolean;
  verifiedAt?: string;
  errorCode?: string;
  message?: string;
  lockedUntil?: string;
  remainingAttempts?: number;
}

function client() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");
  return supabase;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function optionalText(value: unknown): string | undefined {
  if (value == null) return undefined;
  const result = String(value);
  return result || undefined;
}

export function desktopActivityStorageKey(userId: string): string {
  return `san-wms:desktop-last-activity:${userId}`;
}

export async function getDesktopSessionGuardStatus(): Promise<DesktopSessionGuardStatus> {
  if (isDemoMode()) return { enabled: false, pinConfigured: false };
  const { data, error } = await client().rpc("get_desktop_session_guard_status");
  if (error) throw new Error(error.message);
  const row = record(data);
  return {
    enabled: Boolean(row.enabled),
    pinConfigured: Boolean(row.pin_configured),
    displayName: optionalText(row.display_name),
    message: optionalText(row.message),
  };
}

export async function verifyCurrentUserPin(pin: string): Promise<PinVerificationResult> {
  if (isDemoMode()) return { ok: true, verifiedAt: new Date().toISOString() };
  const { data, error } = await client().rpc("verify_current_user_pin", { p_pin: pin });
  if (error) throw new Error(error.message);
  const row = record(data);
  return {
    ok: Boolean(row.ok),
    verifiedAt: optionalText(row.verified_at),
    errorCode: optionalText(row.error_code),
    message: optionalText(row.message),
    lockedUntil: optionalText(row.locked_until),
    remainingAttempts: row.remaining_attempts == null ? undefined : Number(row.remaining_attempts),
  };
}
