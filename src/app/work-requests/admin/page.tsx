"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PermissionGuard } from "@/components/permission-guard";
import {
  adminListWorkerKpi,
  adminSetBusinessCalendar,
  adminSetWorkerKpiOverride,
  adminUpsertWorkerKpi,
  listBusinessCalendar,
  type BusinessCalendarEntry,
  type KpiMetricType,
  type WorkerKpiStatus,
} from "@/lib/work-request-api";

function todayText(){return new Date().toISOString().slice(0,10);}

function WorkRequestAdminContent(){
  const [date,setDate]=useState(todayText());
  const [kpi,setKpi]=useState<WorkerKpiStatus[]>([]);
  const [calendar,setCalendar]=useState<BusinessCalendarEntry[]>([]);
  const [calendarFrom,setCalendarFrom]=useState(`${new Date().getFullYear()}-01-01`);
  const [calendarTo,setCalendarTo]=useState(`${new Date().getFullYear()+1}-12-31`);
  const [holidayDate,setHolidayDate]=useState(todayText());
  const [isWorkingDay,setIsWorkingDay]=useState(false);
  const [holidayName,setHolidayName]=useState("");
  const [holidayNote,setHolidayNote]=useState("");
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");

  const loadKpi=useCallback(async()=>{try{setKpi(await adminListWorkerKpi(date));setError("");}catch(cause){setError(cause instanceof Error?cause.message:"KPI를 불러오지 못했습니다.");}},[date]);
  const loadCalendar=useCallback(async()=>{try{setCalendar(await listBusinessCalendar(calendarFrom,calendarTo));setError("");}catch(cause){setError(cause instanceof Error?cause.message:"영업일을 불러오지 못했습니다.");}},[calendarFrom,calendarTo]);
  useEffect(()=>{void loadKpi();},[loadKpi]);
  useEffect(()=>{void loadCalendar();},[loadCalendar]);

  async function saveKpi(item:WorkerKpiStatus,metricType:KpiMetricType,capacity:number){setBusy(item.userId);try{await adminUpsertWorkerKpi(item.userId,metricType,capacity,true);setMessage(`${item.userName} 기본 KPI를 저장했습니다.`);await loadKpi();}catch(cause){setError(cause instanceof Error?cause.message:"KPI 저장 실패");}finally{setBusy("");}}
  async function saveOverride(item:WorkerKpiStatus){const raw=window.prompt(`${date} ${item.userName}의 예외 KPI를 입력하세요.`,String(item.overrideCapacity??item.dailyCapacity));if(raw==null)return;const reason=window.prompt("예외 사유를 입력하세요.","특정 일자 업무량 조정")??"";setBusy(item.userId);try{await adminSetWorkerKpiOverride(item.userId,date,Number(raw),reason);setMessage("날짜별 KPI 예외를 저장했습니다.");await loadKpi();}catch(cause){setError(cause instanceof Error?cause.message:"예외 KPI 저장 실패");}finally{setBusy("");}}
  async function saveCalendar(){setBusy("CAL");try{await adminSetBusinessCalendar(holidayDate,isWorkingDay,holidayName,holidayNote);setMessage(`${holidayDate}를 ${isWorkingDay?"특별 근무일":"휴무일"}로 저장했습니다.`);setHolidayName("");setHolidayNote("");await loadCalendar();}catch(cause){setError(cause instanceof Error?cause.message:"영업일 저장 실패");}finally{setBusy("");}}

  return <div className="page-stack">
    <section className="section-heading"><div><Link className="text-link" href="/work-requests">← 업무요청</Link><p className="eyebrow">WORK REQUEST ADMIN</p><h2>작업자 KPI·영업일 설정</h2><p className="muted">조회자를 제외한 관리자·매니저·작업자의 일일 한도를 설정합니다. 특정 날짜의 예약 업무량이 한도를 초과하면 신규 요청과 재배정이 서버에서 차단됩니다.</p></div></section>
    {error?<p className="inline-error">{error}</p>:null}{message?<div className="feedback feedback-success"><strong>{message}</strong></div>:null}

    <section className="panel page-stack">
      <div className="section-heading"><div><p className="eyebrow">DAILY KPI</p><h3>작업자 KPI</h3></div><label>조회 날짜<input type="date" value={date} onChange={(event)=>setDate(event.target.value)}/></label></div>
      <div className="table-wrap"><table><thead><tr><th>작업자</th><th>역할</th><th>KPI 기준</th><th>기본/적용 한도</th><th>예약 사용</th><th>잔여</th><th>설정</th></tr></thead><tbody>{kpi.map((item)=><KpiRow key={item.userId} item={item} busy={busy===item.userId} onSave={saveKpi} onOverride={saveOverride}/>)}</tbody></table></div>
      <div className="feedback feedback-info"><strong>WORKLOAD_POINTS 계산</strong><p>기본 5점 + SKU 1개당 2점 + 수량 10개당 1점입니다. 관리자 화면에서 요청 건수, SKU 수, 총수량 기준으로도 변경할 수 있습니다.</p></div>
    </section>

    <section className="panel page-stack">
      <div><p className="eyebrow">BUSINESS CALENDAR</p><h3>공휴일·회사 휴무일·특별 근무일</h3><p className="muted">주말은 기본 휴무입니다. 공휴일과 회사 휴무일을 등록하고, 주말 특별근무일은 ‘근무일’로 덮어쓸 수 있습니다.</p></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12,alignItems:"end"}}>
        <label>날짜<input type="date" value={holidayDate} onChange={(event)=>setHolidayDate(event.target.value)}/></label>
        <label>구분<select value={isWorkingDay?"WORK":"OFF"} onChange={(event)=>setIsWorkingDay(event.target.value==="WORK")}><option value="OFF">휴무일</option><option value="WORK">특별 근무일</option></select></label>
        <label>명칭<input value={holidayName} onChange={(event)=>setHolidayName(event.target.value)} placeholder="예: 회사 창립기념일"/></label>
        <label>비고<input value={holidayNote} onChange={(event)=>setHolidayNote(event.target.value)}/></label>
        <button className="button button-primary" onClick={()=>void saveCalendar()} disabled={busy==="CAL"}>영업일 저장</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:10,alignItems:"end"}}><label>조회 시작<input type="date" value={calendarFrom} onChange={(event)=>setCalendarFrom(event.target.value)}/></label><label>조회 종료<input type="date" value={calendarTo} onChange={(event)=>setCalendarTo(event.target.value)}/></label><button className="button button-secondary" onClick={()=>void loadCalendar()}>조회</button></div>
      <div className="table-wrap"><table><thead><tr><th>날짜</th><th>구분</th><th>명칭</th><th>출처</th><th>비고</th></tr></thead><tbody>{calendar.map((item)=><tr key={item.businessDate}><td>{item.businessDate}</td><td><span className={`status-badge ${item.isWorkingDay?"success":"inactive"}`}>{item.isWorkingDay?"근무일":"휴무일"}</span></td><td>{item.holidayName||"-"}</td><td>{item.source}</td><td>{item.note||"-"}</td></tr>)}</tbody></table></div>
    </section>
  </div>;
}

