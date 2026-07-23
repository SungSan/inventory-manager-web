"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { BarcodeField } from "@/components/barcode-field";
import { Feedback, type FeedbackKind } from "@/components/feedback";
import {
  MultiProductBarcodePicker,
  type MultiProductBarcodeSelection,
} from "@/components/multi-product-barcode-picker";
import { createIdempotencyKey } from "@/lib/barcode";
import { resolveBarcodeCandidates } from "@/lib/inventory-api";
import {
  confirmRemainingStock,
  listLocationInventory,
  postLocationInventoryBatch,
} from "@/lib/scan-operation-api";
import type {
  InventoryRow,
  Location,
  MovementType,
  Product,
  ResolvedBarcode,
} from "@/types/domain";
import styles from "@/app/scan/scan-workflow.module.css";

type WorkflowMode = "start" | "product" | "location";

interface ProductDraft {
  product: Product;
  barcodeValue: string;
  qty: number;
}

interface StockCountTarget {
  productId: string;
  artist: string;
  nameVer: string;
  codeNo: string;
  locationId: string;
  locationCode: string;
  currentQty: number;
}

function beep(success: boolean) {
  try {
    const AudioContextClass = window.AudioContext
      || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = success ? 880 : 220;
    gain.gain.value = 0.05;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + (success ? 0.08 : 0.18));
  } catch {
    // 오디오가 차단돼도 작업은 계속됩니다.
  }
}

function productFromResolved(item: ResolvedBarcode): Product | null {
  return item.target.type === "product" && "product" in item.target
    ? item.target.product
    : null;
}

function locationFromResolved(item: ResolvedBarcode): Location | null {
  return item.target.type === "location" && "location" in item.target
    ? item.target.location
    : null;
}

