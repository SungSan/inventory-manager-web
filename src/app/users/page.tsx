"use client";

import { useCallback, useEffect, useState } from "react";
import { Feedback, type FeedbackKind } from "@/components/feedback";
import { PermissionGuard } from "@/components/permission-guard";
import { subscribeToInventory, updateUserRole } from "@/lib/inventory-api";
import {
  adminRequireAllReconsent,
  adminRequireUserReconsent,
  adminResetUserPin,
  adminSetAccountType,
  adminUpdateAssignedName,
  listAdminUserSecurityStatus,
  type AdminUserSecurityStatus,
} from "@/lib/identity-api";
import { roleLabels } from "@/lib/permissions";
import type { UserRole } from "@/types/domain";

function UsersContent() {
  const [users, setUsers] = useState<AdminUserSecurityStatus[]>([]);
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; title: string; body?: string } | null>(null);
  const load = useCallback(async () => setUsers(await listAdminUserSecurityStatus()), []);
  useEffect(() => { void load(); return subscribeToInventory(() => void load()); }, [load]);

  async function run(userId: string, action: () => Promise<void>, success: string) {
    setBusyId(userId);
    try {
      await action();
      setFeedback({ kind: "success", title: success });
      await load();
    } catch (cause) {
      setFeedback({ kind: "error", title: "처리 실패", body: cause instanceof Error ? cause.message : "오류" });
    } finally {
      setBusyId("");
    }
  }

  async function changeRole(user: AdminUserSecurityStatus, role: UserRole) {
    await run(user.id, () => updateUserRole(user.id, role), `${user.assignedName || user.email} 권한을 ${roleLabels[role]}로 변경했습니다.`);
  }

  async function editAssignedName(user: AdminUserSecurityStatus) {
    const next = window.prompt("계정에 배정할 사용자의 전체 이름을 입력하세요.", user.assignedName || "");
    if (next == null) return;
    const reason = window.prompt("이름 변경 사유를 입력하세요. 변경 이력에 남습니다.", "관리자 정보 정정") ?? "";
    await run(user.id, () => adminUpdateAssignedName(user.id, next, reason), "배정 사용자 이름을 변경하고 재동의를 요구했습니다.");
  }

  async function setAccountType(user: AdminUserSecurityStatus, accountType: AdminUserSecurityStatus["accountType"]) {
    const service = accountType !== "HUMAN";
    await run(user.id, () => adminSetAccountType(user.id, accountType, service), "계정 유형을 변경했습니다.");
  }

  async function requireAll() {
    if (!window.confirm("모든 활성 HUMAN 계정에 최신 이용조건 재동의를 요구할까요? 기존 동의 기록은 삭제되지 않습니다.")) return;
    setBusyId("ALL");
    try {
      const count = await adminRequireAllReconsent();
      setFeedback({ kind: "success", title: "전체 재동의 요구 완료", body: `${count.toLocaleString()}개 계정에 적용했습니다.` });
      await load();
    } catch (cause) {
      setFeedback({ kind: "error", title: "처리 실패", body: cause instanceof Error ? cause.message : "오류" });
    } finally {
      setBusyId("");
    }
  }

  return <div className="page-stack">
    <section className="section-heading">
      <div><p className="eyebrow">ACCESS & IDENTITY CONTROL</p><h2>사용자·본인확인 관리</h2><p className="muted">기존 역할과 로그인 비밀번호는 유지하며, 배정 이름·PIN 설정 상태·최신 이용조건 동의 상태만 관리합니다. PIN 원문과 해시값은 이 화면과 API에 노출되지 않습니다.</p></div>
      <button className="button button-secondary" onClick={() => void requireAll()} disabled={busyId === "ALL"}>전체 사용자 재동의 요구</button>
    </section>
    {feedback ? <Feedback kind={feedback.kind} title={feedback.title}>{feedback.body}</Feedback> : null}
    <section className="panel">
      <div className="table-wrap"><table>
        <thead><tr><th>사용자</th><th>로그인 ID</th><th>역할</th><th>계정 유형</th><th>PIN</th><th>최신 이용조건</th><th>관리</th></tr></thead>
        <tbody>{users.map((user) => {
          const busy = busyId === user.id;
          return <tr key={user.id}>
            <td><strong>{user.legalName || user.assignedName || "이름 미등록"}</strong><br/><small className="muted">배정: {user.assignedName || "-"}</small></td>
            <td>{user.email}<br/><span className={`status-badge ${user.active ? "active" : "inactive"}`}>{user.active ? "사용" : "중지"}</span></td>
            <td><select value={user.role} onChange={(event) => void changeRole(user, event.target.value as UserRole)} disabled={busy}>
              <option value="admin">관리자</option><option value="manager">매니저</option><option value="operator">작업자</option><option value="viewer">조회자</option>
            </select></td>
            <td><select value={user.accountType} onChange={(event) => void setAccountType(user, event.target.value as AdminUserSecurityStatus["accountType"])} disabled={busy}>
              <option value="HUMAN">HUMAN</option><option value="SERVICE">SERVICE</option><option value="API">API</option><option value="AUTOMATION">AUTOMATION</option><option value="SYSTEM">SYSTEM</option>
            </select><br/><small className="muted">{user.isServiceAccount ? "최초 절차 제외" : "본인확인 대상"}</small></td>
            <td><span className={`status-badge ${user.pinConfigured ? "success" : "inactive"}`}>{user.pinConfigured ? "설정 완료" : user.pinResetRequired ? "재설정 필요" : "미설정"}</span><br/><small>{user.pinSetAt ? new Date(user.pinSetAt).toLocaleString("ko-KR") : "-"}</small></td>
            <td><span className={`status-badge ${user.latestTermsAccepted ? "success" : "inactive"}`}>{user.latestTermsAccepted ? "동의 완료" : "재동의 필요"}</span><br/><small>{user.latestTermsVersion || "-"} {user.latestTermsAcceptedAt ? `· ${new Date(user.latestTermsAcceptedAt).toLocaleDateString("ko-KR")}` : ""}</small></td>
            <td><div className="action-row">
              <button className="button button-secondary button-compact" onClick={() => void editAssignedName(user)} disabled={busy}>이름 수정</button>
              {!user.isServiceAccount && user.accountType === "HUMAN" ? <>
                <button className="button button-secondary button-compact" onClick={() => { if (window.confirm("관리자는 새 PIN을 지정하지 않습니다. 이 사용자가 다음 로그인에서 직접 새 PIN을 설정하도록 할까요?")) void run(user.id, () => adminResetUserPin(user.id), "PIN 재설정을 요구했습니다."); }} disabled={busy}>PIN 초기화</button>
                <button className="button button-secondary button-compact" onClick={() => void run(user.id, () => adminRequireUserReconsent(user.id), "최신 이용조건 재동의를 요구했습니다.")} disabled={busy}>재동의 요구</button>
              </> : null}
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>
  </div>;
}

export default function UsersPage() { return <PermissionGuard permission="manage_users"><UsersContent /></PermissionGuard>; }
