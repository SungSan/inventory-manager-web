"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useUser } from "@/components/user-provider";
import { hasPermission } from "@/lib/permissions";
import { listInventory, listLocations, listProducts, listRecentTransactions, listScanEvents, subscribeToInventory } from "@/lib/inventory-api";
import type { InventoryRow, InventoryTransaction, Location, Product, ScanEvent } from "@/types/domain";

export default function DashboardPage() {
  const { user } = useUser();
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [scans, setScans] = useState<ScanEvent[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [stock, recent, productRows, locationRows, scanRows] = await Promise.all([
        listInventory(), listRecentTransactions(8), listProducts("", false), listLocations("", false), listScanEvents("", "ALL", 100),
      ]);
      setInventory(stock); setTransactions(recent); setProducts(productRows); setLocations(locationRows); setScans(scanRows); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "데이터를 불러오지 못했습니다."); }
  }, []);

  useEffect(() => { void load(); return subscribeToInventory(() => void load()); }, [load]);

  const metrics = useMemo(() => {
    const totalQty = inventory.reduce((sum, item) => sum + item.qty, 0);
    const lowStock = inventory.filter((item) => item.qty <= 5).length;
    const scanFailures = scans.filter((item) => item.result !== "SUCCESS").length;
    return { totalQty, skuCount: products.length, locationCount: locations.length, lowStock, scanFailures };
  }, [inventory, locations.length, products.length, scans]);

  return <div className="page-stack">
    <section><p className="eyebrow">OVERVIEW</p><h2>실시간 재고 현황</h2></section>
    {error ? <p className="inline-error">{error}</p> : null}
    <section className="metric-grid five"><article className="metric-card"><span>총 재고</span><strong>{metrics.totalQty.toLocaleString()}</strong></article><article className="metric-card"><span>활성 상품</span><strong>{metrics.skuCount}</strong></article><article className="metric-card"><span>활성 로케이션</span><strong>{metrics.locationCount}</strong></article><article className="metric-card"><span>5개 이하</span><strong>{metrics.lowStock}</strong></article><article className="metric-card"><span>최근 스캔 오류</span><strong>{metrics.scanFailures}</strong></article></section>

    {user ? <section className="quick-grid">
      {hasPermission(user.role, "scan_inventory") ? <Link href="/scan" className="quick-card"><strong>입고·출고 시작</strong><span>상품과 로케이션 바코드 스캔</span></Link> : null}
      {hasPermission(user.role, "transfer_inventory") ? <Link href="/transfers" className="quick-card"><strong>재고 이관</strong><span>진행 중 업무 저장·재개 및 LOC 간 이동</span></Link> : null}
      {hasPermission(user.role, "view_inventory") ? <Link href="/location-map" className="quick-card"><strong>LOC MAP</strong><span>점유·빈 로케이션과 상세 재고 확인</span></Link> : null}
      {hasPermission(user.role, "manage_products") ? <Link href="/products" className="quick-card"><strong>신규 상품 등록</strong><span>대표 바코드와 동시에 생성</span></Link> : null}
      {hasPermission(user.role, "manage_barcodes") ? <Link href="/barcodes" className="quick-card"><strong>바코드 연결</strong><span>추가 번호·대표·라벨 관리</span></Link> : null}
      {hasPermission(user.role, "view_logs") ? <Link href="/logs" className="quick-card"><strong>작업 로그</strong><span>거래·스캔·감사 내역 확인</span></Link> : null}
    </section> : null}

    <section className="panel"><div className="section-heading"><div><p className="eyebrow">RECENT</p><h3>최근 입출고</h3></div><Link className="text-link" href="/logs">전체 로그 보기</Link></div>
      {transactions.length === 0 ? <p className="empty-state">아직 처리된 입출고가 없습니다.</p> : <div className="table-wrap"><table><thead><tr><th>시간</th><th>상태</th><th>구분</th><th>상품</th><th>로케이션</th><th>수량</th><th>처리 후</th><th>작업자</th></tr></thead><tbody>{transactions.map((tx) => <tr key={tx.id}><td>{new Date(tx.createdAt).toLocaleString("ko-KR")}</td><td><span className={`status-badge ${tx.status.toLowerCase()}`}>{tx.status}</span></td><td><span className={`operation ${tx.operation.toLowerCase()}`}>{tx.operation}</span></td><td>{tx.productLabel}</td><td>{tx.locationCode}</td><td>{tx.qty.toLocaleString()}</td><td>{tx.afterQty.toLocaleString()}</td><td>{tx.actorLabel}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
