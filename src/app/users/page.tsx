"use client";

import { useCallback, useEffect, useState } from "react";
import { Feedback, type FeedbackKind } from "@/components/feedback";
import { PermissionGuard } from "@/components/permission-guard";
import { listUsers, subscribeToInventory, updateUserRole } from "@/lib/inventory-api";
import { roleLabels } from "@/lib/permissions";
import type { UserProfile, UserRole } from "@/types/domain";

function UsersContent() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; title: string; body?: string } | null>(null);
  const load = useCallback(async () => setUsers(await listUsers()), []);
  useEffect(() => { void load(); return subscribeToInventory(() => void load()); }, [load]);

  async function changeRole(user: UserProfile, role: UserRole) {
    try {
      await updateUserRole(user.id, role);
      setFeedback({ kind: "success", title: "권한 변경 완료", body: `${user.displayName}: ${roleLabels[role]}` });
      await load();
    } catch (cause) {
      setFeedback({ kind: "error", title: "권한 변경 실패", body: cause instanceof Error ? cause.message : "오류" });
    }
  }

  return <div className="page-stack">
    <section><p className="eyebrow">ACCESS CONTROL</p><h2>사용자 권한</h2><p className="muted">데모 모드에서는 상단 사용자 선택기로 각 역할의 화면과 권한을 시험할 수 있습니다. 실운영에서는 Supabase Auth 계정과 연결됩니다.</p></section>
    {feedback ? <Feedback kind={feedback.kind} title={feedback.title}>{feedback.body}</Feedback> : null}
    <section className="panel"><div className="table-wrap"><table><thead><tr><th>이름</th><th>이메일</th><th>상태</th><th>역할</th><th>권한 범위</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.displayName}</strong></td><td>{user.email}</td><td><span className={`status-badge ${user.active ? "active" : "inactive"}`}>{user.active ? "사용" : "중지"}</span></td><td><select value={user.role} onChange={(e) => void changeRole(user, e.target.value as UserRole)}><option value="admin">관리자</option><option value="manager">매니저</option><option value="operator">작업자</option><option value="viewer">조회자</option></select></td><td>{user.role === "admin" ? "전체 기능·사용자 관리" : user.role === "manager" ? "입출고·원복·데이터 이전" : user.role === "operator" ? "입출고·상품·로케이션·바코드" : "조회 전용"}</td></tr>)}</tbody></table></div></section>
  </div>;
}

export default function UsersPage() { return <PermissionGuard permission="manage_users"><UsersContent /></PermissionGuard>; }
