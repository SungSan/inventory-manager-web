"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { BarcodeField } from "@/components/barcode-field";
import { PermissionGuard } from "@/components/permission-guard";
import { listInventory } from "@/lib/inventory-api";
import {
  cancelTransferJob,
  completeTransferJob,
  getTransferJob,
  saveTransferJobItems,
  setTransferDestination,
} from "@/lib/transfer-api";
import type { InventoryRow, TransferItemInput, TransferJobDetail } from "@/types/domain";

function TransferDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const jobId = params.id;
  const [job, setJob] = useState<TransferJobDetail | null>(null);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string>("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const initializedRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const pendingSavesRef = useRef(0);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await getTransferJob(jobId);
      const rows = await listInventory(detail.sourceLocationCode);
      const exactRows = rows
        .filter((row) => row.locationId === detail.sourceLocationId)
        .sort((a, b) => `${a.artist}${a.nameVer}${a.codeNo}`.localeCompare(`${b.artist}${b.nameVer}${b.codeNo}`));
      const initialDrafts = Object.fromEntries(detail.items.map((item) => [item.productId, item.requestedQty]));
      setJob(detail);
      setInventory(exactRows);
      setDrafts(initialDrafts);
      setSavedAt(detail.updatedAt);
      setError("");
      initializedRef.current = true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "이관 작업을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [load]);

  const active = job?.status === "DRAFT" || job?.status === "READY";

  const payloadFrom = useCallback((next: Record<string, number>): TransferItemInput[] => (
    Object.entries(next)
      .filter(([, qty]) => Number.isFinite(qty) && qty > 0)
      .map(([productId, qty]) => ({ productId, qty: Math.trunc(qty) }))
  ), []);

  const persist = useCallback(async (next: Record<string, number>) => {
    if (!initializedRef.current || !active) return;
    const payload = payloadFrom(next);
    pendingSavesRef.current += 1;
    setSaving(true);

    let result: TransferJobDetail | null = null;
    let failure: unknown = null;
    const task = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          result = await saveTransferJobItems(jobId, payload);
        } catch (cause) {
          failure = cause;
        }
      });
    saveChainRef.current = task;
    await task;

    pendingSavesRef.current -= 1;
    if (pendingSavesRef.current === 0) setSaving(false);

    if (failure) {
      setError(failure instanceof Error ? failure.message : "선택 내용을 저장하지 못했습니다.");
      return;
    }
    if (result) {
      setJob(result);
      setSavedAt(result.updatedAt);
      setError("");
    }
  }, [active, jobId, payloadFrom]);

  const queuePersist = useCallback((next: Record<string, number>) => {
    setDrafts(next);
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void persist(next);
    }, 450);
  }, [persist]);

  const flush = useCallback(async () => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    await persist(drafts);
    await saveChainRef.current;
  }, [drafts, persist]);

  const visibleInventory = useMemo(() => {
    const keyword = search.trim().toUpperCase();
    return inventory.filter((row) => {
      if (row.qty <= 0 && !drafts[row.productId]) return false;
      if (!keyword) return true;
      return [row.pCodeNo, row.codeNo, row.masterCodeNo, row.artist, row.nameVer]
        .some((value) => value.toUpperCase().includes(keyword));
    });
  }, [drafts, inventory, search]);

  const selectedCount = Object.values(drafts).filter((qty) => qty > 0).length;
  const selectedQty = Object.values(drafts).reduce((sum, qty) => sum + Math.max(0, Number(qty) || 0), 0);

  function toggleProduct(row: InventoryRow, checked: boolean) {
    const next = { ...drafts };
    if (checked) next[row.productId] = row.qty;
    else delete next[row.productId];
    queuePersist(next);
  }

  function changeQuantity(row: InventoryRow, raw: string) {
    const parsed = Number(raw);
    const next = { ...drafts };
    next[row.productId] = Number.isFinite(parsed) ? Math.min(row.qty, Math.max(1, Math.trunc(parsed))) : 1;
    queuePersist(next);
  }

  function selectAllVisible() {
    const next = { ...drafts };
    for (const row of visibleInventory) {
      if (row.qty > 0) next[row.productId] = row.qty;
    }
    queuePersist(next);
  }

  function clearSelection() {
    queuePersist({});
  }

  async function scanDestination(value: string): Promise<boolean> {
    setWorking(true);
    setError("");
    try {
      await flush();
      const updated = await setTransferDestination(jobId, value);
      setJob(updated);
      setSavedAt(updated.updatedAt);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "도착 로케이션을 저장하지 못했습니다.");
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function complete() {
    if (!job || !active) return;
    if (selectedCount === 0) {
      setError("이관할 상품을 하나 이상 선택하세요.");
      return;
    }
    if (!job.destinationLocationId) {
      setError("도착 로케이션을 먼저 스캔하세요.");
      return;
    }
    if (!window.confirm(`${job.sourceLocationCode}에서 ${job.destinationLocationCode}로 ${selectedCount} SKU / ${selectedQty.toLocaleString()}개를 이관할까요?`)) return;

    setWorking(true);
    setError("");
    try {
      await flush();
      const completed = await completeTransferJob(jobId);
      setJob(completed);
      window.alert("재고 이관이 완료되었습니다.");
      router.push("/transfers");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "재고 이관을 완료하지 못했습니다.");
      await load();
    } finally {
      setWorking(false);
    }
  }

  async function cancel() {
    if (!job || !active) return;
    const reason = window.prompt("이관 작업 취소 사유를 입력하세요.", "작업 취소");
    if (reason === null) return;
    setWorking(true);
    try {
      await cancelTransferJob(jobId, reason);
      router.push("/transfers");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "작업을 취소하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <div className="center-panel">이관 작업을 불러오는 중...</div>;
  if (!job) return <section className="panel"><h2>이관 작업을 열 수 없습니다.</h2>{error ? <p className="inline-error">{error}</p> : null}<Link className="button button-secondary" href="/transfers">목록으로</Link></section>;

  return (
    <div className="page-stack transfer-page">
      <section className="transfer-detail-header">
        <div>
          <p className="eyebrow">TRANSFER JOB</p>
          <h2>{job.sourceLocationCode} → {job.destinationLocationCode || "목적지 미지정"}</h2>
          <p className="muted">작업자 {job.assignedToLabel} · 시작 {new Date(job.createdAt).toLocaleString("ko-KR")}</p>
        </div>
        <div className="row-actions">
          <Link className="button button-secondary" href="/transfers">진행 중 업무</Link>
          {active ? <button className="button button-ghost" onClick={() => void cancel()} disabled={working}>작업 취소</button> : null}
        </div>
      </section>

      {error ? <p className="inline-error">{error}</p> : null}

      <section className="transfer-progress" aria-label="이관 진행 단계">
        <div className="transfer-progress-step done"><span>1</span><strong>출발 LOC</strong><small>{job.sourceLocationCode}</small></div>
        <div className={`transfer-progress-step ${selectedCount > 0 ? "done" : "current"}`}><span>2</span><strong>상품 선택</strong><small>{selectedCount} SKU</small></div>
        <div className={`transfer-progress-step ${job.destinationLocationId ? "done" : selectedCount > 0 ? "current" : ""}`}><span>3</span><strong>도착 LOC</strong><small>{job.destinationLocationCode || "미지정"}</small></div>
        <div className={`transfer-progress-step ${job.status === "READY" ? "current" : ""}`}><span>4</span><strong>이관 확정</strong><small>{selectedQty.toLocaleString()}개</small></div>
      </section>

      {!active ? (
        <section className="feedback feedback-info">
          <strong>{job.status === "COMPLETED" ? "완료된 이관 작업입니다." : "취소된 이관 작업입니다."}</strong>
          <span>완료·취소된 작업은 수정할 수 없습니다.</span>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-heading">
          <div><p className="eyebrow">STEP 2</p><h3>이동할 상품 선택</h3></div>
          <div className="transfer-save-state" aria-live="polite">
            {saving ? "서버에 저장 중..." : savedAt ? `저장됨 ${new Date(savedAt).toLocaleTimeString("ko-KR")}` : ""}
          </div>
        </div>
        <div className="filter-row transfer-item-toolbar">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="상품명, 아티스트, CODE_NO 검색" />
          <button className="button button-secondary" onClick={selectAllVisible} disabled={!active}>검색 결과 전체 이동</button>
          <button className="button button-ghost" onClick={clearSelection} disabled={!active}>선택 해제</button>
        </div>

        <div className="transfer-item-list">
          {visibleInventory.map((row) => {
            const checked = Boolean(drafts[row.productId]);
            return (
              <article key={row.productId} className={`transfer-item ${checked ? "selected" : ""}`}>
                <label className="transfer-item-check">
                  <input type="checkbox" checked={checked} onChange={(event) => toggleProduct(row, event.target.checked)} disabled={!active || row.qty <= 0} />
                  <span>
                    <strong>{row.artist || "아티스트 없음"}</strong>
                    <b>{row.nameVer || "상품명/버전 없음"}</b>
                    <small>{row.pCodeNo || "-"} · {row.codeNo || "-"}</small>
                  </span>
                </label>
                <div className="transfer-item-stock">
                  <span>현재 재고</span>
                  <strong>{row.qty.toLocaleString()}</strong>
                </div>
                <label className="transfer-item-qty">
                  <span>이관 수량</span>
                  <input
                    type="number"
                    min={1}
                    max={row.qty}
                    value={checked ? drafts[row.productId] : ""}
                    onChange={(event) => changeQuantity(row, event.target.value)}
                    onBlur={() => void flush()}
                    disabled={!active || !checked}
                  />
                </label>
              </article>
            );
          })}
          {visibleInventory.length === 0 ? <p className="empty-state">출발 로케이션에 이동 가능한 재고가 없습니다.</p> : null}
        </div>
      </section>

      <section className="panel transfer-destination-panel">
        <div><p className="eyebrow">STEP 3</p><h3>도착 로케이션</h3></div>
        <BarcodeField
          label="도착 로케이션 스캔"
          placeholder="이동 후 적재할 로케이션 바코드"
          value={job.destinationLocationCode}
          onSubmit={scanDestination}
          disabled={!active || working}
          resetToken={job.destinationLocationId || "destination"}
        />
      </section>

      <section className="panel transfer-confirm-panel">
        <div>
          <p className="eyebrow">STEP 4</p>
          <h3>최종 확인</h3>
          <div className="transfer-summary">
            <span><small>출발</small><strong>{job.sourceLocationCode}</strong></span>
            <span aria-hidden="true">→</span>
            <span><small>도착</small><strong>{job.destinationLocationCode || "미지정"}</strong></span>
            <span><small>선택</small><strong>{selectedCount} SKU / {selectedQty.toLocaleString()}개</strong></span>
          </div>
        </div>
        <button
          className="button button-primary transfer-complete-button"
          onClick={() => void complete()}
          disabled={!active || working || saving || selectedCount === 0 || !job.destinationLocationId}
        >
          {working ? "처리 중..." : "재고 이관 확정"}
        </button>
      </section>
    </div>
  );
}

export default function TransferDetailPage() {
  return (
    <PermissionGuard permission="transfer_inventory">
      <TransferDetailContent />
    </PermissionGuard>
  );
}
