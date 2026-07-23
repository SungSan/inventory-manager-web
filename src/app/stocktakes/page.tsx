"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PermissionGuard } from "@/components/permission-guard";
import {
  createInventoryCountSession,
  getInventoryCountDashboard,
  type InventoryCountDashboard,
  type InventoryCountLocationStatus,
  type InventoryCountStatus,
} from "@/lib/stocktake-api";
import styles from "./stocktakes.module.css";

const statusLabel: Record<InventoryCountStatus, string> = {
  COMPLETE: "실사 완료",
  DUE_SOON: "재실사 임박",
  DUE: "재실사 필요",
  NEVER: "미실사",
  PLANNED: "실사 예정",
  IN_PROGRESS: "실사 진행 중",
};

const statusClass: Record<InventoryCountStatus, string> = {
  COMPLETE: styles.complete,
  DUE_SOON: styles.dueSoon,
  DUE: styles.due,
  NEVER: styles.never,
  PLANNED: styles.planned,
  IN_PROGRESS: styles.inProgress,
};

function formatDate(value?: string): string {
  return value ? new Date(value).toLocaleDateString("ko-KR") : "-";
}

function StocktakesContent() {
  const [dashboard, setDashboard] = useState<InventoryCountDashboard | null>(null);
  const [scopeType, setScopeType] = useState<"ALL" | "ZONE" | "LOCATIONS" | "DUE">("ALL");
  const [zone, setZone] = useState("");
  const [locationId, setLocationId] = useState("");
  const [note, setNote] = useState("");
  const [statusFilter, setStatusFilter] = useState<InventoryCountStatus | "ALL">("ALL");
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setDashboard(await getInventoryCountDashboard());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "재고실사 현황을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const zones = useMemo(
    () => Array.from(new Set((dashboard?.locations ?? []).map((row) => row.zone).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, "ko", { numeric: true })),
    [dashboard],
  );

  const visibleLocations = useMemo(() => {
    const normalized = keyword.trim().toUpperCase();
    return (dashboard?.locations ?? []).filter((row) => {
      if (statusFilter !== "ALL" && row.countStatus !== statusFilter) return false;
      if (!normalized) return true;
      return `${row.locationCode} ${row.zone}`.toUpperCase().includes(normalized);
    });
  }, [dashboard, keyword, statusFilter]);

  async function createSession() {
    if (scopeType === "ZONE" && !zone) { setError("실사할 구역을 선택하세요."); return; }
    if (scopeType === "LOCATIONS" && !locationId) { setError("실사할 로케이션을 선택하세요."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await createInventoryCountSession({ scopeType, zone: scopeType === "ZONE" ? zone : undefined, locationIds: scopeType === "LOCATIONS" ? [locationId] : undefined, note });
      setMessage(`${result.countNo} · ${result.targetCount.toLocaleString()}개 로케이션 실사를 생성했습니다.`);
      setNote(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "재고실사 작업을 생성하지 못했습니다."); }
    finally { setBusy(false); }
  }

  const summary = dashboard?.summary;

  return (
    <div className={`page-stack ${styles.page}`}>
      <section><p className="eyebrow">CYCLE COUNT</p><h2>재고실사</h2><p className="muted">로케이션별 실사 이력과 3개월 재실사 주기를 관리합니다. 실사 시작 후 완료·취소 전까지 해당 LOC의 입고·출고·이관은 잠깁니다.</p></section>
      {error ? <p className="inline-error">{error}</p> : null}
      {message ? <div className="feedback feedback-success"><strong>{message}</strong></div> : null}
      <section className={styles.metricGrid}>
        <article><span>전체 대상</span><strong>{(summary?.total ?? 0).toLocaleString()}</strong></article>
        <article className={styles.completeCard}><span>최근 3개월 완료</span><strong>{(summary?.complete ?? 0).toLocaleString()}</strong></article>
        <article className={styles.dueSoonCard}><span>재실사 임박</span><strong>{(summary?.dueSoon ?? 0).toLocaleString()}</strong></article>
        <article className={styles.dueCard}><span>재실사 필요</span><strong>{(summary?.due ?? 0).toLocaleString()}</strong></article>
        <article className={styles.neverCard}><span>미실사</span><strong>{(summary?.never ?? 0).toLocaleString()}</strong></article>
        <article className={styles.progressCard}><span>진행·예정</span><strong>{((summary?.inProgress ?? 0) + (summary?.planned ?? 0)).toLocaleString()}</strong></article>
      </section>
      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">NEW COUNT</p><h3>신규 재고실사 생성</h3></div></div>
        <div className={styles.createGrid}>
          <label>실사 범위<select value={scopeType} onChange={(event) => setScopeType(event.target.value as typeof scopeType)} disabled={busy}><option value="ALL">전체 활성 로케이션</option><option value="DUE">재실사 필요·미실사만</option><option value="ZONE">구역별 실사</option><option value="LOCATIONS">특정 로케이션</option></select></label>
          {scopeType === "ZONE" ? <label>구역<select value={zone} onChange={(event) => setZone(event.target.value)} disabled={busy}><option value="">구역 선택</option>{zones.map((item) => <option key={item} value={item}>{item}</option>)}</select></label> : null}
          {scopeType === "LOCATIONS" ? <label>로케이션<select value={locationId} onChange={(event) => setLocationId(event.target.value)} disabled={busy}><option value="">로케이션 선택</option>{(dashboard?.locations ?? []).map((item) => <option key={item.locationId} value={item.locationId}>{item.locationCode} · {statusLabel[item.countStatus]}</option>)}</select></label> : null}
          <label className={styles.noteField}>메모(선택)<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="예: 3분기 전체 재고실사" disabled={busy} /></label>
          <button className="button button-primary" onClick={() => void createSession()} disabled={busy}>{busy ? "생성 중..." : "재고실사 생성"}</button>
        </div>
      </section>
      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">SESSIONS</p><h3>재고실사 작업</h3></div><button className="button button-secondary button-compact" onClick={() => void load()} disabled={busy}>새로고침</button></div>
        <div className={styles.sessionList}>
          {(dashboard?.sessions ?? []).map((session) => {
            const percent = session.targetCount > 0 ? Math.round((session.completedCount / session.targetCount) * 100) : 0;
            return <article key={session.id} className={styles.sessionCard}><div><span className={`status-badge ${session.status === "IN_PROGRESS" ? "active" : session.status === "COMPLETED" ? "success" : "inactive"}`}>{session.status}</span><h4>{session.countNo}</h4><p>{session.scopeValue || session.scopeType}</p><small>{new Date(session.createdAt).toLocaleString("ko-KR")}{session.note ? ` · ${session.note}` : ""}</small></div><div className={styles.sessionMetrics}><span><small>진행률</small><strong>{session.completedCount}/{session.targetCount} ({percent}%)</strong></span><span><small>차이 SKU</small><strong>{session.differenceSkuCount.toLocaleString()}</strong></span><span><small>차이 수량</small><strong>{session.differenceQty.toLocaleString()}</strong></span></div><Link className="button button-primary" href={`/stocktakes/${session.id}`}>{session.status === "IN_PROGRESS" ? "실사 계속" : "실사 내역"}</Link></article>;
          })}
          {(dashboard?.sessions.length ?? 0) === 0 ? <p className="empty-state">생성된 재고실사가 없습니다.</p> : null}
        </div>
      </section>
      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">LOCATION STATUS</p><h3>로케이션별 실사 상태</h3></div><strong>{visibleLocations.length.toLocaleString()}개</strong></div>
        <div className={styles.filters}><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="LOC 또는 구역 검색" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="ALL">전체 상태</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="table-wrap"><table><thead><tr><th>로케이션</th><th>구역</th><th>상태</th><th>최근 실사</th><th>다음 실사</th><th>최근 차이</th><th>작업</th></tr></thead><tbody>{visibleLocations.map((row: InventoryCountLocationStatus) => <tr key={row.locationId}><td><strong>{row.locationCode}</strong></td><td>{row.zone || "-"}</td><td><span className={`${styles.statusBadge} ${statusClass[row.countStatus]}`}>{statusLabel[row.countStatus]}</span></td><td>{formatDate(row.lastCountedAt)}</td><td>{formatDate(row.nextDueAt)}</td><td>{row.lastDifferenceSkuCount > 0 ? `${row.lastDifferenceSkuCount} SKU / ${row.lastDifferenceQty.toLocaleString()}개` : "차이 없음"}</td><td>{row.openSessionId ? <Link className="text-link" href={`/stocktakes/${row.openSessionId}`}>{row.openCountNo || "열기"}</Link> : "-"}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}

export default function StocktakesPage() {
  return <PermissionGuard permission="stocktake_inventory"><StocktakesContent /></PermissionGuard>;
}
