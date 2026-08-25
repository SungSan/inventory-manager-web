import * as XLSX from "xlsx";
import type { BenefitOrderRow, BenefitRule, BenefitWinnerRow } from "@/lib/benefit-api";
import { classifyBenefitProductName, isPhotoBenefitValue, type BenefitCalculationOutput } from "@/lib/benefit-engine";

export const BENEFIT_ORDER_HEADERS = [
  "배송번호","운송장번호","주문번호","주문상품명(옵션포함)","수량","주문자명","수령인","수령인 휴대전화","수령인 전화번호","수령인 주소(전체)",
  "품목별 주문번호","배송메시지","결제구분","주문자 이메일","자체 상품코드","배송국가","상품구매금액(KRW)","총 결제금액(KRW)","추가입력옵션","추가입력옵션(상세)",
  "상품옵션","주문서추가항목01_응모자이름 (공통입력사항)","주문서추가항목02_응모자이름 (공통입력사항)","주문서추가항목03_응모자이름 (공통입력사항)","배송비 정보","총 배송비 (첫 품목에만 표시)",
  "배송완료일","결제일시(입금확인일)","취소구분","쇼핑몰",
] as const;

export const BENEFIT_WINNER_HEADERS = [
  "몰","주문번호","주문자명","주문자 휴대전화","주문상품명","01_응모자이름","02_생년월일","03_연락처","04_이메일(E-mail)","수량","05_국적","친사폴 당첨여부",
] as const;

function text(value:unknown):string{return value==null?"":String(value).trim();}
function numeric(value:unknown):number{const parsed=Number(String(value??"").replace(/,/g,"").trim()||"0");return Number.isFinite(parsed)?parsed:Number.NaN;}
function assertHeaders(actual:string[],expected:readonly string[],label:string){
  if(actual.length!==expected.length)throw new Error(`${label} 컬럼 수가 ${expected.length}개가 아닙니다. 현재 ${actual.length}개입니다.`);
  for(let index=0;index<expected.length;index+=1)if(actual[index]!==expected[index])throw new Error(`${label} ${index+1}번째 컬럼이 다릅니다. 필요: '${expected[index]}' / 현재: '${actual[index]??""}'`);
}
async function readRows(file:File):Promise<{headers:string[];rows:Record<string,unknown>[]}>{
  const buffer=await file.arrayBuffer();const workbook=XLSX.read(buffer,{type:"array"});const sheetName=workbook.SheetNames[0];if(!sheetName)throw new Error("엑셀 파일에 시트가 없습니다.");
  const sheet=workbook.Sheets[sheetName];const matrix=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:"",raw:false,blankrows:false});if(!matrix.length)throw new Error("엑셀 파일이 비어 있습니다.");
  const headers=(matrix[0]??[]).map((value)=>String(value??"").trim());const rows=matrix.slice(1).filter((row)=>row.some((value)=>text(value)!=="")).map((row)=>{const record:Record<string,unknown>={};headers.forEach((header,index)=>{record[header]=row[index]??"";});return record;});
  return{headers,rows};
}
export async function sha256File(file:File):Promise<string>{const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());return[...new Uint8Array(digest)].map((value)=>value.toString(16).padStart(2,"0")).join("");}

export interface ParsedBenefitOrderFile {
  rows:Array<Omit<BenefitOrderRow,"id"|"importId">>;
  classifications:Array<{classificationRaw:string;eventMarker:string;eventType:string;sourceRowCount:number;sourceQtySum:number}>;
  cancelValues:string[];
}
export async function parseBenefitOrderFile(file:File):Promise<ParsedBenefitOrderFile>{
  const{headers,rows}=await readRows(file);assertHeaders(headers,BENEFIT_ORDER_HEADERS,"주문자료");if(!rows.length)throw new Error("주문자료에 데이터 행이 없습니다.");
  const lineOrderNos=new Set<string>();const duplicateLineOrderNos=new Set<string>();const classMap=new Map<string,{classificationRaw:string;eventMarker:string;eventType:string;sourceRowCount:number;sourceQtySum:number}>();const cancelValues=new Set<string>();
  const mapped=rows.map((raw,index)=>{
    const sourceRowNumber=index+2;const shippingNo=text(raw["배송번호"]);const orderNo=text(raw["주문번호"]);const productName=text(raw["주문상품명(옵션포함)"]);const quantity=numeric(raw["수량"]);
    if(!shippingNo||!orderNo||!productName||!text(raw["수량"]))throw new Error(`${sourceRowNumber}행: 배송번호, 주문번호, 주문상품명(옵션포함), 수량은 필수입니다.`);
    if(!Number.isFinite(quantity)||quantity<0||!Number.isInteger(quantity))throw new Error(`${sourceRowNumber}행: 수량 '${text(raw["수량"])}'은 0 이상의 정수여야 합니다.`);
    const lineOrderNo=text(raw["품목별 주문번호"]);if(lineOrderNo){if(lineOrderNos.has(lineOrderNo))duplicateLineOrderNos.add(lineOrderNo);lineOrderNos.add(lineOrderNo);}
    const classification=classifyBenefitProductName(productName);if(classification){const summary=classMap.get(classification.classificationRaw)??{...classification,sourceRowCount:0,sourceQtySum:0};summary.sourceRowCount+=1;summary.sourceQtySum+=quantity;classMap.set(classification.classificationRaw,summary);}
    const cancelStatus=text(raw["취소구분"]);cancelValues.add(cancelStatus);const itemAmount=numeric(raw["상품구매금액(KRW)"]);const totalPayment=numeric(raw["총 결제금액(KRW)"]);
    if(!Number.isFinite(itemAmount)||itemAmount<0)throw new Error(`${sourceRowNumber}행: 상품구매금액(KRW)을 확인하세요.`);if(!Number.isFinite(totalPayment)||totalPayment<0)throw new Error(`${sourceRowNumber}행: 총 결제금액(KRW)을 확인하세요.`);
    return{sourceRowNumber,shippingNo,orderNo,lineOrderNo,originalProductName:productName,quantity,itemAmount,totalPaymentAmount:totalPayment,cancelStatus,mall:text(raw["쇼핑몰"]),ordererName:text(raw["주문자명"]),ordererPhone:"",recipientName:text(raw["수령인"]),classificationRaw:classification?.classificationRaw,eventMarker:classification?.eventMarker,eventType:classification?.eventType,classificationStatus:classification?"AUTO" as const:"REVIEW" as const,calculationIncluded:true,reviewMessage:classification?undefined:"주문상품명 앞 대괄호에서 행사 유형을 자동 분류하지 못했습니다.",originalRow:Object.fromEntries(BENEFIT_ORDER_HEADERS.map((header)=>[header,raw[header]??""]))};
  });
  if(duplicateLineOrderNos.size)throw new Error(`동일한 품목별 주문번호가 중복되었습니다: ${[...duplicateLineOrderNos].slice(0,10).join(", ")}`);
  return{rows:mapped,classifications:[...classMap.values()],cancelValues:[...cancelValues]};
}

