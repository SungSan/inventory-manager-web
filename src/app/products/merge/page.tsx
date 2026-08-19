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
  const visible = items.filter((item) =>
    item.id !== excludeId
    && !item.mergedIntoProductId
    && (!targetMode || item.active),
  );

  if (visible.length === 0) return <p className="empty-state">선택 가능한 상품이 없습니다.</p>;

  return (
    <div className="page-stack">
      {visible.slice(0, 40).map((item) => {
        const selected = selectedId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={`panel ${selected ? "selected-card" : ""}`}
            style={{ textAlign: "left", cursor: "pointer" }}
            onClick={() => onSelect(item)}
          >
            <div className="section-heading">
              <div>
                <strong>{label(item)}</strong>
                <p className="muted">{item.pCodeNo || "-"} · {item.codeNo || "-"} · {item.masterCodeNo || "-"}</p>
              </div>
              <span className={`status-badge ${item.active ? "active" : "inactive"}`}>
                {selected ? "선택됨" : item.active ? "사용" : "중지"}
              </span>
            </div>
            <p>현재 재고 <strong>{item.stockQty.toLocaleString()}</strong>개 · {item.stockLocationCount.toLocaleString()} LOC</p>
            <small>바코드 {item.barcodes.filter((barcode) => barcode.active).map((barcode) => barcode.value).join(", ") || "-"}</small>
            {selected ? <p className="small"><strong>다른 상품을 누르면 즉시 선택이 바뀝니다.</strong></p> : null}
          </button>
        );
      })}
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
    try {
      setSourceItems(await listProductMergeCandidates(sourceSearch));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "상품을 불러오지 못했습니다.");
    }
  }, [sourceSearch]);

  const loadTarget = useCallback(async () => {
    try {
      setTargetItems(await listProductMergeCandidates(targetSearch));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "상품을 불러오지 못했습니다.");
    }
  }, [targetSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSource(), 180);
    return () => window.clearTimeout(timer);
  }, [loadSource]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTarget(), 180);
    return () => window.clearTimeout(timer);
  }, [loadTarget]);

  if (user?.role !== "admin" && user?.role !== "manager") {
    return (
      <section className="panel">
        <h2>상품 병합 권한이 없습니다.</h2>
        <p className="muted">관리자 또는 매니저만 상품 병합을 실행할 수 있습니다.</p>
        <Link className="button button-secondary" href="/products">상품 관리로</Link>
      </section>
    );
  }

  function selectSource(item: ProductMergeCandidate) {
    setSource(item);
    if (target?.id === item.id) setTarget(null);
    setMessage("");
    setError("");
  }

  function selectTarget(item: ProductMergeCandidate) {
    setTarget(item);
    if (source?.id === item.id) setSource(null);
    setMessage("");
    setError("");
  }

  async function merge() {
    if (!source || !target) {
      setError("병합할 원본 상품과 기준 상품을 모두 선택하세요.");
      return;
    }
    if (source.id === target.id) {
      setError("같은 상품끼리는 병합할 수 없습니다.");
      return;
    }

    const confirmation = `${label(source)}\n→ ${label(target)}\n\n현재 재고 ${source.stockQty.toLocaleString()}개와 사용 가능한 바코드를 기준 상품으로 합칩니다.\n과거 거래 기록은 보존되며, 이후 원복은 기준 상품 재고에 반영됩니다.\n\n계속할까요?`;
    if (!window.confirm(confirmation)) return;

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await mergeProductRecords(source.id, target.id, reason);
      setMessage(`병합 완료 · 재고 ${result.movedQty.toLocaleString()}개 / ${result.movedLocations.toLocaleString()} LOC / 바코드 ${result.movedBarcodes.toLocaleString()}개 이전`);
      setSource(null);
      setTarget(null);
      setSourceSearch("");
      setTargetSearch("");
      await Promise.all([loadSource(), loadTarget()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "상품 병합에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div>
          <p className="eyebrow">PRODUCT MERGE</p>
          <h2>중복·오타 상품 병합</h2>
          <p className="muted">원본 상품의 현재 재고와 바코드를 기준 상품으로 합칩니다. 과거 거래·출고명세서 기록은 감사 목적으로 유지합니다.</p>
        </div>
        <Link className="button button-secondary" href="/products">상품 관리로</Link>
      </section>

      <div className="feedback feedback-info">
        <strong>안전 규칙</strong>
        <p>진행 중인 재고이관·외부이관·업무요청·재고실사에 원본 상품이 포함돼 있으면 병합을 차단합니다. 해당 작업을 먼저 완료하거나 취소하세요.</p>
      </div>

      {error ? <p className="inline-error">{error}</p> : null}
      {message ? <div className="feedback feedback-success"><strong>{message}</strong></div> : null}

      <section
        className="panel page-stack"
        style={{ position: "sticky", top: "12px", zIndex: 30, boxShadow: "0 8px 28px rgba(0,0,0,0.16)" }}
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">MERGE CONTROL</p>
            <h3>현재 병합 선택</h3>
          </div>
          <span className={`status-badge ${source && target ? "active" : "inactive"}`}>
            {source && target ? "실행 가능" : "선택 필요"}
          </span>
        </div>

        <div className="detail-meta-grid">
          <div>
            <span>정리할 원본</span>
            <strong>{source ? label(source) : "미선택"}</strong>
            {source ? <small>재고 {source.stockQty.toLocaleString()}개 · {source.stockLocationCount} LOC</small> : null}
            {source ? <button className="button button-ghost button-compact" type="button" onClick={() => setSource(null)}>원본 선택 해제</button> : null}
          </div>
          <div>
            <span>남길 기준</span>
            <strong>{target ? label(target) : "미선택"}</strong>
            {target ? <small>재고 {target.stockQty.toLocaleString()}개 · {target.stockLocationCount} LOC</small> : null}
            {target ? <button className="button button-ghost button-compact" type="button" onClick={() => setTarget(null)}>기준 선택 해제</button> : null}
          </div>
        </div>

        <label>
          병합 사유
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="예: 상품명 오타로 중복 등록" />
        </label>

        <div className="row-actions">
          <button
            className="button button-danger"
            disabled={busy || !source || !target}
            onClick={() => void merge()}
          >
            {busy ? "병합 중..." : "선택한 상품 병합"}
          </button>
          {(source || target) ? (
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={() => { setSource(null); setTarget(null); setError(""); }}
            >
              선택 전체 초기화
            </button>
          ) : null}
        </div>
      </section>

      <section className="panel page-stack">
        <div><p className="eyebrow">STEP 1</p><h3>정리할 오타·중복 상품</h3><p className="muted">상품을 다시 누르면 원본 선택이 즉시 변경됩니다.</p></div>
        <input value={sourceSearch} onChange={(event) => setSourceSearch(event.target.value)} placeholder="상품명, CODE_NO, 아티스트, 바코드 검색" />
        <CandidateList items={sourceItems} selectedId={source?.id} onSelect={selectSource} excludeId={target?.id} />
      </section>

      <section className="panel page-stack">
        <div><p className="eyebrow">STEP 2</p><h3>남길 기준 상품</h3><p className="muted">정확한 상품을 누르면 기준 선택이 즉시 변경됩니다.</p></div>
        <input value={targetSearch} onChange={(event) => setTargetSearch(event.target.value)} placeholder="정확한 상품명, CODE_NO, 바코드 검색" />
        <CandidateList items={targetItems} selectedId={target?.id} onSelect={selectTarget} excludeId={source?.id} targetMode />
      </section>
    </div>
  );
}

export default function ProductMergePage() {
  return <PermissionGuard permission="manage_products"><ProductMergeContent /></PermissionGuard>;
}
