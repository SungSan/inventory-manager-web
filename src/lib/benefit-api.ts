import { getSupabaseClient, isDemoMode } from "@/lib/supabase";

export const BENEFIT_FEATURE_KEY = "BENEFIT_AUTOMATION";

export type BenefitEventStatus = "ACTIVE" | "ENDED";
export type BenefitRuleType = "QUANTITY" | "AMOUNT" | "PER_ORDER" | "PER_SHIPMENT";
export type BenefitClassificationStatus = "AUTO" | "REVIEW" | "MANUAL";

export interface BenefitFeatureGrant {
  userId: string;
  enabled: boolean;
  reason?: string;
  updatedAt?: string;
}

export interface BenefitEvent {
  id: string;
  name: string;
  salesStartAt: string;
  salesEndAt: string;
  salesChannel: string;
  isFansign: boolean;
  status: BenefitEventStatus;
  cancelNormalValues: string[];
  cancelExcludeValues: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BenefitEventClass {
  id: string;
  eventId: string;
  classificationRaw: string;
  eventMarker: string;
  eventType: string;
  isSelected: boolean;
  sourceRowCount: number;
  sourceQtySum: number;
  manualOverride: boolean;
}

export interface BenefitRule {
  id: string;
  eventId: string;
  name: string;
  ruleType: BenefitRuleType;
  thresholdValue: number;
  rewardQuantity: number;
  rewardUnit: string;
  repeatEnabled: boolean;
  oneTimeOnly: boolean;
  maximumRewardQuantity?: number;
  isActive: boolean;
  version: number;
  classIds: string[];
  eventTypes: string[];
}

export interface BenefitOrderImport {
  id: string;
  eventId: string;
  originalFileName: string;
  fileHash: string;
  importVersion: number;
  rowCount: number;
  uploadedAt: string;
  status: string;
}

export interface BenefitOrderRow {
  id: string;
  importId: string;
  sourceRowNumber: number;
  shippingNo: string;
  orderNo: string;
  lineOrderNo: string;
  originalProductName: string;
  quantity: number;
  itemAmount: number;
  totalPaymentAmount: number;
  cancelStatus: string;
  mall: string;
  ordererName: string;
  ordererPhone: string;
  recipientName: string;
  classificationRaw?: string;
  eventMarker?: string;
  eventType?: string;
  classificationStatus: BenefitClassificationStatus;
  calculationIncluded: boolean;
  reviewMessage?: string;
  originalRow: Record<string, unknown>;
}

export interface BenefitWinnerImport {
  id: string;
  eventId: string;
  originalFileName: string;
  fileHash: string;
  importVersion: number;
  rowCount: number;
  uploadedAt: string;
  status: string;
}

export interface BenefitWinnerRow {
  id: string;
  importId: string;
  sourceRowNumber: number;
  mall: string;
  orderNo: string;
  ordererName: string;
  ordererPhone: string;
  productName: string;
  applicantName: string;
  quantity: number;
  eventType?: string;
  classificationRaw?: string;
  photoBenefitRaw: string;
  isPhotoBenefit: boolean;
  matchStatus: string;
  matchMessage?: string;
  matchedOrderRowId?: string;
  originalRow: Record<string, unknown>;
}

export interface BenefitCalculationRun {
  id: string;
  eventId: string;
  orderImportId: string;
  winnerImportId?: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  resultHash?: string;
  summary: Record<string, unknown>;
}

export interface BenefitCalculationResultRecord {
  shippingNo: string;
  orderNo: string;
  eventType: string;
  purchaseQty: number;
  benefitBasisQty: number;
  onsitePickupQty: number;
  warehouseShipQty: number;
  isWinner: boolean;
  isPhotoBenefit: boolean;
  benefits: unknown[];
  calculationStatus: string;
  reviewMessage?: string;
  representativeSourceRowId?: string;
}

function client() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");
  return supabase;
}

function isMissingDatabaseObject(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  return error.code === "PGRST202"
    || error.code === "42P01"
    || error.code === "42883"
    || message.includes("does not exist")
    || message.includes("could not find the function");
}

function databaseSetupError(error: { code?: string; message?: string } | null): Error {
  if (isMissingDatabaseObject(error)) {
    return new Error("특전 자동계산 DB 기능이 아직 적용되지 않았습니다. 관리자에게 SQL 43 실행을 요청하세요.");
  }
  return new Error(error?.message || "특전 자동계산 DB 처리 중 오류가 발생했습니다.");
}

