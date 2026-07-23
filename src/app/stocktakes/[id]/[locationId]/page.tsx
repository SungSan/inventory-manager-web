"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarcodeField } from "@/components/barcode-field";
import { MultiProductBarcodePicker, type MultiProductBarcodeSelection } from "@/components/multi-product-barcode-picker";
import { PermissionGuard } from "@/components/permission-guard";
import { resolveBarcodeCandidates } from "@/lib/inventory-api";
import { addInventoryCountProduct, cancelInventoryCountLocation, completeInventoryCountLocation, getInventoryCountLocation, markInventoryCountItemsEqual, saveInventoryCountItems, startInventoryCountLocation, type InventoryCountLocationDetail } from "@/lib/stocktake-api";
import type { Product, ResolvedBarcode } from "@/types/domain";
import styles from "../../stocktakes.module.css";

function productFromResolved(item: ResolvedBarcode): Product | null {
  return item.target.type === "product" && "product" in item.target ? item.target.product : null;
}
function normalizeQuantity(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? digits.replace(/^0+(?=\d)/, "") : "";
}

function LocationCountContent() {
  const params = useParams<{ id: string; locationId: string }>();
  const [detail, setDetail] = useState<InventoryCountLocationDetail | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [keyword, setKeyword] = useState("");
  const [productBarcode, setProductBarcode] = useState("");
  const [candidateMatches, setCandidateMatches] = useState<ResolvedBarcode[]>([]);
  const [resetToken, setResetToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const applyDetail = useCallback((next: InventoryCountLocationDetail) => {
    setDetail(next);
    setCounts(Object.fromEntries(next.items.map((item) => [item.productId, item.countedQty == null ? "" : String(item.countedQty)])));
  }, []);

  const load = useCallback(async () => {
    try {
      let next = await getInventoryCountLocation(params.id, params.locationId);
      if (next.status === "PENDING") next = await startInventoryCountLocation(params.id, params.locationId);
      applyDetail(next); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "로케이션 실사를 불러오지 못했습니다."); }
  }, [applyDetail, params.id, params.locationId]);

  useEffect(() => { void load(); }, [load]);

  const visibleItems = useMemo(() => {
    const normalized = keyword.trim().toUpperCase();
    return (detail?.items ?? []).filter((item) => !normalized || `${item.artist} ${item.nameVer} ${item.pCodeNo} ${item.codeNo} ${item.masterCodeNo}`.toUpperCase().includes(normalized));
  }, [detail, keyword]);
  const missingCount = useMemo(() => (detail?.items ?? []).filter((item) => counts[item.productId] === "").length, [counts, detail]);
  const liveDifference = useMemo(() => (detail?.items ?? []).reduce((sum, item) => {
    const raw = counts[item.productId];
    return raw === "" || raw == null ? sum : sum + Math.abs(Number(raw) - item.systemQty);
  }, 0), [counts, detail]);

  function changeCount(productId: string, raw: string) { setCounts((current) => ({ ...current, [productId]: normalizeQuantity(raw) })); }

  async function saveAll(showMessage = true): Promise<boolean> {
    if (!detail || detail.status !== "IN_PROGRESS") return false;
    const filledItems = detail.items.filter((item) => counts[item.productId] !== "");
    if (filledItems.length === 0) { setError("저장할 실제 수량을 입력하세요."); return false; }
    setBusy(true); setError("");
    try {
      const next = await saveInventoryCountItems(detail.sessionId, detail.locationId, filledItems.map((item) => ({ productId: item.productId, countedQty: Number(counts[item.productId]) })));
      applyDetail(next); if (showMessage) setMessage("입력한 실사 수량을 저장했습니다."); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "실사 수량을 저장하지 못했습니다."); return false; }
    finally { setBusy(false); }
  }

  async function markAllEqual() {
    if (!detail || !window.confirm("아직 입력하지 않은 상품을 전산 수량과 동일하게 처리할까요?")) return;
    setBusy(true);
    try { applyDetail(await markInventoryCountItemsEqual(detail.sessionId, detail.locationId)); setMessage("미입력 상품을 전산 수량과 동일하게 처리했습니다."); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "일치 처리를 완료하지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function addProducts(selections: MultiProductBarcodeSelection[]) {
    if (!detail) return;
    setBusy(true);
    try {
      let next = detail;
      for (const selection of selections) next = await addInventoryCountProduct(detail.sessionId, detail.locationId, selection.product.id);
      applyDetail(next); setCandidateMatches([]); setProductBarcode(""); setResetToken((value) => value + 1); setMessage(`${selections.length}개 상품을 실사 목록에 추가했습니다.`); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "상품을 실사 목록에 추가하지 못했습니다."); }
    finally { setBusy(false); }
  }

  const scanProduct = useCallback(async (value: string): Promise<boolean> => {
    if (!detail || detail.status !== "IN_PROGRESS") return false;
    setBusy(true); setError("");
    try {
      const matches = await resolveBarcodeCandidates(value, "product", "STOCKTAKE_PRODUCT_SCAN");
      const products = matches.filter((item) => productFromResolved(item)?.id);
      if (products.length === 0) throw new Error("등록된 상품 바코드를 찾을 수 없습니다.");
      if (products.length > 1) { setCandidateMatches(products); setProductBarcode(value); return true; }
      const product = productFromResolved(products[0]);
      if (!product) throw new Error("상품 정보를 읽지 못했습니다.");
      await addProducts([{ match: products[0], product, qty: 1 }]); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "상품 바코드를 확인하지 못했습니다."); return false; }
    finally { setBusy(false); }
  }, [detail]);

  async function completeLocation() {
    if (!detail) return;
    if (missingCount > 0) { setError(`실제 수량을 입력하지 않은 상품이 ${missingCount}개 있습니다.`); return; }
    const saved = detail.items.length === 0 ? true : await saveAll(false);
    if (!saved || !window.confirm(`${detail.locationCode} 실사를 완료할까요?\n차이 수량은 입고·출고 조정으로 기록됩니다.`)) return;
    setBusy(true);
    try { const next = await completeInventoryCountLocation(detail.sessionId, detail.locationId); applyDetail(next); setMessage(`실사 완료 · 차이 ${next.differenceSkuCount} SKU / ${next.differenceQty.toLocaleString()}개`); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "로케이션 실사를 완료하지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function cancelLocation() {
    if (!detail || detail.status !== "IN_PROGRESS") return;
    const reason = window.prompt("이 로케이션 실사 취소 사유를 입력하세요.", "");
    if (reason === null || !window.confirm(`${detail.locationCode} 실사를 취소하고 재고 잠금을 해제할까요?`)) return;
    setBusy(true);
    try { await cancelInventoryCountLocation(detail.sessionId, detail.locationId, reason); await load(); setMessage("로케이션 실사를 취소했습니다."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "로케이션 실사를 취소하지 못했습니다."); }
    finally { setBusy(false); }
  }

  if (!detail) return <div className="page-stack"><Link className="text-link" href={`/stocktakes/${params.id}`}>← 실사 작업</Link>{error ? <p className="inline-error">{error}</p> : <div className="center-panel">로케이션 실사를 불러오는 중...</div>}</div>;
  const editable = detail.status === "IN_PROGRESS";

  return (
    <div className={`page-stack ${styles.page}`}>
      <section className={styles.detailHeader}><div><Link className="text-link" href={`/stocktakes/${detail.sessionId}`}>← {detail.countNo}</Link><p className="eyebrow">LOCATION COUNT</p><h2>{detail.locationCode}</h2><p className="muted">{detail.zone || "구역 없음"} · 실사 중에는 해당 LOC의 입고·출고·이관이 잠깁니다.</p></div><span className={`status-badge ${detail.status === "IN_PROGRESS" ? "active" : detail.status === "COMPLETED" ? "success" : "inactive"}`}>{detail.status}</span></section>
      {error ? <p className="inline-error">{error}</p> : null}{message ? <div className="feedback feedback-success"><strong>{message}</strong></div> : null}
      <section className={styles.progressPanel}><div><span>전산 SKU</span><strong>{detail.items.length.toLocaleString()}</strong></div><div><span>수량 입력</span><strong>{(detail.items.length - missingCount).toLocaleString()}</strong></div><div><span>미입력</span><strong>{missingCount.toLocaleString()}</strong></div><div><span>현재 차이</span><strong>{liveDifference.toLocaleString()}개</strong></div></section>
      {editable ? <section className="panel"><div className="section-heading"><div><p className="eyebrow">UNREGISTERED STOCK</p><h3>전산에 없는 실물 상품 추가</h3></div></div><BarcodeField label="상품 바코드" placeholder="현장에만 있는 상품 바코드를 스캔하세요" value={productBarcode} onSubmit={scanProduct} disabled={busy || candidateMatches.length > 0} resetToken={resetToken} /></section> : null}
      <section className="panel"><div className="section-heading"><div><p className="eyebrow">COUNT ITEMS</p><h3>품목별 실제 수량</h3></div><div className="action-row">{editable ? <button className="button button-secondary button-compact" onClick={() => void markAllEqual()} disabled={busy}>미입력 전부 일치</button> : null}{editable ? <button className="button button-primary button-compact" onClick={() => void saveAll()} disabled={busy}>입력 저장</button> : null}</div></div><input className={styles.itemSearch} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="상품명, 아티스트, 코드 검색" /><div className={styles.countItemList}>{visibleItems.map((item) => { const raw = counts[item.productId] ?? ""; const difference = raw === "" ? null : Number(raw) - item.systemQty; return <article key={item.productId} className={`${styles.countItem} ${difference === 0 ? styles.equalItem : difference ? styles.differenceItem : ""}`}><div className={styles.itemIdentity}><strong>{item.artist || "아티스트 없음"}</strong><b>{item.nameVer || "상품명/버전 없음"}</b><small>{item.pCodeNo || "-"} · {item.codeNo || "-"} · {item.masterCodeNo || "-"}</small></div><div className={styles.systemQty}><span>전산 수량</span><strong>{item.systemQty.toLocaleString()}</strong></div><label className={styles.countQty}>실제 수량<input type="number" min={0} inputMode="numeric" value={raw} placeholder="공란" onChange={(event) => changeCount(item.productId, event.target.value)} disabled={!editable || busy} /></label><div className={styles.differenceValue}><span>차이</span><strong>{difference == null ? "-" : difference > 0 ? `+${difference.toLocaleString()}` : difference.toLocaleString()}</strong></div>{editable ? <button className="button button-secondary button-compact" onClick={() => changeCount(item.productId, String(item.systemQty))} disabled={busy}>일치</button> : null}</article>; })}{visibleItems.length === 0 ? <p className="empty-state">표시할 실사 품목이 없습니다. 빈 LOC라면 바로 실사 완료할 수 있습니다.</p> : null}</div></section>
      {editable ? <section className={styles.completePanel}><div><strong>로케이션 실사 확정</strong><p>모든 품목의 실제 수량이 입력되어야 합니다. 완료 후 다음 실사 예정일은 3개월 뒤로 설정됩니다.</p></div><div className="action-row"><button className="button button-danger" onClick={() => void cancelLocation()} disabled={busy}>이 LOC 실사 취소</button><button className="button button-primary" onClick={() => void completeLocation()} disabled={busy || missingCount > 0}>{busy ? "처리 중..." : "로케이션 실사 완료"}</button></div></section> : <section className="panel"><h3>실사 결과</h3><p>차이 {detail.differenceSkuCount.toLocaleString()} SKU / {detail.differenceQty.toLocaleString()}개</p><p>다음 실사 예정일: {detail.nextDueAt ? new Date(detail.nextDueAt).toLocaleDateString("ko-KR") : "-"}</p></section>}
      {candidateMatches.length > 1 ? <MultiProductBarcodePicker matches={candidateMatches} title="실사 상품 선택" description="현장에 실제로 존재하는 상품을 복수 선택하세요. 실제 수량은 추가 후 입력합니다." confirmLabel="선택 상품 추가" busy={busy} onConfirm={addProducts} onClose={() => { setCandidateMatches([]); setProductBarcode(""); setResetToken((value) => value + 1); }} /> : null}
    </div>
  );
}

export default function InventoryCountLocationPage() {
  return <PermissionGuard permission="stocktake_inventory"><LocationCountContent /></PermissionGuard>;
}
