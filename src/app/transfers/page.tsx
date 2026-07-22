"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BarcodeField } from "@/components/barcode-field";
import { PermissionGuard } from "@/components/permission-guard";
import { createTransferJob, listTransferJobs } from "@/lib/transfer-api";
import { subscribeToInventory } from "@/lib/inventory-api";
import type { TransferJob } from "@/types/domain";

const statusLabel: Record<TransferJob["status"], string> = {
  DRAFT: "상품 선택 중",
  READY: "확정 대기",
  COMPLETED: "완료",
  CANCELLED: "취소",
};

function TransferListContent() {
  const router = useRouter();
  const [jobs, setJobs] = useState<TransferJob[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const rows = await listTransferJobs(false);
      setJobs(rows);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "진행 중 업무를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribeToInventory(() => void load());
  }, [load]);

  async function startTransfer(sourceBarcode: string): Promise<boolean> {
    setCreating(true);
    setError("");
    try {
      const job = await createTransferJob(sourceBarcode, note);
      router.push(`/transfers/${job.id}`);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "이관 작업을 시작하지 못했습니다.");
      return false;
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="page-stack transfer-page">
      <section>
        <p className="eyebrow">LOCATION TRANSFER</p>
        <h2>재고 이관</h2>
        <p className="muted">
          출발 로케이션을 스캔하는 즉시 진행 중 업무로 저장됩니다. 앱을 종료하거나 휴대폰을 재부팅해도 이어서 작업할 수 있습니다.
        </p>
      </section>

      {error ? <p className="inline-error">{error}</p> : null}

      <section className="panel transfer-start-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">NEW JOB</p>
            <h3>새 이관 시작</h3>
          </div>
          {creating ? <span className="status-badge active">작업 생성 중</span> : null}
        </div>
        <div className="form-stack">
          <label>
            <span>작업 메모·선택</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="예: D1B 재배치, 행사 재고 이동"
              disabled={creating}
            />
          </label>
          <BarcodeField
            label="출발 로케이션"
            placeholder="로케이션 바코드를 스캔하거나 입력"
            onSubmit={startTransfer}
            disabled={creating}
            autoFocus
          />
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">IN PROGRESS</p>
            <h3>진행 중 업무</h3>
          </div>
          <button className="button button-secondary button-compact" onClick={() => void load()} disabled={loading}>
            새로고침
          </button>
        </div>

        {loading ? <p className="empty-state">진행 중 업무를 불러오는 중입니다.</p> : null}
        {!loading && jobs.length === 0 ? <p className="empty-state">진행 중인 이관 업무가 없습니다.</p> : null}

        <div className="transfer-job-list">
          {jobs.map((job) => (
            <article key={job.id} className="transfer-job-card">
              <div className="transfer-job-route">
                <strong>{job.sourceLocationCode}</strong>
                <span aria-hidden="true">→</span>
                <strong>{job.destinationLocationCode || "목적지 미지정"}</strong>
              </div>
              <div className="transfer-job-meta">
                <span className={`status-badge ${job.status === "READY" ? "success" : "primary"}`}>
                  {statusLabel[job.status]}
                </span>
                <span>{job.itemCount.toLocaleString()} SKU</span>
                <span>{job.totalQty.toLocaleString()}개</span>
                <span>{job.assignedToLabel}</span>
              </div>
              {job.note ? <p className="muted small transfer-job-note">{job.note}</p> : null}
              <div className="transfer-job-footer">
                <small>마지막 저장 {new Date(job.updatedAt).toLocaleString("ko-KR")}</small>
                <Link className="button button-primary" href={`/transfers/${job.id}`}>
                  계속하기
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function TransferListPage() {
  return (
    <PermissionGuard permission="transfer_inventory">
      <TransferListContent />
    </PermissionGuard>
  );
}
