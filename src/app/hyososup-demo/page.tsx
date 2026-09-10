"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./demo.module.css";

type Role = "hq" | "manager" | "staff";
type View = "dashboard" | "inventory" | "orders" | "guide";
type Status = "요청" | "승인" | "준비 중" | "출고" | "입고 완료" | "반려";
type Order = { id:number; store:string; item:string; qty:number; needed:string; note:string; status:Status; by:string };
type State = { stock:Record<string,Record<string,number>>; orders:Order[] };

const stores = [
  { id:"gildong", name:"길동점", manager:"김지연" },
  { id:"ilsan", name:"일산점", manager:"박소연" },
  { id:"guri", name:"구리점", manager:"이민정" },
  { id:"bundang", name:"분당점", manager:"최은서" },
];
const items = [
  { id:"rice", name:"쌀겨", unit:"포", group:"핵심 재료", safe:5, target:12 },
  { id:"culture", name:"배양액", unit:"통", group:"핵심 재료", safe:4, target:10 },
  { id:"enzyme", name:"효소 분말", unit:"박스", group:"핵심 재료", safe:3, target:8 },
  { id:"robe", name:"찜질복", unit:"벌", group:"운영 비품", safe:12, target:30 },
  { id:"towel", name:"대형 타월", unit:"장", group:"운영 비품", safe:20, target:50 },
  { id:"tea", name:"웰컴티", unit:"박스", group:"고객 서비스", safe:3, target:8 },
  { id:"cleaner", name:"천연 세정제", unit:"통", group:"소모품", safe:4, target:10 },
];
const seed:State = {
  stock:{
    gildong:{rice:3,culture:5,enzyme:2,robe:24,towel:42,tea:2,cleaner:7},
    ilsan:{rice:9,culture:3,enzyme:6,robe:31,towel:18,tea:7,cleaner:8},
    guri:{rice:6,culture:8,enzyme:4,robe:14,towel:36,tea:5,cleaner:3},
    bundang:{rice:11,culture:6,enzyme:7,robe:27,towel:55,tea:6,cleaner:9},
  },
  orders:[
    {id:1042,store:"gildong",item:"rice",qty:10,needed:"2026-09-13",note:"주말 예약 증가 대비",status:"요청",by:"김지연"},
    {id:1041,store:"ilsan",item:"culture",qty:6,needed:"2026-09-12",note:"현재 재고 3통",status:"승인",by:"박소연"},
    {id:1040,store:"guri",item:"cleaner",qty:8,needed:"2026-09-11",note:"정기 보충",status:"출고",by:"이민정"},
    {id:1039,store:"bundang",item:"towel",qty:20,needed:"2026-09-10",note:"신규 타월 교체",status:"입고 완료",by:"최은서"},
  ]
};
const steps:Status[]=["요청","승인","준비 중","출고","입고 완료"];
const key="hyososup-demo-v1";
const clone=():State=>JSON.parse(JSON.stringify(seed)) as State;
const storeName=(id:string)=>stores.find(x=>x.id===id)?.name ?? id;
const itemOf=(id:string)=>items.find(x=>x.id===id) ?? items[0];

