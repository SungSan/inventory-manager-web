"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarcodeField } from "@/components/barcode-field";
import { PermissionGuard } from "@/components/permission-guard";
import { useUser } from "@/components/user-provider";
import { listProducts, resolveBarcodeCandidates, subscribeToInventory } from "@/lib/inventory-api";
import type { Product, ResolvedBarcode } from "@/types/domain";
import {
  adminVoidWorkRequest,
  approveWorkRequestChange,
  cancelWorkRequest,
  getWorkRequest,
  listWorkRequestAssignees,
  reassignWorkRequest,
  rejectWorkRequestChange,
  scanWorkRequestItem,
  startWorkRequest,
  submitWorkRequestChange,
  updateWorkRequestBeforeStart,
  type WorkRequest,
  type WorkRequestAssignee,
  type WorkRequestHeaderInput,
} from "@/lib/work-request-api";
import styles from "../work-requests.module.css";

const statusLabel:Record<WorkRequest["status"],string>={SCHEDULED:"작업 전",IN_PROGRESS:"작업 중",PARTIAL:"부분 처리",COMPLETED:"작업 완료",REJECTED:"반려",REQUESTER_CANCELLED:"요청자 삭제",VOIDED:"관리자 무효"};
function productFromMatch(match:ResolvedBarcode):Product|null{return match.target.type==="product"&&"product" in match.target?match.target.product:null;}

