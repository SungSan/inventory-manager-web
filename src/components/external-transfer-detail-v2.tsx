"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { BarcodeField } from "@/components/barcode-field";
import {
  MultiProductBarcodePicker,
  type MultiProductBarcodeSelection,
} from "@/components/multi-product-barcode-picker";
import {
  cancelExternalTransferJob,
  completeExternalTransferJob,
  getExternalTransferJob,
  incrementExternalTransferItem,
  prepareExternalTransferAllocations,
  removeExternalTransferItem,
  saveExternalTransferAllocations,
  setExternalTransferItemQty,
  updateExternalTransferHeader,
  type ExternalAllocationInput,
  type ExternalTransferHeaderInput,
  type ExternalTransferItem,
  type ExternalTransferJob,
} from "@/lib/external-transfer-api";
import { setExternalTransferItemsBatch } from "@/lib/external-transfer-batch-api";
import { resolveBarcodeCandidates } from "@/lib/inventory-api";
import type { Product, ResolvedBarcode } from "@/types/domain";
import styles from "@/app/external-transfers/external-transfers.module.css";

type AllocationDraft = Record<string, Record<string, number>>;

function productFromMatch(match: ResolvedBarcode): Product | null {
  return match.target.type === "product" && "product" in match.target
    ? match.target.product
    : null;
}

