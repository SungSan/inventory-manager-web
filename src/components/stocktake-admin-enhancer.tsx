"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useUser } from "@/components/user-provider";
import { getSupabaseClient } from "@/lib/supabase";
import { getInventoryCountDashboard, type InventoryCountSessionSummary } from "@/lib/stocktake-api";

async function deleteSession(sessionId: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase 연결 설정을 확인하세요.");
  const { error } = await client.rpc("delete_inventory_count_session", { p_session_id: sessionId });
  if (error) throw new Error(error.message);
}

export function StocktakeAdminEnhancer({ active }: { active: boolean }) {
  const { user } = useUser();
  const [target, setTarget] = useState<Element | null>(null);
  const [sessions, setSessions] = useState<InventoryCountSessionSummary[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const canDelete = user?.role === "admin";

  const load = useCallback(async () => {
    if (!active || !canDelete) return;
    const dashboard = await getInventoryCountDashboard();
    setSessions(dashboard.sessions.filter((session) => session.status === "COMPLETED" || session.status === "CANCELLED"));
  }, [active, canDelete]);

  useEffect(() => {
    if (!active || !canDelete) return;
    setTarget(document.querySelector(".page-stack"));
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "마무리 작업을 불러오지 못했습니다."));
  }, [active, canDelete, load]);

  async function remove(session: InventoryCountSessionSummary) {
    if (!window.confirm(`${session.countNo} 작업을 삭제할까요?\n실사 조정 거래와 감사 로그는 유지됩니다.`)) return;
    setBusy(session.id); setError("");
    try { await deleteSession(session.id); await load(); window.location.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "실사 작업을 삭제하지 못했습니다."); }
    finally { setBusy(""); }
  }

  if (!target || sessions.length === 0) return null;
  return createPortal(
    <section className="panel stocktake-admin-cleanup">
      <div className="section-heading"><div><p className="eyebrow">ADMIN CLEANUP</p><h3>마무리된 실사 작업 관리</h3><p className="muted small">완료·취소 작업만 관리자에게 표시됩니다.</p></div></div>
      {error ? <p className="inline-error">{error}</p> : null}
      <div className="stocktake-cleanup-list">{sessions.map((session) => <article key={session.id}><div><strong>{session.countNo}</strong><span>{session.status} · {session.targetCount.toLocaleString()} LOC</span></div><button className="button button-danger button-compact" disabled={busy === session.id} onClick={() => void remove(session)}>{busy === session.id ? "삭제 중..." : "작업 삭제"}</button></article>)}</div>
    </section>, target,
  );
}

export function StocktakeSessionSortEnhancer({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;
    let sorting = false;
    const apply = () => {
      if (sorting) return;
      const panel = Array.from(document.querySelectorAll<HTMLElement>("section.panel"))
        .find((section) => section.textContent?.includes("실사 대상 로케이션"));
      if (!panel) return;
      const container = Array.from(panel.querySelectorAll<HTMLElement>("div"))
        .find((element) => Array.from(element.children).some((child) => (
          child.tagName === "ARTICLE" && Boolean(child.querySelector(".status-badge"))
        )));
      if (!container) return;

      const priority: Record<string, number> = { IN_PROGRESS: 0, PENDING: 1, CANCELLED: 2, COMPLETED: 3 };
      const current = Array.from(container.children).filter((node): node is HTMLElement => (
        node instanceof HTMLElement && node.tagName === "ARTICLE" && Boolean(node.querySelector(".status-badge"))
      ));
      const sorted = [...current].sort((a, b) => {
        const sa = a.querySelector(".status-badge")?.textContent?.trim() || "";
        const sb = b.querySelector(".status-badge")?.textContent?.trim() || "";
        return (priority[sa] ?? 9) - (priority[sb] ?? 9);
      });
      if (sorted.every((node, index) => node === current[index])) return;
      sorting = true;
      sorted.forEach((node) => container.appendChild(node));
      sorting = false;
    };
    apply();
    const observer = new MutationObserver(() => window.setTimeout(apply, 0));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [active]);
  return null;
}
