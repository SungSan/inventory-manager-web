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
  excludedId,
  step,
  onSelect,
}: {
  items: ProductMergeCandidate[];
  selectedId?: string;
  excludedId?: string;
  step: 1 | 2;
  onSelect: (item: ProductMergeCandidate) => void;
}) {
  if (items.length === 0) return <p className="empty-state">검색 결과가 없습니다.</p>;

  return (
    <div className="page-stack">
      {items.map((item) => {
        const selected = selectedId === item.id;
        const excluded = excludedId === item.id;
        const merged = Boolean(item.mergedIntoProductId);
        const inactiveTarget = step === 2 && !item.active;
        const disabled = excluded || merged || inactiveTarget;

        return (
          <button
            key={item.id}
            type="button"
            className={`panel ${selected ? "selected-card" : ""}`}
            style={{ textAlign: "left", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.58 : 1 }}
            disabled={disabled}
            onClick={() => onSelect(item)}
          >
            <div className="section-heading">
              <div>
                <strong>{label(item)}</strong>
                <p className="muted">{item.pCodeNo || "-"} · {item.codeNo || "-"} · {item.masterCodeNo || "-"}</p>
              </div>
              <span className={`status-badge ${selected ? "active" : item.active ? "active" : "inactive"}`}>
                {selected
                  ? "현재 후보"
                  : excluded
                    ? "1번 선택 상품"
                    : merged
                      ? "이미 병합됨"
                      : inactiveTarget
                        ? "기준 상품 불가"
                        : item.active
                          ? "사용"
                          : "중지"}
              </span>
            </div>
            <p>현재 재고 <strong>{item.stockQty.toLocaleString()}</strong>개 · {item.stockLocationCount.toLocaleString()} LOC</p>
            <small>바코드 {item.barcodes.filter((barcode) => barcode.active).map((barcode) => barcode.value).join(", ") || "-"}</small>
          </button>
        );
      })}
    </div>
  );
}

