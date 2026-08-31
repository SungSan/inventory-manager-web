"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Feedback, type FeedbackKind } from "@/components/feedback";
import { PermissionGuard } from "@/components/permission-guard";
import { useUser } from "@/components/user-provider";
import { hasPermission } from "@/lib/permissions";
import { listOutboundJobs } from "@/lib/outbound-progress-api";
import { listAuditLogs, listScanEvents, listTransactions, reverseTransaction, subscribeToInventory, type LogQueryOptions } from "@/lib/inventory-api";
import type { AuditLog, InventoryTransaction, ScanEvent } from "@/types/domain";
import type { OutboundJob } from "@/types/outbound-progress";

type Tab = "transactions" | "outbound" | "transfers" | "scans" | "audit";
type DateMode = "ALL" | "DAY" | "RANGE";

function todayInKorea(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function toDateOptions(mode: DateMode, startDate: string, endDate: string): LogQueryOptions {
  if (mode === "ALL") return {};
  const start = startDate || todayInKorea();
  const end = mode === "DAY" ? start : (endDate || start);
  return {
    startAt: new Date(`${start}T00:00:00+09:00`).toISOString(),
    endBefore: new Date(`${nextDate(end)}T00:00:00+09:00`).toISOString(),
  };
}

function TransactionTable({ rows, emptyText, user, onReverse }: {
  rows: InventoryTransaction[];
  emptyText: string;
  user: ReturnType<typeof useUser>["user"];
  onReverse: (tx: InventoryTransaction) => void;
}) {
  return <section className="panel">
    <div className="table-wrap"><table>
      <thead><tr><th>시간</th><th>상태</th><th>구분</th><th>상품</th><th>로케이션</th><th>수량</th><th>재고 변화</th><th>작업자</th><th>메모</th><th>관리</th></tr></thead>
      <tbody>{rows.map((tx) => <tr key={tx.id}>
        <td>{new Date(tx.createdAt).toLocaleString("ko-KR")}</td>
        <td><span className={`status-badge ${tx.status.toLowerCase()}`}>{tx.status}</span></td>
        <td><span className={`operation ${tx.operation.toLowerCase()}`}>{tx.operation}</span></td>
        <td>{tx.productLabel}</td><td>{tx.locationCode}</td><td>{tx.qty.toLocaleString()}</td>
        <td>{tx.beforeQty} → {tx.afterQty}</td><td>{tx.actorLabel}</td><td>{tx.note}</td>
        <td>{user && hasPermission(user.role, "reverse_transactions") && tx.status === "ACTIVE" ? <button className="button button-danger button-compact" onClick={() => onReverse(tx)}>취소·원복</button> : ""}</td>
      </tr>)}</tbody>
    </table></div>
    {rows.length === 0 ? <p className="empty-state">{emptyText}</p> : null}
  </section>;
}

function OutboundJobTable({ jobs }: { jobs: OutboundJob[] }) {
  const [expandedId, setExpandedId] = useState("");
  return <section className="panel">
    <div className="table-wrap"><table>
      <thead><tr><th>생성일</th><th>상태</th><th>출고 작업</th><th>송장</th><th>예정 수량</th><th>출고 완료</th><th>작업자</th><th>상세</th></tr></thead>
      <tbody>{jobs.map((job) => {
        const items = job.shipments.flatMap((shipment) => shipment.items);
        const requiredQty = items.reduce((sum, item) => sum + item.requiredQty, 0);
        const pickedQty = items.reduce((sum, item) => sum + item.pickedQty, 0);
        const workers = Array.from(new Set(job.shipments.map((shipment) => shipment.assignedWorker).filter(Boolean)));
        const expanded = expandedId === job.id;
        return [
          <tr key={job.id}>
            <td>{new Date(job.createdAt).toLocaleString("ko-KR")}</td>
            <td><span className={`status-badge ${job.status === "COMPLETED" ? "success" : "active"}`}>{job.status}</span></td>
            <td><strong>{job.name}</strong>{job.archivedAt ? <div className="small muted">숨김 · {job.archiveReason || "사유 없음"}</div> : null}</td>
            <td>{job.shipments.length.toLocaleString()}건</td>
            <td>{requiredQty.toLocaleString()}개</td>
            <td><strong>{pickedQty.toLocaleString()}개</strong></td>
            <td>{workers.length ? workers.join(", ") : "-"}</td>
            <td><button className="button button-secondary button-compact" onClick={() => setExpandedId(expanded ? "" : job.id)}>{expanded ? "접기" : "상세보기"}</button></td>
          </tr>,
          expanded ? <tr key={`${job.id}-detail`} className="outbound-log-detail-row"><td colSpan={8}>
            <div className="table-wrap"><table>
              <thead><tr><th>운송장</th><th>상태</th><th>품목</th><th>예정 수량</th><th>출고 완료</th><th>작업자</th></tr></thead>
              <tbody>{job.shipments.map((shipment) => {
                const required = shipment.items.reduce((sum, item) => sum + item.requiredQty, 0);
                const picked = shipment.items.reduce((sum, item) => sum + item.pickedQty, 0);
                return <tr key={shipment.id}><td><code>{shipment.trackingNo}</code></td><td>{shipment.status}</td><td>{shipment.items.length}</td><td>{required.toLocaleString()}</td><td>{picked.toLocaleString()}</td><td>{shipment.assignedWorker || "-"}</td></tr>;
              })}</tbody>
            </table></div>
          </td></tr> : null,
        ];
      })}</tbody>
    </table></div>
    {jobs.length === 0 ? <p className="empty-state">출고작업 이력이 없습니다.</p> : null}
  </section>;
}

function LogsContent() {
  const { user } = useUser();
  const canViewAudit = Boolean(user && ["admin", "manager"].includes(user.role));
  const [tab, setTab] = useState<Tab>("transactions");
  const [search, setSearch] = useState("");
  const [operation, setOperation] = useState("ALL");
  const [scanResult, setScanResult] = useState("ALL");
  const [dateMode, setDateMode] = useState<DateMode>("ALL");
  const [startDate, setStartDate] = useState(todayInKorea);
  const [endDate, setEndDate] = useState(todayInKorea);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [scans, setScans] = useState<ScanEvent[]>([]);
  const [audits, setAudits] = useState<AuditLog[]>([]);
  const [outboundJobs, setOutboundJobs] = useState<OutboundJob[]>([]);
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; title: string; body?: string } | null>(null);

  const dateOptions = useMemo(() => toDateOptions(dateMode, startDate, endDate), [dateMode, endDate, startDate]);
  const invalidRange = dateMode === "RANGE" && endDate < startDate;
  const transactionTab = tab === "transactions" || tab === "transfers";
  const visibleOutboundJobs = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return outboundJobs.filter((job) => {
      const created = new Date(job.createdAt).getTime();
      if (dateOptions.startAt && created < new Date(dateOptions.startAt).getTime()) return false;
      if (dateOptions.endBefore && created >= new Date(dateOptions.endBefore).getTime()) return false;
      if (!keyword) return true;
      return [job.name, ...job.shipments.flatMap((shipment) => [
        shipment.trackingNo,
        shipment.assignedWorker || "",
        ...shipment.items.flatMap((item) => [item.artist, item.nameVer, item.productBarcode]),
      ])].some((value) => value.toLowerCase().includes(keyword));
    });
  }, [dateOptions, outboundJobs, search]);

  const load = useCallback(async () => {
    if (invalidRange) return;
    if (tab === "outbound") setOutboundJobs(await listOutboundJobs(true));
    if (tab === "transactions") setTransactions(await listTransactions(search, operation, 500, "INOUT", dateOptions));
    if (tab === "transfers") setTransactions(await listTransactions(search, operation, 500, "TRANSFER", dateOptions));
    if (tab === "scans") setScans(await listScanEvents(search, scanResult, 1000, dateOptions));
    if (tab === "audit") setAudits(await listAuditLogs(search, 1000, dateOptions));
  }, [dateOptions, invalidRange, operation, scanResult, search, tab]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 150); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => subscribeToInventory(load, { scope: "logs", fallbackMs: 120_000 }), [load]);

  async function reverse(tx: InventoryTransaction) {
    const reason = window.prompt("취소 사유를 입력하세요.", "잘못 처리된 입출고 취소");
    if (reason === null) return;
    try {
      const reversal = await reverseTransaction(tx.id, reason);
      setFeedback({ kind: "success", title: "거래 취소 완료", body: `${reversal.beforeQty} → ${reversal.afterQty}` });
      await load();
    } catch (cause) {
      setFeedback({ kind: "error", title: "거래 취소 실패", body: cause instanceof Error ? cause.message : "오류" });
    }
  }

  return <div className="page-stack">
    <section><p className="eyebrow">TRACEABILITY</p><h2>작업 로그</h2><p className="muted">입출고, 내부 재고이관, 스캔, 감사 로그를 분리하고 원하는 날짜 또는 기간으로 조회합니다.</p></section>
    <section className="tab-row log-tab-row">
      <button className={tab === "transactions" ? "active" : ""} onClick={() => setTab("transactions")}>입출고 이력</button>
      <button className={tab === "outbound" ? "active" : ""} onClick={() => setTab("outbound")}>출고작업 이력</button>
      <button className={tab === "transfers" ? "active" : ""} onClick={() => setTab("transfers")}>재고이관 이력</button>
      <button className={tab === "scans" ? "active" : ""} onClick={() => setTab("scans")}>스캔 로그</button>
      {canViewAudit ? <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>감사 로그</button> : null}
    </section>
    <section className="panel filter-row">
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="상품, 로케이션, 작업자, 메모 검색" />
      {transactionTab ? <select value={operation} onChange={(event) => setOperation(event.target.value)}><option value="ALL">IB/OB 전체</option><option value="IB">IB</option><option value="OB">OB</option></select> : null}
      {tab === "scans" ? <select value={scanResult} onChange={(event) => setScanResult(event.target.value)}><option value="ALL">결과 전체</option><option value="SUCCESS">성공</option><option value="NOT_FOUND">미등록</option><option value="WRONG_TYPE">유형 불일치</option><option value="ERROR">오류</option></select> : null}
      <select value={dateMode} onChange={(event) => setDateMode(event.target.value as DateMode)} aria-label="날짜 조회 방식"><option value="ALL">전체 기간</option><option value="DAY">하루 선택</option><option value="RANGE">기간 선택</option></select>
      {dateMode !== "ALL" ? <label className="log-date-field"><span>{dateMode === "DAY" ? "조회일" : "시작일"}</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label> : null}
      {dateMode === "RANGE" ? <label className="log-date-field"><span>종료일</span><input type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label> : null}
    </section>
    {invalidRange ? <Feedback kind="error" title="날짜 범위를 확인하세요.">종료일은 시작일보다 빠를 수 없습니다.</Feedback> : null}
    {feedback ? <Feedback kind={feedback.kind} title={feedback.title}>{feedback.body}</Feedback> : null}

    {tab === "outbound" && !invalidRange ? <OutboundJobTable jobs={visibleOutboundJobs} /> : null}
    {transactionTab && !invalidRange ? <TransactionTable rows={transactions} emptyText={tab === "transfers" ? "재고이관 이력이 없습니다." : "입출고 이력이 없습니다."} user={user} onReverse={(tx) => void reverse(tx)} /> : null}
    {tab === "scans" && !invalidRange ? <section className="panel"><div className="table-wrap"><table><thead><tr><th>시간</th><th>결과</th><th>스캔값</th><th>예상 유형</th><th>확인 유형</th><th>대상</th><th>화면</th><th>작업자</th></tr></thead><tbody>{scans.map((event) => <tr key={event.id}><td>{new Date(event.createdAt).toLocaleString("ko-KR")}</td><td><span className={`status-badge ${event.result.toLowerCase()}`}>{event.result}</span></td><td><code>{event.rawValue}</code></td><td>{event.expectedTargetType}</td><td>{event.resolvedTargetType}</td><td>{event.targetLabel}</td><td>{event.context}</td><td>{event.actorLabel}</td></tr>)}</tbody></table></div>{scans.length === 0 ? <p className="empty-state">스캔 기록이 없습니다.</p> : null}</section> : null}
    {tab === "audit" && !invalidRange ? <section className="panel"><div className="table-wrap"><table><thead><tr><th>시간</th><th>작업</th><th>대상 유형</th><th>대상</th><th>작업자</th><th>메모</th><th>변경 전</th><th>변경 후</th></tr></thead><tbody>{audits.map((log) => <tr key={log.id}><td>{new Date(log.createdAt).toLocaleString("ko-KR")}</td><td><code>{log.action}</code></td><td>{log.entityType}</td><td>{log.entityLabel}</td><td>{log.actorLabel}</td><td>{log.note}</td><td><pre className="json-cell">{log.before ? JSON.stringify(log.before, null, 1) : ""}</pre></td><td><pre className="json-cell">{log.after ? JSON.stringify(log.after, null, 1) : ""}</pre></td></tr>)}</tbody></table></div>{audits.length === 0 ? <p className="empty-state">감사 기록이 없습니다.</p> : null}</section> : null}
  </div>;
}

export default function LogsPage() { return <PermissionGuard permission="view_logs"><LogsContent /></PermissionGuard>; }
