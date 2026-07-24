"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PermissionGuard } from "@/components/permission-guard";
import { getWorkRequestDocument, type WorkRequestDocument } from "@/lib/work-request-api";

function WorkRequestDocumentContent(){
  const params=useParams<{id:string}>();
  const [document,setDocument]=useState<WorkRequestDocument|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{void getWorkRequestDocument(params.id).then(setDocument).catch((cause)=>setError(cause instanceof Error?cause.message:"출고명세서를 불러오지 못했습니다."));},[params.id]);
  if(!document)return <div className="page-stack"><Link className="text-link" href="/work-requests">← 업무요청</Link>{error?<p className="inline-error">{error}</p>:<div className="center-panel">출고명세서를 불러오는 중입니다.</div>}</div>;
  return <div className="page-stack shipment-document-page">
    <section className="section-heading no-print"><div><Link className="text-link" href={`/work-requests/${document.workRequestId}`}>← {document.requestNo}</Link><p className="eyebrow">WORK REQUEST SHIPMENT</p><h2>출고명세서</h2></div><button className="button button-primary" onClick={()=>window.print()}>인쇄</button></section>
    <article style={{background:"#fff",border:"1px solid #d0d5dd",padding:28,borderRadius:12}}>
      <header style={{display:"flex",justifyContent:"space-between",gap:20,borderBottom:"2px solid #111",paddingBottom:16,marginBottom:20}}><div><p style={{margin:0,fontSize:13,fontWeight:800}}>SAN WMS</p><h1 style={{margin:"5px 0"}}>출고명세서</h1><p style={{margin:0}}>{document.documentNo}</p></div><div style={{textAlign:"right"}}><p>출고일 {document.shipmentDate}</p><p>요청번호 {document.requestNo}</p></div></header>
      <table style={{width:"100%",borderCollapse:"collapse",marginBottom:20}}><tbody>
        <tr><th style={th}>외부업체</th><td style={td}>{document.vendorName}</td><th style={th}>담당자</th><td style={td}>{document.vendorContact||"-"}</td></tr>
        <tr><th style={th}>연락처</th><td style={td}>{document.vendorPhone||"-"}</td><th style={th}>출고 목적</th><td style={td}>{document.purpose||"-"}</td></tr>
        <tr><th style={th}>주소</th><td style={td} colSpan={3}>{document.vendorAddress||"-"}</td></tr>
        <tr><th style={th}>요청자</th><td style={td}>{document.requesterName} ({document.requesterLoginId})</td><th style={th}>처리 작업자</th><td style={td}>{document.workerName}</td></tr>
        <tr><th style={th}>비고</th><td style={td} colSpan={3}>{document.note||"-"}</td></tr>
      </tbody></table>
      <table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr><th style={th}>No.</th><th style={th}>상품</th><th style={th}>CODE_NO</th><th style={th}>바코드</th><th style={th}>출고 LOC</th><th style={th}>수량</th></tr></thead><tbody>{document.items.map((item)=><tr key={item.lineNo}><td style={td}>{item.lineNo}</td><td style={td}><strong>{item.artist}</strong><br/>{item.nameVer}</td><td style={td}>{item.codeNo}<br/><small>{item.pCodeNo||item.masterCodeNo}</small></td><td style={td}>{item.productBarcode||"-"}</td><td style={td}>{item.allocations.map((allocation)=><div key={`${item.lineNo}-${allocation.locationCode}`}>{allocation.locationCode} · {allocation.qty}</div>)}</td><td style={{...td,textAlign:"right",fontWeight:800}}>{item.qty.toLocaleString()}</td></tr>)}</tbody><tfoot><tr><th style={th} colSpan={4}>합계</th><th style={th}>{document.totalSku.toLocaleString()} SKU</th><th style={{...th,textAlign:"right"}}>{document.totalQty.toLocaleString()}</th></tr></tfoot></table>
      <footer style={{marginTop:24,fontSize:12,color:"#475467"}}>본 명세서는 SAN WMS 업무요청에서 배정 작업자가 실제 상품 및 LOC 바코드를 스캔하여 출고 처리한 수량을 기준으로 생성되었습니다.<br/>생성일시: {new Date(document.createdAt).toLocaleString("ko-KR")}</footer>
    </article>
    <style jsx global>{`@media print{.no-print,.topbar,.main-nav{display:none!important}.content{padding:0!important}.shipment-document-page{display:block!important}.shipment-document-page article{border:none!important;border-radius:0!important;padding:10mm!important}@page{size:A4 portrait;margin:8mm}}`}</style>
  </div>;
}
const th:React.CSSProperties={border:"1px solid #aab2bd",padding:"8px",background:"#f2f4f7",fontSize:12,textAlign:"left"};
const td:React.CSSProperties={border:"1px solid #aab2bd",padding:"8px",fontSize:12,verticalAlign:"top"};
export default function WorkRequestDocumentPage(){return <PermissionGuard permission="work_requests"><WorkRequestDocumentContent/></PermissionGuard>;}
