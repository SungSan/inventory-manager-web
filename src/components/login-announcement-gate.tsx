"use client";

import { useEffect, useState } from "react";
import { dismissLoginAnnouncement, getLoginAnnouncement, type LoginAnnouncement } from "@/lib/announcement-api";

export function LoginAnnouncementGate({ userId, sessionId, children }: {
  userId: string; sessionId: string; children: React.ReactNode;
}) {
  const [notice, setNotice] = useState<LoginAnnouncement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    const key = `san-wms-login-notice:${userId}:${sessionId}`;
    if (sessionStorage.getItem(key)) return;
    void getLoginAnnouncement()
      .then((value) => {
        if (!active) return;
        sessionStorage.setItem(key, "1");
        setNotice(value);
      })
      .catch(() => { if (active) sessionStorage.setItem(key, "1"); });
    return () => { active = false; };
  }, [sessionId, userId]);

  async function neverShowAgain() {
    if (!notice) return;
    setBusy(true); setMessage("");
    try { await dismissLoginAnnouncement(notice.id); setNotice(null); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "처리하지 못했습니다."); }
    finally { setBusy(false); }
  }

  return <>
    {children}
    {notice ? (
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="로그인 공지사항">
        <section className="selection-modal">
          <p className="eyebrow">NOTICE</p>
          <h2>{notice.title}</h2>
          <p className="muted">{new Date(notice.createdAt).toLocaleString("ko-KR")}</p>
          <div className="panel" style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{notice.content}</div>
          {message ? <p className="inline-error">{message}</p> : null}
          <div className="row-actions">
            {notice.allowNeverShow ? (
              <button className="button button-secondary" disabled={busy} onClick={() => void neverShowAgain()}>
                다시는 보지 않기
              </button>
            ) : null}
            <button className="button button-primary" disabled={busy} onClick={() => setNotice(null)}>확인</button>
          </div>
        </section>
      </div>
    ) : null}
  </>;
}
