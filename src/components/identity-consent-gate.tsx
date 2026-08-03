"use client";

import { useCallback, useEffect, useState } from "react";
import {
  completeUserIdentityAndConsent,
  getUserAccessStatus,
  type ConsentCompletionResult,
  type UserAccessStatus,
} from "@/lib/identity-api";
import {
  APP_VERSION,
  APP_VERSION_LABEL,
  hasSameSemanticMajor,
} from "@/lib/app-version";
import { getSupabaseClient } from "@/lib/supabase";
import styles from "./identity-consent-gate.module.css";

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function optionalText(value: unknown): string | undefined {
  return value == null || String(value) === "" ? undefined : String(value);
}

async function completeConsentWithSameMajorFallback(
  status: UserAccessStatus,
  input: {
    enteredName: string;
    newPin?: string;
    pinConfirm?: string;
    finalPin: string;
    termsChecked: boolean;
    privacyChecked: boolean;
  },
): Promise<ConsentCompletionResult> {
  const result = await completeUserIdentityAndConsent(input);

  const mayUseSameMajorFallback =
    !result.ok
    && result.errorCode === "LEGAL_VERSION_MISMATCH"
    && hasSameSemanticMajor(
      APP_VERSION,
      status.terms.version,
      status.privacyNotice.version,
    );

  if (!mayUseSameMajorFallback) return result;

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");

  // 구버전 서버 함수가 정확한 patch/minor 일치를 요구하는 동안만 사용하는 긴급 호환 경로입니다.
  // 메이저가 같은 활성 원문에 한해 기존 동의 RPC를 호출하며, 다른 메이저는 절대 우회하지 않습니다.
  const { data, error } = await supabase.rpc("complete_user_identity_and_consent", {
    p_entered_name: input.enteredName,
    p_new_pin: input.newPin ?? "",
    p_pin_confirm: input.pinConfirm ?? "",
    p_final_pin: input.finalPin,
    p_terms_checked: input.termsChecked,
    p_privacy_checked: input.privacyChecked,
  });

  if (error) throw new Error(error.message);

  const row = record(data);
  return {
    ok: Boolean(row.ok),
    accessReady: row.access_ready == null ? undefined : Boolean(row.access_ready),
    serviceAccount: row.service_account == null ? undefined : Boolean(row.service_account),
    confirmationNo: optionalText(row.confirmation_no),
    acceptedAt: optionalText(row.accepted_at),
    termsVersion: optionalText(row.terms_version) ?? status.terms.version,
    appVersion: APP_VERSION,
    errorCode: optionalText(row.error_code),
    message: optionalText(row.message),
    lockedUntil: optionalText(row.locked_until),
    remainingAttempts: row.remaining_attempts == null
      ? undefined
      : Number(row.remaining_attempts),
  };
}