export async function getMyBenefitFeatureAccess(): Promise<boolean> {
  if (isDemoMode()) return false;
  const { data, error } = await client().rpc("get_my_feature_access", { p_feature_key: BENEFIT_FEATURE_KEY });
  if (error) {
    if (isMissingDatabaseObject(error)) return false;
    throw new Error(error.message);
  }
  return Boolean(data);
}

export async function adminListBenefitFeatureGrants(): Promise<BenefitFeatureGrant[]> {
  const { data, error } = await client().rpc("admin_list_user_feature_grants", { p_feature_key: BENEFIT_FEATURE_KEY });
  if (error) {
    if (isMissingDatabaseObject(error)) return [];
    throw new Error(error.message);
  }
  return (Array.isArray(data) ? data : []).map((row) => {
    const value = row as Record<string, unknown>;
    return {
      userId: String(value.user_id ?? ""),
      enabled: Boolean(value.enabled),
      reason: value.reason == null ? undefined : String(value.reason),
      updatedAt: value.updated_at == null ? undefined : String(value.updated_at),
    };
  });
}

export async function adminSetBenefitFeatureGrant(userId: string, enabled: boolean, reason: string): Promise<void> {
  const { error } = await client().rpc("admin_set_user_feature_grant", {
    p_user_id: userId,
    p_feature_key: BENEFIT_FEATURE_KEY,
    p_enabled: enabled,
    p_reason: reason,
  });
  if (error) throw databaseSetupError(error);
}

function mapEvent(row: Record<string, unknown>): BenefitEvent {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    salesStartAt: String(row.sales_start_at ?? ""),
    salesEndAt: String(row.sales_end_at ?? ""),
    salesChannel: String(row.sales_channel ?? ""),
    isFansign: Boolean(row.is_fansign),
    status: String(row.status || "ACTIVE") as BenefitEventStatus,
    cancelNormalValues: Array.isArray(row.cancel_normal_values) ? row.cancel_normal_values.map(String) : ["", "N", "정상"],
    cancelExcludeValues: Array.isArray(row.cancel_exclude_values) ? row.cancel_exclude_values.map(String) : [],
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function listBenefitEvents(): Promise<BenefitEvent[]> {
  const { data, error } = await client().from("benefit_events").select("*").order("created_at", { ascending: false });
  if (error) throw databaseSetupError(error);
  return (data ?? []).map((row) => mapEvent(row as Record<string, unknown>));
}

export async function getBenefitEvent(id: string): Promise<BenefitEvent> {
  const { data, error } = await client().from("benefit_events").select("*").eq("id", id).single();
  if (error) throw databaseSetupError(error);
  return mapEvent(data as Record<string, unknown>);
}

export async function createBenefitEvent(input: {
  name: string;
  salesStartAt: string;
  salesEndAt: string;
  salesChannel: string;
  isFansign: boolean;
}): Promise<BenefitEvent> {
  const { data, error } = await client().from("benefit_events").insert({
    name: input.name.trim(),
    sales_start_at: input.salesStartAt,
    sales_end_at: input.salesEndAt,
    sales_channel: input.salesChannel.trim(),
    is_fansign: input.isFansign,
  }).select("*").single();
  if (error) throw databaseSetupError(error);
  return mapEvent(data as Record<string, unknown>);
}

export async function updateBenefitEvent(id: string, patch: Partial<{
  name: string;
  salesStartAt: string;
  salesEndAt: string;
  salesChannel: string;
  isFansign: boolean;
  status: BenefitEventStatus;
  cancelNormalValues: string[];
  cancelExcludeValues: string[];
}>): Promise<BenefitEvent> {
  const values: Record<string, unknown> = {};
  if (patch.name !== undefined) values.name = patch.name.trim();
  if (patch.salesStartAt !== undefined) values.sales_start_at = patch.salesStartAt;
  if (patch.salesEndAt !== undefined) values.sales_end_at = patch.salesEndAt;
  if (patch.salesChannel !== undefined) values.sales_channel = patch.salesChannel.trim();
  if (patch.isFansign !== undefined) values.is_fansign = patch.isFansign;
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.cancelNormalValues !== undefined) values.cancel_normal_values = patch.cancelNormalValues;
  if (patch.cancelExcludeValues !== undefined) values.cancel_exclude_values = patch.cancelExcludeValues;
  const { data, error } = await client().from("benefit_events").update(values).eq("id", id).select("*").single();
  if (error) throw databaseSetupError(error);
  return mapEvent(data as Record<string, unknown>);
}

