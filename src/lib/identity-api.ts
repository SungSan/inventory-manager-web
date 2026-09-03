import { APP_VERSION } from "@/lib/app-version";
import { getSupabaseClient, isDemoMode } from "@/lib/supabase";

export interface LegalDocumentVersion {
  version: string;
  title: string;
  content: string;
  contentHash: string;
  effectiveAt: string;
}

export interface UserAccessStatus {
  userId: string;
  loginId: string;
  assignedName: string;
  legalName?: string;
  active: boolean;
  disabledAt?: string;
  disableReason?: string;
  deletedAt?: string;
  deletionReason?: string;
  accountType: string;
  isServiceAccount: boolean;
  pinConfigured: boolean;
  pinResetRequired: boolean;
  termsAcceptanceRequired: boolean;
  latestTermsVersion?: string;
  latestAppVersion?: string;
  latestTermsAcceptedAt?: string;
  accessReady: boolean;
  identityReady: boolean;
  passwordChangeRequired: boolean;
  passwordChangedAt?: string;
  passwordExpiresAt?: string;
  terms: LegalDocumentVersion;
  privacyNotice: LegalDocumentVersion;
}

export interface ConsentCompletionResult {
  ok: boolean;
  accessReady?: boolean;
  serviceAccount?: boolean;
  confirmationNo?: string;
  acceptedAt?: string;
  termsVersion?: string;
  appVersion?: string;
  errorCode?: string;
  message?: string;
  lockedUntil?: string;
  remainingAttempts?: number;
}

export interface TermsAcceptanceReceipt {
  id: string;
  confirmationNo: string;
  appVersion?: string;
  termsVersion: string;
  termsHash: string;
  termsTitle: string;
  termsContent: string;
  privacyNoticeVersion: string;
  privacyNoticeHash: string;
  privacyNoticeTitle: string;
  privacyNoticeContent: string;
  acceptedAt: string;
  authenticationMethod: string;
}

export interface AdminUserSecurityStatus {
  id: string;
  email: string;
  displayName: string;
  assignedName: string;
  legalName?: string;
  role: "admin" | "manager" | "operator" | "viewer";
  active: boolean;
  accountType: "HUMAN" | "SERVICE" | "API" | "AUTOMATION" | "SYSTEM";
  isServiceAccount: boolean;
  pinConfigured: boolean;
  pinSetAt?: string;
  pinResetRequired: boolean;
  latestTermsAccepted: boolean;
  latestTermsVersion?: string;
  latestAppVersion?: string;
  latestTermsAcceptedAt?: string;
  termsAcceptanceRequired: boolean;
  lastSignInAt?: string;
  lastAccessIp?: string;
  lastAccessAt?: string;
  disabledAt?: string;
  disableReason?: string;
  deletedAt?: string;
  deletionReason?: string;
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

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function optionalText(value: unknown): string | undefined {
  const valueText = text(value);
  return valueText || undefined;
}

function mapDocument(value: unknown): LegalDocumentVersion {
  const row = record(value);
  return {
    version: text(row.version),
    title: text(row.title),
    content: text(row.content),
    contentHash: text(row.content_hash ?? row.contentHash),
    effectiveAt: text(row.effective_at ?? row.effectiveAt),
  };
}

function isMissingRpcError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  return error.code === "PGRST202"
    || error.code === "42883"
    || message.includes("could not find the function")
    || message.includes("function") && message.includes("does not exist");
}

