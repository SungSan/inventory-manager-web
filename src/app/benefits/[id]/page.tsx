"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BenefitFeatureGuard } from "@/components/benefit-feature-guard";
import { Feedback, type FeedbackKind } from "@/components/feedback";
import {
  createBenefitOrderImport,
  createBenefitWinnerImport,
  deleteBenefitRule,
  getBenefitEvent,
  insertBenefitOrderRows,
  insertBenefitWinnerRows,
  listBenefitEventClasses,
  listBenefitOrderImports,
  listBenefitOrderRows,
  listBenefitRules,
  listBenefitWinnerImports,
  listBenefitWinnerRows,
  replaceBenefitEventClasses,
  saveBenefitCalculation,
  saveBenefitRule,
  setBenefitEventClassSelected,
  updateBenefitEvent,
  updateBenefitOrderRowClassification,
  updateBenefitWinnerMatch,
  type BenefitEvent,
  type BenefitEventClass,
  type BenefitOrderImport,
  type BenefitOrderRow,
  type BenefitRule,
  type BenefitRuleType,
  type BenefitWinnerImport,
  type BenefitWinnerRow,
} from "@/lib/benefit-api";
import { calculateBenefits, describeBenefitRule, type BenefitCalculationOutput } from "@/lib/benefit-engine";
import { downloadBenefitResultXlsx, parseBenefitOrderFile, parseBenefitWinnerFile, sha256File } from "@/lib/benefit-xlsx";

const emptyRule = { id: "", name: "", ruleType: "QUANTITY" as BenefitRuleType, thresholdValue: 1, rewardQuantity: 1, rewardUnit: "장", repeatEnabled: true, oneTimeOnly: false, classIds: [] as string[] };

function parseCsvValues(value: string): string[] { return value.split(",").map((item) => item.trim()).filter((item, index, all) => all.indexOf(item) === index); }
function numberText(value: number): string { return Number.isInteger(value) ? value.toLocaleString("ko-KR") : value.toLocaleString("ko-KR", { maximumFractionDigits: 2 }); }
async function sha256Text(value: string): Promise<string> { const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((item)=>item.toString(16).padStart(2,"0")).join(""); }

