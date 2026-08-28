import * as XLSX from "xlsx";
import type { OutboundUploadRow } from "@/types/outbound-progress";

const trackingAliases = ["운송장번호", "운송장", "송장번호", "배송번호", "trackingno", "trackingnumber"];
const barcodeAliases = ["88바코드", "상품바코드", "바코드", "barcode", "productbarcode"];
const qtyAliases = ["수량", "상품수량", "주문수량", "출고수량", "qty", "quantity"];
const normalize = (value: unknown) => String(value ?? "").trim().replace(/[\s_-]/g, "").toLowerCase();

function findHeader(headers: unknown[], aliases: string[]): number {
  const normalizedAliases = aliases.map(normalize);
  return headers.findIndex((header) => normalizedAliases.includes(normalize(header)));
}

export async function parseOutboundWorkbook(file: File): Promise<OutboundUploadRow[]> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("엑셀 첫 번째 시트를 찾을 수 없습니다.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  if (rows.length < 2) throw new Error("헤더와 출고 데이터가 필요합니다.");
  const headers = rows[0];
  const trackingIndex = findHeader(headers, trackingAliases);
  const barcodeIndex = findHeader(headers, barcodeAliases);
  const qtyIndex = findHeader(headers, qtyAliases);
  if (trackingIndex < 0 || barcodeIndex < 0 || qtyIndex < 0) throw new Error("운송장번호, 88바코드, 수량 컬럼을 찾지 못했습니다.");
  const parsed = rows.slice(1).flatMap((row, index) => {
    const trackingNo = String(row[trackingIndex] ?? "").trim();
    const productBarcode = String(row[barcodeIndex] ?? "").trim();
    const requiredQty = Number(String(row[qtyIndex] ?? "").replace(/,/g, ""));
    if (!trackingNo && !productBarcode && !requiredQty) return [];
    if (!trackingNo || !productBarcode || !Number.isInteger(requiredQty) || requiredQty < 1) throw new Error(`${index + 2}행의 운송장번호·바코드·수량을 확인하세요.`);
    return [{ trackingNo, productBarcode, requiredQty, sourceRow: index + 2 }];
  });
  if (parsed.length === 0) throw new Error("처리할 출고 행이 없습니다.");
  return parsed;
}
