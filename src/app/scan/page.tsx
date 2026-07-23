"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { BarcodeField } from "@/components/barcode-field";
import { Feedback, type FeedbackKind } from "@/components/feedback";
import { PermissionGuard } from "@/components/permission-guard";
import { createIdempotencyKey } from "@/lib/barcode";
import { postInventoryMovement, resolveBarcodeCandidates } from "@/lib/inventory-api";
import {
  confirmRemainingStock,
  getLocationProductStock,
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
import styles from "./scan-workflow.module.css";

type WorkflowMode = "start" | "product" | "location";
type ProductStep = "location" | "quantity" | "done";

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
    // 브라우저가 오디오를 막아도 작업은 계속됩니다.
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

function ScanContent() {
  const [operation, setOperation] = useState<MovementType>("IB");
  const [mode, setMode] = useState<WorkflowMode>("start");
  const [productStep, setProductStep] = useState<ProductStep>("location");

  const [firstBarcode, setFirstBarcode] = useState("");
  const [productBarcode, setProductBarcode] = useState("");
  const [locationBarcode, setLocationBarcode] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [location, setLocation] = useState<Location | null>(null);
  const [productCandidates, setProductCandidates] = useState<ResolvedBarcode[]>([]);

  const [quantity, setQuantity] = useState(1);
  const [currentStock, setCurrentStock] = useState(0);
  const [note, setNote] = useState("");

  const [locationInventory, setLocationInventory] = useState<InventoryRow[]>([]);
  const [locationSearch, setLocationSearch] = useState("");
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({});

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
    setProductStep("location");
    setFirstBarcode("");
    setProductBarcode("");
    setLocationBarcode("");
    setProduct(null);
    setLocation(null);
    setProductCandidates([]);
    setQuantity(1);
    setCurrentStock(0);
    setNote("");
    setLocationInventory([]);
    setLocationSearch("");
    setSelectedItems({});
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

  const activateLocationWorkflow = useCallback(async (
    resolved: ResolvedBarcode,
    resolvedLocation: Location,
  ) => {
    setLocation(resolvedLocation);
    setLocationBarcode(resolved.barcodeValue);
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

  const selectProduct = useCallback((resolved: ResolvedBarcode): boolean => {
    const selected = productFromResolved(resolved);
    if (!selected?.id) {
      beep(false);
      setFeedback({
        kind: "error",
        title: "상품 정보 해석 실패",
        body: "바코드는 조회됐지만 상품 정보가 비어 있습니다.",
      });
      return false;
    }

    setProduct(selected);
    setProductBarcode(resolved.barcodeValue);
    setFirstBarcode(resolved.barcodeValue);
    setProductCandidates([]);
    setMode("product");
    setProductStep("location");
    setLocation(null);
    setLocationBarcode("");
    setCurrentStock(0);
    beep(true);
    setFeedback({
      kind: "success",
      title: "상품 선택 완료",
      body: `${selected.artist || "아티스트 미입력"} · ${selected.nameVer || "상품명/버전 미입력"}`,
    });
    return true;
  }, []);

  const handleFirstScan = useCallback(async (value: string): Promise<boolean> => {
    if (scanBusy) return false;

    setScanBusy(true);
    setMissingBarcode("");
    setProductCandidates([]);
    setFeedback({ kind: "info", title: "바코드 확인 중", body: value });

    try {
      const matches = await resolveBarcodeCandidates(value, undefined, `${operation}_FIRST_SCAN`);
      const productMatches = matches.filter((item) => productFromResolved(item)?.id);
      const locationMatches = matches.filter((item) => locationFromResolved(item)?.id);

      if (productMatches.length > 0 && locationMatches.length > 0) {
        throw new Error("같은 바코드가 상품과 로케이션에 동시에 연결되어 있습니다. 바코드 관리에서 중복을 정리하세요.");
      }

      if (locationMatches.length > 0) {
        if (locationMatches.length > 1) {
          throw new Error("같은 로케이션 바코드가 여러 위치에 연결되어 있습니다.");
        }
        const resolvedLocation = locationFromResolved(locationMatches[0]);
        if (!resolvedLocation) throw new Error("로케이션 정보를 읽지 못했습니다.");
        await activateLocationWorkflow(locationMatches[0], resolvedLocation);
        return true;
      }

      if (productMatches.length > 0) {
        if (productMatches.length === 1) return selectProduct(productMatches[0]);

        setFirstBarcode(productMatches[0].barcodeValue || value);
        setProductBarcode(productMatches[0].barcodeValue || value);
        setProductCandidates(productMatches);
        beep(true);
        setFeedback({
          kind: "info",
          title: "공통 상품 바코드",
          body: `${productMatches.length}개 상품/버전이 연결되어 있습니다. 실제 작업할 상품을 선택하세요.`,
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
  }, [activateLocationWorkflow, operation, scanBusy, selectProduct]);

  const handleProductLocationScan = useCallback(async (value: string): Promise<boolean> => {
    if (!product) return false;

    setFeedback(null);
    try {
      const matches = await resolveBarcodeCandidates(value, "location", `${operation}_LOCATION_SCAN`);
      if (matches.length === 0) throw new Error("등록되지 않은 로케이션 바코드입니다.");
      if (matches.length > 1) throw new Error("같은 로케이션 바코드가 여러 위치에 연결되어 있습니다.");

      const resolvedLocation = locationFromResolved(matches[0]);
      if (!resolvedLocation) throw new Error("로케이션 바코드가 아닙니다.");

      const stock = await getLocationProductStock(product.id, resolvedLocation.id);
      setLocation(resolvedLocation);
      setLocationBarcode(matches[0].barcodeValue);
      setCurrentStock(stock);
      setProductStep("quantity");
      beep(true);
      setFeedback({
        kind: "success",
        title: "로케이션 확인",
        body: `${resolvedLocation.locationCode} · 현재 재고 ${stock.toLocaleString()}개`,
      });
      return true;
    } catch (cause) {
      beep(false);
      setFeedback({
        kind: "error",
        title: "로케이션 스캔 실패",
        body: cause instanceof Error ? cause.message : "바코드를 확인하지 못했습니다.",
      });
      return false;
    }
  }, [operation, product]);

  const normalCanSubmit = Boolean(
    product
    && location
    && quantity > 0
    && Number.isInteger(quantity)
    && productStep === "quantity",
  );

  async function confirmProductMovement() {
    if (!normalCanSubmit || !product || !location) return;

    setBusy(true);
    setFeedback(null);
    try {
      const result = await postInventoryMovement({
        operation,
        productBarcode,
        locationBarcode,
        productId: product.id,
        locationId: location.id,
        quantity,
        idempotencyKey: createIdempotencyKey(),
        note: note.trim() || undefined,
      });

      setCurrentStock(result.afterQty);
      setProductStep("done");
      beep(true);
      setFeedback({
        kind: "success",
        title: operation === "IB" ? "입고 완료" : "출고 완료",
        body: `${result.product.nameVer} · ${result.location.locationCode} · ${result.beforeQty.toLocaleString()} → ${result.afterQty.toLocaleString()}`,
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
  const selectedQty = Object.values(selectedItems)
    .reduce((sum, qty) => sum + (Number(qty) || 0), 0);

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

    setSelectedItems((current) => ({
      ...current,
      [row.productId]: nextQty,
    }));
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
      setFeedback({ kind: "error", title: "상품을 선택하세요" });
      return;
    }

    const items = Object.entries(selectedItems).map(([productId, qty]) => ({
      productId,
      qty: Math.max(1, Math.trunc(qty)),
    }));

    if (!window.confirm(
      `${location.locationCode}에서 ${selectedCount}개 품목 / ${selectedQty.toLocaleString()}개를 ${operation === "IB" ? "입고" : "출고"}할까요?`,
    )) return;

    setBusy(true);
    setFeedback(null);
    try {
      const result = await postLocationInventoryBatch({
        operation,
        locationId: location.id,
        items,
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
        body: `${result.locationCode} · ${result.itemCount}개 품목 / ${result.totalQty.toLocaleString()}개`,
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
      setCurrentStock(result.afterQty);
      if (mode === "location" && location) {
        await loadLocationRows(location.id);
        setSelectedItems((current) => {
          const next = { ...current };
          delete next[result.productId];
          return next;
        });
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
          첫 바코드로 상품 또는 로케이션을 스캔할 수 있습니다. 상품을 먼저 찍으면 기존 순서로,
          로케이션을 먼저 찍으면 해당 위치의 여러 상품을 선택해 한 번에 처리합니다.
        </p>
      </section>

      <section className="operation-switch" aria-label="작업 구분">
        <button className={operation === "IB" ? "active" : ""} onClick={() => { setOperation("IB"); reset(); }}>
          입고 IB
        </button>
        <button className={operation === "OB" ? "active" : ""} onClick={() => { setOperation("OB"); reset(); }}>
          출고 OB
        </button>
      </section>

      {mode === "start" ? (
        <section className={`panel ${styles.firstScanPanel}`}>
          <div>
            <p className="eyebrow">FIRST SCAN</p>
            <h3>상품 또는 로케이션 바코드</h3>
            <p className="muted">
              상품이면 상품 중심 작업, 로케이션이면 해당 LOC의 재고 목록 작업으로 자동 전환됩니다.
            </p>
          </div>
          <BarcodeField
            label="첫 바코드"
            placeholder="상품 또는 로케이션 바코드를 스캔하세요"
            value={firstBarcode}
            onSubmit={handleFirstScan}
            autoFocus={productCandidates.length === 0}
            disabled={scanBusy || productCandidates.length > 0}
            resetToken={resetToken}
          />
        </section>
      ) : null}

      {mode === "product" && product ? (
        <section className="scan-grid">
          <article className="scan-card current">
            <span className="step-number">1</span>
            <h3>상품 확인</h3>
            <div className="resolved-card">
              <strong>{product.artist || "아티스트 미입력"}</strong>
              <span>{product.nameVer || "상품명/버전 미입력"}</span>
              <small>{product.codeNo}</small>
            </div>
          </article>

          <article className={`scan-card ${productStep === "location" ? "current" : ""}`}>
            <span className="step-number">2</span>
            <h3>로케이션 바코드</h3>
            <BarcodeField
              label="로케이션 스캔"
              placeholder="랙의 로케이션 바코드를 스캔하세요"
              value={locationBarcode}
              onSubmit={handleProductLocationScan}
              autoFocus={productStep === "location"}
              disabled={productStep !== "location" || busy}
              resetToken={resetToken}
            />
            {location ? (
              <div className="resolved-card">
                <strong>{location.locationCode}</strong>
                <span>현재 재고 {currentStock.toLocaleString()}개</span>
              </div>
            ) : null}
          </article>

          <article className={`scan-card ${productStep === "quantity" ? "current" : ""}`}>
            <span className="step-number">3</span>
            <h3>수량 확정</h3>
            <label>
              수량
              <input
                type="number"
                min={1}
                step={1}
                value={quantity}
                disabled={productStep !== "quantity" || busy}
                onChange={(event) => setQuantity(Number(event.target.value))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void confirmProductMovement();
                }}
              />
            </label>
            <label>
              메모(선택)
              <input
                value={note}
                disabled={productStep !== "quantity" || busy}
                onChange={(event) => setNote(event.target.value)}
                placeholder="입고 사유, 작업 메모"
              />
            </label>
            <button
              className="button button-primary button-full"
              disabled={!normalCanSubmit || busy}
              onClick={() => void confirmProductMovement()}
            >
              {busy ? "처리 중..." : operation === "IB" ? "입고 확정" : "출고 확정"}
            </button>
            <button
              className="button button-secondary button-full"
              disabled={!location || currentStock <= 0 || busy || productStep === "location"}
              onClick={() => {
                if (!location) return;
                openStockCount({
                  productId: product.id,
                  artist: product.artist,
                  nameVer: product.nameVer,
                  codeNo: product.codeNo,
                  locationId: location.id,
                  locationCode: location.locationCode,
                  currentQty: currentStock,
                });
              }}
            >
              남은 수량
            </button>
            <p className="muted small">
              현재 전산 재고보다 적은 실제 잔여 수량을 입력하면 차이만큼 출고 처리됩니다.
            </p>
          </article>
        </section>
      ) : null}

      {mode === "location" && location ? (
        <section className={`panel ${styles.locationPanel}`}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">LOCATION FIRST</p>
              <h3>{location.locationCode} 재고 선택</h3>
              <p className="muted">
                현재 이 로케이션에 재고가 있는 상품을 체크하고 품목별 수량을 입력하세요.
                로케이션에 아직 없는 상품의 입고는 상품 바코드를 먼저 스캔하면 됩니다.
              </p>
            </div>
            <span className="status-badge active">
              {locationInventory.length.toLocaleString()} SKU
            </span>
          </div>

          <div className={`filter-row ${styles.toolbar}`}>
            <input
              value={locationSearch}
              onChange={(event) => setLocationSearch(event.target.value)}
              placeholder="상품명, 아티스트, CODE_NO 검색"
            />
            <button className="button button-secondary" onClick={selectAllVisible} disabled={busy}>
              검색 결과 전체 선택
            </button>
            <button className="button button-ghost" onClick={() => setSelectedItems({})} disabled={busy}>
              선택 해제
            </button>
          </div>

          <div className={styles.locationItemList}>
            {visibleLocationInventory.map((row) => {
              const checked = selectedItems[row.productId] !== undefined;
              return (
                <article
                  key={`${row.locationId}-${row.productId}`}
                  className={`${styles.locationItem} ${checked ? styles.selected : ""}`}
                >
                  <label className={styles.itemCheck}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => toggleLocationItem(row, event.target.checked)}
                      disabled={busy}
                    />
                    <span>
                      <strong>{row.artist || "아티스트 미입력"}</strong>
                      <b>{row.nameVer || "상품명/버전 미입력"}</b>
                      <small>{row.pCodeNo || "-"} · {row.codeNo || "-"}</small>
                    </span>
                  </label>

                  <div className={styles.stockValue}>
                    <span>현재 재고</span>
                    <strong>{row.qty.toLocaleString()}</strong>
                  </div>

                  <label className={styles.qtyField}>
                    <span>{operation === "IB" ? "입고 수량" : "출고 수량"}</span>
                    <input
                      type="number"
                      min={1}
                      max={operation === "OB" ? row.qty : undefined}
                      value={checked ? selectedItems[row.productId] : ""}
                      onChange={(event) => changeLocationItemQty(row, event.target.value)}
                      disabled={!checked || busy}
                    />
                  </label>

                  <button
                    type="button"
                    className="button button-secondary button-compact"
                    disabled={busy || row.qty <= 0}
                    onClick={() => openStockCount({
                      productId: row.productId,
                      artist: row.artist,
                      nameVer: row.nameVer,
                      codeNo: row.codeNo,
                      locationId: row.locationId,
                      locationCode: row.locationCode,
                      currentQty: row.qty,
                    })}
                  >
                    남은 수량
                  </button>
                </article>
              );
            })}
            {visibleLocationInventory.length === 0 ? (
              <p className="empty-state">해당 로케이션에 표시할 재고가 없습니다.</p>
            ) : null}
          </div>

          <div className={styles.batchFooter}>
            <label>
              공통 메모(선택)
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="입출고 사유, 작업 메모"
                disabled={busy}
              />
            </label>
            <div className={styles.batchSummary}>
              <span>{selectedCount.toLocaleString()} SKU</span>
              <strong>{selectedQty.toLocaleString()}개</strong>
            </div>
            <button
              className="button button-primary"
              disabled={busy || selectedCount === 0}
              onClick={() => void confirmLocationBatch()}
            >
              {busy
                ? "처리 중..."
                : `${operation === "IB" ? "선택 상품 입고" : "선택 상품 출고"} 확정`}
            </button>
          </div>
        </section>
      ) : null}

      {feedback ? <Feedback kind={feedback.kind} title={feedback.title}>{feedback.body}</Feedback> : null}

      {missingBarcode ? (
        <section className="panel warning-panel">
          <h3>미등록 바코드 처리</h3>
          <p><code>{missingBarcode}</code>를 신규 등록하거나 기존 대상에 연결할 수 있습니다.</p>
          <div className="action-row">
            <Link className="button button-primary" href={`/products?barcode=${encodeURIComponent(missingBarcode)}`}>
              신규 상품 등록
            </Link>
            <Link className="button button-secondary" href={`/barcodes?barcode=${encodeURIComponent(missingBarcode)}&type=product`}>
              기존 상품에 연결
            </Link>
            <Link className="button button-secondary" href="/locations">
              로케이션 관리
            </Link>
          </div>
        </section>
      ) : null}

      <div className="action-row">
        <button className="button button-secondary" onClick={reset}>작업 초기화</button>
        {mode === "product" && productStep === "done" ? (
          <button className="button button-primary" onClick={reset}>다음 작업</button>
        ) : null}
      </div>

      {productCandidates.length > 1 ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="공통 바코드 상품 선택">
          <section className="selection-modal">
            <div className="section-heading">
              <div>
                <p className="eyebrow">MULTIPLE PRODUCTS</p>
                <h3>상품명/버전을 선택하세요</h3>
                <p className="muted">
                  <code>{productBarcode || firstBarcode}</code>에 {productCandidates.length}개 상품이 연결되어 있습니다.
                </p>
              </div>
              <button
                className="button button-ghost"
                onClick={() => {
                  setProductCandidates([]);
                  setFirstBarcode("");
                  setProductBarcode("");
                  setResetToken((value) => value + 1);
                }}
              >
                취소
              </button>
            </div>
            <div className="candidate-list">
              {productCandidates.map((candidate) => {
                const candidateProduct = productFromResolved(candidate);
                if (!candidateProduct) return null;
                return (
                  <button
                    className="candidate-button"
                    key={candidate.targetId}
                    onClick={() => selectProduct(candidate)}
                  >
                    <strong>{candidateProduct.nameVer}</strong>
                    <span>{candidateProduct.artist}</span>
                    <small>{candidateProduct.codeNo}</small>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}

      {stockCountTarget ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="남은 수량 확정">
          <section className={`selection-modal ${styles.stockCountModal}`}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">STOCK COUNT</p>
                <h3>남은 수량 확정</h3>
                <p className="muted">
                  {stockCountTarget.locationCode} · {stockCountTarget.artist || "아티스트 미입력"} · {stockCountTarget.nameVer}
                </p>
              </div>
              <button
                className="button button-ghost"
                onClick={() => setStockCountTarget(null)}
                disabled={busy}
              >
                닫기
              </button>
            </div>

            <div className={styles.stockCountNumbers}>
              <div>
                <span>현재 전산 재고</span>
                <strong>{stockCountTarget.currentQty.toLocaleString()}</strong>
              </div>
              <div>
                <span>차이 출고 수량</span>
                <strong>{Math.max(0, stockCountTarget.currentQty - remainingQty).toLocaleString()}</strong>
              </div>
            </div>

            <label>
              실제 남은 수량
              <input
                type="number"
                min={0}
                max={stockCountTarget.currentQty}
                step={1}
                value={remainingQty}
                onChange={(event) => setRemainingQty(Number(event.target.value))}
                disabled={busy}
                autoFocus
              />
            </label>

            <label>
              사유(선택)
              <input
                value={stockCountReason}
                onChange={(event) => setStockCountReason(event.target.value)}
                placeholder="비워두면 '재고 실사 수량'으로 저장"
                disabled={busy}
              />
            </label>

            <div className="feedback feedback-warning">
              <strong>입력한 남은 수량보다 많은 전산 재고는 출고 이력으로 저장됩니다.</strong>
              <span>이 기능으로 현재 수량보다 재고를 늘릴 수는 없습니다.</span>
            </div>

            <button
              className="button button-primary button-full"
              onClick={() => void confirmStockCount()}
              disabled={busy}
            >
              {busy ? "반영 중..." : "남은 수량 확정"}
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default function ScanPage() {
  return (
    <PermissionGuard permission="scan_inventory">
      <ScanContent />
    </PermissionGuard>
  );
}
