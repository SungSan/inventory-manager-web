"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarcodeField } from "@/components/barcode-field";
import { BarcodeSvg } from "@/components/barcode-svg";
import { Feedback, type FeedbackKind } from "@/components/feedback";
import { PermissionGuard } from "@/components/permission-guard";
import { inferBarcodeSymbology } from "@/lib/barcode";
import { listBarcodes, listTargets, registerBarcode, subscribeToInventory, updateBarcode } from "@/lib/inventory-api";
import type { BarcodeRecord, BarcodeSource, ScannableTargetOption } from "@/types/domain";

function BarcodesContent() {
  const [targetType, setTargetType] = useState<"product" | "location">("product");
  const [search, setSearch] = useState("");
  const [targets, setTargets] = useState<ScannableTargetOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [barcodeValue, setBarcodeValue] = useState("");
  const [source, setSource] = useState<BarcodeSource>("custom");
  const [makePrimary, setMakePrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listSearch, setListSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [barcodes, setBarcodes] = useState<BarcodeRecord[]>([]);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; title: string; body?: string } | null>(null);

  const load = useCallback(async () => setBarcodes(await listBarcodes(listSearch, typeFilter)), [listSearch, typeFilter]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const barcode = params.get("barcode");
    const type = params.get("type");
    if (barcode) setBarcodeValue(barcode);
    if (type === "location") setTargetType("location");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try { setTargets(await listTargets(targetType, search)); }
      catch (cause) { setFeedback({ kind: "error", title: "대상 조회 실패", body: cause instanceof Error ? cause.message : "조회 오류" }); }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [search, targetType]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 150); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => subscribeToInventory(() => void load()), [load]);

  async function save() {
    if (!selectedId || !barcodeValue.trim()) return;
    setBusy(true); setFeedback(null);
    try {
      await registerBarcode({ targetType, targetId: selectedId, barcodeValue, source, symbology: inferBarcodeSymbology(barcodeValue), makePrimary });
      setFeedback({ kind: "success", title: "바코드 연결 완료", body: barcodeValue });
      setBarcodeValue(""); setMakePrimary(false); await load();
    } catch (cause) {
      setFeedback({ kind: "error", title: "바코드 연결 실패", body: cause instanceof Error ? cause.message : "등록 오류" });
    } finally { setBusy(false); }
  }

  const labels = useMemo(() => barcodes.filter((item) => selectedLabels.includes(item.id)), [barcodes, selectedLabels]);

  return <div className="page-stack">
    <section><p className="eyebrow">BARCODE REGISTRY</p><h2>바코드 연결 관리</h2><p className="muted">기존 상품·로케이션에 제조사, 내부 발급, 지정 번호를 추가 연결합니다. 같은 상품 바코드를 여러 상품/버전에 연결할 수 있으며, 스캔 시 상품 선택창이 표시됩니다.</p></section>

    <section className="panel form-grid">
      <label>연결 대상 유형<select value={targetType} onChange={(event) => { setTargetType(event.target.value as "product" | "location"); setSelectedId(""); setSearch(""); }}><option value="product">상품</option><option value="location">로케이션</option></select></label>
      <label>대상 검색<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={targetType === "product" ? "CODE_NO, 아티스트, 상품명" : "로케이션 코드"} /></label>
      <label className="span-two">연결 대상<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">선택하세요</option>{targets.map((target) => <option key={target.targetId} value={target.targetId}>{target.label} — {target.description}</option>)}</select></label>
      <div className="span-two"><BarcodeField label="신규 바코드 번호" placeholder="스캔하거나 지정 번호를 입력하세요" value={barcodeValue} onSubmit={setBarcodeValue} resetToken={barcodeValue === "" ? 1 : 0} /></div>
      <label>바코드 출처<select value={source} onChange={(event) => setSource(event.target.value as BarcodeSource)}><option value="manufacturer">제조사</option><option value="internal">내부 발급</option><option value="custom">사용자 지정</option><option value="future">향후 연동</option></select></label>
      <label className="checkbox-label"><input type="checkbox" checked={makePrimary} onChange={(event) => setMakePrimary(event.target.checked)} />대표 바코드로 지정</label>
      <button className="button button-primary span-two" disabled={!selectedId || !barcodeValue.trim() || busy} onClick={() => void save()}>{busy ? "등록 중..." : "바코드 연결"}</button>
    </section>

    {feedback ? <Feedback kind={feedback.kind} title={feedback.title}>{feedback.body}</Feedback> : null}

    <section className="panel">
      <div className="section-heading"><div><h3>연결된 바코드</h3><p className="muted small">선택한 바코드는 A4 라벨 형식으로 인쇄할 수 있습니다.</p></div><div className="filter-row"><select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="ALL">전체 유형</option><option value="product">상품</option><option value="location">로케이션</option></select><input value={listSearch} onChange={(e) => setListSearch(e.target.value)} placeholder="번호 또는 대상 검색" /><button className="button button-secondary" disabled={labels.length === 0} onClick={() => window.print()}>선택 라벨 인쇄 ({labels.length})</button></div></div>
      <div className="table-wrap"><table><thead><tr><th>인쇄</th><th>상태</th><th>유형</th><th>대상</th><th>바코드</th><th>출처</th><th>대표</th><th>관리</th></tr></thead><tbody>{barcodes.map((item) => <tr key={item.id}><td><input type="checkbox" checked={selectedLabels.includes(item.id)} onChange={(e) => setSelectedLabels((current) => e.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /></td><td><span className={`status-badge ${item.active ? "active" : "inactive"}`}>{item.active ? "사용" : "중지"}</span></td><td>{item.targetType === "product" ? "상품" : "로케이션"}</td><td>{item.targetLabel}</td><td><code>{item.value}</code></td><td>{item.source}</td><td>{item.isPrimary ? <span className="status-badge primary">대표</span> : ""}</td><td><div className="row-actions">{!item.isPrimary ? <button className="button button-secondary button-compact" disabled={!item.active} onClick={() => void updateBarcode(item.id, { isPrimary: true }).then(load)}>대표 지정</button> : null}<button className="button button-ghost button-compact" onClick={() => void updateBarcode(item.id, { active: !item.active }).then(load)}>{item.active ? "비활성화" : "활성화"}</button></div></td></tr>)}</tbody></table></div>
    </section>

    <section className="print-label-sheet" aria-hidden="true">
      {labels.map((item) => <article className="print-label" key={item.id}><strong>{item.targetLabel}</strong><BarcodeSvg value={item.value} height={55} /><code>{item.value}</code><small>{item.targetType === "product" ? "PRODUCT" : "LOCATION"}</small></article>)}
    </section>
  </div>;
}

export default function BarcodesPage() { return <PermissionGuard permission="manage_barcodes"><BarcodesContent /></PermissionGuard>; }
