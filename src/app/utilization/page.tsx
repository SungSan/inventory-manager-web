"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PermissionGuard } from "@/components/permission-guard";
import { useUser } from "@/components/user-provider";
import { subscribeToInventory } from "@/lib/inventory-api";
import {
  listZoneUtilization,
  upsertZoneUtilizationSetting,
} from "@/lib/utilization-api";
import type {
  UtilizationStatus,
  ZoneUtilization,
  ZoneUtilizationSettingInput,
} from "@/types/utilization";

interface ZoneDraft {
  displayName: string;
  capacityPlt: string;
  warningPercent: string;
  dangerPercent: string;
  sortOrder: string;
  active: boolean;
}

const statusLabel: Record<UtilizationStatus, string> = {
  SAFE: "안정",
  WARNING: "경고",
  DANGER: "위험",
  INACTIVE: "비활성",
  UNCONFIGURED: "미설정",
};

function toDraft(row: ZoneUtilization): ZoneDraft {
  return {
    displayName: row.displayName,
    capacityPlt: String(row.capacityPlt),
    warningPercent: String(row.warningPercent),
    dangerPercent: String(row.dangerPercent),
    sortOrder: String(row.sortOrder),
    active: row.active,
  };
}

function UtilizationContent() {
  const { user } = useUser();
  const canManage = user?.role === "admin";
  const [rows, setRows] = useState<ZoneUtilization[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ZoneDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingZone, setSavingZone] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await listZoneUtilization();
      setRows(result);
      setDrafts(Object.fromEntries(result.map((row) => [row.zoneCode, toDraft(row)])));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "용적률을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribeToInventory(() => void load());
  }, [load]);

  const activeRows = useMemo(() => rows.filter((row) => row.active), [rows]);
  const summary = useMemo(() => {
    const capacity = activeRows.reduce((sum, row) => sum + row.capacityPlt, 0);
    const occupied = activeRows.reduce((sum, row) => sum + row.occupiedPlt, 0);
    const totalQty = activeRows.reduce((sum, row) => sum + row.totalQty, 0);
    const utilization = capacity > 0 ? (occupied * 100) / capacity : 0;
    return {
      capacity,
      occupied,
      empty: Math.max(0, capacity - occupied),
      totalQty,
      utilization,
      dangerCount: activeRows.filter((row) => row.status === "DANGER").length,
      warningCount: activeRows.filter((row) => row.status === "WARNING").length,
    };
  }, [activeRows]);

  function updateDraft(zoneCode: string, patch: Partial<ZoneDraft>) {
    setDrafts((current) => ({
      ...current,
      [zoneCode]: { ...current[zoneCode], ...patch },
    }));
  }

  async function saveZone(row: ZoneUtilization) {
    const draft = drafts[row.zoneCode];
    if (!draft) return;

    const input: ZoneUtilizationSettingInput = {
      zoneCode: row.zoneCode,
      displayName: draft.displayName.trim() || row.zoneCode,
      capacityPlt: Math.trunc(Number(draft.capacityPlt)),
      warningPercent: Number(draft.warningPercent),
      dangerPercent: Number(draft.dangerPercent),
      active: draft.active,
      sortOrder: Math.trunc(Number(draft.sortOrder) || 0),
    };

    if (!Number.isFinite(input.capacityPlt) || input.capacityPlt < 1) {
      setError("최대 PLT는 1 이상이어야 합니다.");
      return;
    }
    if (
      !Number.isFinite(input.warningPercent) ||
      !Number.isFinite(input.dangerPercent) ||
      input.warningPercent < 0 ||
      input.dangerPercent > 100 ||
      input.dangerPercent <= input.warningPercent
    ) {
      setError("위험 기준은 경고 기준보다 크고, 두 기준 모두 0~100 사이여야 합니다.");
      return;
    }

    setSavingZone(row.zoneCode);
    setError("");
    setMessage("");
    try {
      await upsertZoneUtilizationSetting(input);
      setMessage(`${input.displayName} 설정을 저장했습니다.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "설정을 저장하지 못했습니다.");
    } finally {
      setSavingZone("");
    }
  }

  if (loading) return <div className="center-panel">용적률을 계산하는 중...</div>;

  return (
    <div className="page-stack utilization-page">
      <section>
        <p className="eyebrow">UTILIZATION</p>
        <h2>센터 용적률</h2>
        <p className="muted">
          상품 종류나 수량과 관계없이 재고가 하나라도 있는 로케이션을 1 PLT 사용으로 계산합니다.
        </p>
      </section>

      {error ? <p className="inline-error">{error}</p> : null}
      {message ? <p className="feedback feedback-success">{message}</p> : null}

      <section className="metric-grid five">
        <article className="metric-card"><span>전체 최대 PLT</span><strong>{summary.capacity.toLocaleString()}</strong></article>
        <article className="metric-card"><span>사용 중 PLT</span><strong>{summary.occupied.toLocaleString()}</strong></article>
        <article className="metric-card"><span>잔여 PLT</span><strong>{summary.empty.toLocaleString()}</strong></article>
        <article className="metric-card"><span>전체 가동률</span><strong>{summary.utilization.toFixed(1)}%</strong></article>
        <article className="metric-card"><span>경고 / 위험 구역</span><strong>{summary.warningCount} / {summary.dangerCount}</strong></article>
      </section>

      <section className="utilization-zone-grid">
        {activeRows.map((row) => {
          const visualPercent = Math.min(100, Math.max(0, row.utilizationPercent));
          return (
            <article key={row.zoneCode} className={`panel utilization-zone-card status-${row.status.toLowerCase()}`}>
              <div className="utilization-zone-heading">
                <div>
                  <p className="eyebrow">{row.zoneCode}</p>
                  <h3>{row.displayName}</h3>
                </div>
                <span className={`utilization-status status-${row.status.toLowerCase()}`}>
                  {statusLabel[row.status]}
                </span>
              </div>

              <div className="utilization-main-value">
                <strong>{row.occupiedPlt.toLocaleString()} / {row.capacityPlt.toLocaleString()}</strong>
                <span>PLT</span>
              </div>

              <div className="utilization-track" aria-label={`${row.displayName} 가동률 ${row.utilizationPercent}%`}>
                <span style={{ width: `${visualPercent}%` }} />
              </div>
              <div className="utilization-percent-row">
                <strong>{row.utilizationPercent.toFixed(1)}%</strong>
                <span>경고 {row.warningPercent}% · 위험 {row.dangerPercent}%</span>
              </div>

              <dl className="utilization-detail-list">
                <div><dt>등록 LOC</dt><dd>{row.totalLocations.toLocaleString()}</dd></div>
                <div><dt>빈 LOC</dt><dd>{row.emptyLocations.toLocaleString()}</dd></div>
                <div><dt>SKU</dt><dd>{row.skuCount.toLocaleString()}</dd></div>
                <div><dt>총수량</dt><dd>{row.totalQty.toLocaleString()}</dd></div>
              </dl>
            </article>
          );
        })}
      </section>

      {rows.length === 0 ? (
        <section className="panel"><p className="empty-state">등록된 구역 또는 로케이션이 없습니다.</p></section>
      ) : null}

      {canManage ? (
        <section className="panel utilization-settings-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ADMIN SETTINGS</p>
              <h3>구역별 용적률 설정</h3>
              <p className="muted small">최대 PLT와 상태 기준을 변경하면 저장 즉시 전체 사용자 화면에 반영됩니다.</p>
            </div>
          </div>

          <div className="table-wrap">
            <table className="utilization-settings-table">
              <thead>
                <tr>
                  <th>구역</th>
                  <th>표시명</th>
                  <th>최대 PLT</th>
                  <th>경고 %</th>
                  <th>위험 %</th>
                  <th>순서</th>
                  <th>활성</th>
                  <th>저장</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const draft = drafts[row.zoneCode] ?? toDraft(row);
                  return (
                    <tr key={row.zoneCode}>
                      <td><strong>{row.zoneCode}</strong></td>
                      <td><input value={draft.displayName} onChange={(event) => updateDraft(row.zoneCode, { displayName: event.target.value })} /></td>
                      <td><input type="number" min="1" value={draft.capacityPlt} onChange={(event) => updateDraft(row.zoneCode, { capacityPlt: event.target.value })} /></td>
                      <td><input type="number" min="0" max="100" step="0.1" value={draft.warningPercent} onChange={(event) => updateDraft(row.zoneCode, { warningPercent: event.target.value })} /></td>
                      <td><input type="number" min="0" max="100" step="0.1" value={draft.dangerPercent} onChange={(event) => updateDraft(row.zoneCode, { dangerPercent: event.target.value })} /></td>
                      <td><input type="number" value={draft.sortOrder} onChange={(event) => updateDraft(row.zoneCode, { sortOrder: event.target.value })} /></td>
                      <td><input type="checkbox" checked={draft.active} onChange={(event) => updateDraft(row.zoneCode, { active: event.target.checked })} /></td>
                      <td><button className="button button-primary button-compact" onClick={() => void saveZone(row)} disabled={savingZone === row.zoneCode}>{savingZone === row.zoneCode ? "저장 중" : "저장"}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {canManage ? <p className="mobile-admin-note muted">구역별 설정 변경은 PC 화면에서 진행하세요.</p> : null}
    </div>
  );
}

export default function UtilizationPage() {
  return (
    <PermissionGuard permission="view_inventory">
      <UtilizationContent />
    </PermissionGuard>
  );
}
