"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Feedback, type FeedbackKind } from "@/components/feedback";
import { PermissionGuard } from "@/components/permission-guard";
import { useUser } from "@/components/user-provider";
import { subscribeToInventory, updateUserRole } from "@/lib/inventory-api";
import {
  adminDeleteUserAccount,
  adminRequireAllReconsent,
  adminRequireUserReconsent,
  adminResetUserPin,
  adminRestoreDeletedUser,
  adminSetAccountType,
  adminSetUserActive,
  adminUpdateAssignedName,
  listAdminUserSecurityStatus,
  type AdminUserSecurityStatus,
} from "@/lib/identity-api";
import { roleLabels } from "@/lib/permissions";
import type { UserRole } from "@/types/domain";

function UsersContent() {
  const { user: currentUser } = useUser();
  const [users, setUsers] = useState<AdminUserSecurityStatus[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; title: string; body?: string } | null>(null);
  const load = useCallback(async () => setUsers(await listAdminUserSecurityStatus()), []);
  useEffect(() => { void load(); return subscribeToInventory(() => void load()); }, [load]);

  const visibleUsers = useMemo(
    () => users.filter((user) => showDeleted || !user.deletedAt),
    [showDeleted, users],
  );
  const deletedCount = useMemo(() => users.filter((user) => Boolean(user.deletedAt)).length, [users]);

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

  function askReason(title: string, initialValue: string): string | null {
    const value = window.prompt(title, initialValue);
    if (value == null) return null;
    const trimmed = value.trim();
    if (!trimmed) {
      setFeedback({ kind: "warning", title: "사유를 입력해야 합니다." });
      return null;
    }
    return trimmed;
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

  async function disableUser(user: AdminUserSecurityStatus) {
    const reason = askReason("사용금지 사유를 입력하세요. 감사 로그에 기록됩니다.", "퇴사·계정 회수");
    if (!reason) return;
    if (!window.confirm(`${user.assignedName || user.email} 계정을 즉시 사용금지 처리할까요? 현재 로그인 세션도 업무 기능에 접근할 수 없게 됩니다.`)) return;
    await run(user.id, () => adminSetUserActive(user.id, false, reason), "사용자 계정을 사용금지 처리했습니다.");
  }

  async function enableUser(user: AdminUserSecurityStatus) {
    if (!window.confirm(`${user.assignedName || user.email} 계정의 사용을 다시 허용할까요?`)) return;
    await run(user.id, () => adminSetUserActive(user.id, true, "관리자 사용 허용"), "사용자 계정의 사용을 허용했습니다.");
  }

  async function deleteUser(user: AdminUserSecurityStatus) {
    const reason = askReason("계정 삭제 사유를 입력하세요. 작업·동의·감사 이력은 보존됩니다.", "퇴사·계정 삭제");
    if (!reason) return;
    if (!window.confirm(`${user.assignedName || user.email} 계정을 삭제 상태로 전환할까요?\n\n로그인은 차단되며 일반 사용자 목록에서 숨겨집니다. 기존 작업·동의·감사 기록은 보존됩니다.`)) return;
    await run(user.id, () => adminDeleteUserAccount(user.id, reason), "사용자 계정을 삭제 상태로 전환했습니다.");
  }

  async function restoreUser(user: AdminUserSecurityStatus) {
    const reason = askReason("삭제 복구 사유를 입력하세요.", "관리자 삭제 복구");
    if (!reason) return;
    if (!window.confirm(`${user.assignedName || user.email} 계정을 복구할까요? 복구 후 사용자가 PIN 재설정과 최신 이용조건 동의를 다시 진행해야 합니다.`)) return;
    await run(user.id, () => adminRestoreDeletedUser(user.id, reason), "삭제된 사용자 계정을 복구했습니다.");
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
      <div><p className="eyebrow">ACCESS & IDENTITY CONTROL</p><h2>사용자·본인확인 관리</h2><p className="muted">역할, 배정 이름, PIN·동의 상태와 계정 사용 여부를 관리합니다. 삭제는 작업·동의·감사 이력을 보존하는 논리 삭제 방식이며 PIN 원문과 해시값은 노출되지 않습니다.</p></div>
      <div className="row-actions">
        <label className="checkbox-label"><input type="checkbox" checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)} />삭제 사용자 표시 ({deletedCount})</label>
        <button className="button button-secondary" onClick={() => void requireAll()} disabled={busyId === "ALL"}>전체 사용자 재동의 요구</button>
      </div>
    </section>
    {feedback ? <Feedback kind={feedback.kind} title={feedback.title}>{feedback.body}</Feedback> : null}
    <section className="panel">
      <div className="table-wrap"><table>
        <thead><tr><th>사용자</th><th>로그인 ID·상태</th><th>역할</th><th>계정 유형</th><th>PIN</th><th>최신 이용조건</th><th>관리</th></tr></thead>
        <tbody>{visibleUsers.map((user) => {
          const busy = busyId === user.id;
          const deleted = Boolean(user.deletedAt);
          const isSelf = currentUser?.id === user.id;
          const editable = !busy && !deleted && user.active;
          return <tr key={user.id}>
            <td><strong>{user.legalName || user.assignedName || "이름 미등록"}</strong><br/><small className="muted">배정: {user.assignedName || "-"}</small></td>
            <td>{user.email}<br/>
              <span className={`status-badge ${deleted || !user.active ? "inactive" : "active"}`}>{deleted ? "삭제" : user.active ? "사용" : "사용금지"}</span>
              {isSelf ? <span className="status-badge primary">현재 계정</span> : null}
              {deleted ? <><br/><small className="muted">{user.deletedAt ? new Date(user.deletedAt).toLocaleString("ko-KR") : ""} · {user.deletionReason || "사유 없음"}</small></> : !user.active ? <><br/><small className="muted">{user.disabledAt ? new Date(user.disabledAt).toLocaleString("ko-KR") : ""} · {user.disableReason || "사유 없음"}</small></> : null}
            </td>
            <td><select value={user.role} onChange={(event) => void changeRole(user, event.target.value as UserRole)} disabled={!editable || isSelf}>
              <option value="admin">관리자</option><option value="manager">매니저</option><option value="operator">작업자</option><option value="viewer">조회자</option>
            </select></td>
            <td><select value={user.accountType} onChange={(event) => void setAccountType(user, event.target.value as AdminUserSecurityStatus["accountType"])} disabled={!editable}>
              <option value="HUMAN">HUMAN</option><option value="SERVICE">SERVICE</option><option value="API">API</option><option value="AUTOMATION">AUTOMATION</option><option value="SYSTEM">SYSTEM</option>
            </select><br/><small className="muted">{user.isServiceAccount ? "최초 절차 제외" : "본인확인 대상"}</small></td>
            <td><span className={`status-badge ${user.pinConfigured ? "success" : "inactive"}`}>{user.pinConfigured ? "설정 완료" : user.pinResetRequired ? "재설정 필요" : "미설정"}</span><br/><small>{user.pinSetAt ? new Date(user.pinSetAt).toLocaleString("ko-KR") : "-"}</small></td>
            <td><span className={`status-badge ${user.latestTermsAccepted ? "success" : "inactive"}`}>{user.latestTermsAccepted ? "동의 완료" : "재동의 필요"}</span><br/><small>{user.latestTermsVersion || "-"} {user.latestTermsAcceptedAt ? `· ${new Date(user.latestTermsAcceptedAt).toLocaleDateString("ko-KR")}` : ""}</small></td>
            <td><div className="action-row">
              {deleted ? <button className="button button-secondary button-compact" onClick={() => void restoreUser(user)} disabled={busy || isSelf}>삭제 복구</button> : <>
                <button className="button button-secondary button-compact" onClick={() => void editAssignedName(user)} disabled={!editable}>이름 수정</button>
                {!user.isServiceAccount && user.accountType === "HUMAN" ? <>
                  <button className="button button-secondary button-compact" onClick={() => { if (window.confirm("관리자는 새 PIN을 지정하지 않습니다. 이 사용자가 다음 로그인에서 직접 새 PIN을 설정하도록 할까요?")) void run(user.id, () => adminResetUserPin(user.id), "PIN 재설정을 요구했습니다."); }} disabled={!editable}>PIN 초기화</button>
                  <button className="button button-secondary button-compact" onClick={() => void run(user.id, () => adminRequireUserReconsent(user.id), "최신 이용조건 재동의를 요구했습니다.")} disabled={!editable}>재동의 요구</button>
                </> : null}
                {user.active ? <button className="button button-secondary button-compact" onClick={() => void disableUser(user)} disabled={busy || isSelf}>사용금지</button> : <button className="button button-secondary button-compact" onClick={() => void enableUser(user)} disabled={busy || isSelf}>사용허용</button>}
                <button className="button button-danger button-compact" onClick={() => void deleteUser(user)} disabled={busy || isSelf}>삭제</button>
              </>}
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>
      {visibleUsers.length === 0 ? <p className="empty-state">표시할 사용자가 없습니다.</p> : null}
    </section>
  </div>;
}

export default function UsersPage() { return <PermissionGuard permission="manage_users"><UsersContent /></PermissionGuard>; }
