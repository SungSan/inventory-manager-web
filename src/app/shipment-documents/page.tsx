"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PermissionGuard } from "@/components/permission-guard";
import { useUser } from "@/components/user-provider";
import {
  listShipmentDocuments,
  setShipmentDocumentAdminOnly,
  type ShipmentDocumentSourceType,
  type ShipmentDocumentSummary,
} from "@/lib/shipment-document-api";

type SourceFilter = "ALL" | ShipmentDocumentSourceType;

function formatCreatedAt(value: string): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR");
}

function ShipmentDocumentsContent() {
  const { user } = useUser();
  const [documents, setDocuments] = useState<ShipmentDocumentSummary[]>([]);
  const [sourceType, setSourceType] = useState<SourceFilter>("ALL");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const requestSequence = useRef(0);
  const isAdmin = user?.role === "admin";

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    try {
      const next = await listShipmentDocuments(sourceType, search, dateFrom, dateTo);
      if (requestId !== requestSequence.current) return;
      setDocuments(next);
      setError("");
    } catch (cause) {
      if (requestId !== requestSequence.current) return;
      setError(cause instanceof Error ? cause.message : "출고명세서를 불러오지 못했습니다.");
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [dateFrom, dateTo, search, sourceType]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  const totals = useMemo(() => ({
    count: documents.length,
    sku: documents.reduce((sum, item) => sum + item.totalSku, 0),
    qty: documents.reduce((sum, item) => sum + item.totalQty, 0),
    unfulfilled: documents.reduce((sum, item) => sum + item.unfulfilledTotalQty, 0),
  }), [documents]);

  async function toggleAdminOnly(document: ShipmentDocumentSummary): Promise<void> {
    if (!isAdmin) return;
    const next = !document.adminOnly;
    const confirmed = window.confirm(
      next
        ? `${document.documentNo} 문서를 관리자 전용으로 전환할까요?\n일반 사용자는 목록·상세·직접 URL에서 조회할 수 없습니다.`
        : `${document.documentNo} 문서를 다시 기존 권한 사용자에게 공개할까요?`,
    );
    if (!confirmed) return;
    setBusyId(document.id);
    setError("");
    try {
      await setShipmentDocumentAdminOnly(document.id, next);
      setDocuments((current) => current.map((item) => item.id === document.id ? { ...item, adminOnly: next } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "명세서 공개 범위를 변경하지 못했습니다.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="page-stack">
      <section>
        <p className="eyebrow">UNIFIED SHIPMENT DOCUMENTS</p>
        <h2>출고명세서</h2>
        <p className="muted">업무요청과 외부이관에서 생성된 출고명세서를 한 곳에서 조회·검색·출력합니다. 작성일은 자동 기록되고 출고일은 문서에서 직접 지정할 수 있습니다.</p>
      </section>

      {error ? <p className="inline-error">{error}</p> : null}

      <section className="metric-grid">
        <article className="metric-card"><span>조회 문서</span><strong>{totals.count.toLocaleString()}</strong></article>
        <article className="metric-card"><span>총 SKU</span><strong>{totals.sku.toLocaleString()}</strong></article>
        <article className="metric-card"><span>실제 출고</span><strong>{totals.qty.toLocaleString()}</strong></article>
        <article className="metric-card"><span>미출고</span><strong>{totals.unfulfilled.toLocaleString()}</strong></article>
      </section>

      <section className="panel page-stack">
        <div className="section-heading"><div><p className="eyebrow">FILTER</p><h3>통합 조회</h3></div><button className="button button-secondary button-compact" onClick={() => void load()} disabled={loading}>새로고침</button></div>
        <div className="form-grid">
          <label>문서 구분<select value={sourceType} onChange={(event) => setSourceType(event.target.value as SourceFilter)}><option value="ALL">전체</option><option value="WORK_REQUEST">업무요청</option><option value="EXTERNAL_TRANSFER">외부이관</option></select></label>
          <label>검색<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="문서번호, 업체, 상품, 바코드, CODE_NO, 작업자" /></label>
          <label>출고일 시작<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
          <label>출고일 종료<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        </div>
      </section>

      <section className="panel page-stack">
        <div className="section-heading"><div><p className="eyebrow">DOCUMENT LIST</p><h3>출고문서 목록</h3></div><strong>{documents.length.toLocaleString()}건</strong></div>
        {loading ? <p className="empty-state">출고명세서를 불러오는 중입니다.</p> : null}
        {!loading && documents.length === 0 ? <p className="empty-state">조건에 맞는 출고명세서가 없습니다.</p> : null}
        {documents.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>구분</th><th>문서번호</th><th>작성일</th><th>출고일</th><th>업체</th><th>출처</th><th>SKU</th><th>실제 출고</th><th>미출고</th><th>작업자</th>{isAdmin ? <th>공개 범위</th> : null}<th /></tr></thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.id}>
                    <td><span className={`status-badge ${document.sourceType === "WORK_REQUEST" ? "active" : "success"}`}>{document.sourceLabel}</span>{document.adminOnly ? <><br /><small>관리자 전용</small></> : null}</td>
                    <td><strong>{document.documentNo}</strong></td>
                    <td>{formatCreatedAt(document.createdAt)}</td>
                    <td><strong>{document.shipmentDate}</strong></td>
                    <td><strong>{document.vendorName}</strong><br /><small>{document.purpose || "-"}</small></td>
                    <td>{document.sourceReferenceNo || "-"}</td>
                    <td>{document.totalSku.toLocaleString()}</td>
                    <td><strong>{document.totalQty.toLocaleString()}</strong></td>
                    <td>{document.unfulfilledTotalQty > 0 ? <strong>{document.unfulfilledTotalQty.toLocaleString()}</strong> : "-"}</td>
                    <td>{document.workerName || document.createdByLabel || "-"}</td>
                    {isAdmin ? <td><button className="button button-secondary button-compact" onClick={() => void toggleAdminOnly(document)} disabled={busyId === document.id}>{busyId === document.id ? "변경 중..." : document.adminOnly ? "전체 공개" : "관리자 전용"}</button></td> : null}
                    <td><Link className="button button-secondary button-compact" href={`/shipment-documents/${document.id}`}>조회·출력</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default function ShipmentDocumentsPage() {
  return <PermissionGuard permission="shipment_documents"><ShipmentDocumentsContent /></PermissionGuard>;
}
