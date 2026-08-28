"use client";

import { useMemo, useRef, useState } from "react";
import { PermissionGuard } from "@/components/permission-guard";
import { Feedback } from "@/components/feedback";
import { useUser } from "@/components/user-provider";
import { listBarcodes, listProducts } from "@/lib/inventory-api";
import { listAllInventoryRows } from "@/lib/full-data-api";
import { parseOutboundWorkbook } from "@/lib/outbound-progress-xlsx";
import type { OutboundJob, OutboundPickingItem, OutboundShipment, OutboundUploadRow } from "@/types/outbound-progress";
import styles from "./outbound-progress.module.css";

type FocusState = { item: OutboundPickingItem; kind: "PICKING" | "COMPLETE" | "EXCESS" } | null;
const normalizeBarcode = (value: string) => value.trim().replace(/\s+/g, "").toUpperCase();
const uid = () => crypto.randomUUID();

function playTone(kind: "SCAN" | "COMPLETE" | "ERROR") {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new AudioContextClass();
    const frequencies = kind === "COMPLETE" ? [660, 880] : kind === "ERROR" ? [180, 120] : [920];
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.frequency.value = frequency; oscillator.type = kind === "ERROR" ? "square" : "sine";
      gain.gain.value = kind === "ERROR" ? .16 : .07; oscillator.connect(gain); gain.connect(context.destination);
      const start = context.currentTime + index * .1; oscillator.start(start); oscillator.stop(start + (kind === "ERROR" ? .13 : .08));
    });
  } catch { /* 소리가 차단되어도 스캔은 계속한다. */ }
}

function sampleJob(): OutboundJob {
  const shipment = (trackingNo: string, items: Array<[string,string,string,number,string[]]>): OutboundShipment => ({
    id: uid(), trackingNo, manualQuantityAllowed: false, status: "READY",
    items: items.map(([barcode,artist,name,qty,locations]) => ({ id: uid(), productBarcode: barcode, artist, nameVer: name, requiredQty: qty, pickedQty: 0, resolution: "MATCHED", locations: locations.map((locationCode,index) => ({ locationCode, qty: Math.max(qty-index*2,1) })) })),
  });
  return { id: uid(), name: "파일럿 출고 작업", createdAt: new Date().toISOString(), status: "READY", shipments: [
    shipment("TEST-880001", [["880001","ATEEZ","GOLDEN HOUR A Ver.",5,["D1A-01-01-01","D1C-02-01-01"]],["880002","ATEEZ","GOLDEN HOUR B Ver.",3,["D1A-01-01-02"]]]),
    shipment("TEST-880002", [["880003","ONF","미니 9집 POCA Ver.",10,["D1B-03-02-01"]]]),
  ] };
}

async function buildJob(name: string, uploadRows: OutboundUploadRow[]): Promise<OutboundJob> {
  const [barcodes, products, inventory] = await Promise.all([listBarcodes("", "product"), listProducts("", true), listAllInventoryRows()]);
  const productsById = new Map(products.map((product) => [product.id, product]));
  const barcodeTargets = new Map<string, string[]>();
  for (const barcode of barcodes.filter((item) => item.active)) {
    const key = normalizeBarcode(barcode.value); const targets = barcodeTargets.get(key) ?? [];
    if (!targets.includes(barcode.targetId)) targets.push(barcode.targetId); barcodeTargets.set(key, targets);
  }
  const grouped = new Map<string, Map<string, OutboundUploadRow[]>>();
  for (const row of uploadRows) {
    const shipment = grouped.get(row.trackingNo) ?? new Map<string, OutboundUploadRow[]>();
    const key = normalizeBarcode(row.productBarcode); shipment.set(key, [...(shipment.get(key) ?? []), row]); grouped.set(row.trackingNo, shipment);
  }
  const shipments: OutboundShipment[] = [...grouped.entries()].map(([trackingNo,itemGroups]) => {
    const items: OutboundPickingItem[] = [...itemGroups.entries()].map(([barcode,rows]) => {
      const targetIds = barcodeTargets.get(barcode) ?? []; const product = targetIds.length === 1 ? productsById.get(targetIds[0]) : undefined;
      const locationRows = product ? inventory.filter((row) => row.productId === product.id && row.qty > 0).sort((a,b) => b.qty-a.qty) : [];
      return { id: uid(), productId: product?.id, productBarcode: rows[0].productBarcode, artist: product?.artist ?? "상품 확인 필요", nameVer: product?.nameVer ?? (targetIds.length > 1 ? "공통 바코드 상품 선택 필요" : "미등록 88바코드"), requiredQty: rows.reduce((sum,row) => sum+row.requiredQty,0), pickedQty: 0, locations: locationRows.map((row) => ({ locationCode: row.locationCode, qty: row.qty })), resolution: targetIds.length > 1 ? "AMBIGUOUS" : product ? "MATCHED" : "UNREGISTERED" };
    });
    return { id: uid(), trackingNo, items, manualQuantityAllowed: false, status: items.some((item) => item.resolution !== "MATCHED") ? "REVIEW" : "READY" };
  });
  return { id: uid(), name, createdAt: new Date().toISOString(), status: shipments.some((shipment) => shipment.status === "REVIEW") ? "DRAFT" : "READY", shipments };
}

