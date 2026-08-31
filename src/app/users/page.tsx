"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Feedback, type FeedbackKind } from "@/components/feedback";
import { PermissionGuard } from "@/components/permission-guard";
import { useUser } from "@/components/user-provider";
import { subscribeToInventory, updateUserRole } from "@/lib/inventory-api";
import {
  adminListBenefitFeatureGrants,
  adminSetBenefitFeatureGrant,
} from "@/lib/benefit-api";
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
import { adminIssueClientControl, type ClientControlAction } from "@/lib/client-control-api";
import { getSupabaseClient } from "@/lib/supabase";
import type { UserRole } from "@/types/domain";
import type { MenuAccessLevel, ProductScope } from "@/types/domain";
import {
  adminGetUserAccessConfig,
  adminSaveUserAccessConfig,
  menuDefinitions,
  type UserAccessConfig,
} from "@/lib/access-control-api";

function formatDateTime(value?: string): string {
  return value ? new Date(value).toLocaleString("ko-KR") : "접속 기록 없음";
}

function UsersContent() {
  const { user: currentUser } = useUser();
  const [users, setUsers] = useState<AdminUserSecurityStatus[]>([]);
  const [benefitGrants, setBenefitGrants] = useState<Record<string, boolean>>(
    {},
  );
  const [showDeleted, setShowDeleted] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState<{
    kind: FeedbackKind;
    title: string;
    body?: string;
  } | null>(null);
  const [accessUser, setAccessUser] = useState<AdminUserSecurityStatus | null>(
    null,
  );
  const [accessDraft, setAccessDraft] = useState<UserAccessConfig | null>(null);
  const load = useCallback(async () => {
    const [nextUsers, grants] = await Promise.all([
      listAdminUserSecurityStatus(),
      adminListBenefitFeatureGrants(),
    ]);
    setUsers(nextUsers);
    setBenefitGrants(
      Object.fromEntries(grants.map((grant) => [grant.userId, grant.enabled])),
    );
  }, []);
  useEffect(() => {
    void load();
    return subscribeToInventory(load, { scope: "users", fallbackMs: 60_000 });
  }, [load]);

  const visibleUsers = useMemo(
    () => users.filter((user) => showDeleted || !user.deletedAt),
    [showDeleted, users],
  );
  const deletedCount = useMemo(
    () => users.filter((user) => Boolean(user.deletedAt)).length,
    [users],
  );

  async function run(
    userId: string,
    action: () => Promise<void>,
    success: string,
  ) {
    setBusyId(userId);
    try {
      await action();
      setFeedback({ kind: "success", title: success });
      await load();
    } catch (cause) {
      setFeedback({
        kind: "error",
        title: "처리 실패",
        body: cause instanceof Error ? cause.message : "오류",
      });
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
    await run(
      user.id,
      () => updateUserRole(user.id, role),
      `${user.assignedName || user.email} 권한을 ${roleLabels[role]}로 변경했습니다.`,
    );
  }

  async function openAccessEditor(user: AdminUserSecurityStatus) {
    setBusyId(user.id);
    try {
      setAccessDraft(await adminGetUserAccessConfig(user.id));
      setAccessUser(user);
    } catch (cause) {
      setFeedback({
        kind: "error",
        title: "세부권한을 불러오지 못했습니다.",
        body: cause instanceof Error ? cause.message : "오류",
      });
    } finally {
      setBusyId("");
    }
  }

  function setMenuLevel(key: string, level: MenuAccessLevel) {
    setAccessDraft((current) =>
      current
        ? { ...current, menuAccess: { ...current.menuAccess, [key]: level } }
        : current,
    );
  }

  function toggleScope(scope: ProductScope) {
    setAccessDraft((current) => {
      if (!current) return current;
      const exists = current.productScopes.includes(scope);
      const next = exists
        ? current.productScopes.filter((item) => item !== scope)
        : [...current.productScopes, scope];
      return { ...current, productScopes: next };
    });
  }

  async function saveAccessEditor() {
    if (!accessUser || !accessDraft || accessDraft.productScopes.length === 0)
      return;
    await run(
      accessUser.id,
      () => adminSaveUserAccessConfig(accessUser.id, accessDraft),
      "사용자별 메뉴·상품 접근권한을 저장했습니다.",
    );
    setAccessUser(null);
    setAccessDraft(null);
  }

  async function toggleBenefitFeature(user: AdminUserSecurityStatus) {
    const next = !Boolean(benefitGrants[user.id]);
    const reason = askReason(
      next
        ? "특전 자동계산 사용 승인 사유를 입력하세요."
        : "특전 자동계산 사용 승인 회수 사유를 입력하세요.",
      next ? "특전 업무 담당 계정 승인" : "특전 업무 권한 회수",
    );
    if (!reason) return;
    if (
      !window.confirm(
        `${user.assignedName || user.email} 계정의 특전 자동계산 기능을 ${next ? "허용" : "차단"}할까요?\n\n역할 등급과는 별도로 적용됩니다.`,
      )
    )
      return;
    await run(
      user.id,
      () => adminSetBenefitFeatureGrant(user.id, next, reason),
      `특전 자동계산 기능을 ${next ? "허용" : "차단"}했습니다.`,
    );
  }

  async function editAssignedName(user: AdminUserSecurityStatus) {
    const next = window.prompt(
      "계정에 배정할 사용자의 전체 이름을 입력하세요.",
      user.assignedName || "",
    );
    if (next == null) return;
    const reason =
      window.prompt(
        "이름 변경 사유를 입력하세요. 변경 이력에 남습니다.",
        "관리자 정보 정정",
      ) ?? "";
    await run(
      user.id,
      () => adminUpdateAssignedName(user.id, next, reason),
      "배정 사용자 이름을 변경하고 재동의를 요구했습니다.",
    );
  }

  async function setAccountType(
    user: AdminUserSecurityStatus,
    accountType: AdminUserSecurityStatus["accountType"],
  ) {
    const service = accountType !== "HUMAN";
    await run(
      user.id,
      () => adminSetAccountType(user.id, accountType, service),
      "계정 유형을 변경했습니다.",
    );
  }

  async function disableUser(user: AdminUserSecurityStatus) {
    const reason = askReason(
      "사용금지 사유를 입력하세요. 감사 로그에 기록됩니다.",
      "퇴사·계정 회수",
    );
    if (!reason) return;
    if (
      !window.confirm(
        `${user.assignedName || user.email} 계정을 즉시 사용금지 처리할까요? 현재 로그인 세션도 업무 기능에 접근할 수 없게 됩니다.`,
      )
    )
      return;
    await run(
      user.id,
      () => adminSetUserActive(user.id, false, reason),
      "사용자 계정을 사용금지 처리했습니다.",
    );
  }

  async function enableUser(user: AdminUserSecurityStatus) {
    if (
      !window.confirm(
        `${user.assignedName || user.email} 계정의 사용을 다시 허용할까요?`,
      )
    )
      return;
    await run(
      user.id,
      () => adminSetUserActive(user.id, true, "관리자 사용 허용"),
      "사용자 계정의 사용을 허용했습니다.",
    );
  }

  async function deleteUser(user: AdminUserSecurityStatus) {
    const reason = askReason(
      "계정 삭제 사유를 입력하세요. 작업·동의·감사 이력은 보존됩니다.",
      "퇴사·계정 삭제",
    );
    if (!reason) return;
    if (
      !window.confirm(
        `${user.assignedName || user.email} 계정을 삭제 상태로 전환할까요?\n\n로그인은 차단되며 일반 사용자 목록에서 숨겨집니다. 기존 작업·동의·감사 기록은 보존됩니다.`,
      )
    )
      return;
    await run(
      user.id,
      () => adminDeleteUserAccount(user.id, reason),
      "사용자 계정을 삭제 상태로 전환했습니다.",
    );
  }

  async function restoreUser(user: AdminUserSecurityStatus) {
    const reason = askReason(
      "삭제 복구 사유를 입력하세요.",
      "관리자 삭제 복구",
    );
    if (!reason) return;
    if (
      !window.confirm(
        `${user.assignedName || user.email} 계정을 복구할까요? 복구 후 사용자가 PIN 재설정과 최신 이용조건 동의를 다시 진행해야 합니다.`,
      )
    )
      return;
    await run(
      user.id,
      () => adminRestoreDeletedUser(user.id, reason),
      "삭제된 사용자 계정을 복구했습니다.",
    );
  }

  async function requireAll() {
    if (
      !window.confirm(
        "모든 활성 HUMAN 계정에 최신 이용조건 재동의를 요구할까요? 기존 동의 기록은 삭제되지 않습니다.",
      )
    )
      return;
    setBusyId("ALL");
    try {
      const count = await adminRequireAllReconsent();
      setFeedback({
        kind: "success",
        title: "전체 재동의 요구 완료",
        body: `${count.toLocaleString()}개 계정에 적용했습니다.`,
      });
      await load();
    } catch (cause) {
      setFeedback({
        kind: "error",
        title: "처리 실패",
        body: cause instanceof Error ? cause.message : "오류",
      });
    } finally {
      setBusyId("");
    }
  }

  async function issueClientControl(action: ClientControlAction) {
    const label = action === "RELOAD" ? "전체 강제 새로고침" : "전체 로그아웃";
    if (!window.confirm(`${label}을 실행할까요? 현재 SAN WMS를 열어 둔 모든 사용자에게 적용됩니다.`)) return;
    setBusyId(`CONTROL_${action}`);
    try {
      await adminIssueClientControl(action);
      if (action === "SIGN_OUT") {
        await getSupabaseClient()?.auth.signOut({ scope: "local" });
        window.location.assign("/");
        return;
      }
      window.location.reload();
    } catch (cause) {
      setFeedback({ kind: "error", title: "명령 전송 실패", body: cause instanceof Error ? cause.message : "오류" });
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div>
          <p className="eyebrow">ACCESS & IDENTITY CONTROL</p>
          <h2>사용자·본인확인 관리</h2>
          <p className="muted">
            역할, 계정 사용 여부와 별도로 특정 기능의 계정별 승인을 관리합니다.
            특전 자동계산은 조회자도 별도 승인되면 사용할 수 있고,
            매니저·관리자도 승인되지 않으면 메뉴와 데이터에 접근할 수 없습니다.
          </p>
        </div>
        <div className="row-actions">
          <button className="button button-secondary" onClick={() => void issueClientControl("RELOAD")} disabled={Boolean(busyId)}>
            전체 강제 새로고침
          </button>
          <button className="button button-danger" onClick={() => void issueClientControl("SIGN_OUT")} disabled={Boolean(busyId)}>
            전체 로그아웃
          </button>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(event) => setShowDeleted(event.target.checked)}
            />
            삭제 사용자 표시 ({deletedCount})
          </label>
          <button
            className="button button-secondary"
            onClick={() => void requireAll()}
            disabled={busyId === "ALL"}
          >
            전체 사용자 재동의 요구
          </button>
        </div>
      </section>
      {feedback ? (
        <Feedback kind={feedback.kind} title={feedback.title}>
          {feedback.body}
        </Feedback>
      ) : null}
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>사용자</th>
                <th>로그인 ID·상태</th>
                <th>마지막 로그인</th>
                <th>역할</th>
                <th>특전 자동계산</th>
                <th>계정 유형</th>
                <th>PIN</th>
                <th>동의 상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => {
                const busy = busyId === user.id;
                const deleted = Boolean(user.deletedAt);
                const isSelf = currentUser?.id === user.id;
                const editable = !busy && !deleted && user.active;
                const benefitEnabled = Boolean(benefitGrants[user.id]);
                return (
                  <tr key={user.id}>
                    <td>
                      <strong>
                        {user.legalName || user.assignedName || "이름 미등록"}
                      </strong>
                      <br />
                      <small className="muted">
                        배정: {user.assignedName || "-"}
                      </small>
                    </td>
                    <td>
                      {user.email}
                      <br />
                      <span
                        className={`status-badge ${deleted || !user.active ? "inactive" : "active"}`}
                      >
                        {deleted ? "삭제" : user.active ? "사용" : "사용금지"}
                      </span>
                      {isSelf ? (
                        <span className="status-badge primary">현재 계정</span>
                      ) : null}
                      {deleted ? (
                        <>
                          <br />
                          <small className="muted">
                            {user.deletedAt
                              ? new Date(user.deletedAt).toLocaleString("ko-KR")
                              : ""}{" "}
                            · {user.deletionReason || "사유 없음"}
                          </small>
                        </>
                      ) : !user.active ? (
                        <>
                          <br />
                          <small className="muted">
                            {user.disabledAt
                              ? new Date(user.disabledAt).toLocaleString(
                                  "ko-KR",
                                )
                              : ""}{" "}
                            · {user.disableReason || "사유 없음"}
                          </small>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <strong>{formatDateTime(user.lastSignInAt)}</strong>
                      <br />
                      <small className="muted">Supabase 인증 성공 기준</small>
                      <br />
                      <strong>{user.lastAccessIp || "IP 기록 없음"}</strong>
                      <br />
                      <small className="muted">앱 접속 {formatDateTime(user.lastAccessAt)}</small>
                    </td>
                    <td>
                      <select
                        value={user.role}
                        onChange={(event) =>
                          void changeRole(user, event.target.value as UserRole)
                        }
                        disabled={!editable || isSelf}
                      >
                        <option value="admin">관리자</option>
                        <option value="manager">매니저</option>
                        <option value="operator">작업자</option>
                        <option value="viewer">조회자</option>
                      </select>
                    </td>
                    <td>
                      <span
                        className={`status-badge ${benefitEnabled ? "success" : "inactive"}`}
                      >
                        {benefitEnabled ? "사용 허용" : "차단"}
                      </span>
                      <br />
                      <button
                        className={`button button-compact ${benefitEnabled ? "button-danger" : "button-primary"}`}
                        disabled={!editable}
                        onClick={() => void toggleBenefitFeature(user)}
                      >
                        {benefitEnabled ? "승인 회수" : "사용 승인"}
                      </button>
                      <br />
                      <small className="muted">역할과 독립</small>
                    </td>
                    <td>
                      <select
                        value={user.accountType}
                        onChange={(event) =>
                          void setAccountType(
                            user,
                            event.target
                              .value as AdminUserSecurityStatus["accountType"],
                          )
                        }
                        disabled={!editable}
                      >
                        <option value="HUMAN">HUMAN</option>
                        <option value="SERVICE">SERVICE</option>
                        <option value="API">API</option>
                        <option value="AUTOMATION">AUTOMATION</option>
                        <option value="SYSTEM">SYSTEM</option>
                      </select>
                      <br />
                      <small className="muted">
                        {user.isServiceAccount
                          ? "최초 절차 제외"
                          : "본인확인 대상"}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`status-badge ${user.pinConfigured ? "success" : "inactive"}`}
                      >
                        {user.pinConfigured
                          ? "설정 완료"
                          : user.pinResetRequired
                            ? "재설정 필요"
                            : "미설정"}
                      </span>
                      <br />
                      <small>
                        {user.pinSetAt
                          ? new Date(user.pinSetAt).toLocaleString("ko-KR")
                          : "-"}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`status-badge ${user.latestTermsAccepted ? "success" : "inactive"}`}
                      >
                        {user.latestTermsAccepted ? "동의 완료" : "재동의 필요"}
                      </span>
                      <br />
                      <small>
                        앱{" "}
                        {user.latestAppVersion
                          ? `V${user.latestAppVersion}`
                          : "기록 없음"}
                      </small>
                      <br />
                      <small>
                        약관 {user.latestTermsVersion || "-"}
                        {user.latestTermsAcceptedAt
                          ? ` · ${new Date(user.latestTermsAcceptedAt).toLocaleString("ko-KR")}`
                          : ""}
                      </small>
                    </td>
                    <td>
                      <div className="action-row">
                        {deleted ? (
                          <button
                            className="button button-secondary button-compact"
                            onClick={() => void restoreUser(user)}
                            disabled={busy || isSelf}
                          >
                            삭제 복구
                          </button>
                        ) : (
                          <>
                            <button
                              className="button button-secondary button-compact"
                              onClick={() => void editAssignedName(user)}
                              disabled={!editable}
                            >
                              이름 수정
                            </button>
                            <button
                              className="button button-primary button-compact"
                              onClick={() => void openAccessEditor(user)}
                              disabled={!editable || isSelf}
                            >
                              세부권한
                            </button>
                            {!user.isServiceAccount &&
                            user.accountType === "HUMAN" ? (
                              <>
                                <button
                                  className="button button-secondary button-compact"
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        "관리자는 새 PIN을 지정하지 않습니다. 이 사용자가 다음 로그인에서 직접 새 PIN을 설정하도록 할까요?",
                                      )
                                    )
                                      void run(
                                        user.id,
                                        () => adminResetUserPin(user.id),
                                        "PIN 재설정을 요구했습니다.",
                                      );
                                  }}
                                  disabled={!editable}
                                >
                                  PIN 초기화
                                </button>
                                <button
                                  className="button button-secondary button-compact"
                                  onClick={() =>
                                    void run(
                                      user.id,
                                      () => adminRequireUserReconsent(user.id),
                                      "최신 이용조건 재동의를 요구했습니다.",
                                    )
                                  }
                                  disabled={!editable}
                                >
                                  재동의 요구
                                </button>
                              </>
                            ) : null}
                            {user.active ? (
                              <button
                                className="button button-secondary button-compact"
                                onClick={() => void disableUser(user)}
                                disabled={busy || isSelf}
                              >
                                사용금지
                              </button>
                            ) : (
                              <button
                                className="button button-secondary button-compact"
                                onClick={() => void enableUser(user)}
                                disabled={busy || isSelf}
                              >
                                사용허용
                              </button>
                            )}
                            <button
                              className="button button-danger button-compact"
                              onClick={() => void deleteUser(user)}
                              disabled={busy || isSelf}
                            >
                              삭제
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visibleUsers.length === 0 ? (
          <p className="empty-state">표시할 사용자가 없습니다.</p>
        ) : null}
      </section>
      {accessUser && accessDraft ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="사용자 세부권한"
        >
          <section className="selection-modal">
            <div className="section-heading">
              <div>
                <p className="eyebrow">USER ACCESS</p>
                <h3>{accessUser.assignedName || accessUser.email} 세부권한</h3>
                <p className="muted">
                  역할 기본값보다 아래 사용자별 설정을 우선 적용합니다.
                </p>
              </div>
              <button
                className="button button-ghost"
                onClick={() => {
                  setAccessUser(null);
                  setAccessDraft(null);
                }}
              >
                닫기
              </button>
            </div>
            <div className="panel">
              <h4>상품 데이터 범위</h4>
              <div className="action-row">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={accessDraft.productScopes.includes("ALBUM")}
                    onChange={() => toggleScope("ALBUM")}
                  />
                  앨범
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={accessDraft.productScopes.includes("MD")}
                    onChange={() => toggleScope("MD")}
                  />
                  MD
                </label>
              </div>
              {accessDraft.productScopes.length === 0 ? (
                <p className="inline-error">
                  최소 한 가지 상품 범위가 필요합니다.
                </p>
              ) : null}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>메뉴</th>
                    <th>권한</th>
                  </tr>
                </thead>
                <tbody>
                  {menuDefinitions.map(([key, label]) => (
                    <tr key={key}>
                      <td>
                        <strong>{label}</strong>
                      </td>
                      <td>
                        <select
                          value={accessDraft.menuAccess[key] ?? "USE"}
                          onChange={(event) =>
                            setMenuLevel(
                              key,
                              event.target.value as MenuAccessLevel,
                            )
                          }
                        >
                          <option value="HIDDEN">숨김·접근 차단</option>
                          <option value="VIEW">조회만</option>
                          <option value="USE">사용 가능</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="button button-primary button-full"
              disabled={
                accessDraft.productScopes.length === 0 ||
                busyId === accessUser.id
              }
              onClick={() => void saveAccessEditor()}
            >
              세부권한 저장
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default function UsersPage() {
  return (
    <PermissionGuard permission="manage_users">
      <UsersContent />
    </PermissionGuard>
  );
}