function mapClass(row: Record<string, unknown>): BenefitEventClass {
  return {
    id: String(row.id ?? ""), eventId: String(row.event_id ?? ""), classificationRaw: String(row.classification_raw ?? ""),
    eventMarker: String(row.event_marker ?? ""), eventType: String(row.event_type ?? ""), isSelected: Boolean(row.is_selected),
    sourceRowCount: Number(row.source_row_count ?? 0), sourceQtySum: Number(row.source_qty_sum ?? 0), manualOverride: Boolean(row.manual_override),
  };
}

export async function listBenefitEventClasses(eventId: string): Promise<BenefitEventClass[]> {
  const { data, error } = await client().from("benefit_event_classes").select("*").eq("event_id", eventId).order("event_type");
  if (error) throw databaseSetupError(error);
  return (data ?? []).map((row) => mapClass(row as Record<string, unknown>));
}

export async function replaceBenefitEventClasses(eventId: string, rows: Array<{
  classificationRaw: string; eventMarker: string; eventType: string; sourceRowCount: number; sourceQtySum: number; manualOverride?: boolean;
}>): Promise<BenefitEventClass[]> {
  const existing = await listBenefitEventClasses(eventId);
  const selectedByRaw = new Map(existing.map((item) => [item.classificationRaw, item.isSelected]));
  if (rows.length) {
    const payload = rows.map((row) => ({
      event_id: eventId,
      classification_raw: row.classificationRaw,
      event_marker: row.eventMarker,
      event_type: row.eventType,
      is_selected: selectedByRaw.get(row.classificationRaw) ?? true,
      source_row_count: row.sourceRowCount,
      source_qty_sum: row.sourceQtySum,
      manual_override: Boolean(row.manualOverride),
    }));
    const { error } = await client().from("benefit_event_classes").upsert(payload, { onConflict: "event_id,classification_raw" });
    if (error) throw databaseSetupError(error);
  }
  return listBenefitEventClasses(eventId);
}

export async function setBenefitEventClassSelected(classId: string, selected: boolean): Promise<void> {
  const { error } = await client().from("benefit_event_classes").update({ is_selected: selected }).eq("id", classId);
  if (error) throw databaseSetupError(error);
}

function mapRule(row: Record<string, unknown>, classIds: string[] = [], eventTypes: string[] = []): BenefitRule {
  return {
    id: String(row.id ?? ""), eventId: String(row.event_id ?? ""), name: String(row.name ?? ""),
    ruleType: String(row.rule_type || "QUANTITY") as BenefitRuleType,
    thresholdValue: Number(row.threshold_value ?? 1), rewardQuantity: Number(row.reward_quantity ?? 1), rewardUnit: String(row.reward_unit || "장"),
    repeatEnabled: Boolean(row.repeat_enabled), oneTimeOnly: Boolean(row.one_time_only),
    maximumRewardQuantity: row.maximum_reward_quantity == null ? undefined : Number(row.maximum_reward_quantity),
    isActive: Boolean(row.is_active), version: Number(row.version ?? 1), classIds, eventTypes,
  };
}

export async function listBenefitRules(eventId: string, classes?: BenefitEventClass[]): Promise<BenefitRule[]> {
  const [{ data: rules, error: ruleError }, { data: links, error: linkError }] = await Promise.all([
    client().from("benefit_rules").select("*").eq("event_id", eventId).order("created_at"),
    client().from("benefit_rule_classes").select("rule_id,event_class_id,benefit_event_classes!inner(event_id,event_type)").eq("benefit_event_classes.event_id", eventId),
  ]);
  if (ruleError) throw databaseSetupError(ruleError);
  if (linkError) throw databaseSetupError(linkError);
  const classMap = new Map((classes ?? await listBenefitEventClasses(eventId)).map((item) => [item.id, item.eventType]));
  const idsByRule = new Map<string, string[]>();
  for (const link of links ?? []) {
    const value = link as Record<string, unknown>;
    const ruleId = String(value.rule_id ?? "");
    const classId = String(value.event_class_id ?? "");
    idsByRule.set(ruleId, [...(idsByRule.get(ruleId) ?? []), classId]);
  }
  return (rules ?? []).map((row) => {
    const value = row as Record<string, unknown>;
    const id = String(value.id ?? "");
    const classIds = idsByRule.get(id) ?? [];
    return mapRule(value, classIds, classIds.map((classId) => classMap.get(classId) ?? "").filter(Boolean));
  });
}

