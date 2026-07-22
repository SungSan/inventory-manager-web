"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useUser } from "@/components/user-provider";
import { listLocations, subscribeToInventory } from "@/lib/inventory-api";
import { listAllInventoryRows } from "@/lib/full-data-api";
import {
  adminSaveLocationMapZoneSettings,
  adminSetLocationUnavailable,
  adminSetMapLocationActive,
  adminUpsertMapLocation,
  listLocationMapStates,
  listLocationMapZoneSettings,
  type LocationMapState,
  type LocationMapZoneSetting,
} from "@/lib/location-map-api";
import type { InventoryRow, Location } from "@/types/domain";

const naturalCollator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
const mobileDetailQuery = "(max-width: 820px)";

type VisualStatus = "occupied" | "empty" | "working" | "unavailable";

interface ZoneColumn {
  key: string;
  locations: Location[];
}

interface ZoneMap {
  zone: string;
  columns: ZoneColumn[];
}

function locationZone(location: Location): string {
  const codePrefix = location.locationCode.split("-")[0] ?? "기타";
  return (location.zone.trim() || codePrefix || "기타").toUpperCase();
}

function shortLocationCode(location: Location): string {
  const zone = locationZone(location);
  const code = location.locationCode.toUpperCase();
  const prefix = `${zone}-`;
  return code.startsWith(prefix) ? code.slice(prefix.length) : code;
}

function aisleKey(location: Location): string {
  return shortLocationCode(location).split("-")[0] || "기타";
}

function transferRoleLabel(role?: LocationMapState["activeTransferRole"]): string {
  if (role === "SOURCE") return "이관 출발지";
  if (role === "DESTINATION") return "이관 도착지";
  if (role === "BOTH") return "이관 출발·도착지";
  return "작업 중";
}

function visualStatusLabel(status: VisualStatus): string {
  if (status === "working") return "작업 중";
  if (status === "unavailable") return "사용불가";
  if (status === "occupied") return "점유";
  return "빈 LOC";
}

