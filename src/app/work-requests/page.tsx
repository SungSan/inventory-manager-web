"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PermissionGuard } from "@/components/permission-guard";
import { useUser } from "@/components/user-provider";
import { listProducts, subscribeToInventory } from "@/lib/inventory-api";
import type { Product } from "@/types/domain";
import {
  createWorkRequest,
  listBusinessCalendar,
  listWorkRequestAssignees,
  listWorkRequestDocuments,
  listWorkRequests,
  type BusinessCalendarEntry,
  type WorkRequest,
  type WorkRequestAssignee,
  type WorkRequestDocumentSummary,
  type WorkRequestHeaderInput,
  type WorkRequestProductInput,
} from "@/lib/work-request-api";
import styles from "./work-requests.module.css";

type Tab = "new" | "own" | "work" | "all" | "documents";
const statusLabel: Record<WorkRequest["status"], string> = { SCHEDULED:"작업 전",IN_PROGRESS:"작업 중",PARTIAL:"작업 중",COMPLETED:"작업 완료",REJECTED:"반려",REQUESTER_CANCELLED:"요청자 삭제",VOIDED:"관리자 무효" };

function dateText(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function addDays(date: Date,days:number):Date{const next=new Date(date);next.setDate(next.getDate()+days);return next;}

function WorkRequestsContent() {
  const { user } = useUser();
  const [tab,setTab]=useState<Tab>(user?.role==="viewer"?"new":"work");
  const [requests,setRequests]=useState<WorkRequest[]>([]);
  const [documents,setDocuments]=useState<WorkRequestDocumentSummary[]>([]);
  const [header,setHeader]=useState<WorkRequestHeaderInput>({requestedShipDate:"",vendorName:"",vendorContact:"",vendorPhone:"",vendorAddress:"",purpose:"",note:""});
  const [selected,setSelected]=useState<Array<{product:Product;qty:number}>>([]);
  const [productKeyword,setProductKeyword]=useState("");
  const [productResults,setProductResults]=useState<Product[]>([]);
  const [assignees,setAssignees]=useState<WorkRequestAssignee[]>([]);
  const [candidateIds,setCandidateIds]=useState<string[]>([]);
  const [search,setSearch]=useState("");
  const [dateFrom,setDateFrom]=useState("");
  const [dateTo,setDateTo]=useState("");
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");

  const loadRequests=useCallback(async()=>{
    try{
      const scope=tab==="own"?"OWN":tab==="work"?"WORK":"ALL";
      if(tab!=="new"&&tab!=="documents")setRequests(await listWorkRequests(scope,tab==="all"));
      setError("");
    }catch(cause){setError(cause instanceof Error?cause.message:"업무요청을 불러오지 못했습니다.");}
    finally{setLoading(false);}
  },[tab]);

  useEffect(()=>{void loadRequests();return subscribeToInventory(()=>void loadRequests());},[loadRequests]);

  useEffect(()=>{
    const prepare=async()=>{
      const today=new Date();
      const end=addDays(today,45);
      const overrides: BusinessCalendarEntry[] = await listBusinessCalendar(dateText(today),dateText(end)).catch(()=>[]);
      const overrideMap = new Map<string, boolean>(overrides.map((item) => [item.businessDate, item.isWorkingDay] as const));
      let cursor=new Date(today.getFullYear(),today.getMonth(),today.getDate());
      let steps=today.getHours()>=15?2:1;
      while(steps>0){cursor=addDays(cursor,1);const key=dateText(cursor);const weekday=cursor.getDay();const working=overrideMap.has(key)?Boolean(overrideMap.get(key)):weekday!==0&&weekday!==6;if(working)steps-=1;}
      setHeader((current)=>current.requestedShipDate?current:{...current,requestedShipDate:dateText(cursor)});
    };
    void prepare();
  },[]);

  useEffect(()=>{
    if(!productKeyword.trim()){setProductResults([]);return;}
    const timer=window.setTimeout(()=>void listProducts(productKeyword,false).then((items)=>setProductResults(items.slice(0,30))).catch((cause)=>setError(cause instanceof Error?cause.message:"상품 검색 실패")),200);
    return()=>window.clearTimeout(timer);
  },[productKeyword]);

  const itemInput=useMemo<WorkRequestProductInput[]>(()=>selected.map((item)=>({productId:item.product.id,qty:item.qty})),[selected]);
  const totalQty=useMemo(()=>selected.reduce((sum,item)=>sum+item.qty,0),[selected]);

  useEffect(()=>{
    if(!header.requestedShipDate){setAssignees([]);return;}
    const timer=window.setTimeout(()=>void listWorkRequestAssignees(header.requestedShipDate,selected.length,totalQty).then(setAssignees).catch((cause)=>setError(cause instanceof Error?cause.message:"담당자 KPI를 불러오지 못했습니다.")),150);
    return()=>window.clearTimeout(timer);
  },[header.requestedShipDate,selected.length,totalQty]);

  useEffect(()=>{setCandidateIds((current)=>current.filter((id)=>assignees.some((item)=>item.userId===id&&item.canAccept)));},[assignees]);

  useEffect(()=>{
    if(tab!=="documents")return;
    const timer=window.setTimeout(()=>void listWorkRequestDocuments(search,dateFrom,dateTo).then(setDocuments).catch((cause)=>setError(cause instanceof Error?cause.message:"명세서 조회 실패")),200);
    return()=>window.clearTimeout(timer);
  },[tab,search,dateFrom,dateTo]);

  function addProduct(product:Product){setSelected((current)=>current.some((item)=>item.product.id===product.id)?current:[...current,{product,qty:1}]);setProductKeyword("");setProductResults([]);}
  function setQty(productId:string,qty:number){setSelected((current)=>current.map((item)=>item.product.id===productId?{...item,qty:Math.max(1,Math.trunc(qty||1))}:item));}

  async function submit(){
    if(!header.vendorName.trim()){setError("외부업체명을 입력하세요.");return;}
    if(selected.length===0){setError("요청 상품을 1개 이상 추가하세요.");return;}
    if(candidateIds.length===0){setError("KPI 여유가 있는 담당 작업자를 1명 이상 선택하세요.");return;}
    setBusy(true);setError("");setMessage("");
    try{
      const created=await createWorkRequest(header,candidateIds,itemInput);
      setMessage(`${created.requestNo} 업무요청을 등록했습니다. 요청 단계에서는 재고가 차감되지 않습니다.`);
      setHeader((current)=>({...current,vendorName:"",vendorContact:"",vendorPhone:"",vendorAddress:"",purpose:"",note:""}));
      setSelected([]);setCandidateIds([]);setTab("own");await loadRequests();
    }catch(cause){setError(cause instanceof Error?cause.message:"업무요청 등록 실패");}
    finally{setBusy(false);}
  }

  const visibleTabs:Tab[]=["new","own",...(user?.role!=="viewer"?["work" as Tab]:[]),...(user?.role==="admin"||user?.role==="manager"?["all" as Tab]:[]),"documents"];
  const tabLabel:Record<Tab,string>={new:"새 출고요청",own:"내 요청",work:"내 작업함",all:"전체 요청",documents:"출고명세서"};

  return <div className={`page-stack ${styles.page}`}>
    <section className="section-heading"><div><p className="eyebrow">WORK REQUESTS</p><h2>업무요청</h2><p className="muted">조회자는 외부이관 형식으로 출고를 요청하고, 배정 작업자가 실제 상품·LOC 바코드를 스캔한 수량만 재고에서 차감합니다.</p></div>{user?.role==="admin"?<Link className="button button-secondary" href="/work-requests/admin">KPI·휴무일 설정</Link>:null}</section>
    <div className={styles.tabs}>{visibleTabs.map((item)=><button key={item} className={tab===item?styles.active:""} onClick={()=>{setLoading(true);setTab(item);}}>{tabLabel[item]}</button>)}</div>
    {error?<p className="inline-error">{error}</p>:null}{message?<div className="feedback feedback-success"><strong>{message}</strong></div>:null}

    {tab==="new"?<>
      <section className="panel page-stack">
        <div className="section-heading"><div><p className="eyebrow">REQUEST HEADER</p><h3>출고요청 정보</h3></div><span className="status-badge active">요청 시 재고 차감 없음</span></div>
        <p className={styles.notice}>당일 출고는 불가능합니다. 15시 이전에는 다음 영업일부터, 15시 이후에는 두 번째 영업일부터 요청할 수 있습니다. 토·일요일, 공휴일 및 관리자 지정 휴무일은 자동 제외됩니다.</p>
        <div className={styles.formGrid}>
          <label>요청 출고일 *<input type="date" value={header.requestedShipDate} onChange={(event)=>setHeader({...header,requestedShipDate:event.target.value})}/></label>
          <label>외부업체명 *<input value={header.vendorName} onChange={(event)=>setHeader({...header,vendorName:event.target.value})} placeholder="수령 업체 또는 행사명"/></label>
          <label>외부 담당자<input value={header.vendorContact} onChange={(event)=>setHeader({...header,vendorContact:event.target.value})}/></label>
          <label>연락처<input value={header.vendorPhone} onChange={(event)=>setHeader({...header,vendorPhone:event.target.value})}/></label>
          <label className={styles.spanTwo}>주소<input value={header.vendorAddress} onChange={(event)=>setHeader({...header,vendorAddress:event.target.value})}/></label>
          <label>출고 목적<input value={header.purpose} onChange={(event)=>setHeader({...header,purpose:event.target.value})}/></label>
          <label>비고<input value={header.note} onChange={(event)=>setHeader({...header,note:event.target.value})}/></label>
        </div>
      </section>

      <section className="panel page-stack">
        <div className="section-heading"><div><p className="eyebrow">REQUEST ITEMS</p><h3>요청 상품</h3></div><strong>{selected.length} SKU · {totalQty.toLocaleString()}개</strong></div>
        <div className={styles.productSearch}><input value={productKeyword} onChange={(event)=>setProductKeyword(event.target.value)} placeholder="상품명, 아티스트, CODE_NO 검색"/><button className="button button-secondary" onClick={()=>setProductKeyword(productKeyword.trim())}>검색</button></div>
        {productResults.length>0?<div className={styles.searchResults}>{productResults.map((product)=><div key={product.id} className={styles.searchRow}><div><strong>{product.artist} · {product.nameVer}</strong><p>{product.pCodeNo||"-"} · {product.codeNo}</p></div><span></span><button className="button button-secondary button-compact" onClick={()=>addProduct(product)}>추가</button></div>)}</div>:null}
        <div className={styles.products}>{selected.map((item)=><div key={item.product.id} className={styles.selectedRow}><div><strong>{item.product.artist} · {item.product.nameVer}</strong><p>{item.product.pCodeNo||"-"} · {item.product.codeNo}</p></div><input type="number" min={1} value={item.qty} onChange={(event)=>setQty(item.product.id,Number(event.target.value))}/><button className="button button-secondary button-compact" onClick={()=>setSelected((current)=>current.filter((row)=>row.product.id!==item.product.id))}>제거</button></div>)}</div>
      </section>

      <section className="panel page-stack">
        <div className="section-heading"><div><p className="eyebrow">ASSIGNEES & KPI</p><h3>담당 작업자 선택</h3></div><span className="muted">1명 지정 또는 여러 후보 지정 가능</span></div>
        <div className={styles.assigneeGrid}>{assignees.map((item)=><label key={item.userId} className={`${styles.assignee} ${!item.canAccept?styles.unavailable:""}`}><input type="checkbox" checked={candidateIds.includes(item.userId)} disabled={!item.canAccept} onChange={(event)=>setCandidateIds((current)=>event.target.checked?[...current,item.userId]:current.filter((id)=>id!==item.userId))}/><span className={styles.assigneeText}><strong>{item.userName} · {item.role}</strong><small>{item.metricType} · 한도 {item.dailyCapacity} / 사용 {item.usedCapacity} / 신규 {item.newRequestLoad}</small><small>{item.canAccept?`배정 후 잔여 ${item.remainingAfter}`:"해당 날짜 KPI 초과"}</small></span></label>)}</div>
        <button className="button button-primary" onClick={()=>void submit()} disabled={busy}>{busy?"요청 등록 중...":"출고 업무요청 등록"}</button>
      </section>
    </>:null}

    {tab!=="new"&&tab!=="documents"?<section className="panel page-stack"><div className="section-heading"><div><p className="eyebrow">REQUEST LIST</p><h3>{tabLabel[tab]}</h3></div><button className="button button-secondary button-compact" onClick={()=>void loadRequests()}>새로고침</button></div>{loading?<p className="empty-state">업무요청을 불러오는 중입니다.</p>:null}<div className={styles.requestList}>{requests.map((request)=>{
      const statusClass=request.status==="SCHEDULED"?styles.statusScheduled:request.status==="IN_PROGRESS"||request.status==="PARTIAL"?styles.statusProgress:request.status==="COMPLETED"?styles.statusCompleted:styles.statusClosed;
      return <article key={request.id} className={styles.requestCard}><div><span className={`status-badge ${statusClass}`}>{statusLabel[request.status]}</span><h3>{request.requestNo} · {request.vendorName}</h3><p>{request.purpose||"출고 목적 미입력"}</p><p>요청자 {request.requesterName} · 담당 {request.assignedName||request.reservedUserName||"후보 선점 대기"}</p></div><div className={styles.metrics}><span><small>출고일</small><strong>{request.requestedShipDate}</strong></span><span><small>SKU</small><strong>{request.itemCount}</strong></span><span><small>수량</small><strong>{request.totalQty}</strong></span></div><Link className="button button-primary" href={`/work-requests/${request.id}`}>상세·처리</Link></article>;
    })}</div>{!loading&&requests.length===0?<p className="empty-state">표시할 업무요청이 없습니다.</p>:null}</section>:null}

    {tab==="documents"?<><section className={`panel ${styles.documentFilters}`}><label>검색<input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="문서번호, 요청번호, 업체, 요청자, 작업자"/></label><label>시작일<input type="date" value={dateFrom} onChange={(event)=>setDateFrom(event.target.value)}/></label><label>종료일<input type="date" value={dateTo} onChange={(event)=>setDateTo(event.target.value)}/></label><button className="button button-secondary" onClick={()=>void listWorkRequestDocuments(search,dateFrom,dateTo).then(setDocuments)}>조회</button></section><section className="panel"><div className="table-wrap"><table><thead><tr><th>출고일</th><th>문서번호</th><th>요청번호</th><th>외부업체</th><th>요청자</th><th>작업자</th><th>SKU</th><th>수량</th><th>명세서</th></tr></thead><tbody>{documents.map((item)=><tr key={item.id}><td>{item.shipmentDate}</td><td><strong>{item.documentNo}</strong></td><td>{item.requestNo}</td><td>{item.vendorName}</td><td>{item.requesterName}</td><td>{item.workerName}</td><td>{item.totalSku}</td><td><strong>{item.totalQty}</strong></td><td><Link className="button button-secondary button-compact" href={`/work-requests/documents/${item.id}`}>조회·출력</Link></td></tr>)}</tbody></table></div>{documents.length===0?<p className="empty-state">조회된 출고명세서가 없습니다.</p>:null}</section></>:null}
  </div>;
}

export default function WorkRequestsPage(){return <PermissionGuard permission="work_requests"><WorkRequestsContent/></PermissionGuard>;}