export function IdentityConsentGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<UserAccessStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [enteredName, setEnteredName] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [finalPin, setFinalPin] = useState("");
  const [termsChecked, setTermsChecked] = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{
    confirmationNo: string;
    acceptedAt: string;
    termsVersion: string;
    appVersion: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await getUserAccessStatus());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "본인확인 상태를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className={styles.loading}>본인확인 상태를 확인하는 중입니다.</div>;

  if (status && (!status.active || status.deletedAt)) {
    const deleted = Boolean(status.deletedAt);
    const reason = deleted ? status.deletionReason : status.disableReason;
    return (
      <main className={styles.page}>
        <section className={styles.card}>
          <div className={styles.receipt}>
            <p className="eyebrow">ACCOUNT ACCESS BLOCKED</p>
            <h1>{deleted ? "삭제 처리된 계정입니다." : "사용금지 처리된 계정입니다."}</h1>
            <p className="muted">현재 계정: {status.loginId}</p>
            <p>SAN WMS 업무 기능에 접근할 수 없습니다. 계정 상태에 관한 문의는 관리자에게 확인하세요.</p>
            {reason ? <p className={styles.error}>처리 사유: {reason}</p> : null}
            <button className="button button-primary" onClick={() => void getSupabaseClient()?.auth.signOut()}>로그아웃</button>
          </div>
        </section>
      </main>
    );
  }

  if (status?.accessReady && !receipt) return children;

  const needNewPin = Boolean(status && (!status.pinConfigured || status.pinResetRequired));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!status) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await completeConsentWithSameMajorFallback(status, {
        enteredName,
        newPin: needNewPin ? newPin : undefined,
        pinConfirm: needNewPin ? pinConfirm : undefined,
        finalPin,
        termsChecked,
        privacyChecked,
      });
      if (!result.ok) {
        setError(result.message || "본인확인 및 동의를 완료하지 못했습니다.");
        return;
      }
      setReceipt({
        confirmationNo: result.confirmationNo || "서비스 계정 자동 확인",
        acceptedAt: result.acceptedAt || new Date().toISOString(),
        termsVersion: result.termsVersion || status.terms.version,
        appVersion: result.appVersion ? `V${result.appVersion}` : APP_VERSION_LABEL,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "본인확인 및 동의를 완료하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  if (receipt) {
    return (
      <main className={styles.page}>
        <section className={styles.card}>
          <div className={styles.receipt}>
            <p className="eyebrow">CONSENT COMPLETED</p>
            <h1>본인확인 및 동의가 완료되었습니다.</h1>
            <div>
              <p className="muted">동의 확인번호</p>
              <strong>{receipt.confirmationNo}</strong>
            </div>
            <p>SAN WMS 앱 {receipt.appVersion} · 이용조건 문서 {receipt.termsVersion} · {new Date(receipt.acceptedAt).toLocaleString("ko-KR")}</p>
            <button
              className="button button-primary"
              onClick={async () => {
                setReceipt(null);
                await load();
              }}
            >
              SAN WMS 업무 화면으로 이동
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (!status) {
    return (
      <main className={styles.page}>
        <section className={styles.card}>
          <h1>본인확인 상태를 불러오지 못했습니다.</h1>
          {error ? <p className={styles.error}>{error}</p> : null}
          <button className="button button-primary" onClick={() => void load()}>다시 시도</button>
        </section>
      </main>
    );
  }

  const sameMajorDocuments = hasSameSemanticMajor(
    APP_VERSION,
    status.terms.version,
    status.privacyNotice.version,
  );
  const exactDocumentMatch =
    APP_VERSION === status.terms.version
    && APP_VERSION === status.privacyNotice.version;

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={submit}>
        <header className={styles.header}>
          <div>
            <p className="eyebrow">IDENTITY & CONSENT</p>
            <h1>본인 확인 및 이용조건 동의</h1>
            <p className="muted">SAN WMS 이용을 계속하려면 본인 확인, 개인 PIN 설정 및 이용조건 동의가 필요합니다.</p>
          </div>
          <button type="button" className="button button-secondary button-compact" onClick={() => void getSupabaseClient()?.auth.signOut()}>
            로그아웃
          </button>
        </header>

        <section className={styles.accountGrid}>
          <div><span>현재 계정</span><strong>{status.loginId}</strong></div>
          <div><span>배정 사용자</span><strong>{status.assignedName || "관리자 등록 필요"}</strong></div>
        </section>

        <section className={styles.formGrid}>
          <label className={styles.spanTwo}>
            본인 이름
            <input
              value={enteredName}
              onChange={(event) => setEnteredName(event.target.value)}
              placeholder="계정에 배정된 이름을 정확히 입력"
              autoComplete="name"
              required
              disabled={submitting}
            />
            <span className="muted small">본인 확인을 위해 계정에 배정된 이름을 정확히 입력해 주세요.</span>
          </label>

          {needNewPin ? (
            <>
              <label>
                새 개인 PIN
                <input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={newPin} onChange={(event) => setNewPin(digitsOnly(event.target.value))} autoComplete="new-password" required disabled={submitting} />
                <span className="muted small">숫자 6자리를 입력하세요. 예: 123456</span>
              </label>
              <label>
                새 개인 PIN 확인
                <input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={pinConfirm} onChange={(event) => setPinConfirm(digitsOnly(event.target.value))} autoComplete="new-password" required disabled={submitting} />
                <span className="muted small">위에서 설정한 숫자 6자리 PIN을 다시 입력하세요.</span>
              </label>
            </>
          ) : (
            <div className={`${styles.notice} ${styles.spanTwo}`}>기존 개인 PIN이 설정되어 있습니다. 최신 이용조건 동의를 위해 마지막 단계에서 PIN을 다시 입력합니다.</div>
          )}

          <label className={styles.spanTwo}>
            최종 확인 PIN
            <input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={finalPin} onChange={(event) => setFinalPin(digitsOnly(event.target.value))} autoComplete="current-password" required disabled={submitting} />
            <p className={styles.pinHint}>숫자 6자리를 입력하세요. PIN 원문은 저장되지 않으며 bcrypt 방식의 일방향 해시만 서버 비공개 영역에 저장됩니다.</p>
          </label>
        </section>

        <p className={styles.notice}>현재 실행 중인 SAN WMS 앱 버전 <strong>{APP_VERSION_LABEL}</strong>과 서버의 활성 이용조건 문서 버전 <strong>{status.terms.version}</strong>이 동의 기록에 각각 저장됩니다.</p>
        {!exactDocumentMatch && sameMajorDocuments ? (
          <p className={styles.notice}>앱과 활성 문서의 세부 버전은 다르지만 모두 동일한 V{APP_VERSION.split(".")[0]} 메이저 버전이므로 정상적으로 동의할 수 있습니다.</p>
        ) : null}

        <section className={styles.documentGrid}>
          <article className={styles.document}>
            <div className={styles.documentHeader}>
              <div><p className="eyebrow">TERMS</p><h3>{status.terms.title}</h3></div>
              <span className={styles.status}>약관 문서 {status.terms.version}</span>
            </div>
            <pre className={styles.documentBody}>{status.terms.content}</pre>
          </article>
          <article className={styles.document}>
            <div className={styles.documentHeader}>
              <div><p className="eyebrow">PRIVACY NOTICE</p><h3>{status.privacyNotice.title}</h3></div>
              <span className={styles.status}>개인정보 문서 {status.privacyNotice.version}</span>
            </div>
            <pre className={styles.documentBody}>{status.privacyNotice.content}</pre>
          </article>
        </section>

        <section className={styles.checks}>
          <p><strong>본인은 본인에게 개별 배정된 계정으로 로그인하였으며, 아래 이용조건을 직접 확인하고 동의합니다.</strong></p>
          <label className={styles.check}>
            <input type="checkbox" checked={termsChecked} onChange={(event) => setTermsChecked(event.target.checked)} disabled={submitting} />
            <span>[필수] SAN WMS 프로그램 이용조건 및 권리 안내를 확인하였으며 이에 동의합니다.</span>
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={privacyChecked} onChange={(event) => setPrivacyChecked(event.target.checked)} disabled={submitting} />
            <span>[필수] 본인확인 및 동의 기록 처리 안내를 확인하였으며 이에 동의합니다.</span>
          </label>
        </section>

        <p className={styles.notice}>동의 시 사용자 계정, 입력 성명, 앱 버전, 이용조건 문서 버전 및 동의 일시가 기록됩니다. 해당 기록은 이용조건의 고지 및 동의 사실을 확인하고 관련 분쟁에 대응하기 위한 증빙자료로 사용될 수 있습니다.</p>
        {error ? <p className={styles.error}>{error}</p> : null}

        <div className={styles.actions}>
          <button type="button" className="button button-secondary" onClick={() => void getSupabaseClient()?.auth.signOut()} disabled={submitting}>동의하지 않고 로그아웃</button>
          <button className="button button-primary" type="submit" disabled={submitting || !termsChecked || !privacyChecked || !enteredName.trim() || finalPin.length !== 6 || (needNewPin && (newPin.length !== 6 || pinConfirm.length !== 6))}>
            {submitting ? "서버 확인 중..." : "확인 및 동의"}
          </button>
        </div>
      </form>
    </main>
  );
}