export async function getUserAccessStatus(): Promise<UserAccessStatus> {
  if (isDemoMode()) {
    return {
      userId: "demo",
      loginId: "demo@san-wms.local",
      assignedName: "데모 사용자",
      active: true,
      accountType: "HUMAN",
      isServiceAccount: false,
      pinConfigured: true,
      pinResetRequired: false,
      termsAcceptanceRequired: false,
      latestTermsVersion: "3.9.0",
      latestAppVersion: APP_VERSION,
      accessReady: true,
      identityReady: true,
      passwordChangeRequired: false,
      terms: { version: "3.9.0", title: "SAN WMS 프로그램 이용조건 및 권리 안내", content: "", contentHash: "", effectiveAt: "" },
      privacyNotice: { version: "3.9.0", title: "본인확인 및 동의 기록의 수집·이용 안내", content: "", contentHash: "", effectiveAt: "" },
    };
  }
  const { data, error } = await client().rpc("get_user_access_status");
  if (error) throw new Error(error.message);
  const row = record(data);
  return {
    userId: text(row.user_id),
    loginId: text(row.login_id),
    assignedName: text(row.assigned_name),
    legalName: optionalText(row.legal_name),
    active: row.active == null ? true : Boolean(row.active),
    disabledAt: optionalText(row.disabled_at),
    disableReason: optionalText(row.disable_reason),
    deletedAt: optionalText(row.deleted_at),
    deletionReason: optionalText(row.deletion_reason),
    accountType: text(row.account_type || "HUMAN"),
    isServiceAccount: Boolean(row.is_service_account),
    pinConfigured: Boolean(row.pin_configured),
    pinResetRequired: Boolean(row.pin_reset_required),
    termsAcceptanceRequired: Boolean(row.terms_acceptance_required),
    latestTermsVersion: optionalText(row.latest_terms_version),
    latestAppVersion: optionalText(row.latest_app_version),
    latestTermsAcceptedAt: optionalText(row.latest_terms_accepted_at),
    accessReady: Boolean(row.access_ready),
    identityReady: row.identity_ready == null ? Boolean(row.access_ready) : Boolean(row.identity_ready),
    passwordChangeRequired: Boolean(row.password_change_required),
    passwordChangedAt: optionalText(row.password_changed_at),
    passwordExpiresAt: optionalText(row.password_expires_at),
    terms: mapDocument(row.terms),
    privacyNotice: mapDocument(row.privacy_notice),
  };
}

export async function completeUserIdentityAndConsent(input: {
  enteredName: string;
  newPin?: string;
  pinConfirm?: string;
  finalPin: string;
  termsChecked: boolean;
  privacyChecked: boolean;
}): Promise<ConsentCompletionResult> {
  const v2Args = {
    p_entered_name: input.enteredName,
    p_new_pin: input.newPin ?? "",
    p_pin_confirm: input.pinConfirm ?? "",
    p_final_pin: input.finalPin,
    p_terms_checked: input.termsChecked,
    p_privacy_checked: input.privacyChecked,
    p_app_version: APP_VERSION,
  };

  const response = await client().rpc("complete_user_identity_and_consent_v2", v2Args);
  if (response.error && isMissingRpcError(response.error)) {
    throw new Error("앱 버전을 기록하는 최신 동의 기능을 찾을 수 없습니다. 관리자에게 문의하세요.");
  }
  if (response.error) throw new Error(response.error.message);
  const row = record(response.data);
  return {
    ok: Boolean(row.ok),
    accessReady: row.access_ready == null ? undefined : Boolean(row.access_ready),
    serviceAccount: row.service_account == null ? undefined : Boolean(row.service_account),
    confirmationNo: optionalText(row.confirmation_no),
    acceptedAt: optionalText(row.accepted_at),
    termsVersion: optionalText(row.terms_version),
    appVersion: optionalText(row.app_version),
    errorCode: optionalText(row.error_code),
    message: optionalText(row.message),
    lockedUntil: optionalText(row.locked_until),
    remainingAttempts: row.remaining_attempts == null ? undefined : Number(row.remaining_attempts),
  };
}