export async function saveBenefitRule(input: Omit<BenefitRule, "id" | "version" | "eventTypes"> & { id?: string }): Promise<BenefitRule> {
  if (input.classIds.length === 0) throw new Error("적용할 행사 유형을 하나 이상 선택하세요.");
  const payload = {
    event_id: input.eventId,
    name: input.name.trim(),
    rule_type: input.ruleType,
    threshold_value: input.thresholdValue,
    reward_quantity: input.rewardQuantity,
    reward_unit: input.rewardUnit.trim() || "장",
    repeat_enabled: input.repeatEnabled,
    one_time_only: input.oneTimeOnly,
    maximum_reward_quantity: input.maximumRewardQuantity ?? null,
    is_active: input.isActive,
  };
  let ruleId = input.id;
  if (ruleId) {
    const { data, error } = await client().from("benefit_rules").update(payload).eq("id", ruleId).select("id").single();
    if (error) throw databaseSetupError(error);
    ruleId = String(data.id);
  } else {
    const { data, error } = await client().from("benefit_rules").insert(payload).select("id").single();
    if (error) throw databaseSetupError(error);
    ruleId = String(data.id);
  }
  const { error: deleteError } = await client().from("benefit_rule_classes").delete().eq("rule_id", ruleId);
  if (deleteError) throw databaseSetupError(deleteError);
  const { error: insertError } = await client().from("benefit_rule_classes").insert(input.classIds.map((eventClassId) => ({ rule_id: ruleId, event_class_id: eventClassId })));
  if (insertError) throw databaseSetupError(insertError);
  const rules = await listBenefitRules(input.eventId);
  const saved = rules.find((rule) => rule.id === ruleId);
  if (!saved) throw new Error("저장된 특전 규칙을 다시 불러오지 못했습니다.");
  return saved;
}

export async function deleteBenefitRule(ruleId: string): Promise<void> {
  const { error } = await client().from("benefit_rules").delete().eq("id", ruleId);
  if (error) throw databaseSetupError(error);
}

function mapOrderImport(row: Record<string, unknown>): BenefitOrderImport {
  return { id:String(row.id??""),eventId:String(row.event_id??""),originalFileName:String(row.original_file_name??""),fileHash:String(row.file_hash??""),importVersion:Number(row.import_version??0),rowCount:Number(row.row_count??0),uploadedAt:String(row.uploaded_at??""),status:String(row.status??"") };
}

function mapWinnerImport(row: Record<string, unknown>): BenefitWinnerImport {
  return { id:String(row.id??""),eventId:String(row.event_id??""),originalFileName:String(row.original_file_name??""),fileHash:String(row.file_hash??""),importVersion:Number(row.import_version??0),rowCount:Number(row.row_count??0),uploadedAt:String(row.uploaded_at??""),status:String(row.status??"") };
}

export async function listBenefitOrderImports(eventId: string): Promise<BenefitOrderImport[]> {
  const { data,error }=await client().from("benefit_order_imports").select("*").eq("event_id",eventId).order("import_version",{ascending:false});
  if(error)throw databaseSetupError(error); return (data??[]).map((row)=>mapOrderImport(row as Record<string,unknown>));
}

export async function createBenefitOrderImport(eventId:string,fileName:string,fileHash:string,rowCount:number):Promise<BenefitOrderImport>{
  const imports=await listBenefitOrderImports(eventId); const version=(imports[0]?.importVersion??0)+1;
  const {data,error}=await client().from("benefit_order_imports").insert({event_id:eventId,original_file_name:fileName,file_hash:fileHash,import_version:version,row_count:rowCount}).select("*").single();
  if(error)throw databaseSetupError(error);
  if(imports.length){await client().from("benefit_order_imports").update({status:"SUPERSEDED"}).eq("event_id",eventId).neq("id",String(data.id)).eq("status","IMPORTED");}
  return mapOrderImport(data as Record<string,unknown>);
}

async function insertChunks(table:string,rows:Record<string,unknown>[],size=500):Promise<void>{
  for(let offset=0;offset<rows.length;offset+=size){const{error}=await client().from(table).insert(rows.slice(offset,offset+size));if(error)throw databaseSetupError(error);}
}