function BenefitDetailContent() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [event, setEvent] = useState<BenefitEvent | null>(null);
  const [classes, setClasses] = useState<BenefitEventClass[]>([]);
  const [rules, setRules] = useState<BenefitRule[]>([]);
  const [orderImports, setOrderImports] = useState<BenefitOrderImport[]>([]);
  const [winnerImports, setWinnerImports] = useState<BenefitWinnerImport[]>([]);
  const [orderRows, setOrderRows] = useState<BenefitOrderRow[]>([]);
  const [winnerRows, setWinnerRows] = useState<BenefitWinnerRow[]>([]);
  const [ruleForm, setRuleForm] = useState(emptyRule);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; title: string; body?: string } | null>(null);
  const [normalValuesText, setNormalValuesText] = useState("");
  const [excludeValuesText, setExcludeValuesText] = useState("");

  const load = useCallback(async () => {
    const nextEvent = await getBenefitEvent(eventId);
    const [nextClasses, nextOrderImports, nextWinnerImports] = await Promise.all([
      listBenefitEventClasses(eventId), listBenefitOrderImports(eventId), listBenefitWinnerImports(eventId),
    ]);
    const nextRules = await listBenefitRules(eventId, nextClasses);
    const latestOrder = nextOrderImports[0];
    const latestWinner = nextWinnerImports[0];
    const [nextOrderRows, nextWinnerRows] = await Promise.all([
      latestOrder ? listBenefitOrderRows(latestOrder.id) : Promise.resolve([]),
      latestWinner && nextEvent.isFansign ? listBenefitWinnerRows(latestWinner.id) : Promise.resolve([]),
    ]);
    setEvent(nextEvent); setClasses(nextClasses); setRules(nextRules); setOrderImports(nextOrderImports); setWinnerImports(nextWinnerImports); setOrderRows(nextOrderRows); setWinnerRows(nextWinnerRows);
    setNormalValuesText(nextEvent.cancelNormalValues.join(", ")); setExcludeValuesText(nextEvent.cancelExcludeValues.join(", "));
  }, [eventId]);

  useEffect(() => { void load().catch((cause) => setFeedback({ kind: "error", title: "행사 상세 로드 실패", body: cause instanceof Error ? cause.message : "오류" })); }, [load]);

  const calculation = useMemo<BenefitCalculationOutput | null>(() => {
    if (!event || !orderRows.length || !classes.length) return null;
    return calculateBenefits({ event, classes, rules, orderRows, winnerRows: event.isFansign ? winnerRows : [] });
  }, [event, classes, rules, orderRows, winnerRows]);

  const selectedClassCount = classes.filter((item) => item.isSelected).length;
  const observedCancelValues = useMemo(() => [...new Set(orderRows.map((row) => row.cancelStatus))], [orderRows]);
  const unresolvedRows = useMemo(() => orderRows.filter((row) => row.classificationStatus === "REVIEW" || !row.eventType), [orderRows]);
  const mixedOrders = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const row of orderRows) {
      if (!row.eventType) continue;
      const byType = map.get(row.orderNo) ?? new Map<string, number>();
      byType.set(row.eventType, (byType.get(row.eventType) ?? 0) + row.quantity); map.set(row.orderNo, byType);
    }
    return [...map.entries()].filter(([, types]) => types.size > 1);
  }, [orderRows]);

  async function syncClassesFromRows(rows: BenefitOrderRow[]) {
    const map = new Map<string, { classificationRaw: string; eventMarker: string; eventType: string; sourceRowCount: number; sourceQtySum: number; manualOverride?: boolean }>();
    for (const row of rows) {
      if (!row.eventType || !row.classificationRaw) continue;
      const value = map.get(row.classificationRaw) ?? { classificationRaw: row.classificationRaw, eventMarker: row.eventMarker || "", eventType: row.eventType, sourceRowCount: 0, sourceQtySum: 0, manualOverride: row.classificationStatus === "MANUAL" };
      value.sourceRowCount += 1; value.sourceQtySum += row.quantity; value.manualOverride = value.manualOverride || row.classificationStatus === "MANUAL"; map.set(row.classificationRaw, value);
    }
    const next = await replaceBenefitEventClasses(eventId, [...map.values()]); setClasses(next); setRules(await listBenefitRules(eventId, next));
  }

  async function uploadOrders(file: File) {
    setBusy("orders"); setFeedback(null);
    try {
      const parsed = await parseBenefitOrderFile(file); const hash = await sha256File(file);
      if (orderImports.some((item) => item.fileHash === hash) && !window.confirm("같은 주문파일 해시가 이미 업로드되어 있습니다. 새 버전으로 다시 업로드할까요?")) return;
      const imported = await createBenefitOrderImport(eventId, file.name, hash, parsed.rows.length);
      await insertBenefitOrderRows(imported.id, parsed.rows);
      await replaceBenefitEventClasses(eventId, parsed.classifications);
      setFeedback({ kind: "success", title: "주문자료 업로드 완료", body: `${parsed.rows.length.toLocaleString()}행 · 자동 감지 유형 ${parsed.classifications.length}개` });
      await load();
    } catch (cause) { setFeedback({ kind: "error", title: "주문자료 업로드 실패", body: cause instanceof Error ? cause.message : "오류" }); }
    finally { setBusy(""); }
  }

  async function uploadWinners(file: File) {
    if (!event?.isFansign) return;
    setBusy("winners"); setFeedback(null);
    try {
      const parsed = await parseBenefitWinnerFile(file); const hash = await sha256File(file);
      if (winnerImports.some((item) => item.fileHash === hash) && !window.confirm("같은 당첨자파일 해시가 이미 업로드되어 있습니다. 새 버전으로 다시 업로드할까요?")) return;
      const imported = await createBenefitWinnerImport(eventId, file.name, hash, parsed.rows.length);
      await insertBenefitWinnerRows(imported.id, parsed.rows);
      setFeedback({ kind: "success", title: "당첨자자료 업로드 완료", body: `${parsed.rows.length.toLocaleString()}행을 저장했습니다.` }); await load();
    } catch (cause) { setFeedback({ kind: "error", title: "당첨자자료 업로드 실패", body: cause instanceof Error ? cause.message : "오류" }); }
    finally { setBusy(""); }
  }

  async function toggleClass(item: BenefitEventClass) {
    setBusy(item.id); try { await setBenefitEventClassSelected(item.id, !item.isSelected); const next=await listBenefitEventClasses(eventId); setClasses(next); setRules(await listBenefitRules(eventId,next)); }
    catch(cause){setFeedback({kind:"error",title:"행사 유형 선택 변경 실패",body:cause instanceof Error?cause.message:"오류"});} finally{setBusy("");}
  }

  async function manualClassify(row: BenefitOrderRow) {
    const suggestions = [...new Set(classes.map((item) => item.eventType))].join(", ");
    const eventType = window.prompt(`이 행의 행사 유형을 입력하세요.\n기존 유형: ${suggestions || "없음"}`, classes[0]?.eventType || "")?.trim();
    if (!eventType) return;
    setBusy(row.id);
    try {
      await updateBenefitOrderRowClassification(row.id, { classificationRaw: `MANUAL:${eventType}`, eventMarker: "MANUAL", eventType });
      const nextRows = await listBenefitOrderRows(row.importId); setOrderRows(nextRows); await syncClassesFromRows(nextRows);
      setFeedback({ kind: "success", title: "수동 분류 저장", body: `${row.sourceRowNumber}행 → ${eventType}` });
    } catch(cause){setFeedback({kind:"error",title:"수동 분류 실패",body:cause instanceof Error?cause.message:"오류"});} finally{setBusy("");}
  }

  function editRule(rule: BenefitRule) { setRuleForm({ id:rule.id,name:rule.name,ruleType:rule.ruleType,thresholdValue:rule.thresholdValue,rewardQuantity:rule.rewardQuantity,rewardUnit:rule.rewardUnit,repeatEnabled:rule.repeatEnabled,oneTimeOnly:rule.oneTimeOnly,classIds:[...rule.classIds] }); window.scrollTo({top:document.body.scrollHeight*0.25,behavior:"smooth"}); }
  function copyRule(rule: BenefitRule) { setRuleForm({ id:"",name:`${rule.name} 복사`,ruleType:rule.ruleType,thresholdValue:rule.thresholdValue,rewardQuantity:rule.rewardQuantity,rewardUnit:rule.rewardUnit,repeatEnabled:rule.repeatEnabled,oneTimeOnly:rule.oneTimeOnly,classIds:[...rule.classIds] }); }

  async function saveRule() {
    if (!ruleForm.name.trim() || !ruleForm.classIds.length) return;
    const signature=(value:typeof ruleForm)=>JSON.stringify([value.ruleType,value.thresholdValue,value.rewardQuantity,value.rewardUnit,value.repeatEnabled,value.oneTimeOnly,[...value.classIds].sort()]);
    if(rules.some((rule)=>rule.id!==ruleForm.id&&signature({id:rule.id,name:rule.name,ruleType:rule.ruleType,thresholdValue:rule.thresholdValue,rewardQuantity:rule.rewardQuantity,rewardUnit:rule.rewardUnit,repeatEnabled:rule.repeatEnabled,oneTimeOnly:rule.oneTimeOnly,classIds:rule.classIds})===signature(ruleForm))){setFeedback({kind:"warning",title:"동일 특전 규칙이 이미 등록되어 있습니다."});return;}
    setBusy("rule");
    try { await saveBenefitRule({ ...ruleForm, id:ruleForm.id||undefined, eventId, maximumRewardQuantity:undefined, isActive:true }); setRuleForm(emptyRule); setRules(await listBenefitRules(eventId,classes)); }
    catch(cause){setFeedback({kind:"error",title:"특전 규칙 저장 실패",body:cause instanceof Error?cause.message:"오류"});} finally{setBusy("");}
  }

  async function removeRule(rule: BenefitRule) { if(!window.confirm(`${rule.name} 특전 조건을 삭제할까요? 과거 계산 실행의 규칙 스냅샷은 유지됩니다.`))return; setBusy(rule.id);try{await deleteBenefitRule(rule.id);setRules(await listBenefitRules(eventId,classes));}catch(cause){setFeedback({kind:"error",title:"특전 삭제 실패",body:cause instanceof Error?cause.message:"오류"});}finally{setBusy("");} }

  async function saveCancellationSettings(){if(!event)return;setBusy("cancel");try{const next=await updateBenefitEvent(event.id,{cancelNormalValues:parseCsvValues(normalValuesText),cancelExcludeValues:parseCsvValues(excludeValuesText)});setEvent(next);setFeedback({kind:"success",title:"취소구분 기준 저장 완료"});}catch(cause){setFeedback({kind:"error",title:"취소구분 기준 저장 실패",body:cause instanceof Error?cause.message:"오류"});}finally{setBusy("");}}

  async function persistCalculation(){if(!event||!calculation||!orderImports[0])return;if(selectedClassCount===0){setFeedback({kind:"warning",title:"계산할 행사 유형을 하나 이상 선택하세요."});return;}if(calculation.reviewRequired){setFeedback({kind:"warning",title:"확인 필요 건을 먼저 해결하세요.",body:`현재 ${calculation.summary.reviewCount}건의 확인 필요 항목이 있습니다.`});return;}setBusy("calculate");try{for(const outcome of calculation.winnerOutcomes){await updateBenefitWinnerMatch(outcome.winnerRowId,{status:outcome.status,message:outcome.message,matchedOrderRowId:outcome.matchedOrderRowId});}const resultHash=await sha256Text(JSON.stringify({summary:calculation.summary,results:calculation.results}));await saveBenefitCalculation({eventId:event.id,orderImportId:orderImports[0].id,winnerImportId:event.isFansign?winnerImports[0]?.id:undefined,rules,classes,summary:calculation.summary as unknown as Record<string,unknown>,resultHash,reviewRequired:false,results:calculation.results});setFeedback({kind:"success",title:"계산 결과 저장 완료",body:"재고 데이터는 변경되지 않았습니다. 현재 결과 스냅샷만 특전 모듈에 저장했습니다."});}catch(cause){setFeedback({kind:"error",title:"계산 결과 저장 실패",body:cause instanceof Error?cause.message:"오류"});}finally{setBusy("");}}

  if (!event) return <div className="center-panel">행사 정보를 불러오는 중...</div>;
  const representativeById=new Map(orderRows.map((row)=>[row.id,row]));

  return <div className="page-stack">
    <section className="section-heading"><div><p className="eyebrow">BENEFIT EVENT</p><h2>{event.name}</h2><p className="muted">{event.salesStartAt} ~ {event.salesEndAt} · {event.salesChannel} · {event.isFansign?"사인회":"일반 행사"}</p></div><div className="row-actions"><Link className="button button-secondary" href="/benefits">행사 목록</Link><button className="button button-secondary" onClick={()=>void updateBenefitEvent(event.id,{status:event.status==="ACTIVE"?"ENDED":"ACTIVE"}).then(setEvent)}>{event.status==="ACTIVE"?"행사 종료":"진행 재개"}</button></div></section>
    <div className="feedback feedback-info"><strong>재고 독립 기능</strong><p>주문자료 업로드·특전 계산·당첨자 차감·결과 다운로드는 SAN WMS 재고/LOC/상품 데이터에 접근하거나 재고를 변경하지 않습니다.</p></div>
    {feedback?<Feedback kind={feedback.kind} title={feedback.title}>{feedback.body}</Feedback>:null}

    <section className="panel"><div className="section-heading"><div><h3>1. 주문자료 업로드</h3><p className="muted">고정 30개 컬럼의 XLSX를 검증하고 주문상품명 앞 대괄호에서 행사 유형을 자동 감지합니다.</p></div>{orderImports[0]?<span className="status-badge success">v{orderImports[0].importVersion} · {orderImports[0].rowCount.toLocaleString()}행</span>:null}</div>
      <input type="file" accept=".xlsx,.xls" disabled={busy==="orders"} onChange={(e)=>{const file=e.target.files?.[0];if(file)void uploadOrders(file);e.currentTarget.value="";}} />
      {orderImports[0]?<p className="muted">현재 파일: {orderImports[0].originalFileName} · {new Date(orderImports[0].uploadedAt).toLocaleString("ko-KR")}</p>:null}
    </section>

    <section className="panel"><div className="section-heading"><div><h3>2. 주문상품 자동 분류 확인</h3><p className="muted">체크 해제한 유형은 원본 행을 삭제하지 않고 이번 계산에서만 제외됩니다. 변경 즉시 결과가 다시 계산됩니다.</p></div><span className={`status-badge ${selectedClassCount?"success":"inactive"}`}>{selectedClassCount}/{classes.length} 유형 선택</span></div>
      <div className="form-grid">{classes.map((item)=><label key={item.id} className="checkbox-label"><input type="checkbox" checked={item.isSelected} disabled={busy===item.id} onChange={()=>void toggleClass(item)} /><span><strong>[{item.classificationRaw}]</strong><br/><small>{item.eventType} · {item.sourceRowCount.toLocaleString()}행 · {numberText(item.sourceQtySum)}장{item.manualOverride?" · 수동분류":""}</small></span></label>)}</div>
      {classes.length===0?<p className="empty-state">주문자료를 먼저 업로드하세요.</p>:null}
      {mixedOrders.length?<div className="feedback feedback-warning"><strong>혼합 주문 {mixedOrders.length}건 자동 감지</strong>{mixedOrders.slice(0,8).map(([orderNo,types])=><p key={orderNo}>{orderNo}: {[...types.entries()].map(([type,qty])=>`${type} ${numberText(qty)}장`).join(" + ")} → 유형별 분리 계산</p>)}</div>:null}
      {unresolvedRows.length?<div><h4>분류 확인 필요 ({unresolvedRows.length})</h4><div className="table-wrap"><table><thead><tr><th>원본 행</th><th>주문번호</th><th>상품명</th><th>처리</th></tr></thead><tbody>{unresolvedRows.slice(0,50).map((row)=><tr key={row.id}><td>{row.sourceRowNumber}</td><td>{row.orderNo}</td><td>{row.originalProductName}</td><td><button className="button button-primary button-compact" disabled={busy===row.id} onClick={()=>void manualClassify(row)}>분류 지정</button></td></tr>)}</tbody></table></div>{unresolvedRows.length>50?<p className="muted">앞 50건만 표시합니다.</p>:null}</div>:null}
    </section>

    <section className="panel"><div className="section-heading"><div><h3>3. 취소구분 기준</h3><p className="muted">알 수 없는 값은 자동 제외하지 않고 확인 필요로 보냅니다.</p></div></div><div className="form-grid"><label className="span-two">정상값 (쉼표 구분)<input value={normalValuesText} onChange={(e)=>setNormalValuesText(e.target.value)} placeholder="N, 정상" /></label><label className="span-two">취소값 (쉼표 구분)<input value={excludeValuesText} onChange={(e)=>setExcludeValuesText(e.target.value)} placeholder="Y, 취소, 환불" /></label><div className="span-two"><small className="muted">현재 파일에서 감지: {observedCancelValues.map((v)=>v||"(빈 값)").join(" / ")||"없음"}</small></div><button className="button button-secondary span-two" disabled={busy==="cancel"} onClick={()=>void saveCancellationSettings()}>기준 저장</button></div></section>

    {event.isFansign?<section className="panel"><div className="section-heading"><div><h3>4. 사인회 당첨자 파일</h3><p className="muted">몰 + 주문번호 + 행사유형으로 대조합니다. 당첨 유형의 물류 출고수량만 1장 차감하고 특전은 원 구매수량으로 계산합니다. 친사폴은 정확한 문자 O/o만 자동 인식합니다.</p></div>{winnerImports[0]?<span className="status-badge success">v{winnerImports[0].importVersion} · {winnerImports[0].rowCount.toLocaleString()}행</span>:null}</div><input type="file" accept=".xlsx,.xls" disabled={busy==="winners"} onChange={(e)=>{const file=e.target.files?.[0];if(file)void uploadWinners(file);e.currentTarget.value="";}} />{winnerImports[0]?<p className="muted">현재 파일: {winnerImports[0].originalFileName}</p>:null}</section>:null}

    <section className="panel"><div className="section-heading"><div><h3>{event.isFansign?"5":"4"}. 특전 조건</h3><p className="muted">각 특전마다 적용할 행사 유형을 별도로 선택합니다. 상품코드/SKU는 사용하지 않습니다.</p></div></div>
      <div className="form-grid"><label className="span-two">특전명<input value={ruleForm.name} onChange={(e)=>setRuleForm({...ruleForm,name:e.target.value})} placeholder="예: 영통 미공개 셀카" /></label><label>계산 유형<select value={ruleForm.ruleType} onChange={(e)=>{const ruleType=e.target.value as BenefitRuleType;setRuleForm({...ruleForm,ruleType,thresholdValue:ruleType==="PER_ORDER"||ruleType==="PER_SHIPMENT"?1:ruleForm.thresholdValue,repeatEnabled:ruleType==="PER_ORDER"||ruleType==="PER_SHIPMENT"?false:ruleForm.repeatEnabled,oneTimeOnly:ruleType==="PER_ORDER"||ruleType==="PER_SHIPMENT"?true:ruleForm.oneTimeOnly});}}><option value="QUANTITY">상품 수량 기준</option><option value="AMOUNT">구매금액 기준</option><option value="PER_ORDER">주문번호당 지급</option><option value="PER_SHIPMENT">배송번호당 지급</option></select></label><label>기준값<input type="number" min="1" step="1" disabled={ruleForm.ruleType==="PER_ORDER"||ruleForm.ruleType==="PER_SHIPMENT"} value={ruleForm.thresholdValue} onChange={(e)=>setRuleForm({...ruleForm,thresholdValue:Number(e.target.value)})} /></label><label>회당 지급수량<input type="number" min="0.01" step="0.01" value={ruleForm.rewardQuantity} onChange={(e)=>setRuleForm({...ruleForm,rewardQuantity:Number(e.target.value)})} /></label><label>지급단위<input value={ruleForm.rewardUnit} onChange={(e)=>setRuleForm({...ruleForm,rewardUnit:e.target.value})} placeholder="장 / 세트 / 개" /></label>
      <label className="checkbox-label"><input type="radio" name="repeat" checked={ruleForm.repeatEnabled&&!ruleForm.oneTimeOnly} disabled={ruleForm.ruleType==="PER_ORDER"||ruleForm.ruleType==="PER_SHIPMENT"} onChange={()=>setRuleForm({...ruleForm,repeatEnabled:true,oneTimeOnly:false})} />n개/금액 구매할 때마다 반복 지급</label><label className="checkbox-label"><input type="radio" name="repeat" checked={ruleForm.oneTimeOnly||!ruleForm.repeatEnabled} onChange={()=>setRuleForm({...ruleForm,repeatEnabled:false,oneTimeOnly:true})} />기준 이상이면 1회만 지급</label>
      <div className="span-two"><strong>적용할 행사 유형</strong><div className="row-actions">{classes.map((item)=><label key={item.id} className="checkbox-label"><input type="checkbox" checked={ruleForm.classIds.includes(item.id)} onChange={(e)=>setRuleForm({...ruleForm,classIds:e.target.checked?[...ruleForm.classIds,item.id]:ruleForm.classIds.filter((id)=>id!==item.id)})} />{item.eventType}</label>)}</div></div>
      <button className="button button-primary span-two" disabled={busy==="rule"||!ruleForm.name.trim()||!ruleForm.classIds.length} onClick={()=>void saveRule()}>{ruleForm.id?"특전 수정 저장":"+ 특전 추가"}</button>{ruleForm.id?<button className="button button-secondary span-two" onClick={()=>setRuleForm(emptyRule)}>수정 취소</button>:null}</div>
      <div className="page-stack" style={{marginTop:16}}>{rules.map((rule)=><div className="feedback feedback-info" key={rule.id}><strong>{rule.name}</strong><p>{describeBenefitRule(rule)}</p><p>적용 유형: {rule.eventTypes.join(" / ")} · 현재 예상 총 지급: {numberText(calculation?.summary.benefitTotals[rule.id]?.quantity??0)}{rule.rewardUnit}</p><div className="row-actions"><button className="button button-secondary button-compact" onClick={()=>editRule(rule)}>수정</button><button className="button button-secondary button-compact" onClick={()=>copyRule(rule)}>복사</button><button className="button button-danger button-compact" disabled={busy===rule.id} onClick={()=>void removeRule(rule)}>삭제</button></div></div>)}</div>
    </section>

    <section className="panel"><div className="section-heading"><div><h3>{event.isFansign?"6":"5"}. 계산 결과</h3><p className="muted">행사 유형 체크·규칙 변경·당첨자 업로드 결과를 기준으로 즉시 재계산됩니다.</p></div><div className="row-actions"><button className="button button-secondary" disabled={!calculation||selectedClassCount===0||calculation.reviewRequired} onClick={()=>calculation&&downloadBenefitResultXlsx({eventName:event.name,orderRows,rules,calculation})}>XLSX 결과 다운로드</button><button className="button button-primary" disabled={!calculation||selectedClassCount===0||calculation.reviewRequired||busy==="calculate"} onClick={()=>void persistCalculation()}>계산 결과 저장</button></div></div>
      {!calculation?<p className="empty-state">주문자료를 업로드하면 계산 결과가 표시됩니다.</p>:<>
        <div className="stats-grid"><div className="stat-card"><span>배송번호</span><strong>{calculation.summary.shippingCount.toLocaleString()}</strong></div><div className="stat-card"><span>주문번호</span><strong>{calculation.summary.orderCount.toLocaleString()}</strong></div><div className="stat-card"><span>전체 구매수량</span><strong>{numberText(calculation.summary.purchaseQty)}</strong></div><div className="stat-card"><span>물류 출고수량</span><strong>{numberText(calculation.summary.warehouseShipQty)}</strong></div><div className="stat-card"><span>특전 계산수량</span><strong>{numberText(calculation.summary.benefitBasisQty)}</strong></div><div className="stat-card"><span>당첨자</span><strong>{calculation.summary.winnerCount.toLocaleString()}</strong></div><div className="stat-card"><span>현장수령 차감</span><strong>{numberText(calculation.summary.onsitePickupQty)}</strong></div><div className="stat-card"><span>친사폴</span><strong>{calculation.summary.photoBenefitCount.toLocaleString()}</strong></div><div className="stat-card"><span>확인 필요</span><strong>{calculation.summary.reviewCount.toLocaleString()}</strong></div></div>
        <div className="row-actions" style={{marginTop:12}}>{Object.entries(calculation.summary.eventTypeQty).map(([type,qty])=><span className="status-badge primary" key={type}>{type}: {numberText(qty)}장</span>)}</div>
        {calculation.reviewRequired?<div className="feedback feedback-warning"><strong>확인 필요 {calculation.summary.reviewCount}건</strong><p>분류 실패, 알 수 없는 취소구분, 당첨자 대조 실패/중복 등을 해결해야 결과 저장·다운로드가 활성화됩니다.</p></div>:<div className="feedback feedback-success"><strong>계산 검증 통과</strong><p>현재 결과는 다운로드/스냅샷 저장할 수 있습니다. 재고에는 아무 변화가 없습니다.</p></div>}
        <div className="table-wrap"><table><thead><tr><th>배송번호</th><th>주문번호</th><th>수령인</th><th>행사 유형</th><th>혼합</th><th>당첨</th><th>상품명</th><th>구매</th><th>현장수령</th><th>물류출고</th><th>친사폴</th><th>특전</th><th>상태/확인</th></tr></thead><tbody>{calculation.results.map((result,index)=>{const source=result.representativeSourceRowId?representativeById.get(result.representativeSourceRowId):undefined;const outcome=source?calculation.rowOutcomes[source.id]:undefined;return <tr key={`${result.shippingNo}-${result.orderNo}-${result.eventType}-${index}`}><td>{result.shippingNo}</td><td>{result.orderNo}</td><td>{source?.recipientName||"-"}</td><td>{result.eventType}</td><td>{outcome?.mixedOrder?"혼합":""}</td><td>{result.isWinner?"당첨":""}</td><td>{source?.originalProductName||"-"}</td><td>{numberText(result.purchaseQty)}</td><td>{numberText(result.onsitePickupQty)}</td><td>{numberText(result.warehouseShipQty)}</td><td>{result.isPhotoBenefit?<span className="status-badge success">친사폴</span>:""}</td><td>{(result.benefits as Array<{name:string;quantity:number;unit:string}>).map((benefit)=>`${benefit.name} ${numberText(benefit.quantity)}${benefit.unit}`).join(" / ")||"-"}</td><td><span className={`status-badge ${result.calculationStatus==="OK"?"success":"inactive"}`}>{result.calculationStatus}</span>{result.reviewMessage?<><br/><small>{result.reviewMessage}</small></>:null}</td></tr>;})}</tbody></table></div>
      </>}
    </section>
  </div>;
}

export default function BenefitDetailPage(){return <BenefitFeatureGuard><BenefitDetailContent /></BenefitFeatureGuard>;}
