"use client";

import { useCallback, useEffect, useState } from "react";
import { completeUserIdentityAndConsent, getUserAccessStatus, type UserAccessStatus } from "@/lib/identity-api";
import { getSupabaseClient } from "@/lib/supabase";
import styles from "./identity-consent-gate.module.css";

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
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
  const [receipt, setReceipt] = useState<{ confirmationNo: string; acceptedAt: string; termsVersion: string } | null>(null);

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
      const result = await completeUserIdentityAndConsent({
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
            <p>이용조건 버전 {receipt.termsVersion} · {new Date(receipt.acceptedAt).toLocaleString("ko-KR")}</p>
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
              </label>
              <label>
                새 개인 PIN 확인
                <input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={pinConfirm} onChange={(event) => setPinConfirm(digitsOnly(event.target.value))} autoComplete="new-password" required disabled={submitting} />
              </label>
            </>
          ) : (
            <div className={`${styles.notice} ${styles.spanTwo}`}>기존 개인 PIN이 설정되어 있습니다. 최신 이용조건 동의를 위해 마지막 단계에서 PIN을 다시 입력합니다.</div>
          )}

          <label className={styles.spanTwo}>
            최종 확인 PIN
            <input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={finalPin} onChange={(event) => setFinalPin(digitsOnly(event.target.value))} autoComplete="current-password" required disabled={submitting} />
            <p className={styles.pinHint}>PIN 원문은 저장되지 않으며 bcrypt 방식의 일방향 해시만 서버 비공개 영역에 저장됩니다.</p>
          </label>
        </section>

        <section className={styles.documentGrid}>
          <article className={styles.document}>
            <div className={styles.documentHeader}>
              <div><p className="eyebrow">TERMS</p><h3>{status.terms.title}</h3></div>
              <span className={styles.status}>버전 {status.terms.version}</span>
            </div>
            <pre className={styles.documentBody}>{status.terms.content}</pre>
          </article>
          <article className={styles.document}>
            <div className={styles.documentHeader}>
              <div><p className="eyebrow">PRIVACY NOTICE</p><h3>{status.privacyNotice.title}</h3></div>
              <span className={styles.status}>버전 {status.privacyNotice.version}</span>
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

        <p className={styles.notice}>동의 시 사용자 계정, 입력 성명, 이용조건 버전 및 동의 일시가 기록됩니다. 해당 기록은 이용조건의 고지 및 동의 사실을 확인하고 관련 분쟁에 대응하기 위한 증빙자료로 사용될 수 있습니다.</p>
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
