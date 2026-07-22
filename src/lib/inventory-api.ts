import {
  demoCreateLocation,
  demoCreateProduct,
  demoGetCurrentUser,
  demoImportInventoryRows,
  demoListAuditLogs,
  demoListBarcodes,
  demoListInventory,
  demoListLocations,
  demoListProducts,
  demoListRecentTransactions,
  demoListScanEvents,
  demoListTargets,
  demoListTransactions,
  demoListUsers,
  demoPostMovement,
  demoRegisterBarcode,
  demoResolveBarcode,
  demoResolveBarcodes,
  demoReverseTransaction,
  demoSetCurrentUser,
  demoSubscribe,
  demoUpdateBarcode,
  demoUpdateLocation,
  demoUpdateProduct,
  demoUpdateUserRole,
  exportDemoData,
  resetDemoData,
} from "@/lib/demo-store";
import { getSupabaseClient, isDemoMode } from "@/lib/supabase";
import type {
  AuditLog,
  BarcodeRecord,
  BarcodeRegistrationInput,
  ImportInventoryRow,
  ImportResult,
  InventoryRow,
  InventoryTransaction,
  Location,
  LocationInput,
  MovementInput,
  MovementResult,
  Product,
  ProductInput,
  ResolvedBarcode,
  ScannableTargetOption,
  ScanEvent,
  UserProfile,
  UserRole,
} from "@/types/domain";

function client() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");
  return supabase;
}

function firstValue(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? value as Record<string, unknown> : {};
}

function mapProduct(row: Record<string, unknown>): Product {
  return {
    id: String(firstValue(row, "id", "product_id", "productId") ?? ""),
    scanTargetId: String(firstValue(row, "scan_target_id", "scanTargetId") ?? ""),
    pCodeNo: String(firstValue(row, "p_code_no", "pCodeNo") ?? ""),
    codeNo: String(firstValue(row, "code_no", "codeNo") ?? ""),
    masterCodeNo: String(firstValue(row, "master_code_no", "masterCodeNo") ?? ""),
    artist: String(firstValue(row, "artist") ?? ""),
    nameVer: String(firstValue(row, "name_ver", "nameVer") ?? ""),
    active: firstValue(row, "active") === undefined ? true : Boolean(firstValue(row, "active")),
    createdAt: firstValue(row, "created_at", "createdAt") ? String(firstValue(row, "created_at", "createdAt")) : undefined,
    updatedAt: firstValue(row, "updated_at", "updatedAt") ? String(firstValue(row, "updated_at", "updatedAt")) : undefined,
  };
}

function mapLocation(row: Record<string, unknown>): Location {
  return {
    id: String(firstValue(row, "id", "location_id", "locationId") ?? ""),
    scanTargetId: String(firstValue(row, "scan_target_id", "scanTargetId") ?? ""),
    locationCode: String(firstValue(row, "location_code", "locationCode") ?? ""),
    zone: String(firstValue(row, "zone") ?? ""),
    active: firstValue(row, "active") === undefined ? true : Boolean(firstValue(row, "active")),
    createdAt: firstValue(row, "created_at", "createdAt") ? String(firstValue(row, "created_at", "createdAt")) : undefined,
    updatedAt: firstValue(row, "updated_at", "updatedAt") ? String(firstValue(row, "updated_at", "updatedAt")) : undefined,
  };
}