export async function insertBenefitOrderRows(importId:string,rows:Array<Omit<BenefitOrderRow,"id"|"importId">>):Promise<void>{
  await insertChunks("benefit_order_rows",rows.map((row)=>({import_id:importId,source_row_number:row.sourceRowNumber,shipping_no:row.shippingNo,order_no:row.orderNo,line_order_no:row.lineOrderNo,original_product_name:row.originalProductName,quantity:row.quantity,item_amount:row.itemAmount,total_payment_amount:row.totalPaymentAmount,cancel_status:row.cancelStatus,mall:row.mall,orderer_name:row.ordererName,orderer_phone:row.ordererPhone,recipient_name:row.recipientName,classification_raw:row.classificationRaw??null,event_marker:row.eventMarker??null,event_type:row.eventType??null,classification_status:row.classificationStatus,calculation_included:row.calculationIncluded,review_message:row.reviewMessage??null,original_row:row.originalRow})));
}

function mapOrderRow(row:Record<string,unknown>):BenefitOrderRow{return{id:String(row.id??""),importId:String(row.import_id??""),sourceRowNumber:Number(row.source_row_number??0),shippingNo:String(row.shipping_no??""),orderNo:String(row.order_no??""),lineOrderNo:String(row.line_order_no??""),originalProductName:String(row.original_product_name??""),quantity:Number(row.quantity??0),itemAmount:Number(row.item_amount??0),totalPaymentAmount:Number(row.total_payment_amount??0),cancelStatus:String(row.cancel_status??""),mall:String(row.mall??""),ordererName:String(row.orderer_name??""),ordererPhone:String(row.orderer_phone??""),recipientName:String(row.recipient_name??""),classificationRaw:row.classification_raw==null?undefined:String(row.classification_raw),eventMarker:row.event_marker==null?undefined:String(row.event_marker),eventType:row.event_type==null?undefined:String(row.event_type),classificationStatus:String(row.classification_status||"AUTO") as BenefitClassificationStatus,calculationIncluded:Boolean(row.calculation_included),reviewMessage:row.review_message==null?undefined:String(row.review_message),originalRow:(row.original_row??{}) as Record<string,unknown>};}

async function selectAllRows<T>(table:string,filterColumn:string,filterValue:string,mapper:(row:Record<string,unknown>)=>T):Promise<T[]>{
  const result:T[]=[]; const pageSize=1000;
  for(let from=0;;from+=pageSize){const{data,error}=await client().from(table).select("*").eq(filterColumn,filterValue).order("source_row_number").range(from,from+pageSize-1);if(error)throw databaseSetupError(error);const rows=data??[];result.push(...rows.map((row)=>mapper(row as Record<string,unknown>)));if(rows.length<pageSize)break;}
  return result;
}

export function listBenefitOrderRows(importId:string):Promise<BenefitOrderRow[]>{return selectAllRows("benefit_order_rows","import_id",importId,mapOrderRow);}

export async function updateBenefitOrderRowClassification(rowId:string,input:{classificationRaw:string;eventMarker:string;eventType:string;included?:boolean}):Promise<void>{
  const{error}=await client().from("benefit_order_rows").update({classification_raw:input.classificationRaw,event_marker:input.eventMarker,event_type:input.eventType,classification_status:"MANUAL",calculation_included:input.included??true,review_message:null,manual_classified_by:(await client().auth.getUser()).data.user?.id??null,manual_classified_at:new Date().toISOString()}).eq("id",rowId);if(error)throw databaseSetupError(error);
}

export async function listBenefitWinnerImports(eventId:string):Promise<BenefitWinnerImport[]>{const{data,error}=await client().from("benefit_winner_imports").select("*").eq("event_id",eventId).order("import_version",{ascending:false});if(error)throw databaseSetupError(error);return(data??[]).map((row)=>mapWinnerImport(row as Record<string,unknown>));}

export async function createBenefitWinnerImport(eventId:string,fileName:string,fileHash:string,rowCount:number):Promise<BenefitWinnerImport>{const imports=await listBenefitWinnerImports(eventId);const version=(imports[0]?.importVersion??0)+1;const{data,error}=await client().from("benefit_winner_imports").insert({event_id:eventId,original_file_name:fileName,file_hash:fileHash,import_version:version,row_count:rowCount}).select("*").single();if(error)throw databaseSetupError(error);if(imports.length){await client().from("benefit_winner_imports").update({status:"SUPERSEDED"}).eq("event_id",eventId).neq("id",String(data.id)).eq("status","IMPORTED");}return mapWinnerImport(data as Record<string,unknown>);}

