"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  getExternalShipmentDocument,
  type ExternalShipmentDocument,
} from "@/lib/external-transfer-api";
import {
  getExternalShipmentPersonnel,
  updateExternalShipmentPersonnel,
} from "@/lib/external-shipment-personnel-api";
import styles from "@/app/external-transfers/external-transfers.module.css";

const PRINT_CSS = String.raw`
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
html, body {
  width: 210mm;
  min-height: 297mm;
  margin: 0;
  padding: 0;
  color: #111827;
  background: #fff;
  font-family: Arial, "Noto Sans KR", "Malgun Gothic", sans-serif;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
[data-print-sheet="external-shipment"] {
  width: 210mm;
  min-height: 297mm;
  margin: 0;
  padding: 8mm;
  color: #111827;
  background: #fff;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
[data-print-sheet="external-shipment"] > header {
  display: grid;
  grid-template-columns: 43mm minmax(0, 1fr) 39mm;
  gap: 4mm;
  align-items: center;
  padding-bottom: 4mm;
  border-bottom: 1mm solid #102f4a;
}
[data-print-sheet="external-shipment"] > header img {
  display: block;
  width: 43mm;
  height: auto;
  object-fit: contain;
  object-position: left center;
}
[data-print-sheet="external-shipment"] > header > div:nth-child(2) { text-align: center; }
[data-print-sheet="external-shipment"] > header > div:nth-child(2) p {
  margin: 0 0 1.2mm;
  color: #52606d;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: .18em;
}
[data-print-sheet="external-shipment"] > header h1 {
  margin: 0;
  font-size: 23px;
  letter-spacing: .22em;
}
[data-print-sheet="external-shipment"] > header > div:last-child {
  display: grid;
  gap: 1mm;
  text-align: right;
}
[data-print-sheet="external-shipment"] > header > div:last-child span {
  color: #67727e;
  font-size: 8px;
}
[data-print-sheet="external-shipment"] > header > div:last-child strong { font-size: 12px; }
[data-print-sheet="external-shipment"] > header + section {
  display: grid;
  grid-template-columns: 25mm minmax(0, 1fr) 27mm minmax(0, 1fr);
  margin-top: 4mm;
  border-top: .3mm solid #334155;
  border-left: .3mm solid #334155;
}
[data-print-sheet="external-shipment"] > header + section > div {
  min-height: 8.5mm;
  padding: 2mm 2.5mm;
  border-right: .3mm solid #334155;
  border-bottom: .3mm solid #334155;
  font-size: 10.5px;
  line-height: 1.3;
}
[data-print-sheet="external-shipment"] > header + section > div:nth-child(4n+1),
[data-print-sheet="external-shipment"] > header + section > div:nth-child(4n+3) {
  display: grid;
  place-items: center;
  color: #fff !important;
  background: #102f4a !important;
  box-shadow: inset 0 0 0 1000px #102f4a !important;
  font-weight: 800;
  text-align: center;
}
[data-print-sheet="external-shipment"] > header + section > div:last-child { grid-column: span 3; }
[data-print-sheet="external-shipment"] > table {
  width: 100%;
  margin-top: 4mm;
  border-collapse: collapse;
  table-layout: fixed;
}
[data-print-sheet="external-shipment"] > table th,
[data-print-sheet="external-shipment"] > table td {
  padding: 1.35mm .8mm;
  text-align: center;
  vertical-align: middle;
  border: .3mm solid #334155;
  font-size: 8.4px;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
[data-print-sheet="external-shipment"] > table thead th {
  color: #fff !important;
  background: #102f4a !important;
  box-shadow: inset 0 0 0 1000px #102f4a !important;
  font-weight: 800;
}
[data-print-sheet="external-shipment"] > table thead th:nth-child(1) { width: 5%; }
[data-print-sheet="external-shipment"] > table thead th:nth-child(2) { width: 32%; }
[data-print-sheet="external-shipment"] > table thead th:nth-child(3) { width: 15%; }
[data-print-sheet="external-shipment"] > table thead th:nth-child(4) { width: 12%; }
[data-print-sheet="external-shipment"] > table thead th:nth-child(5) { width: 12%; }
[data-print-sheet="external-shipment"] > table thead th:nth-child(6) { width: 8%; }
[data-print-sheet="external-shipment"] > table thead th:nth-child(7) { width: 16%; }
[data-print-sheet="external-shipment"] > table td:nth-child(2) { text-align: left; }
[data-print-sheet="external-shipment"] > table td:nth-child(2) strong,
[data-print-sheet="external-shipment"] > table td:nth-child(2) span { display: block; }
[data-print-sheet="external-shipment"] > table td:nth-child(2) span { margin-top: 1mm; }
[data-print-sheet="external-shipment"] > table tfoot th {
  color: #102f4a !important;
  background: #fff7d6 !important;
  box-shadow: inset 0 0 0 1000px #fff7d6 !important;
  font-size: 9px;
}
[data-print-sheet="external-shipment"] > table + section {
  display: grid;
  grid-template-columns: 25mm minmax(0, 1fr);
  min-height: 14mm;
  margin-top: 3mm;
  border: .3mm solid #334155;
}
[data-print-sheet="external-shipment"] > table + section > strong {
  display: grid;
  place-items: center;
  color: #fff !important;
  background: #102f4a !important;
  box-shadow: inset 0 0 0 1000px #102f4a !important;
  font-size: 10px;
}
[data-print-sheet="external-shipment"] > table + section > p {
  margin: 0;
  padding: 2.5mm;
  font-size: 10px;
  line-height: 1.35;
}
[data-print-sheet="external-shipment"] > footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4mm;
  margin-top: 5mm;
}
[data-print-sheet="external-shipment"] > footer > div {
  display: grid;
  grid-template-columns: 23mm 1fr 14mm;
  gap: 2mm;
  align-items: end;
  min-height: 12mm;
  padding: 2mm 2.5mm;
  border-bottom: .3mm solid #334155;
  font-size: 10px;
}
[data-print-sheet="external-shipment"] > footer span { font-weight: 800; }
[data-print-sheet="external-shipment"] > footer em {
  color: #67727e;
  font-style: normal;
  text-align: right;
}
[data-print-sheet="external-shipment"] > footer > p {
  grid-column: 1 / -1;
  margin: 1mm 0 0;
  color: #67727e;
  font-size: 8px;
  text-align: right;
}
thead { display: table-header-group; }
tr, [data-print-sheet="external-shipment"] > header,
[data-print-sheet="external-shipment"] > header + section,
[data-print-sheet="external-shipment"] > table + section,
[data-print-sheet="external-shipment"] > footer { break-inside: avoid; }
`;