function mapResolvedBarcode(row: Record<string, unknown>): ResolvedBarcode {
  const targetType = String(firstValue(row, "target_type", "targetType") ?? "").toLowerCase();
  const targetData = asRecord(firstValue(row, "target_data", "targetData"));
  const scanTargetId = String(firstValue(row, "scan_target_id", "scanTargetId", "scan_target") ?? firstValue(targetData, "scan_target_id", "scanTargetId") ?? "");
  const targetId = String(firstValue(row, "target_id", "targetId") ?? firstValue(targetData, "id") ?? "");
  const barcodeId = String(firstValue(row, "barcode_id", "barcodeId", "id") ?? "");
  const barcodeValue = String(firstValue(row, "barcode_value", "barcodeValue") ?? "");

  if (targetType === "product") {
    const product = mapProduct({ ...targetData, id: targetId || firstValue(targetData, "id"), scan_target_id: scanTargetId });
    if (!product.id) throw new Error("상품 바코드 응답에 상품 ID가 없습니다. Supabase 스키마를 업데이트하세요.");
    return {
      barcodeId,
      barcodeValue,
      targetType: "product",
      targetId: product.id,
      target: { type: "product", product },
    };
  }
  if (targetType === "location") {
    const location = mapLocation({ ...targetData, id: targetId || firstValue(targetData, "id"), scan_target_id: scanTargetId });
    if (!location.id) throw new Error("로케이션 바코드 응답에 로케이션 ID가 없습니다. Supabase 스키마를 업데이트하세요.");
    return {
      barcodeId,
      barcodeValue,
      targetType: "location",
      targetId: location.id,
      target: { type: "location", location },
    };
  }
  return {
    barcodeId,
    barcodeValue,
    targetType: targetType || "unknown",
    targetId,
    target: { type: targetType || "unknown", label: String(firstValue(targetData, "label") ?? barcodeValue), data: targetData },
  };
}

export async function getCurrentUser(): Promise<UserProfile> {
  if (isDemoMode()) return demoGetCurrentUser();
  const supabase = client();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("로그인이 필요합니다.");
  const { data, error } = await supabase.from("profiles").select("*").eq("id", authData.user.id).single();
  if (error) throw new Error(error.message);
  return { id: data.id, email: data.email ?? authData.user.email ?? "", displayName: data.display_name ?? data.email ?? "사용자", role: data.role, active: data.active };
}

export async function setCurrentDemoUser(userId: string): Promise<void> {
  if (!isDemoMode()) return;
  return demoSetCurrentUser(userId);
}

export async function listUsers(): Promise<UserProfile[]> {
  if (isDemoMode()) return demoListUsers();
  const { data, error } = await client().from("profiles").select("*").order("display_name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id, email: row.email ?? "", displayName: row.display_name ?? row.email ?? "사용자", role: row.role, active: row.active }));
}

export async function updateUserRole(userId: string, role: UserRole): Promise<void> {
  if (isDemoMode()) return demoUpdateUserRole(userId, role);
  const { error } = await client().rpc("update_user_role", { p_user_id: userId, p_role: role });
  if (error) throw new Error(error.message);
}

export async function resolveBarcodeCandidates(
  value: string,
  expectedTargetType?: "product" | "location",
  context = "LOOKUP",
): Promise<ResolvedBarcode[]> {
  if (isDemoMode()) return demoResolveBarcodes(value, expectedTargetType, context);
  const { data, error } = await client().rpc("resolve_barcode_logged", {
    p_barcode_value: value,
    p_expected_target_type: expectedTargetType ?? null,
    p_context: context,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapResolvedBarcode(row as Record<string, unknown>));
}

export async function resolveBarcode(
  value: string,
  expectedTargetType?: "product" | "location",
  context = "LOOKUP",
): Promise<ResolvedBarcode | null> {
  const matches = await resolveBarcodeCandidates(value, expectedTargetType, context);
  return matches[0] ?? null;
}

export async function postInventoryMovement(input: MovementInput): Promise<MovementResult> {
  if (isDemoMode()) return demoPostMovement(input);
  const { data, error } = await client().rpc("post_inventory_movement", {
    p_operation: input.operation,
    p_product_barcode: input.productBarcode,
    p_location_barcode: input.locationBarcode,
    p_product_id: input.productId ?? null,
    p_location_id: input.locationId ?? null,
    p_quantity: input.quantity,
    p_idempotency_key: input.idempotencyKey,
    p_note: input.note ?? null,
    p_reference_type: input.referenceType ?? null,
    p_reference_id: input.referenceId ?? null,
  });
  if (error) throw new Error(error.message);
  const result = data as Record<string, unknown>;
  return {
    transactionId: String(result.transaction_id), operation: input.operation,
    product: mapProduct(result.product as Record<string, unknown>),
    location: mapLocation(result.location as Record<string, unknown>),
    beforeQty: Number(result.before_qty), afterQty: Number(result.after_qty), quantity: Number(result.quantity),
  };
}

export async function reverseTransaction(transactionId: string, reason: string): Promise<InventoryTransaction> {
  if (isDemoMode()) return demoReverseTransaction(transactionId, reason);
  const { data, error } = await client().rpc("reverse_inventory_transaction", { p_transaction_id: transactionId, p_reason: reason });
  if (error) throw new Error(error.message);
  return data as InventoryTransaction;
}

export async function listInventory(search = ""): Promise<InventoryRow[]> {
  if (isDemoMode()) return demoListInventory(search);
  let query = client().from("inventory_stock_view").select("*").order("location_code");
  if (search.trim()) {
    const keyword = search.trim();
    query = query.or([`p_code_no.ilike.%${keyword}%`, `code_no.ilike.%${keyword}%`, `master_code_no.ilike.%${keyword}%`, `artist.ilike.%${keyword}%`, `name_ver.ilike.%${keyword}%`, `location_code.ilike.%${keyword}%`].join(","));
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    productId: row.product_id, locationId: row.location_id, pCodeNo: row.p_code_no ?? "", codeNo: row.code_no ?? "",
    masterCodeNo: row.master_code_no ?? "", artist: row.artist ?? "", nameVer: row.name_ver ?? "",
    locationCode: row.location_code, zone: row.zone ?? "", qty: Number(row.qty), updatedAt: row.updated_at,
  }));
}

