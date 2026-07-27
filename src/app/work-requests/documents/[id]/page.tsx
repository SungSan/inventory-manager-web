"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PermissionGuard } from "@/components/permission-guard";
import { printShipmentDocument } from "@/lib/shipment-document-print";
import { getWorkRequestDocument, type WorkRequestDocument } from "@/lib/work-request-api";
import styles from "@/app/external-transfers/external-transfers.module.css";

interface SavedPersonnel {
  writerName: string;
  shipmentManagerName: string;
}

function WorkRequestDocumentContent() {
  const params = useParams<{ id: string }>();
  const printSheetRef = useRef<HTMLElement | null>(null);
  const [shipmentDocument, setShipmentDocument] = useState<WorkRequestDocument | null>(null);
  const [writerName, setWriterName] = useState("");
  const [shipmentManagerName, setShipmentManagerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const personnelStorageKey = `san-wms-work-request-document-personnel:${params.id}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await getWorkRequestDocument(params.id);
      setShipmentDocument(loaded);

      let saved: SavedPersonnel | null = null;
      try {
        const raw = window.localStorage.getItem(personnelStorageKey);
        saved = raw ? JSON.parse(raw) as SavedPersonnel : null;
      } catch {
        saved = null;
      }

      setWriterName(saved?.writerName?.trim() || loaded.requesterName || "");
      setShipmentManagerName(saved?.shipmentManagerName?.trim() || loaded.workerName || "");
      setError("");
    } catch (cause) {
      setShipmentDocument(null);
      setError(cause instanceof Error ? cause.message : "출고명세서를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [params.id, personnelStorageKey]);

  useEffect(() => { void load(); }, [load]);

  async function savePersonnel(showMessage = true): Promise<boolean> {
    const writer = writerName.trim();
    const manager = shipmentManagerName.trim();
    if (!writer) {
      setError("작성자를 입력하세요.");
      return false;
    }
    if (!manager) {
      setError("출고 담당을 입력하세요.");
      return false;
    }

    setSaving(true);
    try {
      window.localStorage.setItem(personnelStorageKey, JSON.stringify({ writerName: writer, shipmentManagerName: manager }));
      setWriterName(writer);
      setShipmentManagerName(manager);
      setError("");
      if (showMessage) setMessage("작성자와 출고 담당을 저장했습니다.");
      return true;
    } catch {
      setError("담당자 정보를 저장하지 못했습니다.");
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
      await printShipmentDocument(printSheetRef.current, `출고명세서 ${shipmentDocument?.documentNo ?? ""}`.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "인쇄 문서를 만들지 못했습니다.");
    }
  }

  if (loading) return <div className="center-panel">출고명세서를 불러오는 중...</div>;
  if (!shipmentDocument) {
    return <section className="panel"><h2>출고명세서를 열 수 없습니다.</h2>{error ? <p className="inline-error">{error}</p> : null}<Link className="button button-secondary" href="/work-requests">업무요청 목록</Link></section>;
  }

  return (
    <div className={styles.documentPage}>
      <div className={styles.documentActions} data-no-print="true">
        <Link className="button button-secondary" href={`/work-requests/${shipmentDocument.workRequestId}`}>업무요청으로</Link>
        <button className="button button-primary" onClick={() => void printShipment()} disabled={saving}>{saving ? "저장 중..." : "프린터 출력·PDF 저장"}</button>
      </div>

      <section className="panel" data-no-print="true">
        <div className="section-heading"><div><p className="eyebrow">DOCUMENT PERSONNEL</p><h3>명세서 담당자 입력</h3></div><button className="button button-secondary" onClick={() => void savePersonnel()} disabled={saving}>{saving ? "저장 중..." : "담당자 저장"}</button></div>
        <div className="form-grid">
          <label>작성자 *<input value={writerName} onChange={(event) => setWriterName(event.target.value)} placeholder="예: 홍길동" disabled={saving} /></label>
          <label>출고 담당 *<input value={shipmentManagerName} onChange={(event) => setShipmentManagerName(event.target.value)} placeholder="예: 김물류" disabled={saving} /></label>
        </div>
        <p className="muted">작성자는 요청자, 출고 담당은 실제 처리 작업자 이름으로 자동 입력되며 필요하면 출력 전에 수정할 수 있습니다.</p>
        {message ? <div className="feedback feedback-success"><strong>{message}</strong></div> : null}
        {error ? <p className="inline-error">{error}</p> : null}
      </section>

      <article ref={printSheetRef} className={styles.printSheet} data-print-sheet="external-shipment">
        <header className={styles.printHeader}>
          <img src="/soundwave-logo.png?v=4" alt="사운드웨이브" width={181} height={21} />
          <div className={styles.documentTitle}><p>WORK REQUEST SHIPMENT STATEMENT</p><h1>출 고 명 세 서</h1></div>
          <div className={styles.documentNumber}><span>문서번호</span><strong>{shipmentDocument.documentNo}</strong></div>
        </header>

        <section className={styles.documentInfoGrid}>
          <div className={styles.infoLabel}>출고일자</div><div>{shipmentDocument.shipmentDate}</div><div className={styles.infoLabel}>작성자</div><div>{writerName.trim() || "미입력"}</div>
          <div className={styles.infoLabel}>출고지</div><div>사운드웨이브</div><div className={styles.infoLabel}>출고 목적</div><div>{shipmentDocument.purpose || "-"}</div>
          <div className={styles.infoLabel}>도착지</div><div>{shipmentDocument.vendorName}</div><div className={styles.infoLabel}>인수인·연락처</div><div>{[shipmentDocument.vendorContact, shipmentDocument.vendorPhone].filter(Boolean).join(" · ") || "-"}</div>
          <div className={styles.infoLabel}>도착지 주소</div><div className={styles.infoWide}>{shipmentDocument.vendorAddress || "-"}</div>
        </section>

        <table className={styles.documentTable}>
          <thead><tr><th>No</th><th>품목명</th><th>Barcode</th><th>유통 code</th><th>Master code</th><th>EA</th><th>비고</th></tr></thead>
          <tbody>
            {shipmentDocument.items.map((item) => (
              <tr key={item.lineNo}>
                <td>{item.lineNo}</td>
                <td><strong>{item.artist || "아티스트 없음"}</strong><span>{item.nameVer || "상품명/버전 없음"}</span></td>
                <td>{item.productBarcode || "-"}</td>
                <td>{item.pCodeNo || item.codeNo || "-"}</td>
                <td>{item.masterCodeNo || "-"}</td>
                <td><strong>{item.qty.toLocaleString()}</strong></td>
                <td />
              </tr>
            ))}
          </tbody>
          <tfoot><tr><th colSpan={4}>합계</th><th>{shipmentDocument.totalSku.toLocaleString()} SKU</th><th>{shipmentDocument.totalQty.toLocaleString()}</th><th /></tr></tfoot>
        </table>

        <section className={styles.documentNote}><strong>비고 사항</strong><p>{shipmentDocument.note || "상기 품목을 업무요청에 따라 출고하였음을 확인합니다."}</p></section>
        <footer className={styles.documentFooter}>
          <div><span>출고 담당</span><strong>{shipmentManagerName.trim() || "미입력"}</strong><em>(서명)</em></div>
          <div><span>인수인</span><strong>{shipmentDocument.vendorContact || ""}</strong><em>(서명)</em></div>
          <p>SAN WMS · 업무요청 {shipmentDocument.requestNo} · 출고명세서 생성 {new Date(shipmentDocument.createdAt).toLocaleString("ko-KR")}</p>
        </footer>
      </article>
    </div>
  );
}

export default function WorkRequestDocumentPage() {
  return <PermissionGuard permission="work_requests"><WorkRequestDocumentContent /></PermissionGuard>;
}
