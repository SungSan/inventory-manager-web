import * as XLSX from "xlsx";
import type { AuditLog, InventoryTransaction } from "@/types/domain";
import type { OutboundJob } from "@/types/outbound-progress";

export type LogExportTab = "transactions" | "outbound" | "transfers" | "audit";

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 80);
}

function addSheet(workbook: XLSX.WorkBook, name: string, rows: unknown[][], widths: number[]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  if (rows.length > 0 && rows[0].length > 0) {
    sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length - 1), c: rows[0].length - 1 } }) };
  }
  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) continue;
    const cell = sheet[address];
    if (cell?.t === "d") cell.z = "yyyy-mm-dd hh:mm:ss";
  }
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

export function downloadLogXlsx(input: {
  tab: LogExportTab;
  transactions: InventoryTransaction[];
  outboundJobs: OutboundJob[];
  audits: AuditLog[];
  periodLabel: string;
}) {
  const workbook = XLSX.utils.book_new();
  let label = "작업로그";

  if (input.tab === "transactions" || input.tab === "transfers") {
    label = input.tab === "transactions" ? "입출고이력" : "재고이관이력";
    addSheet(workbook, label, [
      ["시간", "상태", "구분", "상품", "로케이션", "수량", "변경 전", "변경 후", "작업자", "메모", "거래 ID", "참조 유형", "참조 ID"],
      ...input.transactions.map((tx) => [
        new Date(tx.createdAt), tx.status, tx.operation, tx.productLabel, tx.locationCode,
        tx.qty, tx.beforeQty, tx.afterQty, tx.actorLabel || "", tx.note || "", tx.id,
        tx.referenceType || "", tx.referenceId || "",
      ]),
    ], [20, 12, 8, 38, 20, 12, 12, 12, 18, 35, 38, 16, 38]);
  } else if (input.tab === "outbound") {
    label = "출고작업이력";
    addSheet(workbook, "작업 요약", [
      ["생성일", "상태", "출고 작업", "송장 수", "예정 수량", "출고 완료", "작업자", "숨김", "숨김 사유", "작업 ID"],
      ...input.outboundJobs.map((job) => {
        const items = job.shipments.flatMap((shipment) => shipment.items);
        return [new Date(job.createdAt), job.status, job.name, job.shipments.length,
          items.reduce((sum, item) => sum + item.requiredQty, 0),
          items.reduce((sum, item) => sum + item.pickedQty, 0),
          Array.from(new Set(job.shipments.map((shipment) => shipment.assignedWorker).filter(Boolean))).join(", "),
          job.archivedAt ? "Y" : "N", job.archiveReason || "", job.id];
      }),
    ], [20, 14, 34, 12, 14, 14, 22, 9, 30, 38]);
    addSheet(workbook, "송장 품목 상세", [
      ["작업명", "운송장", "송장 상태", "아티스트", "상품명/버전", "상품 바코드", "예정 수량", "출고 완료", "작업자", "작업 ID", "송장 ID"],
      ...input.outboundJobs.flatMap((job) => job.shipments.flatMap((shipment) => shipment.items.map((item) => [
        job.name, shipment.trackingNo, shipment.status, item.artist, item.nameVer, item.productBarcode,
        item.requiredQty, item.pickedQty, shipment.assignedWorker || "", job.id, shipment.id,
      ]))),
    ], [32, 22, 14, 24, 45, 22, 14, 14, 20, 38, 38]);
  } else {
    label = "관리자감사로그";
    addSheet(workbook, label, [
      ["시간", "작업", "대상 유형", "대상", "작업자", "메모", "변경 전", "변경 후", "로그 ID"],
      ...input.audits.map((log) => [
        new Date(log.createdAt), log.action, log.entityType, log.entityLabel || "", log.actorLabel || "",
        log.note || "", log.before ? JSON.stringify(log.before) : "", log.after ? JSON.stringify(log.after) : "", log.id,
      ]),
    ], [20, 30, 16, 34, 18, 40, 55, 55, 38]);
  }

  const binary = XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true });
  const blob = new Blob([binary], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeName(label)}_${safeName(input.periodLabel)}_${todayStamp()}.xlsx`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function todayStamp(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