export interface ParsedBenefitWinnerFile { rows:Array<Omit<BenefitWinnerRow,"id"|"importId">>; }
export async function parseBenefitWinnerFile(file:File):Promise<ParsedBenefitWinnerFile>{
  const{headers,rows}=await readRows(file);assertHeaders(headers,BENEFIT_WINNER_HEADERS,"당첨자자료");if(!rows.length)throw new Error("당첨자자료에 데이터 행이 없습니다.");
  return{rows:rows.map((raw,index)=>{
    const sourceRowNumber=index+2;const mall=text(raw["몰"]);const orderNo=text(raw["주문번호"]);const ordererName=text(raw["주문자명"]);const productName=text(raw["주문상품명"]);const quantity=numeric(raw["수량"]);
    if(!mall||!orderNo||!ordererName||!productName)throw new Error(`${sourceRowNumber}행: 몰, 주문번호, 주문자명, 주문상품명은 필수입니다.`);
    if(!Number.isFinite(quantity)||quantity<0||!Number.isInteger(quantity))throw new Error(`${sourceRowNumber}행: 수량 '${text(raw["수량"])}'은 0 이상의 정수여야 합니다.`);
    const classification=classifyBenefitProductName(productName);
    return{sourceRowNumber,mall,orderNo,ordererName,ordererPhone:text(raw["주문자 휴대전화"]),productName,applicantName:text(raw["01_응모자이름"]),quantity,eventType:classification?.eventType,classificationRaw:classification?.classificationRaw,photoBenefitRaw:text(raw["친사폴 당첨여부"]),isPhotoBenefit:isPhotoBenefitValue(raw["친사폴 당첨여부"]),matchStatus:classification?"PENDING":"REVIEW",matchMessage:classification?undefined:"당첨자 주문상품명에서 행사 유형을 추출할 수 없습니다.",originalRow:Object.fromEntries(BENEFIT_WINNER_HEADERS.map((header)=>[header,raw[header]??""]))};
  })};
}

function safeFileName(value:string):string{return value.replace(/[\\/:*?"<>|]+/g,"_").trim()||"benefit-result";}
export function downloadBenefitResultXlsx(input:{eventName:string;orderRows:BenefitOrderRow[];rules:BenefitRule[];calculation:BenefitCalculationOutput;}){
  const outputRows=input.orderRows.map((row)=>{
    const outcome=input.calculation.rowOutcomes[row.id];const record:Record<string,unknown>={...row.originalRow};const benefitTexts:string[]=[];
    for(const award of outcome?.benefits??[])benefitTexts.push(`${award.name} ${award.quantity}${award.unit}`);if(outcome?.isPhotoBenefit)benefitTexts.push("친사폴 1개");
    if(benefitTexts.length){const originalName=String(record["주문상품명(옵션포함)"]??row.originalProductName);record["주문상품명(옵션포함)"]=`${originalName} **특전: ${benefitTexts.join(" / ")}`;}
    if(outcome&&outcome.onsitePickupQty>0&&outcome.calculationStatus==="OK")record["수량"]=outcome.warehouseShipQty;
    return BENEFIT_ORDER_HEADERS.map((header)=>record[header]??"");
  });
  const worksheet=XLSX.utils.aoa_to_sheet([[...BENEFIT_ORDER_HEADERS],...outputRows]);worksheet["!cols"]=BENEFIT_ORDER_HEADERS.map((header)=>({wch:header==="주문상품명(옵션포함)"?80:header==="수령인 주소(전체)"?45:Math.min(28,Math.max(12,header.length+3))}));
  const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,worksheet,"송장 작업자료");const binary=XLSX.write(workbook,{type:"array",bookType:"xlsx"});const blob=new Blob([binary],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=`${safeFileName(input.eventName)}_특전계산_${new Date().toISOString().slice(0,10)}.xlsx`;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
