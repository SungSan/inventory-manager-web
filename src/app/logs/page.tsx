"use client";

import { useCallback, useEffect, useState } from "react";
import { Feedback, type FeedbackKind } from "@/components/feedback";
import { PermissionGuard } from "@/components/permission-guard";
import { useUser } from "@/components/user-provider";
import { hasPermission } from "@/lib/permissions";
import { listAuditLogs, listScanEvents, listTransactions, reverseTransaction, subscribeToInventory } from "@/lib/inventory-api";
import type { AuditLog, InventoryTransaction, ScanEvent } from "@/types/domain";

type Tab = "transactions" | "scans" | "audit";

function LogsContent() {
  const { user } = useUser();
  const canViewAudit = Boolean(user && ["admin", "manager"].includes(user.role));
  const [tab, setTab] = useState<Tab>("transactions");
  const [search, setSearch] = useState("");
  const [operation, setOperation] = useState("ALL");
  const [scanResult, setScanResult] = useState("ALL");
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [scans, setScans] = useState<ScanEvent[]>([]);
  const [audits, setAudits] = useState<AuditLog[]>([]);
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; title: string; body?: string } | null>(null);

  const load = useCallback(async () => {
    if (tab === "transactions") setTransactions(await listTransactions(search, operation));
    if (tab === "scans") setScans(await listScanEvents(search, scanResult));
    if (tab === "audit") setAudits(await listAuditLogs(search));
  }, [operation, scanResult, search, tab]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 150); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => subscribeToInventory(() => void load()), [load]);

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
    <section><p className="eyebrow">TRACEABILITY</p><h2>작업 로그</h2><p className="muted">입출고 이력, 모든 스캔 성공·실패, 상품·바코드·권한 변경 감사 로그를 분리해서 확인합니다.</p></section>
    <section className="tab-row"><button className={tab === "transactions" ? "active" : ""} onClick={() => setTab("transactions")}>입출고 이력</button><button className={tab === "scans" ? "active" : ""} onClick={() => setTab("scans")}>스캔 로그</button>{canViewAudit ? <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>감사 로그</button> : null}</section>
    <section className="panel filter-row"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="상품, 로케이션, 작업자, 메모 검색" />{tab === "transactions" ? <select value={operation} onChange={(e) => setOperation(e.target.value)}><option value="ALL">IB/OB 전체</option><option value="IB">IB</option><option value="OB">OB</option></select> : null}{tab === "scans" ? <select value={scanResult} onChange={(e) => setScanResult(e.target.value)}><option value="ALL">결과 전체</option><option value="SUCCESS">성공</option><option value="NOT_FOUND">미등록</option><option value="WRONG_TYPE">유형 불일치</option><option value="ERROR">오류</option></select> : null}</section>
    {feedback ? <Feedback kind={feedback.kind} title={feedback.title}>{feedback.body}</Feedback> : null}

    {tab === "transactions" ? <section className="panel"><div className="table-wrap"><table><thead><tr><th>시간</th><th>상태</th><th>구분</th><th>상품</th><th>로케이션</th><th>수량</th><th>재고 변화</th><th>작업자</th><th>메모</th><th>관리</th></tr></thead><tbody>{transactions.map((tx) => <tr key={tx.id}><td>{new Date(tx.createdAt).toLocaleString("ko-KR")}</td><td><span className={`status-badge ${tx.status.toLowerCase()}`}>{tx.status}</span></td><td><span className={`operation ${tx.operation.toLowerCase()}`}>{tx.operation}</span></td><td>{tx.productLabel}</td><td>{tx.locationCode}</td><td>{tx.qty.toLocaleString()}</td><td>{tx.beforeQty} → {tx.afterQty}</td><td>{tx.actorLabel}</td><td>{tx.note}</td><td>{user && hasPermission(user.role, "reverse_transactions") && tx.status === "ACTIVE" ? <button className="button button-danger button-compact" onClick={() => void reverse(tx)}>취소·원복</button> : ""}</td></tr>)}</tbody></table></div>{transactions.length === 0 ? <p className="empty-state">거래가 없습니다.</p> : null}</section> : null}

    {tab === "scans" ? <section className="panel"><div className="table-wrap"><table><thead><tr><th>시간</th><th>결과</th><th>스캔값</th><th>예상 유형</th><th>확인 유형</th><th>대상</th><th>화면</th><th>작업자</th></tr></thead><tbody>{scans.map((event) => <tr key={event.id}><td>{new Date(event.createdAt).toLocaleString("ko-KR")}</td><td><span className={`status-badge ${event.result.toLowerCase()}`}>{event.result}</span></td><td><code>{event.rawValue}</code></td><td>{event.expectedTargetType}</td><td>{event.resolvedTargetType}</td><td>{event.targetLabel}</td><td>{event.context}</td><td>{event.actorLabel}</td></tr>)}</tbody></table></div>{scans.length === 0 ? <p className="empty-state">스캔 기록이 없습니다.</p> : null}</section> : null}

    {tab === "audit" ? <section className="panel"><div className="table-wrap"><table><thead><tr><th>시간</th><th>작업</th><th>대상 유형</th><th>대상</th><th>작업자</th><th>메모</th><th>변경 전</th><th>변경 후</th></tr></thead><tbody>{audits.map((log) => <tr key={log.id}><td>{new Date(log.createdAt).toLocaleString("ko-KR")}</td><td><code>{log.action}</code></td><td>{log.entityType}</td><td>{log.entityLabel}</td><td>{log.actorLabel}</td><td>{log.note}</td><td><pre className="json-cell">{log.before ? JSON.stringify(log.before, null, 1) : ""}</pre></td><td><pre className="json-cell">{log.after ? JSON.stringify(log.after, null, 1) : ""}</pre></td></tr>)}</tbody></table></div>{audits.length === 0 ? <p className="empty-state">감사 기록이 없습니다.</p> : null}</section> : null}
  </div>;
}

export default function LogsPage() { return <PermissionGuard permission="view_logs"><LogsContent /></PermissionGuard>; }