function WorkRequestDetailContent(){
  const params=useParams<{id:string}>();
  const {user}=useUser();
  const [request,setRequest]=useState<WorkRequest|null>(null);
  const [editing,setEditing]=useState(false);
  const [header,setHeader]=useState<WorkRequestHeaderInput>({requestedShipDate:"",vendorName:""});
  const [editItems,setEditItems]=useState<Array<{product:Product;qty:number}>>([]);
  const [candidateIds,setCandidateIds]=useState<string[]>([]);
  const [assignees,setAssignees]=useState<WorkRequestAssignee[]>([]);
  const [productKeyword,setProductKeyword]=useState("");
  const [productResults,setProductResults]=useState<Product[]>([]);
  const [productBarcode,setProductBarcode]=useState("");
  const [locationBarcode,setLocationBarcode]=useState("");
  const [scannedProductId,setScannedProductId]=useState<string|undefined>();
  const [scannedLocationId,setScannedLocationId]=useState<string|undefined>();
  const [productChoices,setProductChoices]=useState<Array<{id:string;label:string}>>([]);
  const [scanQty,setScanQty]=useState(1);
  const [resetToken,setResetToken]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");

  const apply=useCallback((next:WorkRequest)=>{
    setRequest(next);
    setHeader({requestedShipDate:next.requestedShipDate,vendorName:next.vendorName,vendorContact:next.vendorContact,vendorPhone:next.vendorPhone,vendorAddress:next.vendorAddress,purpose:next.purpose,note:next.note});
    setEditItems(next.items.map((item)=>({product:{id:item.productId,scanTargetId:"",pCodeNo:item.pCodeNo,codeNo:item.codeNo,masterCodeNo:item.masterCodeNo,artist:item.artist,nameVer:item.nameVer,active:true},qty:item.requestedQty})));
    setCandidateIds(next.candidates.map((item)=>item.userId));
  },[]);
  const load=useCallback(async()=>{try{apply(await getWorkRequest(params.id));setError("");}catch(cause){setError(cause instanceof Error?cause.message:"업무요청을 불러오지 못했습니다.");}},[apply,params.id]);
  useEffect(()=>{void load();return subscribeToInventory(()=>void load());},[load]);

  const totalQty=useMemo(()=>editItems.reduce((sum,item)=>sum+item.qty,0),[editItems]);
  useEffect(()=>{if(!header.requestedShipDate)return;const timer=window.setTimeout(()=>void listWorkRequestAssignees(header.requestedShipDate,editItems.length,totalQty).then(setAssignees).catch(()=>undefined),150);return()=>window.clearTimeout(timer);},[header.requestedShipDate,editItems.length,totalQty]);
  useEffect(()=>{if(!productKeyword.trim()){setProductResults([]);return;}const timer=window.setTimeout(()=>void listProducts(productKeyword,false).then((items)=>setProductResults(items.slice(0,20))).catch(()=>undefined),180);return()=>window.clearTimeout(timer);},[productKeyword]);

  function addProduct(product:Product){setEditItems((current)=>current.some((item)=>item.product.id===product.id)?current:[...current,{product,qty:1}]);setProductKeyword("");setProductResults([]);}
  async function run(action:()=>Promise<WorkRequest>,success:string){setBusy(true);setError("");setMessage("");try{apply(await action());setMessage(success);setEditing(false);}catch(cause){setError(cause instanceof Error?cause.message:"처리하지 못했습니다.");}finally{setBusy(false);}}

  async function saveEdit(){
    if(!request)return;
    const items=editItems.map((item)=>({productId:item.product.id,qty:item.qty}));
    if(request.status==="SCHEDULED")await run(()=>updateWorkRequestBeforeStart(request.id,header,candidateIds,items),"업무요청을 수정했습니다.");
    else{
      const reason=window.prompt("배정 작업자에게 전달할 수정 사유를 입력하세요.","")??"";
      await run(()=>submitWorkRequestChange(request.id,header,items,reason),"수정 승인 요청을 배정 작업자에게 전달했습니다.");
    }
  }

  const scanProduct=useCallback(async(value:string):Promise<boolean>=>{
    setError("");
    try{
      const matches=await resolveBarcodeCandidates(value,"product","WORK_REQUEST_PRODUCT_SCAN");
      const products=matches.map(productFromMatch).filter((item):item is Product=>Boolean(item));
      if(products.length===0)throw new Error("등록된 상품 바코드를 찾을 수 없습니다.");
      setProductBarcode(value);
      if(products.length===1){setScannedProductId(products[0].id);setProductChoices([]);}
      else{setScannedProductId(undefined);setProductChoices(products.map((item)=>({id:item.id,label:`${item.artist} · ${item.nameVer} (${item.codeNo})`})));}
      return true;
    }catch(cause){setError(cause instanceof Error?cause.message:"상품 바코드 확인 실패");return false;}
  },[]);
  const scanLocation=useCallback(async(value:string):Promise<boolean>=>{
    setError("");
    try{
      const matches=await resolveBarcodeCandidates(value,"location","WORK_REQUEST_LOCATION_SCAN");
      if(matches.length!==1||matches[0].target.type!=="location"||!("location" in matches[0].target))throw new Error(matches.length>1?"중복된 로케이션 바코드입니다.":"등록된 LOC 바코드를 찾을 수 없습니다.");
      setLocationBarcode(value);setScannedLocationId(matches[0].target.location.id);return true;
    }catch(cause){setError(cause instanceof Error?cause.message:"LOC 바코드 확인 실패");return false;}
  },[]);

  async function processScan(){
    if(!request)return;
    if(!productBarcode||!locationBarcode||!scannedProductId||!scannedLocationId){setError("상품 바코드와 LOC 바코드를 모두 확인하세요.");return;}
    setBusy(true);setError("");setMessage("");
    try{
      const next=await scanWorkRequestItem({requestId:request.id,productBarcode,locationBarcode,qty:scanQty,productId:scannedProductId,locationId:scannedLocationId,idempotencyKey:crypto.randomUUID()});
      apply(next);setMessage(next.status==="COMPLETED"?"요청 수량 전체 출고가 완료되어 출고명세서를 생성했습니다.":`${scanQty.toLocaleString()}개를 출고 처리했습니다.`);
      setProductBarcode("");setLocationBarcode("");setScannedProductId(undefined);setScannedLocationId(undefined);setProductChoices([]);setScanQty(1);setResetToken((value)=>value+1);
    }catch(cause){setError(cause instanceof Error?cause.message:"출고 스캔 처리 실패");}
    finally{setBusy(false);}
  }

  if(!request)return <div className="page-stack"><Link className="text-link" href="/work-requests">← 업무요청</Link>{error?<p className="inline-error">{error}</p>:<div className="center-panel">업무요청을 불러오는 중입니다.</div>}</div>;
  const canManage=user?.role==="admin"||user?.role==="manager";
  const canEdit=request.isRequester&&(request.status==="SCHEDULED"||request.status==="IN_PROGRESS"||request.status==="PARTIAL");
  const canStart=request.status==="SCHEDULED"&&(request.isCandidate||request.isAssigned||canManage);
  const canScan=(request.status==="IN_PROGRESS"||request.status==="PARTIAL")&&request.isAssigned;
  const pendingChanges=request.changeRequests.filter((item)=>item.status==="PENDING");
  const progress=request.totalQty?Math.round(request.items.reduce((sum,item)=>sum+item.processedQty,0)/request.totalQty*100):0;

  return <div className={`page-stack ${styles.page}`}>
    <section className="section-heading"><div><Link className="text-link" href="/work-requests">← 업무요청 목록</Link><p className="eyebrow">{request.requestNo}</p><h2>{request.vendorName}</h2><p className="muted">요청자 {request.requesterName} ({request.requesterLoginId}) · 담당 {request.assignedName||request.reservedUserName||"후보 선점 대기"}</p></div><span className="status-badge active">{statusLabel[request.status]}</span></section>
    {error?<p className="inline-error">{error}</p>:null}{message?<div className="feedback feedback-success"><strong>{message}</strong></div>:null}

    <section className="metric-grid"><article className="metric-card"><span>요청 출고일</span><strong>{request.requestedShipDate}</strong></article><article className="metric-card"><span>처리 진행률</span><strong>{progress}%</strong></article><article className="metric-card"><span>요청 수량</span><strong>{request.totalQty.toLocaleString()}</strong></article><article className="metric-card"><span>처리 수량</span><strong>{request.items.reduce((sum,item)=>sum+item.processedQty,0).toLocaleString()}</strong></article></section>

    <section className="panel page-stack">
      <div className="section-heading"><div><p className="eyebrow">REQUEST DETAIL</p><h3>요청 정보</h3></div><div className="action-row">
        {canEdit?<button className="button button-secondary button-compact" onClick={()=>setEditing(!editing)}>{editing?"수정 닫기":request.status==="SCHEDULED"?"요청 수정":"수정 승인 요청"}</button>:null}
        {request.isRequester&&request.status==="SCHEDULED"?<button className="button button-secondary button-compact" onClick={()=>{const reason=window.prompt("삭제 사유를 입력하세요.","요청 취소");if(reason!==null&&window.confirm("작업 시작 전 요청을 삭제할까요? 기록은 영구 보존됩니다."))void run(()=>cancelWorkRequest(request.id,reason),"요청을 삭제 상태로 변경했습니다.");}}>요청 삭제</button>:null}
        {canStart?<button className="button button-primary button-compact" onClick={()=>void run(()=>startWorkRequest(request.id),"작업을 시작하고 담당자로 배정되었습니다.")}>작업 시작</button>:null}
        {user?.role==="admin"&&request.status!=="VOIDED"?<button className="button button-secondary button-compact" onClick={()=>{const reason=window.prompt("관리자 무효 처리 사유를 입력하세요.","");if(reason)void run(()=>adminVoidWorkRequest(request.id,reason),"업무요청을 무효 처리했습니다. 원본과 작업이력은 보존됩니다.");}}>관리자 무효</button>:null}
      </div></div>
      {!editing?<div className={styles.formGrid}><div><small className="muted">외부업체</small><p><strong>{request.vendorName}</strong></p></div><div><small className="muted">담당자·연락처</small><p>{request.vendorContact||"-"} · {request.vendorPhone||"-"}</p></div><div className={styles.spanTwo}><small className="muted">주소</small><p>{request.vendorAddress||"-"}</p></div><div><small className="muted">출고 목적</small><p>{request.purpose||"-"}</p></div><div><small className="muted">비고</small><p>{request.note||"-"}</p></div></div>:<>
        <p className={styles.notice}>{request.status==="SCHEDULED"?"작업 시작 전에는 요청자가 직접 수정할 수 있습니다.":"작업 중 수정은 바로 적용되지 않으며, 현재 배정 작업자가 승인해야 반영됩니다."}</p>
        <div className={styles.formGrid}><label>출고일<input type="date" value={header.requestedShipDate} onChange={(event)=>setHeader({...header,requestedShipDate:event.target.value})}/></label><label>외부업체<input value={header.vendorName} onChange={(event)=>setHeader({...header,vendorName:event.target.value})}/></label><label>담당자<input value={header.vendorContact||""} onChange={(event)=>setHeader({...header,vendorContact:event.target.value})}/></label><label>연락처<input value={header.vendorPhone||""} onChange={(event)=>setHeader({...header,vendorPhone:event.target.value})}/></label><label className={styles.spanTwo}>주소<input value={header.vendorAddress||""} onChange={(event)=>setHeader({...header,vendorAddress:event.target.value})}/></label><label>목적<input value={header.purpose||""} onChange={(event)=>setHeader({...header,purpose:event.target.value})}/></label><label>비고<input value={header.note||""} onChange={(event)=>setHeader({...header,note:event.target.value})}/></label></div>
        <div className={styles.productSearch}><input value={productKeyword} onChange={(event)=>setProductKeyword(event.target.value)} placeholder="수정 요청에 상품 추가 검색"/><span></span></div>
        {productResults.length>0?<div className={styles.searchResults}>{productResults.map((product)=><div key={product.id} className={styles.searchRow}><div><strong>{product.artist} · {product.nameVer}</strong><p>{product.codeNo}</p></div><span></span><button className="button button-secondary button-compact" onClick={()=>addProduct(product)}>추가</button></div>)}</div>:null}
        <div className={styles.products}>{editItems.map((item)=>{const processed=request.items.find((existing)=>existing.productId===item.product.id)?.processedQty??0;return <div key={item.product.id} className={styles.selectedRow}><div><strong>{item.product.artist} · {item.product.nameVer}</strong><p>이미 처리 {processed}개</p></div><input type="number" min={Math.max(1,processed)} value={item.qty} onChange={(event)=>setEditItems((current)=>current.map((row)=>row.product.id===item.product.id?{...row,qty:Math.max(processed,Number(event.target.value)||1)}:row))}/><button className="button button-secondary button-compact" disabled={processed>0} onClick={()=>setEditItems((current)=>current.filter((row)=>row.product.id!==item.product.id))}>제거</button></div>;})}</div>
        {request.status==="SCHEDULED"?<div className={styles.assigneeGrid}>{assignees.map((item)=><label key={item.userId} className={`${styles.assignee} ${!item.canAccept&&!candidateIds.includes(item.userId)?styles.unavailable:""}`}><input type="checkbox" checked={candidateIds.includes(item.userId)} disabled={!item.canAccept&&!candidateIds.includes(item.userId)} onChange={(event)=>setCandidateIds((current)=>event.target.checked?[...current,item.userId]:current.filter((id)=>id!==item.userId))}/><span className={styles.assigneeText}><strong>{item.userName}</strong><small>잔여 {item.remainingAfter} · {item.canAccept?"배정 가능":"KPI 초과"}</small></span></label>)}</div>:null}
        <button className="button button-primary" onClick={()=>void saveEdit()} disabled={busy}>{request.status==="SCHEDULED"?"수정 저장":"작업자에게 수정 승인 요청"}</button>
      </>}
    </section>

    {canManage&&request.status!=="COMPLETED"&&request.status!=="REQUESTER_CANCELLED"&&request.status!=="VOIDED"?<section className="panel"><div className="section-heading"><div><p className="eyebrow">REASSIGN</p><h3>담당 작업자 이관</h3></div></div><div className="action-row"><select defaultValue="" id="reassign-user"><option value="" disabled>새 담당자 선택</option>{assignees.filter((item)=>item.canAccept||item.userId===request.assignedTo).map((item)=><option key={item.userId} value={item.userId}>{item.userName} · 잔여 {item.remainingAfter}</option>)}</select><button className="button button-secondary" onClick={()=>{const select=document.getElementById("reassign-user") as HTMLSelectElement|null;const target=select?.value;if(!target)return;const reason=window.prompt("이관 사유를 입력하세요.","업무 재배정")??"";void run(()=>reassignWorkRequest(request.id,target,reason),"담당 작업자에게 업무를 이관했습니다.");}}>선택 작업자에게 이관</button></div></section>:null}

    {pendingChanges.length>0?<section className="panel page-stack"><div><p className="eyebrow">CHANGE APPROVAL</p><h3>수정 승인 대기</h3></div>{pendingChanges.map((change)=><article key={change.id} className={styles.requestCard}><div><strong>{change.requestedByName}의 수정 요청</strong><p>{change.reason||"사유 미입력"}</p><p>{new Date(change.requestedAt).toLocaleString("ko-KR")}</p></div><div><small>변경 출고일</small><strong>{String(change.proposedHeader.requested_ship_date||request.requestedShipDate)}</strong><p>{change.proposedItems.length} SKU</p></div>{request.isAssigned?<div className="action-row"><button className="button button-primary button-compact" onClick={()=>{const note=window.prompt("승인 메모","")??"";void run(()=>approveWorkRequestChange(change.id,note),"수정 요청을 승인했습니다.");}}>승인</button><button className="button button-secondary button-compact" onClick={()=>{const note=window.prompt("반려 사유","")??"";void run(()=>rejectWorkRequestChange(change.id,note),"수정 요청을 반려했습니다.");}}>반려</button></div>:<span className="muted">배정 작업자 승인 대기</span>}</article>)}</section>:null}

    {canScan?<section className="panel page-stack"><div className="section-heading"><div><p className="eyebrow">ACTUAL OUTBOUND SCAN</p><h3>실제 바코드 출고 처리</h3></div><span className="status-badge active">성공 스캔 수량만 즉시 차감</span></div><p className={styles.notice}>상품 바코드와 실제 출고 LOC 바코드를 확인한 뒤 수량을 처리합니다. 성공 시 기존 출고 거래가 생성되고 해당 수량만 재고에서 차감됩니다.</p><BarcodeField label="상품 바코드" placeholder="상품 바코드 촬영 또는 입력" value={productBarcode} onSubmit={scanProduct} disabled={busy} resetToken={resetToken}/>{productChoices.length>0?<label>공통 바코드 상품 선택<select value={scannedProductId||""} onChange={(event)=>setScannedProductId(event.target.value)}><option value="" disabled>정확한 상품/버전 선택</option>{productChoices.map((item)=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>:null}<BarcodeField label="출고 LOC 바코드" placeholder="실제 출고 위치 바코드 촬영 또는 입력" value={locationBarcode} onSubmit={scanLocation} disabled={busy} resetToken={resetToken}/><label>처리 수량<input type="number" min={1} value={scanQty} onChange={(event)=>setScanQty(Math.max(1,Number(event.target.value)||1))}/></label><button className="button button-primary" onClick={()=>void processScan()} disabled={busy||!scannedProductId||!scannedLocationId}>{busy?"출고 처리 중...":"스캔 수량 출고 확정"}</button></section>:null}

    <section className="panel page-stack"><div className="section-heading"><div><p className="eyebrow">ITEM PROGRESS</p><h3>품목별 처리 현황</h3></div>{request.documentId?<Link className="button button-secondary" href={`/work-requests/documents/${request.documentId}`}>출고명세서 조회·출력</Link>:null}</div><div className="table-wrap"><table><thead><tr><th>상품</th><th>CODE_NO</th><th>요청</th><th>처리</th><th>남음</th></tr></thead><tbody>{request.items.map((item)=><tr key={item.id}><td><strong>{item.artist} · {item.nameVer}</strong></td><td>{item.codeNo}</td><td>{item.requestedQty}</td><td><strong>{item.processedQty}</strong></td><td>{item.remainingQty}</td></tr>)}</tbody></table></div></section>
    {request.scans.length>0?<section className="panel"><div><p className="eyebrow">SCAN HISTORY</p><h3>실제 출고 스캔 이력</h3></div><div className="table-wrap"><table><thead><tr><th>처리 일시</th><th>상품</th><th>LOC</th><th>수량</th><th>작업자</th></tr></thead><tbody>{request.scans.map((scan)=>{const item=request.items.find((row)=>row.productId===scan.productId);return <tr key={scan.id}><td>{new Date(scan.scannedAt).toLocaleString("ko-KR")}</td><td>{item?`${item.artist} · ${item.nameVer}`:scan.productId}</td><td>{scan.locationCode}</td><td><strong>{scan.qty}</strong></td><td>{scan.scannedByName}</td></tr>;})}</tbody></table></div></section>:null}
  </div>;
}

export default function WorkRequestDetailPage(){return <PermissionGuard permission="work_requests"><WorkRequestDetailContent/></PermissionGuard>;}