export default function HyososupDemo(){
  const [data,setData]=useState<State>(clone);
  const [role,setRole]=useState<Role>("hq");
  const [store,setStore]=useState("gildong");
  const [view,setView]=useState<View>("dashboard");
  const [guide,setGuide]=useState(true);
  const [message,setMessage]=useState("길동점에서 쌀겨 10포를 요청했습니다.");
  const [requestOpen,setRequestOpen]=useState(false);
  const [move,setMove]=useState<string|null>(null);
  const [moveQty,setMoveQty]=useState(1);
  const [draft,setDraft]=useState({item:"rice",qty:5,needed:"2026-09-15",note:""});
  const [ready,setReady]=useState(false);

  useEffect(()=>{document.title="효소숲 Store Hub 체험판";try{const saved=localStorage.getItem(key);if(saved)setData(JSON.parse(saved) as State);}catch{}setReady(true)},[]);
  useEffect(()=>{if(ready)localStorage.setItem(key,JSON.stringify(data))},[data,ready]);

  const visibleStores=role==="hq"?stores:stores.filter(x=>x.id===store);
  const visibleOrders=data.orders.filter(x=>role==="hq"||x.store===store);
  const total=useMemo(()=>visibleStores.reduce((a,s)=>a+items.reduce((b,i)=>b+(data.stock[s.id]?.[i.id]??0),0),0),[data,visibleStores]);
  const low=useMemo(()=>visibleStores.reduce((a,s)=>a+items.filter(i=>(data.stock[s.id]?.[i.id]??0)<=i.safe).length,0),[data,visibleStores]);
  const pending=visibleOrders.filter(x=>!["입고 완료","반려"].includes(x.status)).length;

  function reset(){if(confirm("모든 체험 데이터를 처음 상태로 되돌릴까요?")){setData(clone());setView("dashboard");setMessage("체험 데이터를 초기화했습니다.")}}
  function changeRole(value:Role){setRole(value);setView("dashboard");setMessage(value==="hq"?"본사 관리자 화면으로 전환했습니다.":`${storeName(store)} ${value==="manager"?"지점장":"직원"} 화면입니다.`)}
  function createRequest(e:React.FormEvent){e.preventDefault();const manager=stores.find(x=>x.id===store)?.manager??"지점장";const order:Order={id:Math.max(...data.orders.map(x=>x.id))+1,store,item:draft.item,qty:draft.qty,needed:draft.needed,note:draft.note||"재고 보충 요청",status:"요청",by:manager};setData(x=>({...x,orders:[order,...x.orders]}));setRequestOpen(false);setView("orders");setMessage(`본사 담당자에게 ${storeName(store)}의 ${itemOf(draft.item).name} 요청을 알렸습니다.`)}
  function setStatus(order:Order,status:Status){setData(current=>{let stock=current.stock;if(status==="입고 완료"&&order.status!=="입고 완료")stock={...stock,[order.store]:{...stock[order.store],[order.item]:(stock[order.store]?.[order.item]??0)+order.qty}};return{stock,orders:current.orders.map(x=>x.id===order.id?{...x,status}:x)}});setMessage(status==="입고 완료"?`${storeName(order.store)} 재고에 ${itemOf(order.item).name} ${order.qty}${itemOf(order.item).unit}가 반영됐습니다.`:`요청 #${order.id} 상태를 ‘${status}’로 변경했습니다.`)}
  function movement(kind:"in"|"use"){if(!move)return;const current=data.stock[store]?.[move]??0;if(kind==="use"&&current<moveQty){setMessage("현재 재고보다 많이 사용할 수 없습니다.");return}setData(x=>({...x,stock:{...x.stock,[store]:{...x.stock[store],[move]:kind==="in"?current+moveQty:current-moveQty}}}));setMessage(`${storeName(store)} ${itemOf(move).name} ${kind==="in"?"입고":"사용"} ${moveQty}${itemOf(move).unit}를 반영했습니다.`);setMove(null);setMoveQty(1)}

  return <main className={styles.app}>
    <header className={styles.header}><div className={styles.brand}><b>酵</b><span><strong>효소숲 Store Hub</strong><small>전 지점 재고와 수발주를 한곳에서</small></span></div><div className={styles.headerButtons}><i>INTERACTIVE DEMO</i><button onClick={()=>setGuide(true)}>체험 가이드</button><button onClick={reset}>초기화</button></div></header>
    <section className={styles.rolebar}><div><small>현재 역할</small><span className={styles.roles}>{(["hq","manager","staff"] as Role[]).map(x=><button key={x} className={role===x?styles.selected:""} onClick={()=>changeRole(x)}>{x==="hq"?"본사 관리자":x==="manager"?"지점장":"점포 직원"}</button>)}</span></div>{role!=="hq"?<label>담당 점포<select value={store} onChange={e=>setStore(e.target.value)}>{stores.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>:null}<p>{role==="hq"?"모든 점포 현황 · 수발주 승인 및 출고":role==="manager"?"담당 점포 재고 · 물품 요청 · 입고 확인":"담당 점포 입고 · 사용 등록"}</p></section>
    {message?<aside className={styles.toast}>●　{message}<button onClick={()=>setMessage("")}>×</button></aside>:null}
    <div className={styles.layout}><nav className={styles.nav}>{[["dashboard","▦","통합 현황"],["inventory","◫","점포별 재고"],["orders","⇄","수발주 관리"],["guide","?","도입 안내"]].map(([id,icon,label])=><button key={id} className={view===id?styles.navOn:""} onClick={()=>setView(id as View)}><b>{icon}</b>{label}{id==="orders"?<i>{pending}</i>:null}</button>)}<article><strong>재고가 부족해지기 전에</strong><p>각 점포가 직접 요청하고 본사가 한눈에 처리합니다.</p></article></nav>
      <section className={styles.content}>
        {view==="dashboard"?<><Title eyebrow="LIVE OVERVIEW" title={role==="hq"?"전체 점포 운영 현황":`${storeName(store)} 운영 현황`} body="오늘 필요한 일과 모든 재고를 한 화면에서 확인하세요." action={role!=="staff"?()=>setRequestOpen(true):undefined}/>
          <div className={styles.metrics}><Metric label="관리 점포" value={visibleStores.length} sub="개 점포 실시간 집계"/><Metric label="전체 재고" value={total} sub="등록 품목 합계"/><Metric label="안전재고 부족" value={low} sub="즉시 확인 필요" warn/><Metric label="진행 중 수발주" value={pending} sub="요청부터 입고까지"/></div>
          <div className={styles.columns}><Panel title="점포별 재고 상태" sub="안전재고 미만 품목을 자동으로 찾아냅니다."><div className={styles.stores}>{visibleStores.map(s=>{const lows=items.filter(i=>(data.stock[s.id]?.[i.id]??0)<=i.safe);const sum=items.reduce((a,i)=>a+(data.stock[s.id]?.[i.id]??0),0);return <button key={s.id} onClick={()=>{setStore(s.id);setView("inventory")}}><header><b>{s.name[0]}</b><span><strong>{s.name}</strong><small>지점장 {s.manager}</small></span></header><h3>{sum.toLocaleString()} <small>총재고</small></h3><p className={lows.length?styles.bad:styles.good}>{lows.length?`부족 ${lows.length}품목 · ${lows.slice(0,2).map(x=>x.name).join(", ")}`:"모든 품목 적정"}</p></button>})}</div></Panel>
            <Panel title="처리할 수발주" sub="요청부터 입고까지 진행상태가 이어집니다."><div className={styles.preview}>{visibleOrders.slice(0,4).map(o=><div key={o.id}><Status value={o.status}/><span><strong>{storeName(o.store)} · {itemOf(o.item).name} {o.qty}{itemOf(o.item).unit}</strong><small>필요일 {o.needed}</small></span></div>)}</div></Panel></div></>:null}
        {view==="inventory"?<><Title eyebrow="STORE INVENTORY" title="점포별 재고" body="본사는 전체를, 지점은 자기 점포만 관리합니다." action={role!=="staff"?()=>setRequestOpen(true):undefined}/>
          {role==="hq"?<div className={styles.tabs}>{stores.map(x=><button key={x.id} className={store===x.id?styles.tabOn:""} onClick={()=>setStore(x.id)}>{x.name}</button>)}</div>:null}
          <Panel title={storeName(store)} sub={`담당 지점장 ${stores.find(x=>x.id===store)?.manager}`}><div className={styles.inventory}>{items.map(i=>{const qty=data.stock[store]?.[i.id]??0;const isLow=qty<=i.safe;return <article className={isLow?styles.lowItem:""} key={i.id}><header><small>{i.group}</small><b>{isLow?"보충 필요":"적정"}</b></header><h3>{i.name}</h3><strong>{qty}<small>{i.unit}</small></strong><div><i style={{width:`${Math.min(100,qty/i.target*100)}%`}}/></div><p>안전 {i.safe}{i.unit} · 권장 {i.target}{i.unit}</p><button onClick={()=>setMove(i.id)}>입고·사용 등록</button></article>})}</div></Panel></>:null}
        {view==="orders"?<><Title eyebrow="SMART REPLENISHMENT" title="수발주 관리" body="전화와 메신저 대신 요청·승인·출고·입고를 한 줄로 연결합니다." action={role!=="staff"?()=>setRequestOpen(true):undefined}/><Panel title="요청 진행 현황" sub="역할을 바꿔 전체 흐름을 직접 체험해 보세요."><div className={styles.orders}>{visibleOrders.map(o=>{const index=steps.indexOf(o.status);return <article key={o.id}><div className={styles.orderMain}><Status value={o.status}/><span><small>요청 #{o.id} · {storeName(o.store)}</small><h3>{itemOf(o.item).name} <b>{o.qty}{itemOf(o.item).unit}</b></h3><p>{o.note} · 필요일 {o.needed} · {o.by}</p></span></div><div className={styles.progress}>{steps.map((s,n)=><span className={index>=n?styles.done:""} key={s}><i/>{s}</span>)}</div><div className={styles.actions}>{role==="hq"&&o.status==="요청"?<><button className={styles.primarySmall} onClick={()=>setStatus(o,"승인")}>승인</button><button onClick={()=>setStatus(o,"반려")}>반려</button></>:null}{role==="hq"&&o.status==="승인"?<button className={styles.primarySmall} onClick={()=>setStatus(o,"준비 중")}>준비 시작</button>:null}{role==="hq"&&o.status==="준비 중"?<button className={styles.primarySmall} onClick={()=>setStatus(o,"출고")}>출고 완료</button>:null}{role!=="hq"&&o.status==="출고"?<button className={styles.primarySmall} onClick={()=>setStatus(o,"입고 완료")}>수령·입고 확인</button>:null}</div></article>})}</div></Panel></>:null}
        {view==="guide"?<Guide onStart={()=>setGuide(true)}/>:null}
      </section>
    </div>
    {guide?<div className={styles.backdrop}><section className={styles.modal}><button className={styles.close} onClick={()=>setGuide(false)}>×</button><small className={styles.eyebrow}>3-MINUTE EXPERIENCE</small><h2>3분이면 핵심을 모두 체험할 수 있어요</h2><p>각 역할을 바꿔가며 실제 점포의 수발주 흐름을 직접 눌러보세요.</p><div className={styles.guide}>{[["1","본사 통합 현황","전 점포 재고와 부족 품목 확인"],["2","지점장 물품 요청","필요한 품목·수량·필요일 요청"],["3","본사 승인·출고","승인부터 출고까지 진행"],["4","점포 입고 완료","수령 확인과 동시에 재고 증가"]].map(x=><article key={x[0]}><b>{x[0]}</b><span><strong>{x[1]}</strong><p>{x[2]}</p></span></article>)}</div><button className={styles.primary} onClick={()=>setGuide(false)}>체험 시작하기</button><small>실제 데이터가 아닌 샘플이며 언제든 초기화할 수 있습니다.</small></section></div>:null}
    {requestOpen?<div className={styles.backdrop}><form className={styles.form} onSubmit={createRequest}><button type="button" className={styles.close} onClick={()=>setRequestOpen(false)}>×</button><small className={styles.eyebrow}>RESTOCK REQUEST</small><h2>물품 요청</h2><label>요청 점포<select value={store} onChange={e=>setStore(e.target.value)}>{stores.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label>요청 품목<select value={draft.item} onChange={e=>setDraft({...draft,item:e.target.value})}>{items.map(i=><option value={i.id} key={i.id}>{i.name} · 현재 {data.stock[store]?.[i.id]??0}{i.unit}</option>)}</select></label><div className={styles.formTwo}><label>수량<input type="number" min="1" value={draft.qty} onChange={e=>setDraft({...draft,qty:Number(e.target.value)})}/></label><label>필요일<input type="date" value={draft.needed} onChange={e=>setDraft({...draft,needed:e.target.value})}/></label></div><label>요청 사유<textarea rows={3} placeholder="주말 예약 증가 대비" value={draft.note} onChange={e=>setDraft({...draft,note:e.target.value})}/></label><button className={styles.primary}>본사 담당자에게 요청</button></form></div>:null}
    {move?<div className={styles.backdrop}><section className={styles.form}><button className={styles.close} onClick={()=>setMove(null)}>×</button><small className={styles.eyebrow}>STOCK MOVEMENT</small><h2>{storeName(store)} · {itemOf(move).name}</h2><p className={styles.current}>현재 재고 <strong>{data.stock[store]?.[move]??0}</strong>{itemOf(move).unit}</p><label>처리 수량<input type="number" min="1" value={moveQty} onChange={e=>setMoveQty(Number(e.target.value))}/></label><div className={styles.formTwo}><button className={styles.primary} onClick={()=>movement("in")}>입고 +{moveQty}</button><button className={styles.use} onClick={()=>movement("use")}>사용 −{moveQty}</button></div></section></div>:null}
  </main>
}

function Title({eyebrow,title,body,action}:{eyebrow:string;title:string;body:string;action?:()=>void}){return <header className={styles.title}><div><small className={styles.eyebrow}>{eyebrow}</small><h1>{title}</h1><p>{body}</p></div>{action?<button className={styles.primary} onClick={action}>+ 물품 요청</button>:null}</header>}
function Metric({label,value,sub,warn}:{label:string;value:number;sub:string;warn?:boolean}){return <article className={warn?styles.warn:""}><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{sub}</small></article>}
function Panel({title,sub,children}:{title:string;sub:string;children:React.ReactNode}){return <section className={styles.panel}><header><h2>{title}</h2><p>{sub}</p></header>{children}</section>}
function Status({value}:{value:Status}){return <b className={`${styles.status} ${styles[`s${value.replace(" ","")}`]}`}>{value}</b>}
function Guide({onStart}:{onStart:()=>void}){const features=[["전 지점 통합관리","점포별 재고와 전체 합계를 실시간으로 비교합니다.","어느 점포에 무엇이 부족한지 즉시 확인"],["간편한 수발주","지점장이 품목·수량·필요일을 입력하면 본사 담당자에게 전달됩니다.","전화·카톡·누락 없는 요청 관리"],["끝까지 이어지는 처리","요청, 승인, 준비, 출고, 점포 입고 상태를 한 화면에서 확인합니다.","누가 어디까지 처리했는지 명확하게"],["부족 재고 자동감지","점포와 품목마다 안전재고를 설정해 부족하면 자동으로 알려줍니다.","품절 전에 미리 보충"],["담당 점포·권한 분리","본사는 전체를 보고 지점장과 직원은 배정 점포만 관리합니다.","필요한 사람에게 필요한 화면만"],["자동 집계와 이력","입고와 사용을 기록하면 현재고와 점포별 사용량이 자동 계산됩니다.","엑셀 취합 없이 언제나 최신 현황"]];return <><Title eyebrow="WHY STORE HUB?" title="효소숲 운영이 이렇게 달라집니다" body="각 점포의 연락을 기다리지 않아도 본사가 먼저 상황을 파악합니다." action={onStart}/><div className={styles.features}>{features.map((x,i)=><article key={x[0]}><small>0{i+1}</small><h2>{x[0]}</h2><p>{x[1]}</p><b>{x[2]}</b></article>)}</div><section className={styles.impact}><div><small>BEFORE</small><strong>점포별 전화·메신저 확인<br/>엑셀 취합과 반복 문의</strong></div><i>→</i><div><small>WITH STORE HUB</small><strong>한 화면에서 전체 파악<br/>요청부터 입고까지 자동 연결</strong></div></section></>}

