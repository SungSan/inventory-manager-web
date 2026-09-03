"use client";

import { useState } from "react";
import { changeMyPassword } from "@/lib/password-policy-api";

export function PasswordChangeForm({ required = false, expiresAt, onChanged }: { required?: boolean; expiresAt?: string; onChanged?: () => void | Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setMessage("");
    if (newPassword !== confirm) { setError("새 비밀번호 확인이 일치하지 않습니다."); return; }
    setBusy(true);
    try {
      await changeMyPassword(currentPassword, newPassword);
      setCurrentPassword(""); setNewPassword(""); setConfirm("");
      setMessage("비밀번호를 변경했습니다. 다음 변경 기한은 90일 후입니다.");
      await onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "비밀번호를 변경하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <form className="panel page-stack" onSubmit={submit}>
    <div><p className="eyebrow">PASSWORD SECURITY</p><h2>{required ? "비밀번호 재설정이 필요합니다" : "내 비밀번호 변경"}</h2>
      <p className="muted">10자 이상, 영문 대·소문자·숫자·특수문자를 모두 사용하세요. 현재 및 이전에 사용한 비밀번호는 사용할 수 없습니다.</p>
      {required ? <p className="inline-error">{expiresAt ? `변경 기한 ${new Date(expiresAt).toLocaleString("ko-KR")}이 지났습니다.` : "최초 1회 비밀번호 변경이 필요합니다."} 변경 후 업무 화면을 사용할 수 있습니다.</p> : null}
    </div>
    <label>현재 비밀번호<input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required disabled={busy} /></label>
    <label>새 비밀번호<input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={10} required disabled={busy} /></label>
    <label>새 비밀번호 확인<input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={10} required disabled={busy} /></label>
    {error ? <p className="inline-error">{error}</p> : null}{message ? <p className="feedback">{message}</p> : null}
    <button className="button button-primary" type="submit" disabled={busy}>{busy ? "변경 중..." : "비밀번호 변경"}</button>
  </form>;
}
