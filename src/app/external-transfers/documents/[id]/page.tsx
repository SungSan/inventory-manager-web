"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PermissionGuard } from "@/components/permission-guard";
import {
  getExternalShipmentDocument,
  type ExternalShipmentDocument,
} from "@/lib/external-transfer-api";
import styles from "../../external-transfers.module.css";

function formatAllocations(document: ExternalShipmentDocument, lineNo: number): string {
  const item = document.items?.find((row) => row.lineNo === lineNo);
  return (item?.allocations ?? [])
    .map((allocation) => `${allocation.locationCode} (${allocation.qty.toLocaleString()})`)
    .join(", ");
}

function ExternalShipmentDocumentContent() {
  const params = useParams<{ id: string }>();
  const [document, setDocument] = useState<ExternalShipmentDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDocument(await getExternalShipmentDocument(params.id));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "출고명세서를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="center-panel">출고명세서를 불러오는 중...</div>;
  if (!document) {
    return (
      <section className="panel">
        <h2>출고명세서를 열 수 없습니다.</h2>
        {error ? <p className="inline-error">{error}</p> : null}
        <Link className="button button-secondary" href="/external-transfers">목록으로</Link>
      </section>
    );
  }

  return (
    <div className={styles.documentPage}>
      <style>{`@media print {
        .topbar, .main-nav { display: none !important; }
        .content { padding: 0 !important; }
        body, html, .app-layout { background: #fff !important; }
      }`}</style>
      <div className={styles.documentActions}>
        <Link className="button button-secondary" href="/external-transfers">명세서 목록</Link>
        <button className="button button-primary" onClick={() => window.print()}>
          프린터 출력·PDF 저장
        </button>
      </div>

      <article className={styles.printSheet}>
        <header className={styles.printHeader}>
          <div className={styles.sanLogo} aria-label="SAN WMS 로고">
            <span>SAN</span>
            <strong>WMS</strong>
          </div>
          <div className={styles.documentTitle}>
            <p>EXTERNAL SHIPMENT STATEMENT</p>
            <h1>출 고 명 세 서</h1>
          </div>
          <div className={styles.documentNumber}>
            <span>문서번호</span>
            <strong>{document.documentNo}</strong>
          </div>
        </header>

        <section className={styles.documentInfoGrid}>
          <div className={styles.infoLabel}>출고일자</div>
          <div>{document.shipmentDate}</div>
          <div className={styles.infoLabel}>작성자</div>
          <div>{document.createdByLabel}</div>

          <div className={styles.infoLabel}>출고지</div>
          <div>SAN WMS 물류센터</div>
          <div className={styles.infoLabel}>출고 목적</div>
          <div>{document.purpose || "-"}</div>

          <div className={styles.infoLabel}>외부업체</div>
          <div>{document.vendorName}</div>
          <div className={styles.infoLabel}>담당자·연락처</div>
          <div>{[document.vendorContact, document.vendorPhone].filter(Boolean).join(" · ") || "-"}</div>

          <div className={styles.infoLabel}>출고 주소</div>
          <div className={styles.infoWide}>{document.vendorAddress || "-"}</div>
        </section>

        <table className={styles.documentTable}>
          <thead>
            <tr>
              <th>No</th>
              <th>품목명</th>
              <th>Barcode</th>
              <th>유통 code</th>
              <th>Master code</th>
              <th>출고 LOC</th>
              <th>EA</th>
              <th>비고</th>
            </tr>
          </thead>
          <tbody>
            {(document.items ?? []).map((item) => (
              <tr key={item.lineNo}>
                <td>{item.lineNo}</td>
                <td>
                  <strong>{item.artist || "아티스트 없음"}</strong>
                  <span>{item.nameVer || "상품명/버전 없음"}</span>
                </td>
                <td>{item.productBarcode || "-"}</td>
                <td>{item.pCodeNo || item.codeNo || "-"}</td>
                <td>{item.masterCodeNo || "-"}</td>
                <td>{formatAllocations(document, item.lineNo) || "-"}</td>
                <td><strong>{item.qty.toLocaleString()}</strong></td>
                <td>{item.note || ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={5}>합계</th>
              <th>{document.totalSku.toLocaleString()} SKU</th>
              <th>{document.totalQty.toLocaleString()}</th>
              <th />
            </tr>
          </tfoot>
        </table>

        <section className={styles.documentNote}>
          <strong>비고 사항</strong>
          <p>{document.note || "상기 품목을 외부업체 이관 목적으로 출고하였음을 확인합니다."}</p>
        </section>

        <footer className={styles.documentFooter}>
          <div>
            <span>출고 담당</span>
            <strong>{document.createdByLabel}</strong>
            <em>(서명)</em>
          </div>
          <div>
            <span>외부업체 인수자</span>
            <strong>{document.vendorContact || ""}</strong>
            <em>(서명)</em>
          </div>
          <p>SAN WMS · 출고명세서 생성 {new Date(document.createdAt).toLocaleString("ko-KR")}</p>
        </footer>
      </article>
    </div>
  );
}

export default function ExternalShipmentDocumentPage() {
  return (
    <PermissionGuard permission="external_transfer">
      <ExternalShipmentDocumentContent />
    </PermissionGuard>
  );
}
