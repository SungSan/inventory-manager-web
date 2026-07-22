"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { BarcodeField } from "@/components/barcode-field";
import { Feedback, type FeedbackKind } from "@/components/feedback";
import { PermissionGuard } from "@/components/permission-guard";
import { createIdempotencyKey } from "@/lib/barcode";
import { postInventoryMovement, resolveBarcodeCandidates } from "@/lib/inventory-api";
import type { Location, MovementType, Product, ResolvedBarcode } from "@/types/domain";

type Step = "product" | "location" | "quantity" | "done";

function beep(success: boolean) {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
  return item.target.type === "product" && "product" in item.target ? item.target.product : null;
}

function ScanContent() {
  const [operation, setOperation] = useState<MovementType>("IB");
  const [step, setStep] = useState<Step>("product");
  const [productBarcode, setProductBarcode] = useState("");
  const [locationBarcode, setLocationBarcode] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [location, setLocation] = useState<Location | null>(null);
  const [productCandidates, setProductCandidates] = useState<ResolvedBarcode[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [missingBarcode, setMissingBarcode] = useState("");
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; title: string; body?: string } | null>(null);
  const [resetToken, setResetToken] = useState(0);

  const reset = useCallback(() => {
    setStep("product");
    setProductBarcode("");
    setLocationBarcode("");
    setProduct(null);
    setLocation(null);
    setProductCandidates([]);
    setQuantity(1);
    setNote("");
    setMissingBarcode("");
    setFeedback(null);
    setBusy(false);
    setScanBusy(false);
    setResetToken((value) => value + 1);
  }, []);

  const selectProduct = useCallback((resolved: ResolvedBarcode): boolean => {
    const selected = productFromResolved(resolved);
    if (!selected?.id) {
      setFeedback({
        kind: "error",
        title: "상품 정보 해석 실패",
        body: "바코드는 조회됐지만 상품 정보가 비어 있습니다. Supabase 스키마 업데이트가 필요합니다.",
      });
      beep(false);
      return false;
    }
    setProduct(selected);
    setProductBarcode(resolved.barcodeValue);
    setProductCandidates([]);
    setStep("location");
    beep(true);
    setFeedback({
      kind: "success",
      title: "상품 선택 완료",
      body: `${selected.artist || "아티스트 미입력"} · ${selected.nameVer || "상품명/버전 미입력"}`,
    });
    return true;
  }, []);

  const handleProductScan = useCallback(async (value: string): Promise<boolean> => {
    if (scanBusy) return false;
    setScanBusy(true);
    setFeedback({ kind: "info", title: "상품 조회 중", body: value });
    setMissingBarcode("");
    setProductCandidates([]);
    try {
      const matches = await resolveBarcodeCandidates(value, "product", `${operation}_PRODUCT_SCAN`);
      if (matches.length === 0) {
        setMissingBarcode(value);
        throw new Error("등록되지 않은 상품 바코드입니다.");
      }

      const usableMatches = matches.filter((item) => productFromResolved(item)?.id);
      if (usableMatches.length === 0) {
        throw new Error("바코드는 조회됐지만 상품 상세정보를 읽지 못했습니다. SUPABASE_PATCH_1_1_2.sql을 실행하세요.");
      }

      setProductBarcode(usableMatches[0].barcodeValue || value);
      if (usableMatches.length === 1) {
        if (!selectProduct(usableMatches[0])) return false;
      } else {
        setProductCandidates(usableMatches);
        beep(true);
        setFeedback({
          kind: "info",
          title: "공통 상품 바코드",
          body: `${usableMatches.length}개 상품/버전이 연결되어 있습니다. 실제 작업할 상품을 선택하세요.`,
        });
      }
      return true;
    } catch (cause) {
      beep(false);
      setFeedback({ kind: "error", title: "상품 스캔 실패", body: cause instanceof Error ? cause.message : "바코드를 확인할 수 없습니다." });
      return false;
    } finally {
      setScanBusy(false);
    }
  }, [operation, scanBusy, selectProduct]);

  const handleLocationScan = useCallback(async (value: string): Promise<boolean> => {
    setFeedback(null);
    try {
      const matches = await resolveBarcodeCandidates(value, "location", `${operation}_LOCATION_SCAN`);
      if (matches.length === 0) throw new Error("등록되지 않은 로케이션 바코드입니다.");
      if (matches.length > 1) throw new Error("같은 로케이션 바코드가 여러 위치에 연결되어 있습니다. 바코드 관리에서 중복을 정리하세요.");
      const resolved = matches[0];
      if (!("location" in resolved.target)) throw new Error("로케이션 바코드가 아닙니다.");
      const resolvedLocation = resolved.target.location;
      setLocationBarcode(resolved.barcodeValue);
      setLocation(resolvedLocation);
      setStep("quantity");
      beep(true);
      setFeedback({ kind: "success", title: "로케이션 확인", body: resolvedLocation.locationCode });
      return true;
    } catch (cause) {
      beep(false);
      setFeedback({ kind: "error", title: "로케이션 스캔 실패", body: cause instanceof Error ? cause.message : "바코드를 확인할 수 없습니다." });
      return false;
    }
  }, [operation]);

  const canSubmit = useMemo(
    () => Boolean(product && location && quantity > 0 && Number.isInteger(quantity)),
    [location, product, quantity],
  );

  async function confirm() {
    if (!canSubmit || !product || !location) return;
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
      setStep("done");
      beep(true);
      setFeedback({
        kind: "success",
        title: operation === "IB" ? "입고 완료" : "출고 완료",
        body: `${result.product.nameVer} · ${result.location.locationCode} · ${result.beforeQty} → ${result.afterQty}`,
      });
    } catch (cause) {
      beep(false);
      setFeedback({ kind: "error", title: operation === "IB" ? "입고 처리 실패" : "출고 처리 실패", body: cause instanceof Error ? cause.message : "처리 중 오류가 발생했습니다." });
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
          상품 바코드 → 상품/버전 선택(공통 바코드일 때만) → 로케이션 바코드 → 수량 순서입니다.
        </p>
      </section>

      <section className="operation-switch" aria-label="작업 구분">
        <button className={operation === "IB" ? "active" : ""} onClick={() => { setOperation("IB"); reset(); }}>입고 IB</button>
        <button className={operation === "OB" ? "active" : ""} onClick={() => { setOperation("OB"); reset(); }}>출고 OB</button>
      </section>

      <section className="scan-grid">
        <article className={`scan-card ${step === "product" ? "current" : ""}`}>
          <span className="step-number">1</span><h3>상품 바코드</h3>
          <BarcodeField
            label="상품 스캔"
            placeholder="상품 바코드를 스캔하세요"
            value={productBarcode}
            onSubmit={handleProductScan}
            autoFocus={step === "product" && productCandidates.length === 0}
            disabled={step !== "product" || productCandidates.length > 0 || scanBusy}
            resetToken={resetToken}
          />
          {product ? <div className="resolved-card"><strong>{product.artist}</strong><span>{product.nameVer}</span><small>{product.codeNo}</small></div> : null}
        </article>

        <article className={`scan-card ${step === "location" ? "current" : ""}`}>
          <span className="step-number">2</span><h3>로케이션 바코드</h3>
          <BarcodeField label="로케이션 스캔" placeholder="랙의 로케이션 바코드를 스캔하세요" value={locationBarcode} onSubmit={handleLocationScan} autoFocus={step === "location"} disabled={step !== "location"} resetToken={resetToken} />
          {location ? <div className="resolved-card"><strong>{location.locationCode}</strong><span>{location.zone}</span></div> : null}
        </article>

        <article className={`scan-card ${step === "quantity" ? "current" : ""}`}>
          <span className="step-number">3</span><h3>수량 확정</h3>
          <label>수량<input type="number" min={1} step={1} value={quantity} disabled={step !== "quantity" || busy} onChange={(event) => setQuantity(Number(event.target.value))} onKeyDown={(event) => { if (event.key === "Enter") void confirm(); }} /></label>
          <label>메모(선택)<input value={note} disabled={step !== "quantity" || busy} onChange={(event) => setNote(event.target.value)} placeholder="입고 사유, 작업 메모" /></label>
          <button className="button button-primary button-full" disabled={step !== "quantity" || !canSubmit || busy} onClick={() => void confirm()}>{busy ? "처리 중..." : operation === "IB" ? "입고 확정" : "출고 확정"}</button>
        </article>
      </section>

      {feedback ? <Feedback kind={feedback.kind} title={feedback.title}>{feedback.body}</Feedback> : null}

      {missingBarcode ? (
        <section className="panel warning-panel">
          <h3>미등록 바코드 처리</h3>
          <p><code>{missingBarcode}</code>를 신규 상품으로 등록하거나 기존 상품에 추가 연결할 수 있습니다.</p>
          <div className="action-row">
            <Link className="button button-primary" href={`/products?barcode=${encodeURIComponent(missingBarcode)}`}>신규 상품 등록</Link>
            <Link className="button button-secondary" href={`/barcodes?barcode=${encodeURIComponent(missingBarcode)}&type=product`}>기존 상품에 연결</Link>
          </div>
        </section>
      ) : null}

      <div className="action-row">
        <button className="button button-secondary" onClick={reset}>작업 초기화</button>
        {step === "done" ? <button className="button button-primary" onClick={reset}>다음 작업</button> : null}
      </div>

      {productCandidates.length > 1 ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="공통 바코드 상품 선택">
          <section className="selection-modal">
            <div className="section-heading">
              <div>
                <p className="eyebrow">MULTIPLE PRODUCTS</p>
                <h3>상품명/버전을 선택하세요</h3>
                <p className="muted"><code>{productBarcode}</code>에 {productCandidates.length}개 상품이 연결되어 있습니다.</p>
              </div>
              <button className="button button-ghost" onClick={() => { setProductCandidates([]); setProductBarcode(""); setResetToken((value) => value + 1); }}>취소</button>
            </div>
            <div className="candidate-list">
              {productCandidates.map((candidate) => {
                const candidateProduct = productFromResolved(candidate);
                if (!candidateProduct) return null;
                return (
                  <button className="candidate-button" key={candidate.targetId} onClick={() => selectProduct(candidate)}>
                    <strong>{candidateProduct.nameVer}</strong>
                    <span>{candidateProduct.artist}</span>
                    <small>P_CODE: {candidateProduct.pCodeNo || "-"} · CODE_NO: {candidateProduct.codeNo || "-"}</small>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default function ScanPage() {
  return <PermissionGuard permission="scan_inventory"><ScanContent /></PermissionGuard>;
}
