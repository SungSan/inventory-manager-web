import type { ImportInventoryRow } from "@/types/domain";

export type InventoryCsvLayout = "HEADER" | "LEGACY_7_COLUMNS";

export interface ParsedInventoryCsv {
  layout: InventoryCsvLayout;
  rows: ImportInventoryRow[];
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function normalizedHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function pick(row: string[], index: Map<string, number>, names: string[]): string {
  for (const name of names) {
    const i = index.get(normalizedHeader(name));
    if (i !== undefined) return (row[i] ?? "").trim();
  }
  return "";
}

function parseQty(value: string): number {
  const qty = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(qty) ? qty : -1;
}

function looksLikeHeader(firstRow: string[]): boolean {
  const headers = new Set(firstRow.map(normalizedHeader));
  const hasLocation = ["LOCATION", "LOCATION_CODE", "로케이션", "위치"].some((name) => headers.has(normalizedHeader(name)));
  const hasCode = ["CODE_NO", "CODE", "상품바코드", "BARCODE"].some((name) => headers.has(normalizedHeader(name)));
  const hasQty = ["QTY", "QUANTITY", "TOTAL_QTY", "재고", "수량"].some((name) => headers.has(normalizedHeader(name)));
  return hasLocation && hasCode && hasQty;
}

export function parseInventoryCsv(text: string): ParsedInventoryCsv {
  const rawRows = parseCsv(text);
  if (rawRows.length === 0) throw new Error("CSV에 데이터가 없습니다.");

  if (!looksLikeHeader(rawRows[0])) {
    const rows = rawRows.map((row, index) => {
      if (row.length < 7) {
        throw new Error(`${index + 1}행: 헤더 없는 기존 양식은 A~G 7개 열이 필요합니다.`);
      }
      const locationCode = (row[0] ?? "").trim();
      const pCodeNo = (row[1] ?? "").trim();
      const codeNo = (row[2] ?? "").trim();
      const masterCodeNo = (row[3] ?? "").trim();
      const artist = (row[4] ?? "").trim();
      const nameVer = (row[5] ?? "").trim();
      const qty = parseQty(row[6] ?? "");
      return {
        locationCode,
        pCodeNo,
        codeNo,
        masterCodeNo,
        artist,
        nameVer,
        qty,
        // 현재 사용 중인 양식에서는 C열 CODE_NO를 상품 스캔 바코드로 사용합니다.
        productBarcode: codeNo || undefined,
        // 별도 로케이션 바코드 열이 없으므로 A열 로케이션 코드를 그대로 등록합니다.
        locationBarcode: locationCode || undefined,
      } satisfies ImportInventoryRow;
    });
    return { layout: "LEGACY_7_COLUMNS", rows };
  }

  if (rawRows.length < 2) throw new Error("헤더 아래에 데이터 행이 필요합니다.");
  const index = new Map(rawRows[0].map((header, i) => [normalizedHeader(header), i]));
  const rows: ImportInventoryRow[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    const locationCode = pick(row, index, ["LOCATION", "LOCATION_CODE", "로케이션", "위치"]);
    const codeNo = pick(row, index, ["CODE_NO", "CODE", "상품코드"]);
    const explicitProductBarcode = pick(row, index, ["PRODUCT_BARCODE", "BARCODE", "상품바코드"]);
    const explicitLocationBarcode = pick(row, index, ["LOCATION_BARCODE", "로케이션바코드"]);
    rows.push({
      locationCode,
      pCodeNo: pick(row, index, ["P_CODE_NO", "P_CODE"]),
      codeNo: codeNo || explicitProductBarcode,
      masterCodeNo: pick(row, index, ["MASTER_CODE_NO", "MASTER_CODE"]),
      artist: pick(row, index, ["ARTIST", "아티스트"]),
      nameVer: pick(row, index, ["NAME_VER", "상품명", "상품명_버전", "NAME", "상품명/버전"]),
      qty: parseQty(pick(row, index, ["QTY", "QUANTITY", "TOTAL_QTY", "재고", "수량"])),
      productBarcode: explicitProductBarcode || codeNo || undefined,
      locationBarcode: explicitLocationBarcode || locationCode || undefined,
    });
  }
  return { layout: "HEADER", rows };
}

export function csvToInventoryRows(text: string): ImportInventoryRow[] {
  return parseInventoryCsv(text).rows;
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