export function LocationMapView() {
  const { user } = useUser();
  const canManage = user?.role === "admin";
  const [locations, setLocations] = useState<Location[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [mapStates, setMapStates] = useState<LocationMapState[]>([]);
  const [zoneSettings, setZoneSettings] = useState<LocationMapZoneSetting[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newBarcode, setNewBarcode] = useState("");
  const [unavailableReason, setUnavailableReason] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [locationRows, inventoryRows, stateRows, zoneRows] = await Promise.all([
        listLocations("", true),
        listAllInventoryRows(),
        listLocationMapStates(),
        listLocationMapZoneSettings(),
      ]);
      setLocations(locationRows);
      setInventory(inventoryRows);
      setMapStates(stateRows);
      setZoneSettings(zoneRows);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로케이션맵 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribeToInventory(() => void load());
  }, [load]);

  useEffect(() => {
    if (!mobileDetailOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileDetailOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileDetailOpen]);

  const inventoryByLocation = useMemo(() => {
    const result = new Map<string, InventoryRow[]>();
    for (const row of inventory) {
      if (row.qty <= 0) continue;
      const current = result.get(row.locationId) ?? [];
      current.push(row);
      result.set(row.locationId, current);
    }
    for (const rows of result.values()) {
      rows.sort((a, b) => naturalCollator.compare(`${a.artist} ${a.nameVer}`, `${b.artist} ${b.nameVer}`));
    }
    return result;
  }, [inventory]);

  const stateByLocation = useMemo(
    () => new Map(mapStates.map((state) => [state.locationId, state])),
    [mapStates],
  );

  const zoneSettingByCode = useMemo(
    () => new Map(zoneSettings.map((setting) => [setting.zoneCode, setting])),
    [zoneSettings],
  );

  const activeLocations = useMemo(() => locations.filter((location) => location.active), [locations]);
  const visibleLocations = useMemo(
    () => activeLocations.filter((location) => zoneSettingByCode.get(locationZone(location))?.visible ?? true),
    [activeLocations, zoneSettingByCode],
  );
  const inactiveLocations = useMemo(
    () => locations.filter((location) => !location.active).sort((a, b) => naturalCollator.compare(a.locationCode, b.locationCode)),
    [locations],
  );
  const unavailableLocations = useMemo(
    () => activeLocations
      .filter((location) => stateByLocation.get(location.id)?.unavailable)
      .sort((a, b) => naturalCollator.compare(a.locationCode, b.locationCode)),
    [activeLocations, stateByLocation],
  );

  function getVisualStatus(location: Location): VisualStatus {
    const state = stateByLocation.get(location.id);
    if (state?.unavailable) return "unavailable";
    if ((state?.activeTransferCount ?? 0) > 0) return "working";
    return (inventoryByLocation.get(location.id)?.length ?? 0) > 0 ? "occupied" : "empty";
  }

  const statusCounts = useMemo(() => {
    const counts: Record<VisualStatus, number> = { occupied: 0, empty: 0, working: 0, unavailable: 0 };
    for (const location of visibleLocations) counts[getVisualStatus(location)] += 1;
    return counts;
  }, [visibleLocations, inventoryByLocation, stateByLocation]);

  const zones = useMemo<ZoneMap[]>(() => {
    const keyword = search.trim().toUpperCase();
    const zoneMap = new Map<string, Map<string, Location[]>>();

    for (const location of visibleLocations) {
      if (keyword && !location.locationCode.toUpperCase().includes(keyword) && !locationZone(location).includes(keyword)) continue;
      const zone = locationZone(location);
      const column = aisleKey(location);
      const columns = zoneMap.get(zone) ?? new Map<string, Location[]>();
      const rows = columns.get(column) ?? [];
      rows.push(location);
      columns.set(column, rows);
      zoneMap.set(zone, columns);
    }

    return Array.from(zoneMap.entries())
      .sort(([a], [b]) => {
        const orderA = zoneSettingByCode.get(a)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
        const orderB = zoneSettingByCode.get(b)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
        return orderA - orderB || naturalCollator.compare(a, b);
      })
      .map(([zone, columns]) => ({
        zone,
        columns: Array.from(columns.entries())
          .sort(([a], [b]) => naturalCollator.compare(a, b))
          .map(([key, rows]) => ({
            key,
            locations: rows.sort((a, b) => naturalCollator.compare(shortLocationCode(a), shortLocationCode(b))),
          })),
      }));
  }, [visibleLocations, search, zoneSettingByCode]);

  const selected = locations.find((location) => location.id === selectedId);
  const selectedRows = selected ? inventoryByLocation.get(selected.id) ?? [] : [];
  const selectedQty = selectedRows.reduce((sum, row) => sum + row.qty, 0);
  const selectedState = selected ? stateByLocation.get(selected.id) : undefined;
  const selectedVisualStatus = selected ? getVisualStatus(selected) : "empty";

  useEffect(() => {
    setUnavailableReason(selectedState?.unavailableReason ?? "");
  }, [selectedId, selectedState?.unavailableReason]);

  function openLocation(locationId: string) {
    setSelectedId(locationId);
    if (window.matchMedia(mobileDetailQuery).matches) setMobileDetailOpen(true);
  }

  function updateZoneVisibility(zoneCode: string, visible: boolean) {
    setZoneSettings((current) => current.map((setting) => (
      setting.zoneCode === zoneCode ? { ...setting, visible } : setting
    )));
  }

  function setAllZoneVisibility(visible: boolean) {
    setZoneSettings((current) => current.map((setting) => ({ ...setting, visible })));
  }

  async function saveZoneVisibility() {
    setBusy("zones");
    setError("");
    setMessage("");
    try {
      const saved = await adminSaveLocationMapZoneSettings(zoneSettings);
      setZoneSettings(saved);
      if (selected && !(saved.find((setting) => setting.zoneCode === locationZone(selected))?.visible ?? true)) {
        setSelectedId("");
        setMobileDetailOpen(false);
      }
      setMessage("로케이션맵 대분류 표시 설정을 저장했습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "대분류 표시 설정을 저장하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function addLocation() {
    const code = newCode.trim().toUpperCase();
    if (!code) {
      setError("추가할 로케이션 코드를 입력하세요.");
      return;
    }
    setBusy("add");
    setError("");
    setMessage("");
    try {
      const location = await adminUpsertMapLocation(code, newBarcode);
      setNewCode("");
      setNewBarcode("");
      setSelectedId(location.id);
      setMessage(`${location.locationCode} 로케이션을 추가했습니다.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로케이션을 추가하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function setActive(location: Location, active: boolean) {
    const action = active ? "복구" : "제외";
    if (!active && !window.confirm(`${location.locationCode}를 로케이션맵에서 제외할까요?`)) return;
    setBusy(`active:${location.id}`);
    setError("");
    setMessage("");
    try {
      await adminSetMapLocationActive(location.id, active);
      if (!active && selectedId === location.id) {
        setSelectedId("");
        setMobileDetailOpen(false);
      }
      setMessage(`${location.locationCode} 로케이션을 ${action}했습니다.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `로케이션을 ${action}하지 못했습니다.`);
    } finally {
      setBusy("");
    }
  }

  async function setUnavailable(location: Location, unavailable: boolean, reason = "") {
    const action = unavailable ? "사용불가 설정" : "사용 가능 전환";
    if (unavailable && !window.confirm(`${location.locationCode}를 사용불가 LOC로 지정할까요?`)) return;
    setBusy(`unavailable:${location.id}`);
    setError("");
    setMessage("");
    try {
      await adminSetLocationUnavailable(location.id, unavailable, reason);
      setMessage(`${location.locationCode} 로케이션을 ${action}했습니다.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${action}에 실패했습니다.`);
    } finally {
      setBusy("");
    }
  }

  const detailContent = !selected ? (
    <p className="empty-state">LOC를 선택하면 상세 재고가 표시됩니다.</p>
  ) : (
    <>
      <div className="section-heading location-detail-heading">
        <div><p className="eyebrow">SELECTED LOC</p><h3>{selected.locationCode}</h3></div>
        <span className={`status-badge location-status-${selectedVisualStatus}`}>{visualStatusLabel(selectedVisualStatus)}</span>
      </div>

      {selectedVisualStatus === "working" ? (
        <p className="location-state-notice working">
          {transferRoleLabel(selectedState?.activeTransferRole)} · 진행 업무 {selectedState?.activeTransferCount ?? 0}건
        </p>
      ) : null}
      {selectedVisualStatus === "unavailable" ? (
        <p className="location-state-notice unavailable">
          사용불가 LOC{selectedState?.unavailableReason ? ` · ${selectedState.unavailableReason}` : ""}
        </p>
      ) : null}

      <dl className="location-detail-summary">
        <div><dt>구역</dt><dd>{locationZone(selected)}</dd></div>
        <div><dt>SKU</dt><dd>{selectedRows.length.toLocaleString()}</dd></div>
        <div><dt>총수량</dt><dd>{selectedQty.toLocaleString()}</dd></div>
      </dl>

      {selectedRows.length === 0 ? <p className="empty-state">현재 재고가 없습니다.</p> : (
        <div className="location-product-list">
          {selectedRows.map((row) => (
            <article key={`${row.productId}-${row.locationId}`}>
              <div><strong>{row.artist || "아티스트 미등록"}</strong><span>{row.nameVer}</span></div>
              <b>{row.qty.toLocaleString()}</b>
            </article>
          ))}
        </div>
      )}

      {canManage ? (
        <div className="location-admin-actions">
          {selectedState?.unavailable ? (
            <button
              className="button button-secondary"
              disabled={busy === `unavailable:${selected.id}`}
              onClick={() => void setUnavailable(selected, false)}
            >
              {busy === `unavailable:${selected.id}` ? "처리 중..." : "사용 가능으로 변경"}
            </button>
          ) : (
            <div className="location-unavailable-form">
              <label>
                사용불가 사유
                <input
                  value={unavailableReason}
                  onChange={(event) => setUnavailableReason(event.target.value)}
                  placeholder="예: 랙 파손, 점검 중"
                />
              </label>
              <button
                className="button button-secondary"
                disabled={busy === `unavailable:${selected.id}`}
                onClick={() => void setUnavailable(selected, true, unavailableReason)}
              >
                {busy === `unavailable:${selected.id}` ? "처리 중..." : "사용불가 설정"}
              </button>
            </div>
          )}
          <button
            className="button button-ghost location-remove-button"
            disabled={busy === `active:${selected.id}`}
            onClick={() => void setActive(selected, false)}
          >
            {busy === `active:${selected.id}` ? "처리 중..." : "로케이션맵에서 제외"}
          </button>
        </div>
      ) : null}
    </>
  );

  if (loading) return <div className="center-panel">로케이션맵을 불러오는 중...</div>;

  return (
    <div className="page-stack location-map-page">
      <section className="location-map-title-row">
        <div>
          <p className="eyebrow">LOCATION MAP</p>
          <h2>로케이션맵</h2>
          <p className="muted">재고, 이관 작업, 사용불가 상태를 실시간으로 표시합니다.</p>
        </div>
      </section>

      {error ? <p className="inline-error">{error}</p> : null}
      {message ? <p className="feedback feedback-success">{message}</p> : null}

      <section className="panel location-map-command-bar">
        <div className="location-map-metrics six">
          <article><span>표시 LOC</span><strong>{visibleLocations.length.toLocaleString()}</strong></article>
          <article><span>점유 LOC</span><strong>{statusCounts.occupied.toLocaleString()}</strong></article>
          <article><span>빈 LOC</span><strong>{statusCounts.empty.toLocaleString()}</strong></article>
          <article><span>작업 중</span><strong>{statusCounts.working.toLocaleString()}</strong></article>
          <article><span>사용불가</span><strong>{statusCounts.unavailable.toLocaleString()}</strong></article>
          <article><span>제외 LOC</span><strong>{inactiveLocations.length.toLocaleString()}</strong></article>
        </div>
        <div className="location-map-tools">
          <label className="compact-search">
            LOC 검색
            <input value={search} onChange={(event) => setSearch(event.target.value.toUpperCase())} placeholder="D1B-01-01-04" />
          </label>
          <div className="location-map-legend">
            <span><i className="legend-dot occupied" />재고 있음</span>
            <span><i className="legend-dot empty" />빈 LOC</span>
            <span><i className="legend-dot working" />작업 중</span>
            <span><i className="legend-dot unavailable" />사용불가</span>
            <span><i className="legend-dot selected" />선택</span>
          </div>
        </div>
      </section>

      <div className="location-map-workspace">
        <div className="location-map-zones">
          {zones.map((zone) => (
            <section
              key={zone.zone}
              className="panel location-zone-panel"
              style={{ "--zone-columns": Math.max(1, zone.columns.length) } as CSSProperties}
            >
              <div className="location-zone-title"><strong>{zone.zone}</strong><span>{zone.columns.reduce((sum, column) => sum + column.locations.length, 0)} LOC</span></div>
              <div className="location-zone-columns">
                {zone.columns.map((column) => (
                  <div key={column.key} className="location-aisle-column">
                    <div className="location-aisle-title">{column.key}</div>
                    <div className="location-cell-list">
                      {column.locations.map((location) => {
                        const rows = inventoryByLocation.get(location.id) ?? [];
                        const qty = rows.reduce((sum, row) => sum + row.qty, 0);
                        const state = stateByLocation.get(location.id);
                        const status = getVisualStatus(location);
                        const cellText = status === "working"
                          ? "작업 중"
                          : status === "unavailable"
                            ? "사용불가"
                            : status === "occupied"
                              ? `${rows.length} SKU`
                              : "EMPTY";
                        return (
                          <button
                            type="button"
                            key={location.id}
                            className={`location-map-cell ${status} ${selectedId === location.id ? "selected" : ""}`}
                            onClick={() => openLocation(location.id)}
                            title={`${location.locationCode} · ${visualStatusLabel(status)} · ${rows.length} SKU · ${qty.toLocaleString()}개${state?.unavailableReason ? ` · ${state.unavailableReason}` : ""}`}
                          >
                            <strong>{shortLocationCode(location)}</strong>
                            <small>{cellText}</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {zones.length === 0 ? <section className="panel"><p className="empty-state">표시하도록 설정된 대분류가 없거나 검색 결과가 없습니다.</p></section> : null}
        </div>

        <aside className="panel location-detail-panel">{detailContent}</aside>
      </div>

      {canManage ? (
        <section className="panel location-map-admin">
          <div className="section-heading">
            <div><p className="eyebrow">ADMIN</p><h3>로케이션맵 관리</h3><p className="muted small">대분류 표시, LOC 추가·제외, 사용불가 상태를 각각 관리합니다.</p></div>
          </div>

          <div className="location-zone-visibility-admin">
            <div className="section-heading compact">
              <div><h3>표시할 대분류</h3><p className="muted small">체크 해제한 대분류는 맵에서만 숨겨지며 데이터와 작업 기능은 유지됩니다.</p></div>
              <div className="location-zone-visibility-tools">
                <button type="button" className="button button-secondary button-compact" onClick={() => setAllZoneVisibility(true)}>전체 선택</button>
                <button type="button" className="button button-secondary button-compact" onClick={() => setAllZoneVisibility(false)}>전체 해제</button>
                <button type="button" className="button button-primary button-compact" disabled={busy === "zones"} onClick={() => void saveZoneVisibility()}>{busy === "zones" ? "저장 중" : "표시 설정 저장"}</button>
              </div>
            </div>
            <div className="location-zone-check-grid">
              {zoneSettings.map((setting) => (
                <label key={setting.zoneCode} className={`location-zone-check ${setting.visible ? "checked" : ""}`}>
                  <input
                    type="checkbox"
                    checked={setting.visible}
                    onChange={(event) => updateZoneVisibility(setting.zoneCode, event.target.checked)}
                  />
                  <span><strong>{setting.zoneCode}</strong><small>활성 LOC {setting.activeLocationCount.toLocaleString()}개</small></span>
                </label>
              ))}
            </div>
          </div>

          <div className="section-heading excluded-heading"><h3>로케이션 추가·복구</h3></div>
          <div className="location-admin-form">
            <label>로케이션 코드<input value={newCode} onChange={(event) => setNewCode(event.target.value.toUpperCase())} placeholder="D1B-01-01-04" /></label>
            <label>별도 바코드 번호<input value={newBarcode} onChange={(event) => setNewBarcode(event.target.value)} placeholder="비워두면 로케이션 코드 사용" /></label>
            <button className="button button-primary" disabled={busy === "add" || !newCode.trim()} onClick={() => void addLocation()}>{busy === "add" ? "추가 중..." : "로케이션 추가·복구"}</button>
          </div>

          <div className="section-heading excluded-heading"><h3>사용불가 로케이션</h3><span className="muted small">{unavailableLocations.length}개</span></div>
          {unavailableLocations.length === 0 ? <p className="empty-state">사용불가로 지정된 로케이션이 없습니다.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>로케이션</th><th>구역</th><th>사유</th><th>처리</th></tr></thead>
                <tbody>
                  {unavailableLocations.map((location) => {
                    const state = stateByLocation.get(location.id);
                    return (
                      <tr key={location.id}>
                        <td><strong>{location.locationCode}</strong></td>
                        <td>{locationZone(location)}</td>
                        <td>{state?.unavailableReason || "-"}</td>
                        <td><button className="button button-secondary button-compact" disabled={busy === `unavailable:${location.id}`} onClick={() => void setUnavailable(location, false)}>{busy === `unavailable:${location.id}` ? "처리 중" : "사용 가능"}</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="section-heading excluded-heading"><h3>제외된 로케이션</h3><span className="muted small">{inactiveLocations.length}개</span></div>
          {inactiveLocations.length === 0 ? <p className="empty-state">제외된 로케이션이 없습니다.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>로케이션</th><th>구역</th><th>처리</th></tr></thead>
                <tbody>
                  {inactiveLocations.map((location) => (
                    <tr key={location.id}>
                      <td><strong>{location.locationCode}</strong></td>
                      <td>{locationZone(location)}</td>
                      <td><button className="button button-secondary button-compact" disabled={busy === `active:${location.id}`} onClick={() => void setActive(location, true)}>{busy === `active:${location.id}` ? "처리 중" : "복구"}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {selected && mobileDetailOpen ? (
        <div
          className="location-mobile-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`${selected.locationCode} 상세 재고`}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setMobileDetailOpen(false);
          }}
        >
          <section className="location-mobile-sheet">
            <div className="location-mobile-sheet-bar"><span /><button type="button" onClick={() => setMobileDetailOpen(false)}>닫기</button></div>
            {detailContent}
          </section>
        </div>
      ) : null}
    </div>
  );
}
