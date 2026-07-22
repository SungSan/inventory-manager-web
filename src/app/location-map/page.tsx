"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { PermissionGuard } from "@/components/permission-guard";
import { useUser } from "@/components/user-provider";
import { listInventory, listLocations, subscribeToInventory } from "@/lib/inventory-api";
import {
  adminSetMapLocationActive,
  adminUpsertMapLocation,
} from "@/lib/location-map-api";
import type { InventoryRow, Location } from "@/types/domain";

const naturalCollator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
const mobileDetailQuery = "(max-width: 820px)";

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

function LocationMapContent() {
  const { user } = useUser();
  const canManage = user?.role === "admin";
  const [locations, setLocations] = useState<Location[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newBarcode, setNewBarcode] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [locationRows, inventoryRows] = await Promise.all([
        listLocations("", true),
        listInventory(""),
      ]);
      setLocations(locationRows);
      setInventory(inventoryRows);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "LOC MAP 데이터를 불러오지 못했습니다.");
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

  const activeLocations = useMemo(() => locations.filter((location) => location.active), [locations]);
  const inactiveLocations = useMemo(
    () => locations.filter((location) => !location.active).sort((a, b) => naturalCollator.compare(a.locationCode, b.locationCode)),
    [locations],
  );

  const zones = useMemo<ZoneMap[]>(() => {
    const keyword = search.trim().toUpperCase();
    const zoneMap = new Map<string, Map<string, Location[]>>();

    for (const location of activeLocations) {
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
      .sort(([a], [b]) => naturalCollator.compare(a, b))
      .map(([zone, columns]) => ({
        zone,
        columns: Array.from(columns.entries())
          .sort(([a], [b]) => naturalCollator.compare(a, b))
          .map(([key, rows]) => ({
            key,
            locations: rows.sort((a, b) => naturalCollator.compare(shortLocationCode(a), shortLocationCode(b))),
          })),
      }));
  }, [activeLocations, search]);

  const selected = locations.find((location) => location.id === selectedId);
  const selectedRows = selected ? inventoryByLocation.get(selected.id) ?? [] : [];
  const selectedQty = selectedRows.reduce((sum, row) => sum + row.qty, 0);
  const occupiedCount = activeLocations.filter((location) => (inventoryByLocation.get(location.id)?.length ?? 0) > 0).length;

  function openLocation(locationId: string) {
    setSelectedId(locationId);
    if (window.matchMedia(mobileDetailQuery).matches) setMobileDetailOpen(true);
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
      setMessage(`${location.locationCode} 로케이션을 LOC MAP에 추가했습니다.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로케이션을 추가하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function setActive(location: Location, active: boolean) {
    const action = active ? "복구" : "제외";
    if (!active && !window.confirm(`${location.locationCode}를 LOC MAP에서 제외할까요?`)) return;
    setBusy(location.id);
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

  const detailContent = !selected ? (
    <p className="empty-state">LOC를 선택하면 상세 재고가 표시됩니다.</p>
  ) : (
    <>
      <div className="section-heading location-detail-heading">
        <div><p className="eyebrow">SELECTED LOC</p><h3>{selected.locationCode}</h3></div>
        <span className={`status-badge ${selectedRows.length > 0 ? "danger" : "active"}`}>{selectedRows.length > 0 ? "점유" : "빈 LOC"}</span>
      </div>
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
        <button className="button button-ghost location-remove-button" disabled={busy === selected.id} onClick={() => void setActive(selected, false)}>
          {busy === selected.id ? "처리 중..." : "LOC MAP에서 제외"}
        </button>
      ) : null}
    </>
  );

  if (loading) return <div className="center-panel">LOC MAP을 불러오는 중...</div>;

  return (
    <div className="page-stack location-map-page">
      <section className="location-map-title-row">
        <div>
          <p className="eyebrow">LOCATION MAP</p>
          <h2>LOC MAP</h2>
          <p className="muted">로케이션 코드를 숫자 순서로 자동 배치합니다.</p>
        </div>
      </section>

      {error ? <p className="inline-error">{error}</p> : null}
      {message ? <p className="feedback feedback-success">{message}</p> : null}

      <section className="panel location-map-command-bar">
        <div className="location-map-metrics">
          <article><span>활성 LOC</span><strong>{activeLocations.length.toLocaleString()}</strong></article>
          <article><span>점유 LOC</span><strong>{occupiedCount.toLocaleString()}</strong></article>
          <article><span>빈 LOC</span><strong>{Math.max(0, activeLocations.length - occupiedCount).toLocaleString()}</strong></article>
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
                        const occupied = rows.length > 0;
                        return (
                          <button
                            type="button"
                            key={location.id}
                            className={`location-map-cell ${occupied ? "occupied" : "empty"} ${selectedId === location.id ? "selected" : ""}`}
                            onClick={() => openLocation(location.id)}
                            title={`${location.locationCode} · ${rows.length} SKU · ${qty.toLocaleString()}개`}
                          >
                            <strong>{shortLocationCode(location)}</strong>
                            <small>{occupied ? `${rows.length} SKU` : "EMPTY"}</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {zones.length === 0 ? <section className="panel"><p className="empty-state">조건에 맞는 활성 로케이션이 없습니다.</p></section> : null}
        </div>

        <aside className="panel location-detail-panel">
          {detailContent}
        </aside>
      </div>

      {canManage ? (
        <section className="panel location-map-admin">
          <div className="section-heading">
            <div><p className="eyebrow">ADMIN</p><h3>LOC MAP 관리</h3><p className="muted small">추가된 LOC는 코드의 숫자 순서에 맞춰 자동 배치됩니다.</p></div>
          </div>
          <div className="location-admin-form">
            <label>로케이션 코드<input value={newCode} onChange={(event) => setNewCode(event.target.value.toUpperCase())} placeholder="D1B-01-01-04" /></label>
            <label>별도 바코드 번호<input value={newBarcode} onChange={(event) => setNewBarcode(event.target.value)} placeholder="비워두면 로케이션 코드 사용" /></label>
            <button className="button button-primary" disabled={busy === "add" || !newCode.trim()} onClick={() => void addLocation()}>{busy === "add" ? "추가 중..." : "로케이션 추가·복구"}</button>
          </div>

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
                      <td><button className="button button-secondary button-compact" disabled={busy === location.id} onClick={() => void setActive(location, true)}>{busy === location.id ? "처리 중" : "복구"}</button></td>
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

export default function LocationMapPage() {
  return (
    <PermissionGuard permission="view_inventory">
      <LocationMapContent />
    </PermissionGuard>
  );
}
