"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PermissionGuard } from "@/components/permission-guard";
import {
  getShipmentDocument,
  updateShipmentDocumentPersonnel,
  type ShipmentDocument,
} from "@/lib/shipment-document-api";
import { printShipmentDocument } from "@/lib/shipment-document-print";
import styles from "@/app/external-transfers/external-transfers.module.css";

function ShipmentDocumentContent() {
  const params = useParams<{ id: string }>();
  const printSheetRef = useRef<HTMLElement | null>(null);
  const [document, setDocument] = useState<ShipmentDocument | null>(null);
  const [writerName, setWriterName] = useState("");
  const [shipmentManagerName, setShipmentManagerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await getShipmentDocument(params.id);
      setDocument(loaded);
      setWriterName(loaded.writerName || loaded.createdByLabel || "");
      setShipmentManagerName(loaded.shipmentManagerName || loaded.workerName || "");
      setError("");
    } catch (cause) {
      setDocument(null);
      setError(cause instanceof Error ? cause.message : "출고명세서를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { void load(); }, [load]);

  async function savePersonnel(showMessage = true): Promise<boolean> {
    if (!writerName.trim()) {
      setError("작성자를 입력하세요.");
      return false;
    }
    if (!shipmentManagerName.trim()) {
      setError("출고 담당을 입력하세요.");
      return false;
    }
    setSaving(true);
    try {
      const saved = await updateShipmentDocumentPersonnel(params.id, writerName, shipmentManagerName);
      setWriterName(saved.writerName);
      setShipmentManagerName(saved.shipmentManagerName);
      setError("");
      if (showMessage) setMessage("작성자와 출고 담당을 저장했습니다.");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "담당자 정보를 저장하지 못했습니다.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function printShipment(): Promise<void> {
    setMessage("");
    const saved = await savePersonnel(false);
    if (!saved || !printSheetRef.current) return;
    try {
      await printShipmentDocument(printSheetRef.current, `출고명세서 ${document?.documentNo ?? ""}`.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "인쇄 문서를 만들지 못했습니다.");
    }
  }

  if (loading) return <div className="center-panel">출고명세서를 불러오는 중...</div>;
  if (!document) {
    return <section className="panel"><h2>출고명세서를 열 수 없습니다.</h2>{error ? <p className="inline-error">{error}</p> : null}<Link className="button button-secondary" href="/shipment-documents">통합 명세서 목록</Link></section>;
  }

  const forced = document.completionType === "ADMIN_FORCE";
  const sourceHref = document.sourceType === "WORK_REQUEST"
    ? `/work-requests/${document.sourceEntityId}`
    : `/external-transfers/${document.sourceEntityId}`;

  return (
    <div className={styles.documentPage}>
      <div className={styles.documentActions} data-no-print="true">
        <Link className="button button-secondary" href="/shipment-documents">통합 명세서 목록</Link>
        <Link className="button button-secondary" href={sourceHref}>{document.sourceLabel} 원본</Link>
        <button className="button button-primary" onClick={() => void printShipment()} disabled={saving}>{saving ? "저장 중..." : "프린터 출력·PDF 저장"}</button>
      </div>

      <section className="panel" data-no-print="true">
        <div className="section-heading"><div><p className="eyebrow">DOCUMENT PERSONNEL</p><h3>명세서 담당자</h3></div><button className="button button-secondary" onClick={() => void savePersonnel()} disabled={saving}>{saving ? "저장 중..." : "담당자 저장"}</button></div>
        <div className="form-grid">
          <label>작성자 *<input value={writerName} onChange={(event) => setWriterName(event.target.value)} disabled={saving} /></label>
          <label>출고 담당 *<input value={shipmentManagerName} onChange={(event) => setShipmentManagerName(event.target.value)} disabled={saving} /></label>
        </div>
        <p className="muted">업무요청·외부이관 구분 없이 같은 출고문서 담당자 정보로 DB에 저장됩니다.</p>
        {forced ? <div className="feedback"><strong>관리자 강제 완료 명세서</strong><p>요청 {document.requestedTotalQty.toLocaleString()} / 실제 출고 {document.totalQty.toLocaleString()} / 미출고 {document.unfulfilledTotalQty.toLocaleString()}개 · 사유 {document.forceCompleteReason || "-"}</p></div> : null}
        {message ? <div className="feedback feedback-success"><strong>{message}</strong></div> : null}
        {error ? <p className="inline-error">{error}</p> : null}
      </section>

      <article ref={printSheetRef} className={styles.printSheet} data-print-sheet="external-shipment">
        <header className={styles.printHeader}>
          <img src="/soundwave-logo.png?v=4" alt="사운드웨이브" width={181} height={21} />
          <div className={styles.documentTitle}><p>SHIPMENT STATEMENT · {document.sourceLabel}</p><h1>출 고 명 세 서</h1></div>
          <div className={styles.documentNumber}><span>문서번호</span><strong>{document.documentNo}</strong></div>
        </header>

        <section className={styles.documentInfoGrid}>
          <div className={styles.infoLabel}>출고일자</div><div>{document.shipmentDate}</div><div className={styles.infoLabel}>작성자</div><div>{writerName.trim() || "미입력"}</div>
          <div className={styles.infoLabel}>출고지</div><div>사운드웨이브</div><div className={styles.infoLabel}>출고 구분</div><div>{document.sourceLabel}</div>
          <div className={styles.infoLabel}>도착지</div><div>{document.vendorName}</div><div className={styles.infoLabel}>인수인·연락처</div><div>{[document.vendorContact, document.vendorPhone].filter(Boolean).join(" · ") || "-"}</div>
          <div className={styles.infoLabel}>도착지 주소</div><div className={styles.infoWide}>{document.vendorAddress || "-"}</div>
          <div className={styles.infoLabel}>출고 목적</div><div className={styles.infoWide}>{document.purpose || "-"}</div>
          {forced ? <><div className={styles.infoLabel}>완료 방식</div><div>관리자 강제 완료</div><div className={styles.infoLabel}>미출고</div><div>{document.unfulfilledTotalQty.toLocaleString()} EA</div></> : null}
        </section>

        <table className={styles.documentTable}>
          <thead><tr><th>No</th><th>품목명</th><th>Barcode</th><th>유통 code</th><th>Master code</th><th>요청</th><th>실제 출고</th><th>미출고</th></tr></thead>
          <tbody>
            {document.items.map((item) => (
              <tr key={item.lineNo}>
                <td>{item.lineNo}</td>
                <td><strong>{item.artist || "아티스트 없음"}</strong><span>{item.nameVer || "상품명/버전 없음"}</span></td>
                <td>{item.productBarcode || "-"}</td>
                <td>{item.pCodeNo || item.codeNo || "-"}</td>
                <td>{item.masterCodeNo || "-"}</td>
                <td>{item.requestedQty.toLocaleString()}</td>
                <td><strong>{item.qty.toLocaleString()}</strong></td>
                <td>{item.unfulfilledQty.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><th colSpan={4}>합계</th><th>{document.totalSku.toLocaleString()} SKU</th><th>{document.requestedTotalQty.toLocaleString()}</th><th>{document.totalQty.toLocaleString()}</th><th>{document.unfulfilledTotalQty.toLocaleString()}</th></tr></tfoot>
        </table>

        <section className={styles.documentNote}>
          <strong>{forced ? "관리자 강제 완료" : "비고 사항"}</strong>
          <p>{forced ? `사유: ${document.forceCompleteReason || "-"} · 완료 관리자: ${document.forceCompletedByName || "-"} · 미출고 ${document.unfulfilledTotalQty.toLocaleString()}개` : document.note || "상기 품목을 출고하였음을 확인합니다."}</p>
        </section>
        <footer className={styles.documentFooter}>
          <div><span>출고 담당</span><strong>{shipmentManagerName.trim() || "미입력"}</strong><em>(서명)</em></div>
          <div><span>인수인</span><strong>{document.vendorContact || ""}</strong><em>(서명)</em></div>
          <p>SAN WMS · {document.sourceLabel} · {document.sourceReferenceNo || "원본"} · 생성 {new Date(document.createdAt).toLocaleString("ko-KR")}</p>
        </footer>
      </article>
    </div>
  );
}

export default function ShipmentDocumentPage() {
  return <PermissionGuard permission="shipment_documents"><ShipmentDocumentContent /></PermissionGuard>;
}
