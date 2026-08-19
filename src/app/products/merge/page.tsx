"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PermissionGuard } from "@/components/permission-guard";
import { useUser } from "@/components/user-provider";
import {
  listProductMergeCandidates,
  mergeProductRecords,
  type ProductMergeCandidate,
} from "@/lib/product-merge-api";

function label(product: ProductMergeCandidate): string {
  return `${product.artist || "아티스트 미등록"} · ${product.nameVer || product.codeNo}`;
}

function CandidateList({
  items,
  selectedId,
  onSelect,
  excludeId,
  targetMode = false,
}: {
  items: ProductMergeCandidate[];
  selectedId?: string;
  onSelect: (item: ProductMergeCandidate) => void;
  excludeId?: string;
  targetMode?: boolean;
}) {
  const visible = items.filter((item) => item.id !== excludeId && (!targetMode || (item.active && !item.mergedIntoProductId)));
  if (visible.length === 0) return <p className="empty-state">선택 가능한 상품이 없습니다.</p>;
  return (
    <div className="page-stack">
      {visible.slice(0, 40).map((item) => (
        <button
          key={item.id}
          type="button"
          className={`panel ${selectedId === item.id ? "selected-card" : ""}`}
          style={{ textAlign: "left", cursor: "pointer" }}
          onClick={() => onSelect(item)}
        >
          <div className="section-heading">
            <div>
              <strong>{label(item)}</strong>
              <p className="muted">{item.pCodeNo || "-"} · {item.codeNo || "-"} · {item.masterCodeNo || "-"}</p>
            </div>
            <span className={`status-badge ${item.mergedIntoProductId ? "inactive" : item.active ? "active" : "inactive"}`}>
              {item.mergedIntoProductId ? "병합됨" : item.active ? "사용" : "중지"}
            </span>
          </div>
          <p>현재 재고 <strong>{item.stockQty.toLocaleString()}</strong>개 · {item.stockLocationCount.toLocaleString()} LOC</p>
          <small>바코드 {item.barcodes.filter((barcode) => barcode.active).map((barcode) => barcode.value).join(", ") || "-"}</small>
          {item.mergedIntoProductId ? <p className="muted">이미 다른 상품으로 병합된 원본입니다.</p> : null}
        </button>
      ))}
    </div>
  );
}