function mapTransaction(row: Record<string, unknown>): InventoryTransaction {
  return {
    id: String(row.id), operation: row.operation as "IB" | "OB", status: (row.status ?? "ACTIVE") as InventoryTransaction["status"],
    productId: String(row.product_id), locationId: String(row.location_id), productLabel: String(row.product_label ?? [row.artist, row.name_ver].filter(Boolean).join(" ")),
    locationCode: String(row.location_code), qty: Number(row.qty), beforeQty: Number(row.before_qty), afterQty: Number(row.after_qty),
    productBarcodeValue: String(row.product_barcode_value), locationBarcodeValue: String(row.location_barcode_value), createdAt: String(row.created_at),
    note: row.note ? String(row.note) : undefined, actorId: row.actor_id ? String(row.actor_id) : undefined, actorLabel: row.actor_label ? String(row.actor_label) : undefined,
    reversalOf: row.reversal_of ? String(row.reversal_of) : undefined, reversedBy: row.reversed_by ? String(row.reversed_by) : undefined,
    referenceType: row.reference_type ? String(row.reference_type) : undefined, referenceId: row.reference_id ? String(row.reference_id) : undefined,
  };
}

export async function listTransactions(search = "", operation = "ALL", limit = 500): Promise<InventoryTransaction[]> {
  if (isDemoMode()) return demoListTransactions(search, operation, limit);
  let query = client().from("inventory_transaction_view").select("*").order("created_at", { ascending: false }).limit(limit);
  if (operation !== "ALL") query = query.eq("operation", operation);
  if (search.trim()) query = query.ilike("search_text", `%${search.trim()}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapTransaction(row));
}

export async function listRecentTransactions(limit = 20): Promise<InventoryTransaction[]> {
  if (isDemoMode()) return demoListRecentTransactions(limit);
  const { data, error } = await client().from("inventory_transaction_view").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapTransaction(row));
}

export async function listProducts(search = "", includeInactive = true): Promise<Product[]> {
  if (isDemoMode()) return demoListProducts(search, includeInactive);
  let query = client().from("products").select("*").order("artist").order("name_ver");
  if (!includeInactive) query = query.eq("active", true);
  if (search.trim()) query = query.or([`p_code_no.ilike.%${search}%`, `code_no.ilike.%${search}%`, `master_code_no.ilike.%${search}%`, `artist.ilike.%${search}%`, `name_ver.ilike.%${search}%`].join(","));
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapProduct(row));
}

export async function createProduct(input: ProductInput): Promise<Product> {
  if (isDemoMode()) return demoCreateProduct(input);
  const { data, error } = await client().rpc("create_product_with_target", {
    p_p_code_no: input.pCodeNo, p_code_no: input.codeNo, p_master_code_no: input.masterCodeNo,
    p_artist: input.artist, p_name_ver: input.nameVer, p_primary_barcode: input.primaryBarcode,
    p_barcode_source: input.barcodeSource ?? "manufacturer", p_symbology: "AUTO",
  });
  if (error) throw new Error(error.message);
  const products = await listProducts(input.codeNo);
  const product = products.find((item) => item.id === data) ?? products[0];
  if (!product) throw new Error("생성된 상품을 불러올 수 없습니다.");
  return product;
}

export async function updateProduct(productId: string, patch: Partial<Product>): Promise<Product> {
  if (isDemoMode()) return demoUpdateProduct(productId, patch);
  const { data, error } = await client().rpc("update_product", {
    p_product_id: productId,
    p_new_p_code_no: patch.pCodeNo ?? null,
    p_new_code_no: patch.codeNo ?? null,
    p_new_master_code_no: patch.masterCodeNo ?? null,
    p_new_artist: patch.artist ?? null,
    p_new_name_ver: patch.nameVer ?? null,
    p_new_active: patch.active ?? null,
  });
  if (error) throw new Error(error.message);
  return mapProduct(data as Record<string, unknown>);
}

export async function listLocations(search = "", includeInactive = true): Promise<Location[]> {
  if (isDemoMode()) return demoListLocations(search, includeInactive);
  let query = client().from("locations").select("*").order("location_code");
  if (!includeInactive) query = query.eq("active", true);
  if (search.trim()) query = query.or(`location_code.ilike.%${search}%,zone.ilike.%${search}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapLocation(row));
}

