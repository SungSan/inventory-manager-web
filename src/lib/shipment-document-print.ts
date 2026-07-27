export const SHIPMENT_DOCUMENT_PRINT_CSS = String.raw`
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

export async function printShipmentDocument(sheet: HTMLElement, title = "출고명세서"): Promise<void> {
  const clonedSheet = sheet.cloneNode(true) as HTMLElement;
  const logo = clonedSheet.querySelector("img");
  if (logo) logo.setAttribute("src", `${window.location.origin}/soundwave-logo.png?v=4`);

  const frame = window.document.createElement("iframe");
  frame.setAttribute("title", `${title} 인쇄`);
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
    throw new Error("인쇄 문서를 만들지 못했습니다.");
  }

  frameDocument.open();
  frameDocument.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title><style>${SHIPMENT_DOCUMENT_PRINT_CSS}</style></head><body>${clonedSheet.outerHTML}</body></html>`);
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
