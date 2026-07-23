"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PermissionGuard } from "@/components/permission-guard";
import { cancelInventoryCountSession, getInventoryCountSession, startInventoryCountLocation, type InventoryCountSessionDetail } from "@/lib/stocktake-api";
import { getSupabaseClient } from "@/lib/supabase";
import styles from "../stocktakes.module.css";

function SessionContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<InventoryCountSessionDetail | null>(null);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [busyLocationId, setBusyLocationId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try { setSession(await getInventoryCountSession(params.id)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "재고실사 작업을 불러오지 못했습니다."); }
  }, [params.id]);

  useEffect(() => { void load(); }, [load]);

  const visibleLocations = useMemo(() => {
    const normalized = keyword.trim().toUpperCase();
    return (session?.locations ?? []).filter((row) => {
      if (statusFilter !== "ALL" && row.status !== statusFilter) return false;
      return !normalized || `${row.locationCode} ${row.zone}`.toUpperCase().includes(normalized);
    });
  }, [keyword, session, statusFilter]);

  async function openLocation(locationId: string, status: string) {
    setBusyLocationId(locationId); setError(""); setMessage("");
    try { if (status === "PENDING") await startInventoryCountLocation(params.id, locationId); router.push(`/stocktakes/${params.id}/${locationId}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "로케이션 실사를 시작하지 못했습니다."); }
    finally { setBusyLocationId(""); }
  }

  async function confirmEmptyLocation(locationId: string, locationCode: string) {
    if (!window.confirm(`${locationCode}가 실제로 비어 있습니까?\n\n확인 후 즉시 실사 완료 처리됩니다.`)) return;
    const supabase = getSupabaseClient();
    if (!supabase) { setError("Supabase 연결 설정을 확인하세요."); return; }
    setBusyLocationId(locationId); setError(""); setMessage("");
    try {
      const { error: rpcError } = await supabase.rpc("complete_empty_inventory_count_location", { p_session_id: params.id, p_location_id: locationId });
      if (rpcError) throw new Error(rpcError.message);
      setMessage(`${locationCode} 빈 LOC 확인을 완료했습니다.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "빈 LOC 확인을 완료하지 못했습니다."); }
    finally { setBusyLocationId(""); }
  }

  async function cancelSession() {
    if (!session || session.status !== "IN_PROGRESS") return;
    const reason = window.prompt("실사 취소 사유를 입력하세요.", "");
    if (reason === null || !window.confirm(`${session.countNo} 실사 전체를 취소할까요?\n진행 중 LOC의 재고 잠금도 해제됩니다.`)) return;
    setBusyLocationId("SESSION");
    try { setSession(await cancelInventoryCountSession(session.id, reason)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "재고실사를 취소하지 못했습니다."); }
    finally { setBusyLocationId(""); }
  }

  if (!session) return <div className="page-stack"><Link className="text-link" href="/stocktakes">← 재고실사 목록</Link>{error ? <p className="inline-error">{error}</p> : <div className="center-panel">재고실사를 불러오는 중...</div>}</div>;

  const completed = session.locations.filter((row) => row.status === "COMPLETED").length;
  const total = session.locations.length;
  const percent = total ? Math.round((completed / total) * 100) : 0;

  return (
    <div className={`page-stack ${styles.page}`}>
      <section className={styles.detailHeader}><div><Link className="text-link" href="/stocktakes">← 재고실사 목록</Link><p className="eyebrow">COUNT SESSION</p><h2>{session.countNo}</h2><p className="muted">{session.scopeValue} · {new Date(session.createdAt).toLocaleString("ko-KR")}</p></div><div className="action-row"><span className={`status-badge ${session.status === "IN_PROGRESS" ? "active" : session.status === "COMPLETED" ? "success" : "inactive"}`}>{session.status}</span>{session.status === "IN_PROGRESS" ? <button className="button button-danger button-compact" onClick={() => void cancelSession()} disabled={busyLocationId === "SESSION"}>전체 실사 취소</button> : null}</div></section>
      {error ? <p className="inline-error">{error}</p> : null}
      {message ? <div className="feedback feedback-success"><strong>{message}</strong></div> : null}
      <section className={styles.progressPanel}><div><span>전체 LOC</span><strong>{total.toLocaleString()}</strong></div><div><span>완료</span><strong>{completed.toLocaleString()}</strong></div><div><span>진행률</span><strong>{percent}%</strong></div><div><span>차이 수량</span><strong>{session.locations.reduce((sum, row) => sum + row.differenceQty, 0).toLocaleString()}</strong></div></section>
      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">TARGET LOCATIONS</p><h3>실사 대상 로케이션</h3></div><strong>{visibleLocations.length.toLocaleString()}개</strong></div>
        <div className={styles.filters}><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="LOC 또는 구역 검색" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">전체 상태</option><option value="PENDING">대기</option><option value="IN_PROGRESS">진행 중</option><option value="COMPLETED">완료</option><option value="CANCELLED">취소</option></select><button className="button button-secondary" onClick={() => void load()}>새로고침</button></div>
        <div className={styles.locationCards}>{visibleLocations.map((row) => <article key={row.locationId} className={styles.locationCard}><div><span className={`status-badge ${row.status === "IN_PROGRESS" ? "active" : row.status === "COMPLETED" ? "success" : row.status === "CANCELLED" ? "inactive" : ""}`}>{row.status}</span><h4>{row.locationCode}</h4><p>{row.zone || "구역 없음"}</p></div><div className={styles.locationMetrics}><span><small>전산 SKU</small><strong>{row.systemSkuCount == null ? "-" : row.systemSkuCount.toLocaleString()}</strong></span><span><small>확인 SKU</small><strong>{row.countedSkuCount.toLocaleString()}</strong></span><span><small>차이</small><strong>{row.differenceSkuCount} SKU / {row.differenceQty.toLocaleString()}개</strong></span></div>{row.status !== "CANCELLED" ? <div className="action-row">{row.status === "PENDING" && row.isCurrentlyEmpty === true ? <button className="button button-secondary" onClick={() => void confirmEmptyLocation(row.locationId, row.locationCode)} disabled={busyLocationId === row.locationId}>{busyLocationId === row.locationId ? "처리 중..." : "빈 LOC 확인 완료"}</button> : null}<button className={row.status === "COMPLETED" ? "button button-secondary" : "button button-primary"} onClick={() => void openLocation(row.locationId, row.status)} disabled={busyLocationId === row.locationId}>{busyLocationId === row.locationId ? "처리 중..." : row.status === "PENDING" ? "실사 시작" : row.status === "IN_PROGRESS" ? "실사 계속" : "결과 보기"}</button></div> : null}</article>)}{visibleLocations.length === 0 ? <p className="empty-state">조건에 맞는 로케이션이 없습니다.</p> : null}</div>
      </section>
    </div>
  );
}

export default function InventoryCountSessionPage() {
  return <PermissionGuard permission="stocktake_inventory"><SessionContent /></PermissionGuard>;
}