function ProductMergeContent() {
  const { user } = useUser();
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<ProductMergeCandidate[]>([]);
  const [draft, setDraft] = useState<ProductMergeCandidate | null>(null);
  const [source, setSource] = useState<ProductMergeCandidate | null>(null);
  const [target, setTarget] = useState<ProductMergeCandidate | null>(null);
  const [reason, setReason] = useState("오타/중복 상품 정리");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const step: 1 | 2 | 3 = !source ? 1 : !target ? 2 : 3;

  const load = useCallback(async () => {
    if (step === 3) return;
    setLoading(true);
    try {
      setItems(await listProductMergeCandidates(search));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "상품을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [search, step]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (user?.role !== "admin" && user?.role !== "manager") {
    return (
      <section className="panel">
        <h2>상품 병합 권한이 없습니다.</h2>
        <p className="muted">관리자 또는 매니저만 상품 병합을 실행할 수 있습니다.</p>
        <Link className="button button-secondary" href="/products">상품 관리로</Link>
      </section>
    );
  }

  function chooseCandidate(item: ProductMergeCandidate) {
    setDraft(item);
    setError("");
    setMessage("");
  }

  function lockSelection() {
    if (!draft) {
      setError(`${step}번으로 고정할 상품을 먼저 선택하세요.`);
      return;
    }

    if (step === 1) {
      setSource(draft);
      setDraft(null);
      setSearch("");
      setItems([]);
      setMessage("1번 상품을 고정했습니다. 이제 남길 2번 상품을 선택하세요.");
      return;
    }

    if (step === 2) {
      if (!draft.active) {
        setError("남길 기준 상품은 사용 상태인 상품만 선택할 수 있습니다.");
        return;
      }
      if (draft.id === source?.id) {
        setError("1번 상품과 같은 상품은 2번으로 선택할 수 없습니다.");
        return;
      }
      setTarget(draft);
      setDraft(null);
      setSearch("");
      setItems([]);
      setMessage("2번 상품까지 고정했습니다. 최종 병합 내용을 확인하세요.");
    }
  }

  function reselectSource() {
    setSource(null);
    setTarget(null);
    setDraft(null);
    setSearch("");
    setItems([]);
    setError("");
    setMessage("1번 상품을 다시 선택하세요.");
  }

  function reselectTarget() {
    setTarget(null);
    setDraft(null);
    setSearch("");
    setItems([]);
    setError("");
    setMessage("2번 상품을 다시 선택하세요.");
  }

  async function merge() {
    if (!source || !target) {
      setError("1번과 2번 상품을 모두 고정하세요.");
      return;
    }

    const confirmation = `1번 정리 대상\n${label(source)}\n\n2번 남길 기준\n${label(target)}\n\n1번 상품의 현재 재고 ${source.stockQty.toLocaleString()}개와 사용 가능한 바코드를 2번 상품으로 합칩니다.\n과거 거래 기록은 보존됩니다.\n\n계속할까요?`;
    if (!window.confirm(confirmation)) return;

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await mergeProductRecords(source.id, target.id, reason);
      setMessage(`병합 완료 · 재고 ${result.movedQty.toLocaleString()}개 / ${result.movedLocations.toLocaleString()} LOC / 바코드 ${result.movedBarcodes.toLocaleString()}개 이전`);
      setSource(null);
      setTarget(null);
      setDraft(null);
      setSearch("");
      setItems([]);
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
          <h2>상품 직접 선택 병합</h2>
          <p className="muted">프로그램이 중복 후보를 선별하지 않습니다. 전체 등록 상품을 직접 검색해 1번 정리 대상과 2번 남길 기준 상품을 순서대로 고정합니다.</p>
        </div>
        <Link className="button button-secondary" href="/products">상품 관리로</Link>
      </section>

      <div className="feedback feedback-info">
        <strong>병합 순서</strong>
        <p>1번 = 정리할 원본 상품 → 2번 = 최종적으로 남길 기준 상품. 진행 중인 이관·업무요청·재고실사에 1번 상품이 포함돼 있으면 안전을 위해 병합이 차단됩니다.</p>
      </div>

      {error ? <p className="inline-error">{error}</p> : null}
      {message ? <div className="feedback feedback-success"><strong>{message}</strong></div> : null}

      <section
        className="panel page-stack"
        style={{ position: "sticky", top: "12px", zIndex: 30, boxShadow: "0 8px 28px rgba(0,0,0,0.16)" }}
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">STEP {step}</p>
            <h3>{step === 1 ? "1번 · 정리할 상품 선택" : step === 2 ? "2번 · 남길 상품 선택" : "최종 병합 확인"}</h3>
          </div>
          <span className={`status-badge ${step === 3 ? "active" : draft ? "active" : "inactive"}`}>
            {step === 3 ? "병합 준비 완료" : draft ? "후보 선택됨" : "상품 선택 필요"}
          </span>
        </div>

        {step < 3 ? (
          <>
            <div className="feedback">
              <strong>{draft ? label(draft) : `${step}번으로 고정할 상품을 아래에서 선택하세요.`}</strong>
              {draft ? <p>재고 {draft.stockQty.toLocaleString()}개 · {draft.stockLocationCount} LOC · {draft.active ? "사용" : "중지"}</p> : null}
            </div>
            <div className="row-actions">
              <button className="button button-primary" type="button" disabled={!draft || loading} onClick={lockSelection}>
                {step === 1 ? "1번 상품으로 고정" : "2번 상품으로 고정"}
              </button>
              {draft ? <button className="button button-secondary" type="button" onClick={() => setDraft(null)}>현재 후보 취소</button> : null}
              {step === 2 ? <button className="button button-ghost" type="button" onClick={reselectSource}>1번 다시 선택</button> : null}
            </div>
          </>
        ) : (
          <>
            <div className="page-stack">
              <div className="feedback">
                <strong>1번 · 정리할 원본</strong>
                <p>{source ? label(source) : "-"}</p>
                <small>재고 {source?.stockQty.toLocaleString() ?? 0}개</small>
              </div>
              <div style={{ textAlign: "center", fontSize: "1.3rem", fontWeight: 700 }}>↓ 병합</div>
              <div className="feedback feedback-success">
                <strong>2번 · 남길 기준</strong>
                <p>{target ? label(target) : "-"}</p>
                <small>기존 재고 {target?.stockQty.toLocaleString() ?? 0}개</small>
              </div>
            </div>
            <label>
              병합 사유
              <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="예: 상품명 오타로 중복 등록" />
            </label>
            <div className="row-actions">
              <button className="button button-danger" disabled={busy} onClick={() => void merge()}>{busy ? "병합 중..." : "1번을 2번으로 병합"}</button>
              <button className="button button-secondary" type="button" disabled={busy} onClick={reselectTarget}>2번 다시 선택</button>
              <button className="button button-ghost" type="button" disabled={busy} onClick={reselectSource}>처음부터 다시 선택</button>
            </div>
          </>
        )}
      </section>

      {step < 3 ? (
        <section className="panel page-stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ALL PRODUCTS</p>
              <h3>전체 등록 상품에서 직접 선택</h3>
              <p className="muted">중복 여부를 자동 판단하지 않습니다. 상품명, 코드, 아티스트, 바코드로 전체 상품 DB를 직접 검색하세요.</p>
            </div>
            <strong>{items.length.toLocaleString()}건</strong>
          </div>
          <input
            autoFocus
            value={search}
            onChange={(event) => { setSearch(event.target.value); setDraft(null); }}
            placeholder="상품명, CODE_NO, P_CODE, MASTER, 아티스트, 바코드 검색"
          />
          {loading ? <p className="muted">상품 검색 중...</p> : null}
          {!loading ? (
            <CandidateList
              items={items}
              selectedId={draft?.id}
              excludedId={step === 2 ? source?.id : undefined}
              step={step === 1 ? 1 : 2}
              onSelect={chooseCandidate}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export default function ProductMergePage() {
  return <PermissionGuard permission="manage_products"><ProductMergeContent /></PermissionGuard>;
}
