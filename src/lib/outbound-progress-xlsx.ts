import * as XLSX from "xlsx";
import type { OutboundUploadRow } from "@/types/outbound-progress";

interface TrackingRow {
  trackingNo: string;
  orderNo: string;
  sourceRow: number;
}
interface OrderProductRow {
  orderNo: string;
  productBarcode: string;
  requiredQty: number;
  sourceRow: number;
}
const trackingAliases = [
  "원송장",
  "운송장번호",
  "운송장",
  "송장번호",
  "배송번호",
  "trackingno",
  "trackingnumber",
];
const orderAliases = [
  "주문번호",
  "주문번호(쇼핑몰)",
  "orderid",
  "orderno",
  "ordernumber",
];
const barcodeAliases = [
  "자체품목코드",
  "88바코드",
  "상품바코드",
  "바코드",
  "barcode",
  "productbarcode",
];
const qtyAliases = [
  "수량",
  "상품수량",
  "주문수량",
  "출고수량",
  "qty",
  "quantity",
];
const normalize = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/[\s_-]/g, "")
    .toLowerCase();
const cell = (value: unknown) => String(value ?? "").trim();

function readSheet(fileBuffer: ArrayBuffer): unknown[][] {
  const workbook = XLSX.read(fileBuffer, { type: "array", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("엑셀 첫 번째 시트를 찾을 수 없습니다.");
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
}
function findHeader(headers: unknown[], aliases: string[]): number {
  const candidates = aliases.map(normalize);
  return headers.findIndex((header) => candidates.includes(normalize(header)));
}
async function parseTrackingFile(file: File): Promise<TrackingRow[]> {
  const rows = readSheet(await file.arrayBuffer());
  if (rows.length < 2) throw new Error("운송장 파일에 데이터가 없습니다.");
  const orderIndex = findHeader(rows[0], orderAliases),
    trackingIndex = findHeader(rows[0], trackingAliases);
  if (orderIndex < 0 || trackingIndex < 0)
    throw new Error(
      "운송장 파일에서 원송장·주문번호 컬럼을 찾지 못했습니다.",
    );
  return rows.slice(1).flatMap((row, index) => {
    const orderNo = cell(row[orderIndex]),
      trackingNo = cell(row[trackingIndex]);
    if (!orderNo && !trackingNo) return [];
    if (!orderNo || !trackingNo)
      throw new Error(
        `운송장 파일 ${index + 2}행의 원송장·주문번호를 확인하세요.`,
      );
    return [{ orderNo, trackingNo, sourceRow: index + 2 }];
  });
}
async function parseOrderProductFile(file: File): Promise<OrderProductRow[]> {
  const rows = readSheet(await file.arrayBuffer());
  if (rows.length < 2) throw new Error("상품 파일에 데이터가 없습니다.");
  const orderIndex = findHeader(rows[0], orderAliases),
    barcodeIndex = findHeader(rows[0], barcodeAliases),
    qtyIndex = findHeader(rows[0], qtyAliases);
  if (orderIndex < 0 || barcodeIndex < 0 || qtyIndex < 0)
    throw new Error(
      "상품수량 파일에서 주문번호·자체품목코드·수량 컬럼을 찾지 못했습니다.",
    );
  return rows.slice(1).flatMap((row, index) => {
    const orderNo = cell(row[orderIndex]),
      productBarcode = cell(row[barcodeIndex]);
    const requiredQty = Number(cell(row[qtyIndex]).replace(/,/g, ""));
    if (!orderNo && !productBarcode && !requiredQty) return [];
    if (
      !orderNo ||
      !productBarcode ||
      !Number.isInteger(requiredQty) ||
      requiredQty < 1
    )
      throw new Error(
        `상품수량 파일 ${index + 2}행의 주문번호·자체품목코드·수량을 확인하세요.`,
      );
    return [{ orderNo, productBarcode, requiredQty, sourceRow: index + 2 }];
  });
}

export async function parseOutboundWorkbooks(
  trackingFile: File,
  orderProductFile: File,
): Promise<OutboundUploadRow[]> {
  const [trackingRows, productRows] = await Promise.all([
    parseTrackingFile(trackingFile),
    parseOrderProductFile(orderProductFile),
  ]);
  const trackingByOrder = new Map<string, string>();
  for (const row of trackingRows) {
    const previous = trackingByOrder.get(row.orderNo);
    if (previous && previous !== row.trackingNo)
      throw new Error(
        `주문번호 ${row.orderNo}에 서로 다른 운송장번호가 연결되어 있습니다.`,
      );
    trackingByOrder.set(row.orderNo, row.trackingNo);
  }
  const missingOrders = Array.from(
    new Set(
      productRows
        .filter((row) => !trackingByOrder.has(row.orderNo))
        .map((row) => row.orderNo),
    ),
  );
  if (missingOrders.length)
    throw new Error(
      `운송장 파일에 없는 주문번호가 ${missingOrders.length}건 있습니다: ${missingOrders.slice(0, 5).join(", ")}`,
    );
  const productOrderSet = new Set(productRows.map((row) => row.orderNo));
  const unusedOrders = Array.from(trackingByOrder.keys()).filter(
    (orderNo) => !productOrderSet.has(orderNo),
  );
  if (unusedOrders.length)
    throw new Error(
      `상품 파일에 없는 주문번호가 ${unusedOrders.length}건 있습니다: ${unusedOrders.slice(0, 5).join(", ")}`,
    );
  return productRows.map((row) => ({
    ...row,
    trackingNo: trackingByOrder.get(row.orderNo)!,
  }));
}