export async function createLocation(input: LocationInput): Promise<Location> {
  if (isDemoMode()) return demoCreateLocation(input);
  const { data, error } = await client().rpc("create_location_with_target", { p_location_code: input.locationCode, p_zone: input.zone, p_barcode_value: input.barcodeValue ?? null, p_symbology: "CODE-128" });
  if (error) throw new Error(error.message);
  const locations = await listLocations(input.locationCode);
  const location = locations.find((item) => item.id === data) ?? locations[0];
  if (!location) throw new Error("생성된 로케이션을 불러올 수 없습니다.");
  return location;
}

export async function updateLocation(locationId: string, patch: Partial<Location>): Promise<Location> {
  if (isDemoMode()) return demoUpdateLocation(locationId, patch);
  const { data, error } = await client().rpc("update_location", {
    p_location_id: locationId,
    p_new_location_code: patch.locationCode ?? null,
    p_new_zone: patch.zone ?? null,
    p_new_active: patch.active ?? null,
  });
  if (error) throw new Error(error.message);
  return mapLocation(data as Record<string, unknown>);
}

export async function listTargets(targetType: "product" | "location", search = ""): Promise<ScannableTargetOption[]> {
  if (isDemoMode()) return demoListTargets(targetType, search);
  let query = client().from("scannable_targets_view").select("*").eq("target_type", targetType).limit(100);
  if (search.trim()) query = query.ilike("search_text", `%${search.trim()}%`);
  const { data, error } = await query.order("label");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ targetType, targetId: row.target_id, scanTargetId: row.scan_target_id, label: row.label, description: row.description ?? "" }));
}