export async function insertBenefitWinnerRows(importId:string,rows:Array<Omit<BenefitWinnerRow,"id"|"importId">>):Promise<void>{await insertChunks("benefit_winner_rows",rows.map((row)=>({import_id:importId,source_row_number:row.sourceRowNumber,mall:row.mall,order_no:row.orderNo,orderer_name:row.ordererName,orderer_phone:row.ordererPhone,product_name:row.productName,applicant_name:row.applicantName,quantity:row.quantity,event_type:row.eventType??null,classification_raw:row.classificationRaw??null,photo_benefit_raw:row.photoBenefitRaw,is_photo_benefit:row.isPhotoBenefit,match_status:row.matchStatus,match_message:row.matchMessage??null,matched_order_row_id:row.matchedOrderRowId??null,original_row:row.originalRow})));}

function mapWinnerRow(row:Record<string,unknown>):BenefitWinnerRow{return{id:String(row.id??""),importId:String(row.import_id??""),sourceRowNumber:Number(row.source_row_number??0),mall:String(row.mall??""),orderNo:String(row.order_no??""),ordererName:String(row.orderer_name??""),ordererPhone:String(row.orderer_phone??""),productName:String(row.product_name??""),applicantName:String(row.applicant_name??""),quantity:Number(row.quantity??0),eventType:row.event_type==null?undefined:String(row.event_type),classificationRaw:row.classification_raw==null?undefined:String(row.classification_raw),photoBenefitRaw:String(row.photo_benefit_raw??""),isPhotoBenefit:Boolean(row.is_photo_benefit),matchStatus:String(row.match_status??"PENDING"),matchMessage:row.match_message==null?undefined:String(row.match_message),matchedOrderRowId:row.matched_order_row_id==null?undefined:String(row.matched_order_row_id),originalRow:(row.original_row??{}) as Record<string,unknown>};}
export function listBenefitWinnerRows(importId:string):Promise<BenefitWinnerRow[]>{return selectAllRows("benefit_winner_rows","import_id",importId,mapWinnerRow);}

export async function updateBenefitWinnerMatch(rowId:string,input:{status:string;message?:string;matchedOrderRowId?:string}):Promise<void>{const{error}=await client().from("benefit_winner_rows").update({match_status:input.status,match_message:input.message??null,matched_order_row_id:input.matchedOrderRowId??null}).eq("id",rowId);if(error)throw databaseSetupError(error);}

export async function saveBenefitCalculation(input:{eventId:string;orderImportId:string;winnerImportId?:string;rules:BenefitRule[];classes:BenefitEventClass[];summary:Record<string,unknown>;resultHash:string;reviewRequired:boolean;results:BenefitCalculationResultRecord[]}):Promise<BenefitCalculationRun>{
  const{data,error}=await client().from("benefit_calculation_runs").insert({event_id:input.eventId,order_import_id:input.orderImportId,winner_import_id:input.winnerImportId??null,rule_version_snapshot:input.rules,selected_classes_snapshot:input.classes.filter((item)=>item.isSelected),status:input.reviewRequired?"REVIEW_REQUIRED":"COMPLETED",completed_at:new Date().toISOString(),result_hash:input.resultHash,summary:input.summary}).select("*").single();if(error)throw databaseSetupError(error);
  const runId=String(data.id);
  if(input.results.length){await insertChunks("benefit_calculation_results",input.results.map((row)=>({run_id:runId,shipping_no:row.shippingNo,order_no:row.orderNo,event_type:row.eventType,purchase_qty:row.purchaseQty,benefit_basis_qty:row.benefitBasisQty,onsite_pickup_qty:row.onsitePickupQty,warehouse_ship_qty:row.warehouseShipQty,is_winner:row.isWinner,is_photo_benefit:row.isPhotoBenefit,benefits:row.benefits,calculation_status:row.calculationStatus,review_message:row.reviewMessage??null,representative_source_row_id:row.representativeSourceRowId??null})));}
  const value=data as Record<string,unknown>;return{id:runId,eventId:String(value.event_id??""),orderImportId:String(value.order_import_id??""),winnerImportId:value.winner_import_id==null?undefined:String(value.winner_import_id),status:String(value.status??""),startedAt:String(value.started_at??""),completedAt:value.completed_at==null?undefined:String(value.completed_at),resultHash:value.result_hash==null?undefined:String(value.result_hash),summary:(value.summary??{}) as Record<string,unknown>};
}