export function ScanWorkflowV3() {
  const [operation, setOperation] = useState<MovementType>("IB");
  const [mode, setMode] = useState<WorkflowMode>("start");
  const [firstBarcode, setFirstBarcode] = useState("");
  const [candidateMatches, setCandidateMatches] = useState<ResolvedBarcode[]>([]);

  const [productItems, setProductItems] = useState<ProductDraft[]>([]);
  const [productLocation, setProductLocation] = useState<Location | null>(null);
  const [productLocationBarcode, setProductLocationBarcode] = useState("");
  const [productStocks, setProductStocks] = useState<Record<string, number>>({});
  const [productDone, setProductDone] = useState(false);

  const [location, setLocation] = useState<Location | null>(null);
  const [locationInventory, setLocationInventory] = useState<InventoryRow[]>([]);
  const [locationSearch, setLocationSearch] = useState("");
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({});

  const [note, setNote] = useState("");
  const [stockCountTarget, setStockCountTarget] = useState<StockCountTarget | null>(null);
  const [remainingQty, setRemainingQty] = useState(0);
  const [stockCountReason, setStockCountReason] = useState("");

  const [busy, setBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [missingBarcode, setMissingBarcode] = useState("");
  const [feedback, setFeedback] = useState<{
    kind: FeedbackKind;
    title: string;
    body?: string;
  } | null>(null);
  const [resetToken, setResetToken] = useState(0);

  const reset = useCallback(() => {
    setMode("start");
    setFirstBarcode("");
    setCandidateMatches([]);
    setProductItems([]);
    setProductLocation(null);
    setProductLocationBarcode("");
    setProductStocks({});
    setProductDone(false);
    setLocation(null);
    setLocationInventory([]);
    setLocationSearch("");
    setSelectedItems({});
    setNote("");
    setStockCountTarget(null);
    setRemainingQty(0);
    setStockCountReason("");
    setMissingBarcode("");
    setFeedback(null);
    setBusy(false);
    setScanBusy(false);
    setResetToken((value) => value + 1);
  }, []);

  const loadLocationRows = useCallback(async (locationId: string) => {
    const rows = await listLocationInventory(locationId);
    setLocationInventory(rows);
    return rows;
  }, []);

  function activateProductWorkflow(items: ProductDraft[], barcodeValue: string) {
    setProductItems(items);
    setFirstBarcode(barcodeValue);
    setProductLocation(null);
    setProductLocationBarcode("");
    setProductStocks({});
    setProductDone(false);
    setMode("product");
    setCandidateMatches([]);
    beep(true);
    setFeedback({
      kind: "success",
      title: items.length > 1 ? "복수 상품 선택 완료" : "상품 선택 완료",
      body: `${items.length} SKU / ${items.reduce((sum, item) => sum + item.qty, 0).toLocaleString()}개`,
    });
  }

  const activateLocationWorkflow = useCallback(async (
    resolved: ResolvedBarcode,
    resolvedLocation: Location,
  ) => {
    setLocation(resolvedLocation);
    setFirstBarcode(resolved.barcodeValue);
    setMode("location");
    setSelectedItems({});
    setLocationSearch("");
    await loadLocationRows(resolvedLocation.id);
    beep(true);
    setFeedback({
      kind: "success",
      title: "로케이션 선택 완료",
      body: `${resolvedLocation.locationCode}의 전체 재고를 불러왔습니다.`,
    });
  }, [loadLocationRows]);

  const handleFirstScan = useCallback(async (value: string): Promise<boolean> => {
    if (scanBusy) return false;
    setScanBusy(true);
    setMissingBarcode("");
    setCandidateMatches([]);
    setFeedback({ kind: "info", title: "바코드 확인 중", body: value });

    try {
      const matches = await resolveBarcodeCandidates(value, undefined, `${operation}_FIRST_SCAN`);
      const productMatches = matches.filter((item) => productFromResolved(item)?.id);
      const locationMatches = matches.filter((item) => locationFromResolved(item)?.id);

      if (productMatches.length > 0 && locationMatches.length > 0) {
        throw new Error("같은 바코드가 상품과 로케이션에 동시에 연결되어 있습니다. 바코드 관리에서 중복을 정리하세요.");
      }

      if (locationMatches.length > 0) {
        if (locationMatches.length > 1) throw new Error("같은 로케이션 바코드가 여러 위치에 연결되어 있습니다.");
        const resolvedLocation = locationFromResolved(locationMatches[0]);
        if (!resolvedLocation) throw new Error("로케이션 정보를 읽지 못했습니다.");
        await activateLocationWorkflow(locationMatches[0], resolvedLocation);
        return true;
      }

      if (productMatches.length === 1) {
        const product = productFromResolved(productMatches[0]);
        if (!product) throw new Error("상품 정보를 읽지 못했습니다.");
        activateProductWorkflow([{ product, barcodeValue: productMatches[0].barcodeValue || value, qty: 1 }], value);
        return true;
      }

      if (productMatches.length > 1) {
        setFirstBarcode(productMatches[0].barcodeValue || value);
        setCandidateMatches(productMatches);
        beep(true);
        setFeedback({
          kind: "info",
          title: "공통 상품 바코드",
          body: `${productMatches.length}개 상품이 연결되어 있습니다. 복수 선택과 상품별 수량을 지정하세요.`,
        });
        return true;
      }

      setMissingBarcode(value);
      throw new Error("등록되지 않은 상품 또는 로케이션 바코드입니다.");
    } catch (cause) {
      beep(false);
      setFeedback({
        kind: "error",
        title: "첫 바코드 확인 실패",
        body: cause instanceof Error ? cause.message : "바코드를 확인하지 못했습니다.",
      });
      return false;
    } finally {
      setScanBusy(false);
    }
  }, [activateLocationWorkflow, operation, scanBusy]);

  async function handleCommonProductSelection(items: MultiProductBarcodeSelection[]) {
    const barcodeValue = items[0]?.match.barcodeValue || firstBarcode;
    activateProductWorkflow(
      items.map((item) => ({ product: item.product, barcodeValue: item.match.barcodeValue, qty: item.qty })),
      barcodeValue,
    );
  }

  const handleProductLocationScan = useCallback(async (value: string): Promise<boolean> => {
    if (productItems.length === 0) return false;
    setBusy(true);
    setFeedback(null);
    try {
      const matches = await resolveBarcodeCandidates(value, "location", `${operation}_LOCATION_SCAN`);
      if (matches.length === 0) throw new Error("등록되지 않은 로케이션 바코드입니다.");
      if (matches.length > 1) throw new Error("같은 로케이션 바코드가 여러 위치에 연결되어 있습니다.");
      const resolvedLocation = locationFromResolved(matches[0]);
      if (!resolvedLocation) throw new Error("로케이션 바코드가 아닙니다.");

      const rows = await listLocationInventory(resolvedLocation.id);
      setProductStocks(Object.fromEntries(rows.map((row) => [row.productId, row.qty])));
      setProductLocation(resolvedLocation);
      setProductLocationBarcode(matches[0].barcodeValue);
      beep(true);
      setFeedback({
        kind: "success",
        title: "로케이션 확인",
        body: `${resolvedLocation.locationCode} · 선택 상품 ${productItems.length} SKU`,
      });
      return true;
    } catch (cause) {
      beep(false);
      setFeedback({
        kind: "error",
        title: "로케이션 스캔 실패",
        body: cause instanceof Error ? cause.message : "로케이션을 확인하지 못했습니다.",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }, [operation, productItems.length]);

  function changeProductQty(productId: string, raw: string) {
    const parsed = Number(raw);
    setProductItems((current) => current.map((item) => {
      if (item.product.id !== productId) return item;
      let qty = Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : 1;
      if (operation === "OB" && productLocation) qty = Math.min(productStocks[productId] ?? 0, qty);
      return { ...item, qty: Math.max(1, qty) };
    }));
  }

  function removeProduct(productId: string) {
    setProductItems((current) => current.filter((item) => item.product.id !== productId));
  }

  const productTotalQty = productItems.reduce((sum, item) => sum + item.qty, 0);
  const productStockInvalid = operation === "OB" && Boolean(productLocation) && productItems.some(
    (item) => item.qty > (productStocks[item.product.id] ?? 0),
  );

  async function confirmProductBatch() {
    if (!productLocation || productItems.length === 0) {
      setFeedback({ kind: "error", title: "상품과 로케이션을 확인하세요." });
      return;
    }
    if (productStockInvalid) {
      setFeedback({ kind: "error", title: "출고 수량이 현재 재고보다 많은 상품이 있습니다." });
      return;
    }
    if (!window.confirm(
      `${productLocation.locationCode}에 ${productItems.length} SKU / ${productTotalQty.toLocaleString()}개를 ${operation === "IB" ? "입고" : "출고"}할까요?`,
    )) return;

    setBusy(true);
    setFeedback(null);
    try {
      const result = await postLocationInventoryBatch({
        operation,
        locationId: productLocation.id,
        items: productItems.map((item) => ({ productId: item.product.id, qty: item.qty })),
        note: note.trim() || undefined,
        idempotencyKey: createIdempotencyKey(),
      });
      const rows = await listLocationInventory(productLocation.id);
      setProductStocks(Object.fromEntries(rows.map((row) => [row.productId, row.qty])));
      setProductDone(true);
      beep(true);
      setFeedback({
        kind: "success",
        title: operation === "IB" ? "복수 상품 입고 완료" : "복수 상품 출고 완료",
        body: `${result.locationCode} · ${result.itemCount} SKU / ${result.totalQty.toLocaleString()}개`,
      });
    } catch (cause) {
      beep(false);
      setFeedback({
        kind: "error",
        title: operation === "IB" ? "입고 처리 실패" : "출고 처리 실패",
        body: cause instanceof Error ? cause.message : "처리 중 오류가 발생했습니다.",
      });
    } finally {
      setBusy(false);
    }
  }

  const visibleLocationInventory = useMemo(() => {
    const keyword = locationSearch.trim().toUpperCase();
    if (!keyword) return locationInventory;
    return locationInventory.filter((row) =>
      [row.pCodeNo, row.codeNo, row.masterCodeNo, row.artist, row.nameVer]
        .some((value) => value.toUpperCase().includes(keyword)),
    );
  }, [locationInventory, locationSearch]);

  const selectedCount = Object.keys(selectedItems).length;
  const selectedQty = Object.values(selectedItems).reduce((sum, qty) => sum + (Number(qty) || 0), 0);

  function toggleLocationItem(row: InventoryRow, checked: boolean) {
    setSelectedItems((current) => {
      const next = { ...current };
      if (checked) next[row.productId] = 1;
      else delete next[row.productId];
      return next;
    });
  }

  function changeLocationItemQty(row: InventoryRow, raw: string) {
    const parsed = Number(raw);
    const max = operation === "OB" ? row.qty : Number.MAX_SAFE_INTEGER;
    const nextQty = Number.isFinite(parsed)
      ? Math.max(1, Math.min(max, Math.trunc(parsed)))
      : 1;
    setSelectedItems((current) => ({ ...current, [row.productId]: nextQty }));
  }

  function selectAllVisible() {
    setSelectedItems((current) => {
      const next = { ...current };
      for (const row of visibleLocationInventory) next[row.productId] = 1;
      return next;
    });
  }

  async function confirmLocationBatch() {
    if (!location || selectedCount === 0) {
      setFeedback({ kind: "error", title: "상품을 선택하세요." });
      return;
    }
    if (!window.confirm(
      `${location.locationCode}에서 ${selectedCount} SKU / ${selectedQty.toLocaleString()}개를 ${operation === "IB" ? "입고" : "출고"}할까요?`,
    )) return;

    setBusy(true);
    setFeedback(null);
    try {
      const result = await postLocationInventoryBatch({
        operation,
        locationId: location.id,
        items: Object.entries(selectedItems).map(([productId, qty]) => ({ productId, qty })),
        note: note.trim() || undefined,
        idempotencyKey: createIdempotencyKey(),
      });
      await loadLocationRows(location.id);
      setSelectedItems({});
      setNote("");
      beep(true);
      setFeedback({
        kind: "success",
        title: operation === "IB" ? "로케이션 일괄 입고 완료" : "로케이션 일괄 출고 완료",
        body: `${result.locationCode} · ${result.itemCount} SKU / ${result.totalQty.toLocaleString()}개`,
      });
    } catch (cause) {
      beep(false);
      setFeedback({
        kind: "error",
        title: operation === "IB" ? "일괄 입고 실패" : "일괄 출고 실패",
        body: cause instanceof Error ? cause.message : "일괄 처리 중 오류가 발생했습니다.",
      });
      await loadLocationRows(location.id);
    } finally {
      setBusy(false);
    }
  }

  function openStockCount(target: StockCountTarget) {
    setStockCountTarget(target);
    setRemainingQty(target.currentQty);
    setStockCountReason("");
  }

  async function confirmStockCount() {
    if (!stockCountTarget) return;
    if (!Number.isInteger(remainingQty) || remainingQty < 0 || remainingQty > stockCountTarget.currentQty) {
      setFeedback({
        kind: "error",
        title: "남은 수량 확인",
        body: `0부터 현재 재고 ${stockCountTarget.currentQty.toLocaleString()} 사이의 정수를 입력하세요.`,
      });
      return;
    }

    const outboundQty = stockCountTarget.currentQty - remainingQty;
    if (!window.confirm(
      `${stockCountTarget.locationCode}\n${stockCountTarget.artist} · ${stockCountTarget.nameVer}\n현재 ${stockCountTarget.currentQty.toLocaleString()}개 → 남은 수량 ${remainingQty.toLocaleString()}개\n차이 ${outboundQty.toLocaleString()}개를 출고 처리할까요?`,
    )) return;

    setBusy(true);
    try {
      const result = await confirmRemainingStock({
        productId: stockCountTarget.productId,
        locationId: stockCountTarget.locationId,
        remainingQty,
        reason: stockCountReason,
        idempotencyKey: createIdempotencyKey(),
      });
      setStockCountTarget(null);
      if (mode === "location" && location) {
        await loadLocationRows(location.id);
        setSelectedItems((current) => {
          const next = { ...current };
          delete next[result.productId];
          return next;
        });
      }
      if (mode === "product" && productLocation) {
        setProductStocks((current) => ({ ...current, [result.productId]: result.afterQty }));
      }
      beep(true);
      setFeedback({
        kind: "success",
        title: result.changed ? "남은 수량 확정 완료" : "재고 수량 변경 없음",
        body: result.changed
          ? `${result.locationCode} · ${result.beforeQty.toLocaleString()} → ${result.afterQty.toLocaleString()} · 차이 ${result.outboundQty.toLocaleString()}개 출고`
          : `${result.locationCode}의 전산 수량과 입력 수량이 같습니다.`,
      });
    } catch (cause) {
      beep(false);
      setFeedback({
        kind: "error",
        title: "남은 수량 확정 실패",
        body: cause instanceof Error ? cause.message : "재고 실사 수량을 반영하지 못했습니다.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <section>
        <p className="eyebrow">SCAN WORKFLOW</p>
        <h2>바코드 입고·출고</h2>
        <p className="muted">
          상품 바코드와 로케이션 바코드를 모두 첫 스캔으로 사용할 수 있습니다. 공통 상품 바코드는 여러 상품을 복수 선택하고 상품별 수량을 지정합니다.
        </p>
      </section>

      <section className="operation-switch" aria-label="작업 구분">
        <button className={operation === "IB" ? "active" : ""} onClick={() => { setOperation("IB"); reset(); }}>입고 IB</button>
        <button className={operation === "OB" ? "active" : ""} onClick={() => { setOperation("OB"); reset(); }}>출고 OB</button>
      </section>

      {mode === "start" ? (
        <section className={`panel ${styles.firstScanPanel}`}>
          <div>
            <p className="eyebrow">FIRST SCAN</p>
            <h3>상품 또는 로케이션 바코드</h3>
            <p className="muted">공통 바코드가 나오면 연결된 상품을 복수 선택하고 각각 수량을 입력합니다.</p>
          </div>
          <BarcodeField
            label="첫 바코드"
            placeholder="상품 또는 로케이션 바코드를 스캔하세요"
            value={firstBarcode}
            onSubmit={handleFirstScan}
            autoFocus={candidateMatches.length === 0}
            disabled={scanBusy || candidateMatches.length > 0}
            resetToken={resetToken}
          />
        </section>
      ) : null}

      {mode === "product" ? (
        <>
          <section className="panel">
            <div className="section-heading">
              <div><p className="eyebrow">STEP 1</p><h3>상품별 수량</h3></div>
              <strong>{productItems.length} SKU / {productTotalQty.toLocaleString()}개</strong>
            </div>
            <div className={styles.locationItemList}>
              {productItems.map((item) => {
                const stock = productStocks[item.product.id] ?? 0;
                const insufficient = operation === "OB" && Boolean(productLocation) && item.qty > stock;
                return (
                  <article key={item.product.id} className={`${styles.locationItem} ${styles.selected}`}>
                    <div className={styles.itemCheck}>
                      <span>
                        <strong>{item.product.artist || "아티스트 없음"}</strong>
                        <b>{item.product.nameVer || "상품명/버전 없음"}</b>
                        <small>{item.product.pCodeNo || "-"} · {item.product.codeNo || "-"}</small>
                      </span>
                    </div>
                    <div className={styles.stockValue}>
                      <span>현재 재고</span>
                      <strong>{productLocation ? stock.toLocaleString() : "-"}</strong>
                    </div>
                    <label className={styles.qtyField}>
                      <span>{operation === "IB" ? "입고 수량" : "출고 수량"}</span>
                      <input
                        type="number"
                        min={1}
                        max={operation === "OB" && productLocation ? stock : undefined}
                        value={item.qty}
                        onChange={(event) => changeProductQty(item.product.id, event.target.value)}
                        disabled={busy || productDone}
                      />
                      {insufficient ? <small className="inline-error">재고 부족</small> : null}
                    </label>
                    <div className="row-actions">
                      <button
                        className="button button-secondary button-compact"
                        disabled={!productLocation || stock <= 0 || busy || productDone}
                        onClick={() => {
                          if (!productLocation) return;
                          openStockCount({
                            productId: item.product.id,
                            artist: item.product.artist,
                            nameVer: item.product.nameVer,
                            codeNo: item.product.codeNo,
                            locationId: productLocation.id,
                            locationCode: productLocation.locationCode,
                            currentQty: stock,
                          });
                        }}
                      >남은 수량</button>
                      {productItems.length > 1 ? <button className="button button-danger button-compact" onClick={() => removeProduct(item.product.id)} disabled={busy || productDone}>제외</button> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="section-heading"><div><p className="eyebrow">STEP 2</p><h3>로케이션 바코드</h3></div></div>
            <BarcodeField
              label="로케이션 스캔"
              placeholder="랙의 로케이션 바코드를 스캔하세요"
              value={productLocationBarcode}
              onSubmit={handleProductLocationScan}
              autoFocus={!productLocation}
              disabled={busy || productDone}
              resetToken={resetToken}
            />
            {productLocation ? <div className="resolved-card"><strong>{productLocation.locationCode}</strong><span>{productItems.length} SKU 재고 확인 완료</span></div> : null}
          </section>

          <section className="panel">
            <div className="section-heading"><div><p className="eyebrow">STEP 3</p><h3>{operation === "IB" ? "입고" : "출고"} 확정</h3></div></div>
            <label>메모(선택)<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="작업 사유 또는 메모" disabled={busy || productDone} /></label>
            <button className="button button-primary button-full" onClick={() => void confirmProductBatch()} disabled={!productLocation || productItems.length === 0 || productStockInvalid || busy || productDone}>
              {busy ? "처리 중..." : `${productItems.length} SKU / ${productTotalQty.toLocaleString()}개 ${operation === "IB" ? "입고" : "출고"} 확정`}
            </button>
          </section>
        </>
      ) : null}

      {mode === "location" && location ? (
        <section className={`panel ${styles.locationPanel}`}>
          <div className="section-heading">
            <div><p className="eyebrow">LOCATION FIRST</p><h3>{location.locationCode} 재고 선택</h3><p className="muted">상품을 복수 체크하고 품목별 수량을 입력하세요.</p></div>
            <span className="status-badge active">{locationInventory.length.toLocaleString()} SKU</span>
          </div>
          <div className={`filter-row ${styles.toolbar}`}>
            <input value={locationSearch} onChange={(event) => setLocationSearch(event.target.value)} placeholder="상품명, 아티스트, CODE_NO 검색" />
            <button className="button button-secondary" onClick={selectAllVisible} disabled={busy}>검색 결과 전체 선택</button>
            <button className="button button-ghost" onClick={() => setSelectedItems({})} disabled={busy}>선택 해제</button>
          </div>
          <div className={styles.locationItemList}>
            {visibleLocationInventory.map((row) => {
              const checked = selectedItems[row.productId] !== undefined;
              return (
                <article key={row.productId} className={`${styles.locationItem} ${checked ? styles.selected : ""}`}>
                  <label className={styles.itemCheck}>
                    <input type="checkbox" checked={checked} onChange={(event) => toggleLocationItem(row, event.target.checked)} disabled={busy} />
                    <span><strong>{row.artist || "아티스트 없음"}</strong><b>{row.nameVer || "상품명/버전 없음"}</b><small>{row.pCodeNo || "-"} · {row.codeNo || "-"}</small></span>
                  </label>
                  <div className={styles.stockValue}><span>현재 재고</span><strong>{row.qty.toLocaleString()}</strong></div>
                  <label className={styles.qtyField}><span>{operation === "IB" ? "입고 수량" : "출고 수량"}</span><input type="number" min={1} max={operation === "OB" ? row.qty : undefined} value={checked ? selectedItems[row.productId] : ""} onChange={(event) => changeLocationItemQty(row, event.target.value)} disabled={!checked || busy} /></label>
                  <button className="button button-secondary button-compact" onClick={() => openStockCount({ productId: row.productId, artist: row.artist, nameVer: row.nameVer, codeNo: row.codeNo, locationId: row.locationId, locationCode: row.locationCode, currentQty: row.qty })} disabled={busy || row.qty <= 0}>남은 수량</button>
                </article>
              );
            })}
            {visibleLocationInventory.length === 0 ? <p className="empty-state">이 로케이션에 표시할 재고가 없습니다.</p> : null}
          </div>
          <div className={styles.batchFooter}>
            <label>메모(선택)<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="작업 사유 또는 메모" disabled={busy} /></label>
            <div className={styles.batchSummary}><span>선택 합계</span><strong>{selectedCount} SKU / {selectedQty.toLocaleString()}개</strong></div>
            <button className="button button-primary" onClick={() => void confirmLocationBatch()} disabled={selectedCount === 0 || busy}>{busy ? "처리 중..." : operation === "IB" ? "선택 상품 입고" : "선택 상품 출고"}</button>
          </div>
        </section>
      ) : null}

      {feedback ? <Feedback kind={feedback.kind} title={feedback.title}>{feedback.body}</Feedback> : null}

      {missingBarcode ? (
        <section className="panel warning-panel">
          <h3>미등록 바코드 처리</h3>
          <p><code>{missingBarcode}</code>를 신규 상품으로 등록하거나 기존 상품에 연결할 수 있습니다.</p>
          <div className="action-row">
            <Link className="button button-primary" href={`/products?barcode=${encodeURIComponent(missingBarcode)}`}>신규 상품 등록</Link>
            <Link className="button button-secondary" href={`/barcodes?barcode=${encodeURIComponent(missingBarcode)}&type=product`}>기존 상품에 연결</Link>
          </div>
        </section>
      ) : null}

      <div className="action-row">
        <button className="button button-secondary" onClick={reset}>작업 초기화</button>
        {productDone ? <button className="button button-primary" onClick={reset}>다음 작업</button> : null}
      </div>

      {candidateMatches.length > 1 ? (
        <MultiProductBarcodePicker
          matches={candidateMatches}
          title="공통 바코드 상품 선택"
          description="필요한 상품을 복수로 체크하고 입고·출고 수량을 상품별로 입력하세요."
          confirmLabel="선택 상품으로 계속"
          busy={busy}
          onConfirm={handleCommonProductSelection}
          onClose={() => { setCandidateMatches([]); setFirstBarcode(""); setResetToken((value) => value + 1); }}
        />
      ) : null}

      {stockCountTarget ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="남은 수량 확정">
          <section className={`selection-modal ${styles.stockCountModal}`}>
            <div className="section-heading"><div><p className="eyebrow">STOCK COUNT</p><h3>남은 수량</h3><p className="muted">{stockCountTarget.locationCode} · {stockCountTarget.artist} · {stockCountTarget.nameVer}</p></div><button className="button button-ghost" onClick={() => setStockCountTarget(null)} disabled={busy}>닫기</button></div>
            <div className={styles.stockCountNumbers}><div><span>현재 전산 재고</span><strong>{stockCountTarget.currentQty.toLocaleString()}</strong></div><div><span>차이 출고 수량</span><strong>{Math.max(0, stockCountTarget.currentQty - remainingQty).toLocaleString()}</strong></div></div>
            <label>실제 남은 수량<input type="number" min={0} max={stockCountTarget.currentQty} value={remainingQty} onChange={(event) => setRemainingQty(Number(event.target.value))} disabled={busy} /></label>
            <label>사유·메모(선택)<input value={stockCountReason} onChange={(event) => setStockCountReason(event.target.value)} placeholder="비어 있으면 재고 실사 수량으로 저장" disabled={busy} /></label>
            <button className="button button-primary button-full" onClick={() => void confirmStockCount()} disabled={busy}>{busy ? "처리 중..." : "남은 수량 확정"}</button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
