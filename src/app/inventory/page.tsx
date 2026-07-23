"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CameraSearchField } from "@/components/camera-search-field";
import { PermissionGuard } from "@/components/permission-guard";
import { downloadCsv } from "@/lib/csv";
import { listBarcodes, listInventory, subscribeToInventory } from "@/lib/inventory-api";
import type { BarcodeRecord, InventoryRow } from "@/types/domain";

interface LocationInventorySummary {
  locationId: string;
  locationCode: string;
  zone: string;
  qty: number;
  updatedAt: string;
  productIds: string[];
}

interface ProductInventorySummary {
  groupKey: string;
  productIds: string[];
  pCodeNos: string[];
  codeNos: string[];
  masterCodeNos: string[];
  artists: string[];
  nameVer: string;
  displayBarcode: string;
  displayBarcodeNormalized: string;
  totalQty: number;
  locationRows: LocationInventorySummary[];
  sourceRows: InventoryRow[];
  barcodes: BarcodeRecord[];
  latestUpdatedAt: string;
}

interface ProductBucket {
  productId: string;
  pCodeNo: string;
  codeNo: string;
  masterCodeNo: string;
  artist: string;
  nameVer: string;
  sourceRows: InventoryRow[];
  barcodes: BarcodeRecord[];
  latestUpdatedAt: string;
}

function normalizeIdentity(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function newestDate(first: string, second: string): string {
  return new Date(second).getTime() > new Date(first).getTime() ? second : first;
}

function formatValueList(values: string[]): string {
  if (values.length === 0) return "-";
  if (values.length === 1) return values[0];
  return `${values[0]} 외 ${values.length - 1}`;
}

function dedupeBarcodes(items: BarcodeRecord[]): BarcodeRecord[] {
  const map = new Map<string, BarcodeRecord>();
  for (const barcode of items) {
    if (!barcode.active) continue;
    const key = barcode.normalizedValue || normalizeIdentity(barcode.value);
    const existing = map.get(key);
    if (!existing || barcode.isPrimary) map.set(key, barcode);
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.value.localeCompare(b.value);
  });
}

function getCanonicalBarcode(bucket: ProductBucket): string {
  const primary = bucket.barcodes.find((barcode) => barcode.active && barcode.isPrimary);
  const first = bucket.barcodes.find((barcode) => barcode.active);
  return (
    primary?.normalizedValue ||
    first?.normalizedValue ||
    normalizeIdentity(bucket.codeNo) ||
    `NO-BARCODE:${bucket.productId}`
  );
}

