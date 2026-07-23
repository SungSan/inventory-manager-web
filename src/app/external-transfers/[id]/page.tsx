"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { BarcodeField } from "@/components/barcode-field";
import { PermissionGuard } from "@/components/permission-guard";
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
import { resolveBarcodeCandidates } from "@/lib/inventory-api";
import type { Product, ResolvedBarcode } from "@/types/domain";
import styles from "../external-transfers.module.css";

type AllocationDraft = Record<string, Record<string, number>>;

function productFromMatch(match: ResolvedBarcode): Product | null {
  return match.target.type === "product" ? match.target.product : null;
}

function ExternalTransferDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const jobId = params.id;
  const [job, setJob] = useState<ExternalTransferJob | null>(null);
  const [header, setHeader] = useState<ExternalTransferHeaderInput>({
    vendorName: "",
    vendorContact: "",
    vendorPhone: "",
    vendorAddress: "",
    purpose: "",
    note: "",
  });
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, number>>({});
  const [candidateMatches, setCandidateMatches] = useState<ResolvedBarcode[]>([]);
  const [allocationOpen, setAllocationOpen] = useState(false);
  const [allocationDraft, setAllocationDraft] = useState<AllocationDraft>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [headerSaving, setHeaderSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const headerInitialized = useRef(false);
  const headerTimer = useRef<number | null>(null);
  const dirtyQty = useRef(new Set<string>());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await getExternalTransferJob(jobId);
      setJob(detail);
      setHeader({
        vendorName: detail.vendorName,
        vendorContact: detail.vendorContact,
        vendorPhone: detail.vendorPhone,
        vendorAddress: detail.vendorAddress,
        purpose: detail.purpose,
        note: detail.note,
      });
      setQtyDrafts(Object.fromEntries((detail.items ?? []).map((item) => [item.productId, item.requestedQty])));
      dirtyQty.current.clear();
      headerInitialized.current = true;
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "외부이관 작업을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
    return () => {
      if (headerTimer.current !== null) window.clearTimeout(headerTimer.current);
    };
  }, [load]);

  const active = job?.status === "DRAFT" || job?.status === "ALLOCATING";
  const items = job?.items ?? [];
  const selectedQty = items.reduce((sum, item) => sum + (qtyDrafts[item.productId] ?? item.requestedQty), 0);
  const allocationsReady = items.length > 0
    && items.every((item) => item.allocatedTotal === item.requestedQty && item.requestedQty > 0);

  const ambiguousItems = useMemo(
    () => items.filter((item) => item.locationCount > 1),
    [items],
  );

  function mergeHeaderResult(result: ExternalTransferJob) {
    setJob((current) => current ? {
      ...current,
      vendorName: result.vendorName,
      vendorContact: result.vendorContact,
      vendorPhone: result.vendorPhone,
      vendorAddress: result.vendorAddress,
      purpose: result.purpose,
      note: result.note,
      updatedAt: result.updatedAt,
    } : result);
  }

  function changeHeader<K extends keyof ExternalTransferHeaderInput>(
    key: K,
    value: ExternalTransferHeaderInput[K],
  ) {
    setHeader((current) => ({ ...current, [key]: value }));
    if (!headerInitialized.current || !active) return;
    if (headerTimer.current !== null) window.clearTimeout(headerTimer.current);
    headerTimer.current = window.setTimeout(() => {
      headerTimer.current = null;
      void saveHeader({ ...header, [key]: value });
    }, 650);
  }

  async function saveHeader(next = header) {
    if (!active || !next.vendorName.trim()) return;
    setHeaderSaving(true);
    try {
      const result = await updateExternalTransferHeader(jobId, next);
      mergeHeaderResult(result);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "업체 정보를 저장하지 못했습니다.");
    } finally {
      setHeaderSaving(false);
    }
  }

  async function addProduct(productId: string) {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const result = await incrementExternalTransferItem(jobId, productId, 1);
      setJob(result);
      setQtyDrafts(Object.fromEntries((result.items ?? []).map((item) => [item.productId, item.requestedQty])));
      dirtyQty.current.clear();
      setMessage("상품을 등록했습니다. 같은 상품을 다시 스캔하면 수량이 1개 증가합니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "상품을 등록하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  async function scanProduct(value: string): Promise<boolean> {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const matches = await resolveBarcodeCandidates(value, "product", "EXTERNAL_TRANSFER");
      if (matches.length === 0) {
        setError("등록된 상품 바코드를 찾을 수 없습니다.");
        return false;
      }
      if (matches.length > 1) {
        setCandidateMatches(matches);
        return true;
      }
      const product = productFromMatch(matches[0]);
      if (!product) {
        setError("상품 바코드가 아닙니다.");
        return false;
      }
      await addProduct(product.id);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "상품 바코드를 처리하지 못했습니다.");
      return false;
    } finally {
      setWorking(false);
    }
  }

  function changeQty(item: ExternalTransferItem, raw: string) {
    const parsed = Number(raw);
    const qty = Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : 1;
    dirtyQty.current.add(item.productId);
    setQtyDrafts((current) => ({ ...current, [item.productId]: qty }));
  }

  async function persistQty(productId: string, overrideQty?: number) {
    if (!dirtyQty.current.has(productId) && overrideQty === undefined) return;
    const qty = overrideQty ?? qtyDrafts[productId];
    if (!qty) return;

    setWorking(true);
    try {
      const result = await setExternalTransferItemQty(jobId, productId, qty);
      setJob(result);
      setQtyDrafts(Object.fromEntries((result.items ?? []).map((item) => [item.productId, item.requestedQty])));
      dirtyQty.current.delete(productId);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "출고 수량을 저장하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  async function flushQuantities(): Promise<ExternalTransferJob | null> {
    let latest = job;
    const productIds = Array.from(dirtyQty.current);
    for (const productId of productIds) {
      const qty = qtyDrafts[productId];
      if (!qty) continue;
      latest = await setExternalTransferItemQty(jobId, productId, qty);
      dirtyQty.current.delete(productId);
    }
    if (latest) {
      setJob(latest);
      setQtyDrafts(Object.fromEntries((latest.items ?? []).map((item) => [item.productId, item.requestedQty])));
    }
    return latest;
  }

  async function removeItem(item: ExternalTransferItem) {
    if (!window.confirm(`${item.artist} · ${item.nameVer}\n이 상품을 외부이관 목록에서 제거할까요?`)) return;
    setWorking(true);
    try {
      const result = await removeExternalTransferItem(jobId, item.productId);
      setJob(result);
      setQtyDrafts(Object.fromEntries((result.items ?? []).map((row) => [row.productId, row.requestedQty])));
      dirtyQty.current.delete(item.productId);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "상품을 제거하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  function buildInitialAllocationDraft(nextItems: ExternalTransferItem[]): AllocationDraft {
    const next: AllocationDraft = {};
    for (const item of nextItems) {
      const byLocation: Record<string, number> = {};
      const allocated = item.locationOptions.reduce((sum, option) => sum + option.allocatedQty, 0);
      if (allocated === item.requestedQty) {
        for (const option of item.locationOptions) {
          byLocation[option.locationId] = option.allocatedQty;
        }
      } else {
        let remaining = item.requestedQty;
        for (const option of item.locationOptions) {
          const qty = Math.min(option.availableQty, remaining);
          byLocation[option.locationId] = qty;
          remaining -= qty;
        }
      }
      next[item.productId] = byLocation;
    }
    return next;
  }

  async function prepareAllocations() {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await flushQuantities();
      const prepared = await prepareExternalTransferAllocations(jobId);
      setJob(prepared);
      setQtyDrafts(Object.fromEntries((prepared.items ?? []).map((item) => [item.productId, item.requestedQty])));
      const ambiguous = (prepared.items ?? []).filter((item) => item.locationCount > 1);
      setAllocationDraft(buildInitialAllocationDraft(prepared.items ?? []));
      if (ambiguous.length > 0) {
        setAllocationOpen(true);
        setMessage(`${ambiguous.length}개 품목의 출고 로케이션을 선택하세요.`);
      } else {
        setMessage("모든 상품이 단일 로케이션에 있어 출고 LOC가 자동 배정되었습니다.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "출고 LOC를 확인하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  function allocationSum(item: ExternalTransferItem): number {
    return Object.values(allocationDraft[item.productId] ?? {}).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
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
    const currentItems = job?.items ?? [];
    const invalid = currentItems.find((item) => allocationSum(item) !== item.requestedQty);
    if (invalid) {
      setError(`${invalid.artist} · ${invalid.nameVer}의 배정 합계를 ${invalid.requestedQty}개로 맞추세요.`);
      return;
    }

    const payload: ExternalAllocationInput[] = currentItems.flatMap((item) =>
      item.locationOptions
        .map((option) => ({
          productId: item.productId,
          locationId: option.locationId,
          qty: allocationDraft[item.productId]?.[option.locationId] ?? option.allocatedQty,
        }))
        .filter((row) => row.qty > 0),
    );

    setWorking(true);
    setError("");
    try {
      const result = await saveExternalTransferAllocations(jobId, payload);
      setJob(result);
      setAllocationDraft(buildInitialAllocationDraft(result.items ?? []));
      setAllocationOpen(false);
      setMessage("상품별 출고 로케이션 배정을 저장했습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "LOC 배정을 저장하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  async function complete() {
    if (!job || !allocationsReady) {
      setError("상품 수량과 출고 LOC 배정을 먼저 완료하세요.");
      return;
    }
    if (!window.confirm(
      `${job.vendorName}\n${items.length} SKU / ${selectedQty.toLocaleString()}개를 외부이관 처리하고 출고명세서를 생성할까요?`,
    )) return;

    setWorking(true);
    setError("");
    try {
      await saveHeader();
      await flushQuantities();
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
  if (!job) {
    return (
      <section className="panel">
        <h2>외부이관 작업을 열 수 없습니다.</h2>
        {error ? <p className="inline-error">{error}</p> : null}
        <Link className="button button-secondary" href="/external-transfers">목록으로</Link>
      </section>
    );
  }

  return (
    <div className={`page-stack ${styles.page}`}>
      <section className={styles.detailHeader}>
        <div>
          <p className="eyebrow">EXTERNAL TRANSFER JOB</p>
          <h2>{job.vendorName}</h2>
          <p className="muted">
            작업자 {job.assignedToLabel} · 시작 {new Date(job.createdAt).toLocaleString("ko-KR")}
          </p>
        </div>
        <div className="row-actions">
          <Link className="button button-secondary" href="/external-transfers">목록</Link>
          {active ? <button className="button button-ghost" onClick={() => void cancel()} disabled={working}>작업 취소</button> : null}
        </div>
      </section>

      <section className={styles.progress}>
        <div className={styles.done}><span>1</span><strong>업체 정보</strong><small>{job.vendorName}</small></div>
        <div className={items.length > 0 ? styles.done : styles.current}><span>2</span><strong>상품·수량</strong><small>{items.length} SKU</small></div>
        <div className={allocationsReady ? styles.done : items.length > 0 ? styles.current : ""}><span>3</span><strong>출고 LOC</strong><small>{allocationsReady ? "배정 완료" : "미배정"}</small></div>
        <div className={allocationsReady ? styles.current : ""}><span>4</span><strong>출고 완료</strong><small>{selectedQty.toLocaleString()}개</small></div>
      </section>

      {error ? <p className="inline-error">{error}</p> : null}
      {message ? <p className="feedback feedback-success">{message}</p> : null}

      {!active ? (
        <section className="feedback feedback-info">
          <strong>{job.status === "COMPLETED" ? "완료된 외부이관입니다." : "취소된 외부이관입니다."}</strong>
          <span>완료·취소된 작업은 수정할 수 없습니다.</span>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-heading">
          <div><p className="eyebrow">STEP 1</p><h3>외부업체·출고 정보</h3></div>
          <span className="small muted">{headerSaving ? "서버에 저장 중..." : `저장됨 ${new Date(job.updatedAt).toLocaleTimeString("ko-KR")}`}</span>
        </div>
        <div className={styles.headerForm}>
          <label>
            외부업체명 *
            <input value={header.vendorName} onChange={(event) => changeHeader("vendorName", event.target.value)} disabled={!active} />
          </label>
          <label>
            담당자
            <input value={header.vendorContact} onChange={(event) => changeHeader("vendorContact", event.target.value)} disabled={!active} />
          </label>
          <label>
            연락처
            <input value={header.vendorPhone} onChange={(event) => changeHeader("vendorPhone", event.target.value)} disabled={!active} />
          </label>
          <label className={styles.spanTwo}>
            주소
            <input value={header.vendorAddress} onChange={(event) => changeHeader("vendorAddress", event.target.value)} disabled={!active} />
          </label>
          <label>
            출고 목적
            <input value={header.purpose} onChange={(event) => changeHeader("purpose", event.target.value)} disabled={!active} />
          </label>
          <label>
            비고
            <input value={header.note} onChange={(event) => changeHeader("note", event.target.value)} disabled={!active} />
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">STEP 2</p>
            <h3>상품 스캔·수량 등록</h3>
            <p className="muted small">같은 상품을 다시 스캔하면 수량이 1개씩 증가합니다.</p>
          </div>
          <strong>{items.length} SKU / {selectedQty.toLocaleString()}개</strong>
        </div>

        <BarcodeField
          label="상품 바코드"
          placeholder="상품 바코드를 스캔하거나 입력"
          onSubmit={scanProduct}
          disabled={!active || working}
          resetToken={items.length}
          autoFocus
        />

        <div className={styles.itemList}>
          {items.map((item) => {
            const qty = qtyDrafts[item.productId] ?? item.requestedQty;
            return (
              <article key={item.productId} className={styles.itemCard}>
                <div className={styles.itemIdentity}>
                  <strong>{item.artist || "아티스트 없음"}</strong>
                  <b>{item.nameVer || "상품명/버전 없음"}</b>
                  <small>{item.productBarcode || "바코드 없음"} · {item.codeNo || "-"}</small>
                </div>
                <div className={styles.stockBlock}>
                  <span>가용 재고</span>
                  <strong className={item.availableTotal < qty ? styles.dangerText : ""}>
                    {item.availableTotal.toLocaleString()}
                  </strong>
                </div>
                <div className={styles.qtyControl}>
                  <button
                    className="button button-secondary button-compact"
                    disabled={!active || working || qty <= 1}
                    onClick={() => {
                      const nextQty = qty - 1;
                      changeQty(item, String(nextQty));
                      void persistQty(item.productId, nextQty);
                    }}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={qty}
                    onChange={(event) => changeQty(item, event.target.value)}
                    onBlur={() => void persistQty(item.productId)}
                    disabled={!active || working}
                  />
                  <button
                    className="button button-secondary button-compact"
                    disabled={!active || working}
                    onClick={() => {
                      const nextQty = qty + 1;
                      changeQty(item, String(nextQty));
                      void persistQty(item.productId, nextQty);
                    }}
                  >
                    +
                  </button>
                </div>
                <div className={styles.itemAllocationState}>
                  <span>출고 LOC</span>
                  <strong>{item.allocatedTotal.toLocaleString()} / {item.requestedQty.toLocaleString()}</strong>
                  <small>{item.locationCount}개 로케이션 보유</small>
                </div>
                <button
                  className="button button-danger button-compact"
                  onClick={() => void removeItem(item)}
                  disabled={!active || working}
                >
                  제거
                </button>
              </article>
            );
          })}
          {items.length === 0 ? <p className="empty-state">상품 바코드를 스캔해 출고 품목을 등록하세요.</p> : null}
        </div>
      </section>

      <section className={`panel ${styles.confirmPanel}`}>
        <div>
          <p className="eyebrow">STEP 3</p>
          <h3>상품별 출고 로케이션 확인</h3>
          <p className="muted">
            한 곳에만 있는 상품은 자동 배정됩니다. 여러 LOC에 있는 상품은 품목별로 출고 수량을 나눠 지정합니다.
          </p>
        </div>
        <button
          className="button button-secondary"
          onClick={() => void prepareAllocations()}
          disabled={!active || working || items.length === 0}
        >
          {working ? "확인 중..." : allocationsReady ? "LOC 배정 다시 확인" : "확인 및 LOC 배정"}
        </button>
      </section>

      <section className={`panel ${styles.confirmPanel}`}>
        <div>
          <p className="eyebrow">STEP 4</p>
          <h3>외부이관 완료·명세서 생성</h3>
          <div className={styles.summary}>
            <span><small>업체</small><strong>{job.vendorName}</strong></span>
            <span><small>품목</small><strong>{items.length} SKU</strong></span>
            <span><small>출고 수량</small><strong>{selectedQty.toLocaleString()}개</strong></span>
            <span><small>LOC 배정</small><strong>{allocationsReady ? "완료" : "미완료"}</strong></span>
          </div>
        </div>
        <button
          className="button button-primary"
          onClick={() => void complete()}
          disabled={!active || working || !allocationsReady || items.length === 0}
        >
          {working ? "출고 처리 중..." : "외부이관 완료 및 명세서 생성"}
        </button>
      </section>

      {candidateMatches.length > 1 ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="상품 선택">
          <section className={`selection-modal ${styles.choiceModal}`}>
            <div className="section-heading">
              <div><p className="eyebrow">PRODUCT CHOICE</p><h3>공통 바코드 상품 선택</h3></div>
              <button className="button button-ghost" onClick={() => setCandidateMatches([])}>닫기</button>
            </div>
            <p className="muted">같은 바코드에 여러 상품 버전이 연결되어 있습니다. 출고할 상품을 선택하세요.</p>
            <div className={styles.choiceList}>
              {candidateMatches.map((match) => {
                const product = productFromMatch(match);
                if (!product) return null;
                return (
                  <button
                    key={product.id}
                    className={styles.choiceButton}
                    onClick={() => {
                      setCandidateMatches([]);
                      void addProduct(product.id);
                    }}
                  >
                    <strong>{product.artist || "아티스트 없음"}</strong>
                    <b>{product.nameVer || "상품명/버전 없음"}</b>
                    <small>{product.pCodeNo || "-"} · {product.codeNo || "-"}</small>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}

      {allocationOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="출고 로케이션 배정">
          <section className={`selection-modal ${styles.allocationModal}`}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">LOCATION ALLOCATION</p>
                <h3>여러 LOC 품목 출고 배정</h3>
              </div>
              <button className="button button-ghost" onClick={() => setAllocationOpen(false)}>닫기</button>
            </div>
            <p className="muted">
              각 품목의 배정 합계가 출고 요청 수량과 같아야 합니다. 단일 LOC 품목은 이미 자동 배정되어 있습니다.
            </p>

            <div className={styles.allocationList}>
              {ambiguousItems.map((item) => {
                const sum = allocationSum(item);
                return (
                  <article key={item.productId} className={styles.allocationCard}>
                    <div className={styles.allocationHeading}>
                      <div>
                        <strong>{item.artist || "아티스트 없음"} · {item.nameVer}</strong>
                        <small>{item.productBarcode || item.codeNo}</small>
                      </div>
                      <span className={sum === item.requestedQty ? "status-badge active" : "status-badge error"}>
                        배정 {sum.toLocaleString()} / {item.requestedQty.toLocaleString()}
                      </span>
                    </div>
                    <div className={styles.locationRows}>
                      {item.locationOptions.map((option) => (
                        <label key={option.locationId} className={styles.locationRow}>
                          <span>
                            <strong>{option.locationCode}</strong>
                            <small>{option.zone || "구역 미지정"} · 가용 {option.availableQty.toLocaleString()}개</small>
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={option.availableQty}
                            value={allocationDraft[item.productId]?.[option.locationId] ?? 0}
                            onChange={(event) => changeAllocation(item, option.locationId, event.target.value)}
                          />
                        </label>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>

            <button
              className="button button-primary button-full"
              onClick={() => void saveAllocations()}
              disabled={working || ambiguousItems.some((item) => allocationSum(item) !== item.requestedQty)}
            >
              {working ? "배정 저장 중..." : "상품별 LOC 배정 저장"}
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default function ExternalTransferDetailPage() {
  return (
    <PermissionGuard permission="external_transfer">
      <ExternalTransferDetailContent />
    </PermissionGuard>
  );
}