export async function getMyTermsAcceptances(): Promise<TermsAcceptanceReceipt[]> {
  if (isDemoMode()) return [];

  let response = await client().rpc("get_my_terms_acceptances_v2");
  if (response.error && isMissingRpcError(response.error)) {
    response = await client().rpc("get_my_terms_acceptances");
  }
  if (response.error) throw new Error(response.error.message);

  return (Array.isArray(response.data) ? response.data : []).map((value) => {
    const row = record(value);
    return {
      id: text(row.id),
      confirmationNo: text(row.confirmation_no),
      appVersion: optionalText(row.app_version),
      termsVersion: text(row.terms_version),
      termsHash: text(row.terms_hash),
      termsTitle: text(row.terms_title),
      termsContent: text(row.terms_content),
      privacyNoticeVersion: text(row.privacy_notice_version),
      privacyNoticeHash: text(row.privacy_notice_hash),
      privacyNoticeTitle: text(row.privacy_notice_title),
      privacyNoticeContent: text(row.privacy_notice_content),
      acceptedAt: text(row.accepted_at),
      authenticationMethod: text(row.authentication_method),
    };
  });
}

export async function listAdminUserSecurityStatus(): Promise<AdminUserSecurityStatus[]> {
  const { data, error } = await client().rpc("admin_list_user_security_status");
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []).map((value) => {
    const row = record(value);
    return {
      id: text(row.id),
      email: text(row.email),
      displayName: text(row.display_name),
      assignedName: text(row.assigned_name),
      legalName: optionalText(row.legal_name),
      role: text(row.role || "viewer") as AdminUserSecurityStatus["role"],
      active: Boolean(row.active),
      accountType: text(row.account_type || "HUMAN") as AdminUserSecurityStatus["accountType"],
      isServiceAccount: Boolean(row.is_service_account),
      pinConfigured: Boolean(row.pin_configured),
      pinSetAt: optionalText(row.pin_set_at),
      pinResetRequired: Boolean(row.pin_reset_required),
      latestTermsAccepted: Boolean(row.latest_terms_accepted),
      latestTermsVersion: optionalText(row.latest_terms_version),
      latestAppVersion: optionalText(row.latest_app_version),
      latestTermsAcceptedAt: optionalText(row.latest_terms_accepted_at),
      termsAcceptanceRequired: Boolean(row.terms_acceptance_required),
      lastSignInAt: optionalText(row.last_sign_in_at),
      lastAccessIp: optionalText(row.last_access_ip),
      lastAccessAt: optionalText(row.last_access_at),
      disabledAt: optionalText(row.disabled_at),
      disableReason: optionalText(row.disable_reason),
      deletedAt: optionalText(row.deleted_at),
      deletionReason: optionalText(row.deletion_reason),
    };
  });
}

async function adminRpc(name: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await client().rpc(name, args);
  if (error) throw new Error(error.message);
}

export function adminUpdateAssignedName(userId: string, assignedName: string, reason = ""): Promise<void> {
  return adminRpc("admin_update_assigned_name", { p_user_id: userId, p_assigned_name: assignedName, p_reason: reason });
}

export function adminResetUserPin(userId: string): Promise<void> {
  return adminRpc("admin_reset_user_pin", { p_user_id: userId });
}

export function adminRequireUserReconsent(userId: string): Promise<void> {
  return adminRpc("admin_require_user_reconsent", { p_user_id: userId });
}

export async function adminRequireAllReconsent(): Promise<number> {
  const { data, error } = await client().rpc("admin_require_all_reconsent");
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export function adminSetAccountType(userId: string, accountType: AdminUserSecurityStatus["accountType"], isServiceAccount: boolean): Promise<void> {
  return adminRpc("admin_set_account_type", { p_user_id: userId, p_account_type: accountType, p_is_service_account: isServiceAccount });
}

export function adminSetUserActive(userId: string, active: boolean, reason = ""): Promise<void> {
  return adminRpc("admin_set_user_active", { p_user_id: userId, p_active: active, p_reason: reason });
}

export function adminDeleteUserAccount(userId: string, reason: string): Promise<void> {
  return adminRpc("admin_delete_user_account", { p_user_id: userId, p_reason: reason });
}

export function adminRestoreDeletedUser(userId: string, reason = ""): Promise<void> {
  return adminRpc("admin_restore_deleted_user", { p_user_id: userId, p_reason: reason });
}