function ExternalShipmentDocumentV2() {
  const params = useParams<{ id: string }>();
  const printSheetRef = useRef<HTMLElement | null>(null);
  const [document, setDocument] = useState<ExternalShipmentDocument | null>(null);
  const [writerName, setWriterName] = useState("");
  const [shipmentManagerName, setShipmentManagerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [personnelSaving, setPersonnelSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const loadedDocument = await getExternalShipmentDocument(params.id);
      setDocument(loadedDocument);
      try {
        const personnel = await getExternalShipmentPersonnel(params.id);
        setWriterName(personnel.writerName);
        setShipmentManagerName(personnel.shipmentManagerName);
        setError("");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "출고명세서 담당자 정보를 불러오지 못했습니다.");
      }
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

    setPersonnelSaving(true);
    try {
      const saved = await updateExternalShipmentPersonnel(params.id, writerName, shipmentManagerName);
      setWriterName(saved.writerName);
      setShipmentManagerName(saved.shipmentManagerName);
      setError("");
      if (showMessage) setMessage("작성자와 출고 담당을 저장했습니다.");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "작성자와 출고 담당을 저장하지 못했습니다.");
      return false;
    } finally {
      setPersonnelSaving(false);
    }
  }

  async function printShipment(): Promise<void> {
    setMessage("");
    const saved = await savePersonnel(false);
    if (!saved || !printSheetRef.current) return;

    const clonedSheet = printSheetRef.current.cloneNode(true) as HTMLElement;
    const logo = clonedSheet.querySelector("img");
    if (logo) logo.setAttribute("src", `${window.location.origin}/soundwave-logo.png?v=4`);

    const frame = window.document.createElement("iframe");
    frame.setAttribute("title", "출고명세서 인쇄");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.style.opacity = "0";
    window.document.body.appendChild(frame);

    const frameDocument = frame.contentDocument;
    if (!frameDocument) {
      frame.remove();
      setError("인쇄 문서를 만들지 못했습니다.");
      return;
    }

    frameDocument.open();
    frameDocument.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>출고명세서</title><style>${PRINT_CSS}</style></head><body>${clonedSheet.outerHTML}</body></html>`);
    frameDocument.close();

    const images = Array.from(frameDocument.images);
    await Promise.all(images.map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
        window.setTimeout(resolve, 2500);
      });
    }));

    window.setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } finally {
        window.setTimeout(() => frame.remove(), 30000);
      }
    }, 100);
  }

  if (loading) return <div className="center-panel">출고명세서를 불러오는 중...</div>;
  if (!document) {
    return <section className="panel"><h2>출고명세서를 열 수 없습니다.</h2>{error ? <p className="inline-error">{error}</p> : null}<Link className="button button-secondary" href="/external-transfers">목록으로</Link></section>;
  }

  return (
    <div className={styles.documentPage}>
      <div className={styles.documentActions} data-no-print="true">
        <Link className="button button-secondary" href="/external-transfers">명세서 목록</Link>
        <button className="button button-primary" onClick={() => void printShipment()} disabled={personnelSaving}>{personnelSaving ? "저장 중..." : "프린터 출력·PDF 저장"}</button>
      </div>

      <section className="panel" data-no-print="true">
        <div className="section-heading"><div><p className="eyebrow">DOCUMENT PERSONNEL</p><h3>명세서 담당자 입력</h3></div><button className="button button-secondary" onClick={() => void savePersonnel()} disabled={personnelSaving}>{personnelSaving ? "저장 중..." : "담당자 저장"}</button></div>
        <div className="form-grid">
          <label>작성자 *<input value={writerName} onChange={(event) => setWriterName(event.target.value)} placeholder="예: 홍길동" disabled={personnelSaving} /></label>
          <label>출고 담당 *<input value={shipmentManagerName} onChange={(event) => setShipmentManagerName(event.target.value)} placeholder="예: 김물류" disabled={personnelSaving} /></label>
        </div>
        {message ? <div className="feedback feedback-success"><strong>{message}</strong></div> : null}
        {error ? <p className="inline-error">{error}</p> : null}
      </section>

      <article ref={printSheetRef} className={styles.printSheet} data-print-sheet="external-shipment">
        <header className={styles.printHeader}>
          <img src="/soundwave-logo.png?v=4" alt="사운드웨이브" width={181} height={21} />
          <div className={styles.documentTitle}><p>EXTERNAL SHIPMENT STATEMENT</p><h1>출 고 명 세 서</h1></div>
          <div className={styles.documentNumber}><span>문서번호</span><strong>{document.documentNo}</strong></div>
        </header>

        <section className={styles.documentInfoGrid}>
          <div className={styles.infoLabel}>출고일자</div><div>{document.shipmentDate}</div><div className={styles.infoLabel}>작성자</div><div>{writerName.trim() || "미입력"}</div>
          <div className={styles.infoLabel}>출고지</div><div>사운드웨이브</div><div className={styles.infoLabel}>출고 목적</div><div>{document.purpose || "-"}</div>
          <div className={styles.infoLabel}>도착지</div><div>{document.vendorName}</div><div className={styles.infoLabel}>인수인·연락처</div><div>{[document.vendorContact, document.vendorPhone].filter(Boolean).join(" · ") || "-"}</div>
          <div className={styles.infoLabel}>도착지 주소</div><div className={styles.infoWide}>{document.vendorAddress || "-"}</div>
        </section>

        <table className={styles.documentTable}>
          <thead><tr><th>No</th><th>품목명</th><th>Barcode</th><th>유통 code</th><th>Master code</th><th>EA</th><th>비고</th></tr></thead>
          <tbody>
            {(document.items ?? []).map((item) => (
              <tr key={item.lineNo}>
                <td>{item.lineNo}</td>
                <td><strong>{item.artist || "아티스트 없음"}</strong><span>{item.nameVer || "상품명/버전 없음"}</span></td>
                <td>{item.productBarcode || "-"}</td>
                <td>{item.pCodeNo || item.codeNo || "-"}</td>
                <td>{item.masterCodeNo || "-"}</td>
                <td><strong>{item.qty.toLocaleString()}</strong></td>
                <td>{item.note || ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><th colSpan={4}>합계</th><th>{document.totalSku.toLocaleString()} SKU</th><th>{document.totalQty.toLocaleString()}</th><th /></tr></tfoot>
        </table>

        <section className={styles.documentNote}><strong>비고 사항</strong><p>{document.note || "상기 품목을 외부업체 이관 목적으로 출고하였음을 확인합니다."}</p></section>
        <footer className={styles.documentFooter}>
          <div><span>출고 담당</span><strong>{shipmentManagerName.trim() || "미입력"}</strong><em>(서명)</em></div>
          <div><span>인수인</span><strong>{document.vendorContact || ""}</strong><em>(서명)</em></div>
          <p>SAN WMS · 출고명세서 생성 {new Date(document.createdAt).toLocaleString("ko-KR")}</p>
        </footer>
      </article>
    </div>
  );
}

export { ExternalShipmentDocumentV2 };
