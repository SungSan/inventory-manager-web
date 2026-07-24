"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PermissionGuard } from "@/components/permission-guard";
import { listLocationMapStates } from "@/lib/location-map-api";
import {
  createInventoryCountSession,
  getInventoryCountDashboard,
  getInventoryCycleProfiles,
  type InventoryCountDashboard,
  type InventoryCountLocationStatus,
  type InventoryCountStatus,
  type InventoryCycleClass,
  type InventoryCycleProfile,
} from "@/lib/stocktake-api";
import styles from "./stocktakes.module.css";

const statusLabel: Record<InventoryCountStatus, string> = {
  COMPLETE: "실사 완료",
  DUE_SOON: "재실사 임박",
  DUE: "재실사 필요",
  NEVER: "미실사",
  PLANNED: "실사 예정",
  IN_PROGRESS: "실사 진행 중",
  PAUSED: "사이클 중지",
};

const statusClass: Record<InventoryCountStatus, string> = {
  COMPLETE: styles.complete,
  DUE_SOON: styles.dueSoon,
  DUE: styles.due,
  NEVER: styles.never,
  PLANNED: styles.planned,
  IN_PROGRESS: styles.inProgress,
  PAUSED: styles.paused,
};

const cycleLabel: Record<InventoryCycleClass, string> = {
  BASELINE: "최초 실사",
  HIGH: "고회전",
  MEDIUM: "중회전",
  LOW: "저회전",
  DORMANT: "무이동",
};

function formatDate(value?: string): string {
  return value ? new Date(value).toLocaleDateString("ko-KR") : "-";
}

function applyCycleProfiles(source: InventoryCountDashboard, profiles: InventoryCycleProfile[]): InventoryCountDashboard {
  const profileByLocation = new Map(profiles.map((profile) => [profile.locationId, profile]));
  return {
    ...source,
    locations: source.locations.map((row) => {
      const profile = profileByLocation.get(row.locationId);
      if (!profile) return row;
      const paused = row.lastCountedAt && !row.openSessionId && profile.autoCycleEnabled === false;
      return {
        ...row,
        countStatus: paused ? "PAUSED" : row.countStatus,
        cycleClass: profile.cycleClass,
        autoCycleEnabled: profile.autoCycleEnabled,
        cycleDays: profile.cycleDays,
        movementEvents90d: profile.movementEvents90d,
        outboundQty90d: profile.outboundQty90d,
        lastMovementAt: profile.lastMovementAt,
        activeSkuCount: profile.activeSkuCount,
        dormantSkuCount: profile.dormantSkuCount,
      };
    }),
  };
}

function availableDashboard(source: InventoryCountDashboard, unavailableIds: Set<string>): InventoryCountDashboard {
  const locations = source.locations.filter((row) => !unavailableIds.has(row.locationId));
  const count = (status: InventoryCountStatus) => locations.filter((row) => row.countStatus === status).length;
  return {
    ...source,
    locations,
    summary: {
      total: locations.filter((row) => row.countStatus !== "PAUSED").length,
      complete: count("COMPLETE"),
      dueSoon: count("DUE_SOON"),
      due: count("DUE"),
      never: count("NEVER"),
      planned: count("PLANNED"),
      inProgress: count("IN_PROGRESS"),
      paused: count("PAUSED"),
    },
  };
}