function ProductMergeContent() {
  const { user } = useUser();
  const [sourceSearch, setSourceSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [sourceItems, setSourceItems] = useState<ProductMergeCandidate[]>([]);
  const [targetItems, setTargetItems] = useState<ProductMergeCandidate[]>([]);
  const [source, setSource] = useState<ProductMergeCandidate | null>(null);
  const [target, setTarget] = useState<ProductMergeCandidate | null>(null);
  const [reason, setReason] = useState("오타/중복 상품 정리");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadSource = useCallback(async () => {
    try { setSourceItems(await listProductMergeCandidates(sourceSearch)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "상품을 불러오지 못했습니다."); }
  }, [sourceSearch]);
  const loadTarget = useCallback(async () => {
    try { setTargetItems(await listProductMergeCandidates(targetSearch)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "상품을 불러오지 못했습니다."); }
  }, [targetSearch]);

  useEffect(() => { const timer = window.setTimeout(() => void loadSource(), 180); return () => window.clearTimeout(timer); }, [loadSource]);
  useEffect(() => { const timer = window.setTimeout(() => void loadTarget(), 180); return () => window.clearTimeout(timer); }, [loadTarget]);

  if (user?.role !== "admin" && user?.role !== "manager") {
    return <section className="panel"><h2>상품 병합 권한이 없습니다.</h2><p className="muted">관리자 또는 매니저만 상품 병합을 실행할 수 있습니다.</p><Link className="button button-secondary" href="/products">상품 관리로</Link></section>;
  }

  async function merge() {
    if (!source || !target) { setError("병합할 원본 상품과 기준 상품을 모두 선택하세요."); return; }
    if (source.id === target.id) { setError("같은 상품끼리는 병합할 수 없습니다."); return; }
    const confirmation = `${label(source)}\n→ ${label(target)}\n\n현재 재고 ${source.stockQty.toLocaleString()}개와 사용 가능한 바코드를 기준 상품으로 합칩니다.\n과거 입출고 이력은 삭제하지 않습니다.\n\n계속할까요?`;
    if (!window.confirm(confirmation)) return;

    setBusy(true); setError(""); setMessage("");
    try {
      const result = await mergeProductRecords(source.id, target.id, reason);
      setMessage(`병합 완료 · 재고 ${result.movedQty.toLocaleString()}개 / ${result.movedLocations.toLocaleString()} LOC / 바코드 ${result.movedBarcodes.toLocaleString()}개 이전`);
      setSource(null); setTarget(null); setSourceSearch(""); setTargetSearch("");
      await Promise.all([loadSource(), loadTarget()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "상품 병합에 실패했습니다.");
    } finally { setBusy(false); }
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><p className="eyebrow">PRODUCT MERGE</p><h2>중복·오타 상품 병합</h2><p className="muted">원본 상품의 현재 재고와 바코드를 기준 상품으로 합칩니다. 과거 거래·출고명세서 기록은 감사 목적상 원래 상품 정보로 보존됩니다.</p></div>
        <Link className="button button-secondary" href="/products">상품 관리로</Link>
      </section>
      <div className="feedback feedback-info"><strong>안전 규칙</strong><p>진행 중인 재고이관·외부이관·업무요청·재고실사에 원본 상품이 포함돼 있으면 병합을 차단합니다. 해당 작업을 먼저 완료하거나 취소하세요.</p></div>
      {error ? <p className="inline-error">{error}</p> : null}
      {message ? <div className="feedback feedback-success"><strong>{message}</strong></div> : null}

      <section className="panel page-stack">
        <div><p className="eyebrow">STEP 1</p><h3>정리할 오타·중복 상품</h3></div>
        <input value={sourceSearch} onChange={(event) => setSourceSearch(event.target.value)} placeholder="상품명, CODE_NO, 아티스트 검색" />
        {source ? <div className="feedback"><strong>원본 선택: {label(source)}</strong><p>재고 {source.stockQty.toLocaleString()}개 · {source.stockLocationCount} LOC</p></div> : null}
        <CandidateList items={sourceItems} selectedId={source?.id} onSelect={setSource} />
      </section>

      <section className="panel page-stack">
        <div><p className="eyebrow">STEP 2</p><h3>남길 기준 상품</h3></div>
        <input value={targetSearch} onChange={(event) => setTargetSearch(event.target.value)} placeholder="정확한 상품명, CODE_NO 검색" />
        {target ? <div className="feedback feedback-success"><strong>기준 선택: {label(target)}</strong><p>기존 재고 {target.stockQty.toLocaleString()}개 · {target.stockLocationCount} LOC</p></div> : null}
        <CandidateList items={targetItems} selectedId={target?.id} onSelect={setTarget} excludeId={source?.id} targetMode />
      </section>

      <section className="panel page-stack">
        <label>병합 사유<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="예: 상품명 오타로 중복 등록" /></label>
        <div className="feedback"><strong>병합 결과</strong><p>{source ? label(source) : "원본 미선택"} → {target ? label(target) : "기준 미선택"}</p><p>원본 상품은 삭제하지 않고 `병합됨` 상태로 영구 비활성화됩니다.</p></div>
        <button className="button button-danger" disabled={busy || !source || !target} onClick={() => void merge()}>{busy ? "병합 중..." : "선택한 상품 병합"}</button>
      </section>
    </div>
  );
}

export default function ProductMergePage() {
  return <PermissionGuard permission="manage_products"><ProductMergeContent /></PermissionGuard>;
}