export async function listBarcodes(search = "", targetType = "ALL"): Promise<BarcodeRecord[]> {
  if (isDemoMode()) return demoListBarcodes(search, targetType);
  let query = client().from("barcode_registry_view").select("*").order("target_label");
  if (targetType !== "ALL") query = query.eq("target_type", targetType);
  if (search.trim()) query = query.ilike("search_text", `%${search.trim()}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id, scanTargetId: row.scan_target_id, targetType: row.target_type, targetId: row.target_id, targetLabel: row.target_label,
    value: row.barcode_value, normalizedValue: row.normalized_value, source: row.source, symbology: row.symbology ?? "", isPrimary: row.is_primary,
    active: row.active, createdAt: row.created_at,
  }));
}

export async function registerBarcode(input: BarcodeRegistrationInput): Promise<void> {
  if (isDemoMode()) return demoRegisterBarcode(input);
  const { error } = await client().rpc("register_barcode", {
    p_target_type: input.targetType, p_target_id: input.targetId, p_barcode_value: input.barcodeValue,
    p_source: input.source, p_symbology: input.symbology ?? null, p_make_primary: Boolean(input.makePrimary),
  });
  if (error) throw new Error(error.message);
}

export async function updateBarcode(barcodeId: string, patch: { active?: boolean; isPrimary?: boolean }): Promise<void> {
  if (isDemoMode()) return demoUpdateBarcode(barcodeId, patch);
  const { error } = await client().rpc("update_barcode_status", { p_barcode_id: barcodeId, p_active: patch.active ?? null, p_make_primary: patch.isPrimary ?? null });
  if (error) throw new Error(error.message);
}

export async function listScanEvents(search = "", result = "ALL", limit = 1000): Promise<ScanEvent[]> {
  if (isDemoMode()) return demoListScanEvents(search, result, limit);
  let query = client().from("scan_event_view").select("*").order("created_at", { ascending: false }).limit(limit);
  if (result !== "ALL") query = query.eq("result", result);
  if (search.trim()) query = query.ilike("search_text", `%${search.trim()}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id, rawValue: row.raw_value, normalizedValue: row.normalized_value, expectedTargetType: row.expected_target_type ?? undefined, resolvedTargetType: row.resolved_target_type ?? undefined, targetLabel: row.target_label ?? undefined, result: row.result, context: row.context ?? undefined, actorId: row.actor_id ?? undefined, actorLabel: row.actor_label ?? undefined, createdAt: row.created_at }));
}

export async function listAuditLogs(search = "", limit = 1000): Promise<AuditLog[]> {
  if (isDemoMode()) return demoListAuditLogs(search, limit);
  let query = client().from("audit_log_view").select("*").order("created_at", { ascending: false }).limit(limit);
  if (search.trim()) query = query.ilike("search_text", `%${search.trim()}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id, action: row.action, entityType: row.entity_type, entityId: row.entity_id ?? undefined, entityLabel: row.entity_label ?? undefined, before: row.before_data, after: row.after_data, note: row.note ?? undefined, actorId: row.actor_id ?? undefined, actorLabel: row.actor_label ?? undefined, createdAt: row.created_at }));
}

export async function importInventoryRows(rows: ImportInventoryRow[]): Promise<ImportResult> {
  if (isDemoMode()) return demoImportInventoryRows(rows);
  const { data, error } = await client().rpc("import_inventory_rows", { p_rows: rows });
  if (error) throw new Error(error.message);
  return data as ImportResult;
}

let realtimeSubscriptionSequence = 0;

export function subscribeToInventory(callback: () => void): () => void {
  if (isDemoMode()) return demoSubscribe(callback);

  const supabase = getSupabaseClient();
  if (!supabase) return () => undefined;

  // 여러 화면과 React 개발 모드가 동시에 구독해도 기존 채널과 충돌하지 않도록
  // 구독 인스턴스마다 고유한 topic을 사용한다.
  realtimeSubscriptionSequence += 1;
  const channelName = [
    "wms-live",
    Date.now().toString(36),
    realtimeSubscriptionSequence.toString(36),
    Math.random().toString(36).slice(2, 8),
  ].join("-");

  const channel = supabase.channel(channelName);

  channel.on(
    "postgres_changes",
    { event: "*", schema: "public" },
    () => callback(),
  );

  channel.subscribe((status, error) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      console.error("Supabase Realtime subscription failed:", status, error);
    }
  });

  let disposed = false;

  return () => {
    if (disposed) return;
    disposed = true;
    void supabase.removeChannel(channel);
  };
}

export function resetDemo(): void {
  if (isDemoMode()) resetDemoData();
}

export function downloadDemoBackup(): void {
  if (!isDemoMode()) return;
  const blob = new Blob([exportDemoData()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `barcode-wms-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
