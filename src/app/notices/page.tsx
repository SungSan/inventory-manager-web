"use client";

import { useCallback, useEffect, useState } from "react";
import { Feedback, type FeedbackKind } from "@/components/feedback";
import { PermissionGuard } from "@/components/permission-guard";
import {
  adminListAnnouncements, adminSaveAnnouncement, type AdminAnnouncement,
} from "@/lib/announcement-api";

const emptyDraft = { id: "", title: "", content: "", isActive: true, allowNeverShow: false };

function NoticesContent() {
  const [items, setItems] = useState<AdminAnnouncement[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; title: string; body?: string } | null>(null);
  const load = useCallback(async () => setItems(await adminListAnnouncements()), []);
  useEffect(() => { void load().catch((cause) => setFeedback({ kind: "error", title: "공지를 불러오지 못했습니다.", body: cause instanceof Error ? cause.message : "오류" })); }, [load]);

  async function save() {
    if (!draft.title.trim() || !draft.content.trim()) {
      setFeedback({ kind: "warning", title: "공지 제목과 내용을 모두 입력하세요." }); return;
    }
    setBusy(true); setFeedback(null);
    try {
      await adminSaveAnnouncement({ id: draft.id || undefined, title: draft.title, content: draft.content, isActive: draft.isActive, allowNeverShow: draft.allowNeverShow });
      setFeedback({ kind: "success", title: draft.id ? "공지를 수정했습니다." : "공지를 등록했습니다.", body: draft.isActive ? "다음 로그인부터 사용자에게 표시됩니다." : "비활성 상태로 저장했습니다." });
      setDraft(emptyDraft); await load();
    } catch (cause) {
      setFeedback({ kind: "error", title: "공지 저장 실패", body: cause instanceof Error ? cause.message : "오류" });
    } finally { setBusy(false); }
  }
  function edit(item: AdminAnnouncement) {
    setDraft({ id: item.id, title: item.title, content: item.content, isActive: item.isActive, allowNeverShow: item.allowNeverShow });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function toggle(item: AdminAnnouncement) {
    setBusy(true); setFeedback(null);
    try {
      await adminSaveAnnouncement({ id: item.id, title: item.title, content: item.content, isActive: !item.isActive, allowNeverShow: item.allowNeverShow });
      setFeedback({ kind: "success", title: item.isActive ? "공지를 비활성화했습니다." : "공지를 활성화했습니다." });
      await load();
    } catch (cause) { setFeedback({ kind: "error", title: "상태 변경 실패", body: cause instanceof Error ? cause.message : "오류" }); }
    finally { setBusy(false); }
  }

  return <div className="page-stack">
    <section className="section-heading"><div>
      <p className="eyebrow">ANNOUNCEMENTS</p><h2>공지사항 관리</h2>
      <p className="muted">활성 공지는 사용자가 로그인할 때마다 한 번 표시됩니다.</p>
    </div></section>
    {feedback ? <Feedback kind={feedback.kind} title={feedback.title}>{feedback.body}</Feedback> : null}
    <section className="panel">
      <h3>{draft.id ? "공지 수정" : "새 공지 등록"}</h3>
      <div className="form-grid">
        <label>제목<input maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label style={{ gridColumn: "1 / -1" }}>내용<textarea rows={8} maxLength={5000} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} /></label>
      </div>
      <div className="row-actions">
        <label className="checkbox-label"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />활성화</label>
        <label className="checkbox-label"><input type="checkbox" checked={draft.allowNeverShow} onChange={(event) => setDraft({ ...draft, allowNeverShow: event.target.checked })} />사용자에게 ‘다시는 보지 않기’ 허용</label>
        <button className="button button-primary" disabled={busy} onClick={() => void save()}>{draft.id ? "공지 수정 저장" : "공지 등록"}</button>
        {draft.id ? <button className="button button-secondary" disabled={busy} onClick={() => setDraft(emptyDraft)}>수정 취소</button> : null}
      </div>
    </section>
    <section className="panel">
      <h3>공지 이력</h3>
      <div className="table-wrap"><table><thead><tr><th>상태</th><th>제목</th><th>다시 보지 않기</th><th>등록자·일시</th><th>관리</th></tr></thead>
        <tbody>{items.map((item) => <tr key={item.id}>
          <td><span className={`status-badge ${item.isActive ? "active" : "inactive"}`}>{item.isActive ? "활성" : "비활성"}</span></td>
          <td><strong>{item.title}</strong><br/><small className="muted">{item.content.length > 90 ? `${item.content.slice(0, 90)}…` : item.content}</small></td>
          <td>{item.allowNeverShow ? "허용" : "미허용"}</td>
          <td>{item.createdByLabel || "-"}<br/><small>{new Date(item.createdAt).toLocaleString("ko-KR")}</small></td>
          <td><div className="action-row"><button className="button button-secondary button-compact" disabled={busy} onClick={() => edit(item)}>수정</button><button className="button button-secondary button-compact" disabled={busy} onClick={() => void toggle(item)}>{item.isActive ? "비활성화" : "활성화"}</button></div></td>
        </tr>)}</tbody></table></div>
      {items.length === 0 ? <p className="empty-state">등록된 공지가 없습니다.</p> : null}
    </section>
  </div>;
}

export default function NoticesPage() {
  return <PermissionGuard permission="manage_users"><NoticesContent /></PermissionGuard>;
}