function InventoryContent() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [barcodes, setBarcodes] = useState<BarcodeRecord[]>([]);
  const [search, setSearch] = useState("");
  const [showZero, setShowZero] = useState(true);
  const [selected, setSelected] = useState<ProductInventorySummary | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [inventoryRows, barcodeRows] = await Promise.all([
        listInventory(""),
        listBarcodes("", "product"),
      ]);
      setRows(inventoryRows);
      setBarcodes(barcodeRows);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "재고를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeToInventory(() => void load()), [load]);

  const sharedBarcodeCount = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const barcode of barcodes.filter((item) => item.active)) {
      const targets = map.get(barcode.normalizedValue) ?? new Set<string>();
      targets.add(barcode.targetId);
      map.set(barcode.normalizedValue, targets);
    }
    return new Map(Array.from(map.entries()).map(([value, targets]) => [value, targets.size]));
  }, [barcodes]);

  const summaries = useMemo(() => {
    const barcodesByProduct = new Map<string, BarcodeRecord[]>();
    for (const barcode of barcodes) {
      if (!barcode.active) continue;
      const list = barcodesByProduct.get(barcode.targetId) ?? [];
      list.push(barcode);
      barcodesByProduct.set(barcode.targetId, list);
    }

    const products = new Map<string, ProductBucket>();
    for (const row of rows) {
      const existing = products.get(row.productId);
      if (existing) {
        existing.sourceRows.push(row);
        existing.latestUpdatedAt = newestDate(existing.latestUpdatedAt, row.updatedAt);
      } else {
        products.set(row.productId, {
          productId: row.productId,
          pCodeNo: row.pCodeNo,
          codeNo: row.codeNo,
          masterCodeNo: row.masterCodeNo,
          artist: row.artist,
          nameVer: row.nameVer,
          sourceRows: [row],
          barcodes: barcodesByProduct.get(row.productId) ?? [],
          latestUpdatedAt: row.updatedAt,
        });
      }
    }

    const grouped = new Map<string, ProductInventorySummary>();
    for (const bucket of products.values()) {
      const canonicalBarcode = getCanonicalBarcode(bucket);
      const groupKey = [
        canonicalBarcode,
        normalizeIdentity(bucket.nameVer),
      ].join("||");

      const existing = grouped.get(groupKey);
      if (existing) {
        existing.productIds.push(bucket.productId);
        existing.pCodeNos = uniqueValues([...existing.pCodeNos, bucket.pCodeNo]);
        existing.codeNos = uniqueValues([...existing.codeNos, bucket.codeNo]);
        existing.masterCodeNos = uniqueValues([...existing.masterCodeNos, bucket.masterCodeNo]);
        existing.artists = uniqueValues([...existing.artists, bucket.artist]);
        existing.sourceRows.push(...bucket.sourceRows);
        existing.barcodes = dedupeBarcodes([...existing.barcodes, ...bucket.barcodes]);
        existing.latestUpdatedAt = newestDate(existing.latestUpdatedAt, bucket.latestUpdatedAt);
      } else {
        const productBarcodes = dedupeBarcodes(bucket.barcodes);
        grouped.set(groupKey, {
          groupKey,
          productIds: [bucket.productId],
          pCodeNos: uniqueValues([bucket.pCodeNo]),
          codeNos: uniqueValues([bucket.codeNo]),
          masterCodeNos: uniqueValues([bucket.masterCodeNo]),
          artists: uniqueValues([bucket.artist]),
          nameVer: bucket.nameVer,
          displayBarcode: productBarcodes[0]?.value || bucket.codeNo || "-",
          displayBarcodeNormalized: productBarcodes[0]?.normalizedValue || normalizeIdentity(bucket.codeNo),
          totalQty: 0,
          locationRows: [],
          sourceRows: [...bucket.sourceRows],
          barcodes: productBarcodes,
          latestUpdatedAt: bucket.latestUpdatedAt,
        });
      }
    }

    const result: ProductInventorySummary[] = [];
    for (const item of grouped.values()) {
      const locationMap = new Map<string, LocationInventorySummary>();
      for (const row of item.sourceRows) {
        const key = row.locationId || row.locationCode;
        const current = locationMap.get(key);
        if (current) {
          current.qty += row.qty;
          current.updatedAt = newestDate(current.updatedAt, row.updatedAt);
          current.productIds = uniqueValues([...current.productIds, row.productId]);
        } else {
          locationMap.set(key, {
            locationId: row.locationId,
            locationCode: row.locationCode,
            zone: row.zone || row.locationCode.split("-")[0] || "기타",
            qty: row.qty,
            updatedAt: row.updatedAt,
            productIds: [row.productId],
          });
        }
      }

      item.locationRows = Array.from(locationMap.values())
        .filter((row) => showZero || row.qty > 0)
        .sort((a, b) => a.locationCode.localeCompare(b.locationCode));
      item.totalQty = item.locationRows.reduce((sum, row) => sum + row.qty, 0);
      item.displayBarcode = item.barcodes[0]?.value || item.codeNos[0] || "-";
      item.displayBarcodeNormalized = item.barcodes[0]?.normalizedValue || normalizeIdentity(item.codeNos[0] || "");

      if (showZero || item.locationRows.length > 0) result.push(item);
    }

    const keyword = normalizeIdentity(search);
    return result
      .filter((item) => !keyword || [
        ...item.pCodeNos,
        ...item.codeNos,
        ...item.masterCodeNos,
        ...item.artists,
        item.nameVer,
        item.displayBarcode,
        ...item.locationRows.map((row) => row.locationCode),
        ...item.barcodes.map((barcode) => barcode.value),
      ].some((value) => normalizeIdentity(value).includes(keyword)))
      .sort((a, b) => `${a.artists[0] ?? ""}${a.nameVer}${a.displayBarcode}`.localeCompare(`${b.artists[0] ?? ""}${b.nameVer}${b.displayBarcode}`));
  }, [barcodes, rows, search, showZero]);

  const total = summaries.reduce((sum, item) => sum + item.totalQty, 0);
  const locationRowCount = summaries.reduce((sum, item) => sum + item.locationRows.length, 0);

  const selectedZoneGroups = useMemo(() => {
    if (!selected) return [];
    const map = new Map<string, LocationInventorySummary[]>();
    for (const row of selected.locationRows) {
      const zone = row.zone || row.locationCode.split("-")[0] || "기타";
      const list = map.get(zone) ?? [];
      list.push(row);
      map.set(zone, list);
    }
    return Array.from(map.entries())
      .map(([zone, locationRows]) => ({
        zone,
        locationRows: [...locationRows].sort((a, b) => a.locationCode.localeCompare(b.locationCode)),
        totalQty: locationRows.reduce((sum, row) => sum + row.qty, 0),
      }))
      .sort((a, b) => a.zone.localeCompare(b.zone));
  }, [selected]);

  function exportRows() {
    const visibleRows = summaries.flatMap((item) => item.sourceRows.filter((row) => showZero || row.qty > 0));
    downloadCsv(
      `inventory-${new Date().toISOString().slice(0, 10)}.csv`,
      ["LOCATION", "P_CODE_NO", "CODE_NO", "MASTER_CODE_NO", "ARTIST", "NAME_VER", "QTY", "UPDATED_AT"],
      visibleRows.map((row) => [row.locationCode, row.pCodeNo, row.codeNo, row.masterCodeNo, row.artist, row.nameVer, row.qty, row.updatedAt]),
    );
  }

  return (
    <div className="page-stack">
      <section>
        <p className="eyebrow">INVENTORY</p>
        <h2>재고 조회</h2>
        <p className="muted">상품 바코드와 상품명이 같은 데이터는 한 줄로 묶어 표시합니다. 상세보기에서는 구역과 로케이션별 실제 재고를 확인할 수 있습니다.</p>
      </section>

      <section className="panel filter-row">
        <div style={{ flex: "1 1 360px" }}>
          <CameraSearchField
            label="검색"
            value={search}
            onChange={setSearch}
            placeholder="상품 바코드, CODE_NO, 아티스트, 상품명/버전, 로케이션"
          />
        </div>
        <label className="checkbox-label"><input type="checkbox" checked={showZero} onChange={(event) => setShowZero(event.target.checked)} />0 재고 포함</label>
        <button className="button button-secondary" onClick={exportRows}>CSV 내보내기</button>
      </section>

      {error ? <p className="inline-error">{error}</p> : null}

      <section className="metric-grid">
        <article className="metric-card"><span>상품 묶음</span><strong>{summaries.length}</strong></article>
        <article className="metric-card"><span>로케이션 수</span><strong>{locationRowCount}</strong></article>
        <article className="metric-card"><span>검색 재고 합계</span><strong>{total.toLocaleString()}</strong></article>
      </section>

      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>상품 바코드</th><th>아티스트</th><th>상품명/버전</th><th>P_CODE</th><th>CODE_NO</th><th>로케이션 수</th><th>총재고</th><th>상세</th></tr></thead>
            <tbody>
              {summaries.map((item) => (
                <tr key={item.groupKey}>
                  <td>
                    <div className="barcode-chip-list">
                      <span className="barcode-chip">
                        <code>{item.displayBarcode}</code>
                        {(sharedBarcodeCount.get(item.displayBarcodeNormalized) ?? 0) > 1 ? <small>공통 바코드</small> : null}
                      </span>
                      {item.barcodes.length > 1 ? <span className="status-badge">+{item.barcodes.length - 1}</span> : null}
                    </div>
                  </td>
                  <td>{formatValueList(item.artists)}</td>
                  <td>
                    <strong>{item.nameVer || "(상품명/버전 없음)"}</strong>
                    {item.productIds.length > 1 ? <div className="small muted">동일 상품 데이터 {item.productIds.length}건 통합</div> : null}
                  </td>
                  <td>{formatValueList(item.pCodeNos)}</td>
                  <td>{formatValueList(item.codeNos)}</td>
                  <td>{item.locationRows.length}</td>
                  <td><strong>{item.totalQty.toLocaleString()}</strong></td>
                  <td><button className="button button-secondary button-compact" onClick={() => setSelected(item)}>재고 상세보기</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {summaries.length === 0 ? <p className="empty-state">검색 결과가 없습니다.</p> : null}
      </section>

      {selected ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="재고 상세보기">
          <section className="selection-modal inventory-detail-modal">
            <div className="section-heading">
              <div>
                <p className="eyebrow">STOCK DETAIL</p>
                <h3>{formatValueList(selected.artists)} · {selected.nameVer}</h3>
                <p className="muted">상품 바코드 {selected.displayBarcode} · 총재고 {selected.totalQty.toLocaleString()}개 · {selected.locationRows.length}개 로케이션</p>
                {selected.productIds.length > 1 ? <p className="small muted">동일한 상품 바코드와 상품명으로 등록된 {selected.productIds.length}개 상품 데이터를 통합해 표시합니다.</p> : null}
              </div>
              <button className="button button-ghost" onClick={() => setSelected(null)}>닫기</button>
            </div>

            <section className="detail-meta-grid">
              <div><span>P_CODE_NO</span><strong>{formatValueList(selected.pCodeNos)}</strong></div>
              <div><span>CODE_NO</span><strong>{formatValueList(selected.codeNos)}</strong></div>
              <div><span>MASTER_CODE_NO</span><strong>{formatValueList(selected.masterCodeNos)}</strong></div>
            </section>

            <div className="barcode-detail-list">
              <strong>연결된 상품 바코드</strong>
              <div className="barcode-chip-list">
                {selected.barcodes.map((barcode) => (
                  <span className="barcode-chip" key={`${barcode.normalizedValue}-${barcode.value}`}>
                    <code>{barcode.value}</code>
                    {barcode.isPrimary ? <small>대표</small> : null}
                    {(sharedBarcodeCount.get(barcode.normalizedValue) ?? 0) > 1 ? <small>공통 {sharedBarcodeCount.get(barcode.normalizedValue)}상품</small> : null}
                  </span>
                ))}
              </div>
            </div>

            <div className="zone-stock-list">
              {selectedZoneGroups.map((group) => (
                <section className="zone-stock-section" key={group.zone}>
                  <div className="zone-stock-heading">
                    <div>
                      <span className="zone-badge">{group.zone}</span>
                      <strong>{group.locationRows.length}개 로케이션</strong>
                    </div>
                    <strong>구역 합계 {group.totalQty.toLocaleString()}개</strong>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>로케이션</th><th>수량</th><th>최종 갱신</th></tr></thead>
                      <tbody>
                        {group.locationRows.map((row) => (
                          <tr key={`${group.zone}-${row.locationId}-${row.locationCode}`}>
                            <td><strong>{row.locationCode}</strong></td>
                            <td><strong>{row.qty.toLocaleString()}</strong></td>
                            <td>{new Date(row.updatedAt).toLocaleString("ko-KR")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default function InventoryPage() {
  return <PermissionGuard permission="view_inventory"><InventoryContent /></PermissionGuard>;
}