function cycleDescription(row: InventoryCountLocationStatus): string {
  if (!row.cycleClass) return "기준 산정 전";
  if (row.autoCycleEnabled === false) return `무이동 · 수동 실사만${row.dormantSkuCount ? ` · ${row.dormantSkuCount} SKU` : ""}`;
  const days = row.cycleDays ? `${row.cycleDays}일` : "최초 실사";
  const active = row.activeSkuCount ?? 0;
  const dormant = row.dormantSkuCount ?? 0;
  return `${cycleLabel[row.cycleClass]} · ${days} · 활성 ${active} / 무이동 ${dormant} SKU`;
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
      // 프로필 RPC가 먼저 미처리 이동 이력을 반영한 뒤 대시보드를 읽습니다.
      const profiles = await getInventoryCycleProfiles();
      const [source, mapStates] = await Promise.all([
        getInventoryCountDashboard(),
        listLocationMapStates(),
      ]);
      const unavailableIds = new Set(mapStates.filter((row) => row.unavailable).map((row) => row.locationId));
      setDashboard(availableDashboard(applyCycleProfiles(source, profiles), unavailableIds));
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
      <section><p className="eyebrow">ADAPTIVE CYCLE COUNT</p><h2>재고실사</h2><p className="muted">정확한 수량과 신선한 재고 상태를 유지하기 위해 LOC·품목 이동 이력을 기준으로 실사 주기를 자동 조정합니다. 고회전은 14일, 중회전은 30일, 저회전은 90일이며 180일 무이동 재고만 있는 LOC는 최초 실사 후 자동 사이클을 중지합니다.</p></section>
      {error ? <p className="inline-error">{error}</p> : null}
      {message ? <div className="feedback feedback-success"><strong>{message}</strong></div> : null}
      <section className={styles.metricGrid}>
        <article><span>자동 실사 대상</span><strong>{(summary?.total ?? 0).toLocaleString()}</strong></article>
        <article className={styles.completeCard}><span>주기 내 완료</span><strong>{(summary?.complete ?? 0).toLocaleString()}</strong></article>
        <article className={styles.dueSoonCard}><span>재실사 임박</span><strong>{(summary?.dueSoon ?? 0).toLocaleString()}</strong></article>
        <article className={styles.dueCard}><span>재실사 필요</span><strong>{(summary?.due ?? 0).toLocaleString()}</strong></article>
        <article className={styles.neverCard}><span>최초 미실사</span><strong>{(summary?.never ?? 0).toLocaleString()}</strong></article>
        <article className={styles.progressCard}><span>진행·예정</span><strong>{((summary?.inProgress ?? 0) + (summary?.planned ?? 0)).toLocaleString()}</strong></article>
        <article className={styles.pausedCard}><span>자동 사이클 중지</span><strong>{(summary?.paused ?? 0).toLocaleString()}</strong></article>
      </section>
      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">NEW COUNT</p><h3>신규 재고실사 생성</h3></div></div>
        <div className={styles.createGrid}>
          <label>실사 범위<select value={scopeType} onChange={(event) => setScopeType(event.target.value as typeof scopeType)} disabled={busy}><option value="ALL">전체 사용 가능 로케이션(수동 전체)</option><option value="DUE">자동 주기 도래·최초 미실사만</option><option value="ZONE">구역별 실사</option><option value="LOCATIONS">특정 로케이션(수동)</option></select></label>
          {scopeType === "ZONE" ? <label>구역<select value={zone} onChange={(event) => setZone(event.target.value)} disabled={busy}><option value="">구역 선택</option>{zones.map((item) => <option key={item} value={item}>{item}</option>)}</select></label> : null}
          {scopeType === "LOCATIONS" ? <label>로케이션<select value={locationId} onChange={(event) => setLocationId(event.target.value)} disabled={busy}><option value="">로케이션 선택</option>{(dashboard?.locations ?? []).map((item) => <option key={item.locationId} value={item.locationId}>{item.locationCode} · {statusLabel[item.countStatus]}</option>)}</select></label> : null}
          <label className={styles.noteField}>메모(선택)<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="예: 고회전 LOC 정기 실사" disabled={busy} /></label>
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
        <div className="table-wrap"><table><thead><tr><th>로케이션</th><th>구역</th><th>자동 주기</th><th>상태</th><th>최근 실사</th><th>다음 실사</th><th>최근 차이</th><th>작업</th></tr></thead><tbody>{visibleLocations.map((row: InventoryCountLocationStatus) => <tr key={row.locationId}><td><strong>{row.locationCode}</strong></td><td>{row.zone || "-"}</td><td><strong>{cycleDescription(row)}</strong><br /><small>90일 이동 {row.movementEvents90d ?? 0}건 · 출고 {(row.outboundQty90d ?? 0).toLocaleString()}개</small></td><td><span className={`${styles.statusBadge} ${statusClass[row.countStatus]}`}>{statusLabel[row.countStatus]}</span></td><td>{formatDate(row.lastCountedAt)}</td><td>{row.countStatus === "PAUSED" ? "자동 중지" : formatDate(row.nextDueAt)}</td><td>{row.lastDifferenceSkuCount > 0 ? `${row.lastDifferenceSkuCount} SKU / ${row.lastDifferenceQty.toLocaleString()}개` : "차이 없음"}</td><td>{row.openSessionId ? <Link className="text-link" href={`/stocktakes/${row.openSessionId}`}>{row.openCountNo || "열기"}</Link> : row.countStatus === "PAUSED" ? "수동 생성 가능" : "-"}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}

export default function StocktakesPage() {
  return <PermissionGuard permission="stocktake_inventory"><StocktakesContent /></PermissionGuard>;
}