function KpiRow({item,busy,onSave,onOverride}:{item:WorkerKpiStatus;busy:boolean;onSave:(item:WorkerKpiStatus,metric:KpiMetricType,capacity:number)=>Promise<void>;onOverride:(item:WorkerKpiStatus)=>Promise<void>}){
  const [metric,setMetric]=useState<KpiMetricType>(item.metricType);
  const [capacity,setCapacity]=useState(item.dailyCapacity);
  useEffect(()=>{setMetric(item.metricType);setCapacity(item.dailyCapacity);},[item]);
  return <tr><td><strong>{item.userName}</strong></td><td>{item.role}</td><td><select value={metric} onChange={(event)=>setMetric(event.target.value as KpiMetricType)}><option value="WORKLOAD_POINTS">업무점수</option><option value="REQUEST_COUNT">요청 건수</option><option value="SKU_LINES">SKU 수</option><option value="TOTAL_QTY">총수량</option></select></td><td><input type="number" min={0} value={capacity} onChange={(event)=>setCapacity(Number(event.target.value))}/>{item.overrideCapacity!=null?<small className="muted"> · 예외 {item.overrideCapacity}</small>:null}</td><td>{item.usedCapacity}</td><td><strong>{item.remainingCapacity}</strong></td><td><div className="action-row"><button className="button button-secondary button-compact" disabled={busy} onClick={()=>void onSave(item,metric,capacity)}>기본 저장</button><button className="button button-secondary button-compact" disabled={busy} onClick={()=>void onOverride(item)}>날짜 예외</button></div></td></tr>;
}

export default function WorkRequestAdminPage(){return <PermissionGuard permission="manage_worker_kpi"><WorkRequestAdminContent/></PermissionGuard>;}