export function ExternalTransferDetailV2() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const jobId = params.id;

  const [job, setJob] = useState<ExternalTransferJob | null>(null);
  const [header, setHeader] = useState<ExternalTransferHeaderInput>({ vendorName: "" });
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, number>>({});
  const [candidateMatches, setCandidateMatches] = useState<ResolvedBarcode[]>([]);
  const [allocationDraft, setAllocationDraft] = useState<AllocationDraft>({});
  const [allocationOpen, setAllocationOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const applyJob = useCallback((next: ExternalTransferJob) => {
    setJob(next);
    setHeader({
      vendorName: next.vendorName,
      vendorContact: next.vendorContact,
      vendorPhone: next.vendorPhone,
      vendorAddress: next.vendorAddress,
      purpose: next.purpose,
      note: next.note,
    });
    setQtyDrafts(Object.fromEntries((next.items ?? []).map((item) => [item.productId, item.requestedQty])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      applyJob(await getExternalTransferJob(jobId));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "외부이관 작업을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [applyJob, jobId]);

  useEffect(() => { void load(); }, [load]);

  const items = job?.items ?? [];
  const active = job?.status === "DRAFT" || job?.status === "ALLOCATING";
  const selectedQty = items.reduce((sum, item) => sum + (qtyDrafts[item.productId] ?? item.requestedQty), 0);
  const allocationsReady = items.length > 0
    && items.every((item) => item.requestedQty > 0 && item.allocatedTotal === item.requestedQty);

  async function saveHeader() {
    if (!active || !header.vendorName.trim()) {
      setError("외부업체명을 입력하세요.");
      return;
    }
    setWorking(true);
    try {
      applyJob(await updateExternalTransferHeader(jobId, header));
      setMessage("업체 정보를 저장했습니다.");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "업체 정보를 저장하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  async function addSingleProduct(productId: string) {
    setWorking(true);
    try {
      applyJob(await incrementExternalTransferItem(jobId, productId, 1));
      setCandidateMatches([]);
      setMessage("상품을 등록했습니다. 같은 단일 상품을 다시 스캔하면 수량이 1개 증가합니다.");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "상품을 등록하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  async function scanProduct(value: string): Promise<boolean> {
    setWorking(true);
    setMessage("");
    setError("");
    try {
      const matches = await resolveBarcodeCandidates(value, "product", "EXTERNAL_TRANSFER");
      const products = matches.filter((match) => productFromMatch(match) !== null);
      if (products.length === 0) {
        setError("등록된 상품 바코드를 찾을 수 없습니다.");
        return false;
      }
      if (products.length > 1) {
        setCandidateMatches(products);
        setMessage(`${products.length}개 상품이 연결된 공통 바코드입니다. 복수 선택과 상품별 수량을 지정하세요.`);
        return true;
      }
      const product = productFromMatch(products[0]);
      if (!product) return false;
      applyJob(await incrementExternalTransferItem(jobId, product.id, 1));
      setMessage("상품을 등록했습니다. 같은 상품을 다시 스캔하면 수량이 증가합니다.");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "상품 바코드를 처리하지 못했습니다.");
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function applyCommonBarcodeItems(selections: MultiProductBarcodeSelection[]) {
    setWorking(true);
    try {
      applyJob(await setExternalTransferItemsBatch(
        jobId,
        selections.map((selection) => ({
          productId: selection.product.id,
          qty: selection.qty,
        })),
      ));
      setCandidateMatches([]);
      setMessage(`${selections.length}개 상품의 출고 수량을 등록했습니다.`);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "공통 바코드 상품을 등록하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  async function saveQty(item: ExternalTransferItem, qty: number) {
    const nextQty = Math.max(1, Math.trunc(qty || 1));
    setQtyDrafts((current) => ({ ...current, [item.productId]: nextQty }));
    setWorking(true);
    try {
      applyJob(await setExternalTransferItemQty(jobId, item.productId, nextQty));
      setMessage("수량을 저장했습니다.");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "수량을 저장하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  async function removeItem(item: ExternalTransferItem) {
    if (!window.confirm(`${item.artist} · ${item.nameVer}\n이 품목을 목록에서 제거할까요?`)) return;
    setWorking(true);
    try {
      applyJob(await removeExternalTransferItem(jobId, item.productId));
      setMessage("품목을 제거했습니다.");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "품목을 제거하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  function buildAllocationDraft(nextItems: ExternalTransferItem[]): AllocationDraft {
    const draft: AllocationDraft = {};
    for (const item of nextItems) {
      const byLocation: Record<string, number> = {};
      let remaining = item.requestedQty;
      for (const option of item.locationOptions) {
        const qty = item.allocatedTotal === item.requestedQty
          ? option.allocatedQty
          : Math.min(option.availableQty, remaining);
        byLocation[option.locationId] = qty;
        remaining -= qty;
      }
      draft[item.productId] = byLocation;
    }
    return draft;
  }

  async function prepareAllocations() {
    if (!header.vendorName.trim()) {
      setError("외부업체명을 입력하고 저장하세요.");
      return;
    }
    if (items.length === 0) {
      setError("출고할 상품을 하나 이상 스캔하세요.");
      return;
    }
    setWorking(true);
    try {
      await updateExternalTransferHeader(jobId, header);
      const prepared = await prepareExternalTransferAllocations(jobId);
      applyJob(prepared);
      setAllocationDraft(buildAllocationDraft(prepared.items ?? []));
      if ((prepared.items ?? []).some((item) => item.locationCount > 1)) {
        setAllocationOpen(true);
        setMessage("여러 LOC에 존재하는 품목의 출고 수량을 배정하세요.");
      } else {
        setMessage("모든 품목의 출고 LOC가 자동으로 배정됐습니다.");
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "출고 LOC를 확인하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  function allocationSum(item: ExternalTransferItem): number {
    return Object.values(allocationDraft[item.productId] ?? {})
      .reduce((sum, qty) => sum + (Number(qty) || 0), 0);
  }

  function changeAllocation(item: ExternalTransferItem, locationId: string, raw: string) {
    const option = item.locationOptions.find((row) => row.locationId === locationId);
    const parsed = Number(raw);
    const qty = Number.isFinite(parsed)
      ? Math.max(0, Math.min(option?.availableQty ?? 0, Math.trunc(parsed)))
      : 0;
    setAllocationDraft((current) => ({
      ...current,
      [item.productId]: {
        ...(current[item.productId] ?? {}),
        [locationId]: qty,
      },
    }));
  }

  async function saveAllocations() {
    const invalid = items.find((item) => allocationSum(item) !== item.requestedQty);
    if (invalid) {
      setError(`${invalid.artist} · ${invalid.nameVer}의 LOC 배정 합계를 ${invalid.requestedQty}개로 맞추세요.`);
      return;
    }
    const payload: ExternalAllocationInput[] = items.flatMap((item) =>
      item.locationOptions
        .map((option) => ({
          productId: item.productId,
          locationId: option.locationId,
          qty: allocationDraft[item.productId]?.[option.locationId] ?? option.allocatedQty,
        }))
        .filter((row) => row.qty > 0),
    );
    setWorking(true);
    try {
      applyJob(await saveExternalTransferAllocations(jobId, payload));
      setAllocationOpen(false);
      setMessage("상품별 출고 LOC를 저장했습니다.");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "출고 LOC를 저장하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  async function complete() {
    if (!job || !allocationsReady) {
      setError("상품 수량과 출고 LOC 배정을 먼저 완료하세요.");
      return;
    }
    if (!window.confirm(`${job.vendorName}으로 ${items.length} SKU / ${job.totalQty.toLocaleString()}개를 출고 완료할까요?`)) return;
    setWorking(true);
    try {
      const document = await completeExternalTransferJob(jobId);
      router.push(`/external-transfers/documents/${document.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "외부이관을 완료하지 못했습니다.");
      await load();
    } finally {
      setWorking(false);
    }
  }

  async function cancel() {
    const reason = window.prompt("외부이관 작업 취소 사유를 입력하세요.", "작업 취소");
    if (reason === null) return;
    setWorking(true);
    try {
      await cancelExternalTransferJob(jobId, reason);
      router.push("/external-transfers");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "작업을 취소하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <div className="center-panel">외부이관 작업을 불러오는 중...</div>;
  if (!job) return <section className="panel"><h2>외부이관 작업을 열 수 없습니다.</h2><p className="inline-error">{error}</p></section>;

  const initialCandidateQuantities = Object.fromEntries(
    items.map((item) => [item.productId, item.requestedQty]),
  );

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><p className="eyebrow">EXTERNAL TRANSFER</p><h2>{job.vendorName || "외부업체 미지정"}</h2><p className="muted">작업자 {job.assignedToLabel} · 시작 {new Date(job.createdAt).toLocaleString("ko-KR")}</p></div>
        <div className="row-actions"><Link className="button button-secondary" href="/external-transfers">목록</Link>{active ? <button className="button button-ghost" onClick={() => void cancel()} disabled={working}>작업 취소</button> : null}</div>
      </section>

      {error ? <p className="inline-error">{error}</p> : null}
      {message ? <div className="feedback feedback-success"><strong>{message}</strong></div> : null}

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">STEP 1</p><h3>외부업체 정보</h3></div></div>
        <div className="form-grid">
          <label>외부업체명 *<input value={header.vendorName} onChange={(event) => setHeader({ ...header, vendorName: event.target.value })} disabled={!active} /></label>
          <label>인수인<input value={header.vendorContact ?? ""} onChange={(event) => setHeader({ ...header, vendorContact: event.target.value })} disabled={!active} /></label>
          <label>연락처<input value={header.vendorPhone ?? ""} onChange={(event) => setHeader({ ...header, vendorPhone: event.target.value })} disabled={!active} /></label>
          <label>출고 목적<input value={header.purpose ?? ""} onChange={(event) => setHeader({ ...header, purpose: event.target.value })} disabled={!active} /></label>
          <label className="span-two">주소<input value={header.vendorAddress ?? ""} onChange={(event) => setHeader({ ...header, vendorAddress: event.target.value })} disabled={!active} /></label>
          <label className="span-two">비고<textarea value={header.note ?? ""} onChange={(event) => setHeader({ ...header, note: event.target.value })} disabled={!active} rows={3} /></label>
          {active ? <button className="button button-secondary span-two" onClick={() => void saveHeader()} disabled={working || !header.vendorName.trim()}>업체 정보 저장</button> : null}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">STEP 2</p><h3>출고 상품 스캔</h3><p className="muted">공통 바코드는 여러 상품을 복수 선택하고 상품별 수량을 직접 입력합니다.</p></div><strong>{items.length} SKU / {selectedQty.toLocaleString()}개</strong></div>
        <BarcodeField label="상품 바코드" placeholder="상품 바코드를 연속으로 스캔" onSubmit={scanProduct} disabled={!active || working} autoFocus />
        <div className={styles.itemList}>
          {items.map((item) => {
            const qty = qtyDrafts[item.productId] ?? item.requestedQty;
            return (
              <article key={item.productId} className={styles.itemCard}>
                <div><strong>{item.artist || "아티스트 없음"} · {item.nameVer || "상품명 없음"}</strong><p className="small muted">{item.productBarcode || "바코드 없음"} · {item.pCodeNo || "-"} · {item.codeNo || "-"}</p><p className="small muted">전체 가용 재고 {item.availableTotal.toLocaleString()}개 · {item.locationCount}개 LOC</p></div>
                <div className="row-actions"><button className="button button-secondary button-compact" onClick={() => void saveQty(item, qty - 1)} disabled={!active || working || qty <= 1}>−</button><input type="number" min={1} value={qty} onChange={(event) => setQtyDrafts((current) => ({ ...current, [item.productId]: Math.max(1, Number(event.target.value) || 1) }))} onBlur={() => void saveQty(item, qty)} disabled={!active || working} style={{ width: 100 }} /><button className="button button-secondary button-compact" onClick={() => void saveQty(item, qty + 1)} disabled={!active || working}>+</button><button className="button button-danger button-compact" onClick={() => void removeItem(item)} disabled={!active || working}>삭제</button></div>
              </article>
            );
          })}
          {items.length === 0 ? <p className="empty-state">상품 바코드를 스캔해 품목을 등록하세요.</p> : null}
        </div>
      </section>

      <section className="panel"><div className="section-heading"><div><p className="eyebrow">STEP 3</p><h3>출고 LOC 확인</h3></div></div><p className="muted">단일 LOC 상품은 자동 배정하고, 여러 LOC에 있는 상품만 선택창을 표시합니다.</p><div className="row-actions"><button className="button button-primary" onClick={() => void prepareAllocations()} disabled={!active || working || items.length === 0}>상품·수량 확인</button>{job.status === "ALLOCATING" ? <button className="button button-secondary" onClick={() => { setAllocationDraft(buildAllocationDraft(items)); setAllocationOpen(true); }}>LOC 배정 다시 열기</button> : null}</div></section>

      <section className="panel"><div className="section-heading"><div><p className="eyebrow">STEP 4</p><h3>외부이관 완료</h3></div><strong>{items.length} SKU / {job.totalQty.toLocaleString()}개</strong></div><button className="button button-primary button-full" onClick={() => void complete()} disabled={!active || working || !allocationsReady}>출고 완료 및 명세서 생성</button></section>

      {candidateMatches.length > 1 ? <MultiProductBarcodePicker matches={candidateMatches} title="공통 바코드 상품 선택" description="이관할 상품을 복수 선택하고 각 상품의 출고 수량을 직접 입력하세요. 연결된 상품은 기본적으로 모두 선택됩니다." confirmLabel="선택 상품·수량 등록" initialQuantities={initialCandidateQuantities} busy={working} onConfirm={applyCommonBarcodeItems} onClose={() => setCandidateMatches([])} /> : null}

      {allocationOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className={`selection-modal ${styles.allocationModal}`}>
            <div className="section-heading"><div><h3>품목별 출고 LOC 선택</h3><p className="muted">각 품목의 배정 합계를 출고 요청 수량과 동일하게 맞추세요.</p></div><button className="button button-ghost" onClick={() => setAllocationOpen(false)}>닫기</button></div>
            <div className={styles.allocationList}>
              {items.map((item) => (
                <article key={item.productId} className={styles.allocationCard}>
                  <div className="section-heading"><div><strong>{item.artist} · {item.nameVer}</strong><p className="small muted">요청 {item.requestedQty}개 · 배정 {allocationSum(item)}개</p></div><span className={`status-badge ${allocationSum(item) === item.requestedQty ? "success" : "primary"}`}>{allocationSum(item)}/{item.requestedQty}</span></div>
                  {item.locationOptions.map((option) => <label key={option.locationId} className={styles.locationOption}><span><strong>{option.locationCode}</strong><small>보유 {option.availableQty.toLocaleString()}개</small></span><input type="number" min={0} max={option.availableQty} value={allocationDraft[item.productId]?.[option.locationId] ?? 0} onChange={(event) => changeAllocation(item, option.locationId, event.target.value)} /></label>)}
                </article>
              ))}
            </div>
            <button className="button button-primary button-full" onClick={() => void saveAllocations()} disabled={working}>LOC 배정 저장</button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