function OutboundProgressContent() {
  const { user } = useUser(); const isAdmin = user?.role === "admin";
  const [jobs,setJobs] = useState<OutboundJob[]>([]); const [selectedJobId,setSelectedJobId] = useState("");
  const [activeShipmentId,setActiveShipmentId] = useState(""); const [scanner,setScanner] = useState(""); const [focus,setFocus] = useState<FocusState>(null);
  const [manualQty,setManualQty] = useState(""); const [creating,setCreating] = useState(false); const [busy,setBusy] = useState(false);
  const [feedback,setFeedback] = useState<{kind:"success"|"error"|"info"|"warning";title:string;body?:string}|null>(null);
  const scannerRef = useRef<HTMLInputElement>(null); const focusTimer = useRef<number | null>(null);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;
  const activeShipment = selectedJob?.shipments.find((shipment) => shipment.id === activeShipmentId) ?? null;
  const refocus = () => window.setTimeout(() => scannerRef.current?.focus(),20);

  function showFocus(item: OutboundPickingItem, kind: NonNullable<FocusState>["kind"], timeout = 0) {
    if (focusTimer.current) window.clearTimeout(focusTimer.current); setFocus({ item, kind });
    if (timeout) focusTimer.current = window.setTimeout(() => { setFocus(null); refocus(); },timeout);
  }
  function updateShipment(shipmentId: string, updater: (shipment: OutboundShipment) => OutboundShipment) {
    setJobs((current) => current.map((job) => job.id !== selectedJobId ? job : ({ ...job, status: "IN_PROGRESS", shipments: job.shipments.map((shipment) => shipment.id === shipmentId ? updater(shipment) : shipment) })));
  }
  function startShipment(shipment: OutboundShipment) {
    if (shipment.status === "REVIEW") { playTone("ERROR"); setFeedback({kind:"error",title:"확인 필요 운송장입니다.",body:"미등록 또는 공통 바코드를 먼저 정리하세요."}); return; }
    setActiveShipmentId(shipment.id); updateShipment(shipment.id,(current) => ({...current,status:current.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS",assignedWorker:user?.displayName}));
    setFeedback({kind:"info",title:`${shipment.trackingNo} 피킹 시작`,body:`${shipment.items.length}개 품목을 연속 스캔하세요.`}); refocus();
  }
  function scanItem(raw: string) {
    if (!activeShipment) return; const barcode = normalizeBarcode(raw);
    const item = activeShipment.items.find((candidate) => normalizeBarcode(candidate.productBarcode) === barcode);
    if (!item) { playTone("ERROR"); setFeedback({kind:"error",title:"이 운송장에 없는 상품입니다.",body:raw}); refocus(); return; }
    if (item.pickedQty >= item.requiredQty) { playTone("ERROR"); showFocus(item,"EXCESS",850); return; }
    const nextQty = item.pickedQty + 1; const completed = nextQty === item.requiredQty;
    const nextItem = {...item,pickedQty:nextQty};
    updateShipment(activeShipment.id,(shipment) => { const items = shipment.items.map((candidate) => candidate.id === item.id ? nextItem : candidate); return {...shipment,items,status:items.every((candidate) => candidate.pickedQty === candidate.requiredQty) ? "COMPLETED" : "IN_PROGRESS"}; });
    playTone(completed ? "COMPLETE" : "SCAN"); showFocus(nextItem,completed ? "COMPLETE" : "PICKING",completed ? 950 : 0); refocus();
  }
  function submitScan(event: React.FormEvent) {
    event.preventDefault(); const value = scanner.trim(); setScanner(""); if (!value) return;
    if (!activeShipment) { const shipment = selectedJob?.shipments.find((candidate) => normalizeBarcode(candidate.trackingNo) === normalizeBarcode(value)); if (!shipment) { playTone("ERROR"); setFeedback({kind:"error",title:"출고 작업에 없는 운송장입니다.",body:value}); } else startShipment(shipment); return; }
    scanItem(value);
  }
  function applyManualQuantity() {
    if (!activeShipment || !focus || !activeShipment.manualQuantityAllowed) return; const add = Number(manualQty);
    if (!Number.isInteger(add) || add < 1 || focus.item.pickedQty + add > focus.item.requiredQty) { playTone("ERROR"); showFocus(focus.item,"EXCESS",850); return; }
    const nextItem = {...focus.item,pickedQty:focus.item.pickedQty+add}; const completed = nextItem.pickedQty === nextItem.requiredQty;
    updateShipment(activeShipment.id,(shipment) => { const items=shipment.items.map((item)=>item.id===nextItem.id?nextItem:item); return {...shipment,items,status:items.every((item)=>item.pickedQty===item.requiredQty)?"COMPLETED":"IN_PROGRESS"}; });
    setManualQty(""); playTone(completed?"COMPLETE":"SCAN"); showFocus(nextItem,completed?"COMPLETE":"PICKING",completed?950:0); refocus();
  }
  async function upload(file: File) {
    setBusy(true); setFeedback(null); try { const rows=await parseOutboundWorkbook(file); const job=await buildJob(file.name.replace(/\.xlsx?$/i,""),rows); setJobs((current)=>[job,...current]); setSelectedJobId(job.id); setCreating(false); setFeedback({kind:job.status==="READY"?"success":"warning",title:"출고 작업 생성 완료",body:`운송장 ${job.shipments.length}건 · ${rows.length}개 원본 행`}); } catch(cause){setFeedback({kind:"error",title:"엑셀 업로드 실패",body:cause instanceof Error?cause.message:"오류"});} finally{setBusy(false);}
  }
  const counts=useMemo(()=>selectedJob?{total:selectedJob.shipments.length,done:selectedJob.shipments.filter((item)=>item.status==="COMPLETED").length,review:selectedJob.shipments.filter((item)=>item.status==="REVIEW").length}:null,[selectedJob]);
  return <div className="page-stack">
    <section className="section-heading"><div><p className="eyebrow">OUTBOUND PROGRESS PILOT</p><h2>출고 진행</h2><p className="muted">운송장 스캔 후 화면 터치 없이 상품 바코드를 연속 검수하는 독립 파일럿입니다.</p></div><div className={styles.headerActions}><button className="button button-secondary" onClick={()=>{const job=sampleJob();setJobs((current)=>[job,...current]);setSelectedJobId(job.id);}}>샘플 작업 열기</button><button className="button button-primary" onClick={()=>setCreating(true)}>새로 만들기</button></div></section>
    {feedback?<Feedback kind={feedback.kind} title={feedback.title}>{feedback.body}</Feedback>:null}
    {creating?<section className="panel"><div className="section-heading"><div><h3>출고 엑셀 업로드</h3><p className="muted">운송장번호·88바코드·수량 컬럼을 자동 인식합니다.</p></div><button className="button button-ghost" onClick={()=>setCreating(false)}>취소</button></div><input type="file" accept=".xlsx,.xls" disabled={busy} onChange={(event)=>{const file=event.target.files?.[0];if(file)void upload(file);}} /></section>:null}
    {jobs.length?<section className="panel"><div className="section-heading"><h3>출고 작업</h3></div><div className={styles.shipmentList}>{jobs.map((job)=><button className={`button ${selectedJobId===job.id?"button-primary":"button-secondary"}`} key={job.id} onClick={()=>{setSelectedJobId(job.id);setActiveShipmentId("");setFocus(null);}}>{job.name} · 운송장 {job.shipments.length}건</button>)}</div></section>:<section className="panel empty-state">새 출고 작업을 만들거나 샘플 작업을 열어 파일럿 화면을 확인하세요.</section>}
    {selectedJob&&counts?<><section className={styles.jobGrid}><article className="metric-card"><span>전체 운송장</span><strong>{counts.total}</strong></article><article className="metric-card"><span>완료</span><strong>{counts.done}</strong></article><article className="metric-card"><span>진행·대기</span><strong>{counts.total-counts.done-counts.review}</strong></article><article className="metric-card"><span>확인 필요</span><strong>{counts.review}</strong></article></section>
      <section className={`panel ${styles.scanPanel}`}><form onSubmit={submitScan}><label>{activeShipment?"상품 바코드 연속 스캔":"운송장번호 스캔"}<input ref={scannerRef} autoFocus className={styles.scanInput} value={scanner} onChange={(event)=>setScanner(event.target.value)} placeholder={activeShipment?"상품 바코드를 계속 스캔하세요":"운송장 바코드를 스캔하세요"} /></label></form>{activeShipment?<div className={styles.toolbar}><strong>{activeShipment.trackingNo}</strong><span className="status-badge active">{activeShipment.assignedWorker||"작업자"} 피킹 중</span><button className="button button-secondary button-compact" onClick={()=>{setActiveShipmentId("");setFocus(null);refocus();}}>운송장 닫기</button>{isAdmin?<button className={`button button-compact ${activeShipment.manualQuantityAllowed?"button-danger":"button-secondary"}`} onClick={()=>updateShipment(activeShipment.id,(shipment)=>({...shipment,manualQuantityAllowed:!shipment.manualQuantityAllowed}))}>직접 수량 입력 {activeShipment.manualQuantityAllowed?"허용됨":"차단됨"}</button>:null}</div>:null}</section>
      {activeShipment?<section className="panel"><div className="section-heading"><div><h3>필요 물품</h3><p className="muted">품목을 스캔하면 집중 화면으로 전환됩니다. 다른 품목을 찍으면 해당 품목으로 즉시 전환됩니다.</p></div></div><div className={styles.itemList}>{activeShipment.items.map((item)=><article className={`${styles.item} ${item.pickedQty===item.requiredQty?styles.itemComplete:""}`} key={item.id}><div><strong>{item.artist} · {item.nameVer}</strong><div className={styles.locations}>{item.locations.length?item.locations.map((location)=><span className="status-badge" key={location.locationCode}>{location.locationCode} · {location.qty}</span>):<span className="inline-error">재고 LOC 없음</span>}</div></div><code>{item.productBarcode}</code><strong>{item.pickedQty}/{item.requiredQty}</strong></article>)}</div></section>:
      <section className="panel"><div className="section-heading"><h3>운송장 목록</h3></div><div className={styles.shipmentList}>{selectedJob.shipments.map((shipment)=><article className={styles.shipment} key={shipment.id}><div className={styles.shipmentHeading}><div><strong>{shipment.trackingNo}</strong><p className="muted small">{shipment.items.length}개 품목 · {shipment.items.reduce((sum,item)=>sum+item.requiredQty,0)}개</p></div><div className="row-actions"><span className={`status-badge ${shipment.status==="COMPLETED"?"success":shipment.status==="REVIEW"?"inactive":"active"}`}>{shipment.status}</span><button className="button button-primary button-compact" disabled={shipment.status==="REVIEW"} onClick={()=>startShipment(shipment)}>운송장 열기</button></div></div></article>)}</div></section>}</>:null}
    {focus&&activeShipment?<div className={styles.focusBackdrop}><section className={`${styles.focusCard} ${focus.kind==="EXCESS"?styles.warningFlash:focus.kind==="COMPLETE"?styles.completeCard:""}`}><p className="eyebrow">{focus.kind==="EXCESS"?"수량 초과":focus.kind==="COMPLETE"?"품목 피킹 완료":"PICKING"}</p><h2>{focus.item.artist} · {focus.item.nameVer}</h2><div className={styles.focusCount}>{focus.item.pickedQty}/{focus.item.requiredQty}</div><div className={`${styles.progressBar} ${focus.kind==="COMPLETE"?styles.completedBar:""}`}><span style={{width:`${focus.item.pickedQty/focus.item.requiredQty*100}%`}} /></div><div className={styles.focusMeta}>{focus.item.locations.map((location)=><span className="status-badge" key={location.locationCode}>{location.locationCode}</span>)}</div>{focus.kind==="EXCESS"?<h3>이미 필요한 수량을 모두 피킹했습니다.</h3>:null}{activeShipment.manualQuantityAllowed&&focus.kind==="PICKING"?<div className={styles.manualBox}><input type="number" min={1} max={focus.item.requiredQty-focus.item.pickedQty} value={manualQty} onChange={(event)=>setManualQty(event.target.value)} placeholder="추가 수량"/><button className="button button-primary" onClick={applyManualQuantity}>수량 반영</button></div>:null}<button className="button button-ghost" onClick={()=>{setFocus(null);refocus();}}>닫기</button></section></div>:null}
  </div>;
}

export default function OutboundProgressPage(){return <PermissionGuard permission="scan_inventory"><OutboundProgressContent/></PermissionGuard>;}
