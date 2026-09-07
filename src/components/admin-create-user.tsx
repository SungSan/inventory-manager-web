"use client";

import { useState } from "react";
import { adminCreateUser } from "@/lib/admin-user-api";
import { generateTemporaryPassword } from "@/lib/password-policy-api";
import { roleLabels } from "@/lib/permissions";
import type { UserRole } from "@/types/domain";

export function AdminCreateUser({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [assignedName, setAssignedName] = useState("");
  const [role, setRole] = useState<UserRole>("operator");
  const [temporaryPassword, setTemporaryPassword] = useState(() => generateTemporaryPassword());

  function close() { if (!busy) { setOpen(false); setMessage(""); } }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await adminCreateUser({ email, assignedName, role, temporaryPassword });
      await onCreated();
      window.prompt("사용자에게 전달할 로그인 ID와 임시 비밀번호입니다. 이 창을 닫으면 비밀번호를 다시 확인할 수 없습니다.", `${email}\n${temporaryPassword}`);
      setEmail(""); setAssignedName(""); setRole("operator"); setTemporaryPassword(generateTemporaryPassword()); setOpen(false);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "사용자를 생성하지 못했습니다."); }
    finally { setBusy(false); }
  }

  return <>
    <button className="button button-primary" onClick={() => setOpen(true)}>새 사용자 생성</button>
    {open ? <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="새 사용자 생성">
      <form className="selection-modal" onSubmit={(event) => void submit(event)}>
        <div className="section-heading"><div><p className="eyebrow">CREATE USER</p><h3>새 사용자 생성</h3><p className="muted">일반 사용자는 첫 로그인 후 비밀번호를 반드시 변경해야 합니다.</p></div>
          <button type="button" className="button button-ghost" onClick={close}>닫기</button></div>
        <div className="form-grid">
          <label>로그인 ID (이메일)<input type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>사용자 이름<input required maxLength={80} value={assignedName} onChange={(event) => setAssignedName(event.target.value)} /></label>
          <label>역할<select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>{(["admin","manager","operator","viewer"] as UserRole[]).map((value) => <option value={value} key={value}>{roleLabels[value]}</option>)}</select></label>
          <label>임시 비밀번호<input required minLength={10} autoComplete="new-password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} /></label>
        </div>
        <small className="muted">10자 이상, 영문 대·소문자·숫자·특수문자를 모두 포함해야 합니다.</small>
        {message ? <p className="inline-error">{message}</p> : null}
        <button className="button button-primary button-full" disabled={busy} type="submit">{busy ? "생성 중..." : "사용자 1명 생성"}</button>
      </form>
    </div> : null}
  </>;
}
