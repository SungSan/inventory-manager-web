"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/permission-guard";
import {
  createExternalTransferJob,
  listExternalTransferJobs,
  type ExternalTransferHeaderInput,
  type ExternalTransferJob,
} from "@/lib/external-transfer-api";
import { subscribeToInventory } from "@/lib/inventory-api";
import styles from "./external-transfers.module.css";

const emptyHeader: ExternalTransferHeaderInput = {
  vendorName: "",
  vendorContact: "",
  vendorPhone: "",
  vendorAddress: "",
  purpose: "",
  note: "",
};

const statusLabel: Record<ExternalTransferJob["status"], string> = {
  DRAFT: "상품 등록 중",
  ALLOCATING: "LOC 배정 중",
  COMPLETED: "출고 완료",
  CANCELLED: "취소",
};

function ExternalTransfersContent() {
  const router = useRouter();
  const [header, setHeader] = useState<ExternalTransferHeaderInput>(emptyHeader);
  const [jobs, setJobs] = useState<ExternalTransferJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const loadJobs = useCallback(async () => {
    try {
      setJobs(await listExternalTransferJobs(false));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "진행 중 외부이관을 불러오지 못했습니다.");
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
    return subscribeToInventory(loadJobs, { scope: "externalTransfers", fallbackMs: 60_000 });
  }, [loadJobs]);

  async function createJob() {
    if (!header.vendorName.trim()) {
      setError("외부업체명을 입력하세요.");
      return;
    }

    setCreating(true);
    setError("");
    try {
      const job = await createExternalTransferJob(header);
      setHeader(emptyHeader);
      router.push(`/external-transfers/${job.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "외부이관 작업을 생성하지 못했습니다.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={`page-stack ${styles.page}`}>
      <section className="section-heading">
        <div>
          <p className="eyebrow">EXTERNAL SHIPMENT</p>
          <h2>외부업체 이관</h2>
          <p className="muted">
            여러 상품을 스캔해 수량을 지정하고, 상품별 출고 LOC를 배정한 뒤 재고 차감과 출고명세서 생성을 한 번에 처리합니다.
          </p>
        </div>
        <Link className="button button-secondary" href="/shipment-documents">
          통합 출고명세서
        </Link>
      </section>

      {error ? <p className="inline-error">{error}</p> : null}

      <section className={`panel ${styles.startPanel}`}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">NEW TRANSFER</p>
            <h3>새 외부이관 시작</h3>
          </div>
          {creating ? <span className="status-badge active">작업 생성 중</span> : null}
        </div>

        <div className={styles.headerForm}>
          <label>
            외부업체명 *
            <input
              value={header.vendorName}
              onChange={(event) => setHeader({ ...header, vendorName: event.target.value })}
              placeholder="예: 사운드웨이브 본사, 행사 대행사"
              disabled={creating}
            />
          </label>
          <label>
            담당자
            <input
              value={header.vendorContact}
              onChange={(event) => setHeader({ ...header, vendorContact: event.target.value })}
              placeholder="수령 담당자"
              disabled={creating}
            />
          </label>
          <label>
            연락처
            <input
              value={header.vendorPhone}
              onChange={(event) => setHeader({ ...header, vendorPhone: event.target.value })}
              placeholder="010-0000-0000"
              disabled={creating}
            />
          </label>
          <label className={styles.spanTwo}>
            주소
            <input
              value={header.vendorAddress}
              onChange={(event) => setHeader({ ...header, vendorAddress: event.target.value })}
              placeholder="외부업체 또는 출고 목적지 주소"
              disabled={creating}
            />
          </label>
          <label>
            출고 목적
            <input
              value={header.purpose}
              onChange={(event) => setHeader({ ...header, purpose: event.target.value })}
              placeholder="예: 행사 반출, 외부창고 이동"
              disabled={creating}
            />
          </label>
          <label>
            비고
            <input
              value={header.note}
              onChange={(event) => setHeader({ ...header, note: event.target.value })}
              placeholder="선택 사항"
              disabled={creating}
            />
          </label>
          <button
            className={`button button-primary ${styles.spanTwo}`}
            onClick={() => void createJob()}
            disabled={creating || !header.vendorName.trim()}
          >
            {creating ? "작업 생성 중..." : "상품 스캔 시작"}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DRAFTS</p>
            <h3>진행 중 외부이관</h3>
          </div>
          <button className="button button-secondary button-compact" onClick={() => void loadJobs()}>
            새로고침
          </button>
        </div>

        {loadingJobs ? <p className="empty-state">진행 중 작업을 불러오는 중입니다.</p> : null}
        {!loadingJobs && jobs.length === 0 ? <p className="empty-state">진행 중인 외부이관이 없습니다.</p> : null}

        <div className={styles.jobList}>
          {jobs.map((job) => (
            <article key={job.id} className={styles.jobCard}>
              <div>
                <span className={`status-badge ${job.status === "ALLOCATING" ? "primary" : "active"}`}>
                  {statusLabel[job.status]}
                </span>
                <h3>{job.vendorName}</h3>
                <p className="muted small">
                  {job.purpose || "출고 목적 미입력"} · 작업자 {job.assignedToLabel}
                </p>
              </div>
              <div className={styles.jobMetrics}>
                <span><small>품목</small><strong>{job.itemCount.toLocaleString()} SKU</strong></span>
                <span><small>수량</small><strong>{job.totalQty.toLocaleString()}개</strong></span>
                <span><small>저장</small><strong>{new Date(job.updatedAt).toLocaleString("ko-KR")}</strong></span>
              </div>
              <Link className="button button-primary" href={`/external-transfers/${job.id}`}>
                계속하기
              </Link>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function ExternalTransfersPage() {
  return (
    <PermissionGuard permission="external_transfer">
      <ExternalTransfersContent />
    </PermissionGuard>
  );
}
