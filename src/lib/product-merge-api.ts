import { getSupabaseClient, isDemoMode } from "@/lib/supabase";

export interface ProductMergeBarcode {
  value: string;
  normalizedValue: string;
  active: boolean;
  isPrimary: boolean;
}

export interface ProductMergeCandidate {
  id: string;
  pCodeNo: string;
  codeNo: string;
  masterCodeNo: string;
  artist: string;
  nameVer: string;
  active: boolean;
  mergedIntoProductId?: string;
  mergedAt?: string;
  mergeReason?: string;
  stockQty: number;
  stockLocationCount: number;
  barcodes: ProductMergeBarcode[];
}

export interface ProductMergeResult {
  sourceProductId: string;
  targetProductId: string;
  movedQty: number;
  movedLocations: number;
  movedBarcodes: number;
  duplicateBarcodesDisabled: number;
  merged: boolean;
}

function client() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");
  return supabase;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function txt(value: unknown): string {
  return value == null ? "" : String(value);
}

function opt(value: unknown): string | undefined {
  const result = txt(value);
  return result || undefined;
}

function mergeDbError(message: string): Error {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("could not find the function")
    || normalized.includes("schema cache")
    || normalized.includes("list_product_merge_candidates")
    || normalized.includes("admin_merge_product")
    || normalized.includes("merged_into_product_id")
  ) {
    return new Error("상품 병합 DB 기능이 아직 적용되지 않았습니다. Supabase SQL Editor에서 SQL 40(V4.6.4 누적본)을 실행한 뒤 다시 시도하세요.");
  }
  return new Error(message);
}

function mapCandidate(value: unknown): ProductMergeCandidate {
  const row = rec(value);
  return {
    id: txt(row.id),
    pCodeNo: txt(row.p_code_no),
    codeNo: txt(row.code_no),
    masterCodeNo: txt(row.master_code_no),
    artist: txt(row.artist),
    nameVer: txt(row.name_ver),
    active: Boolean(row.active),
    mergedIntoProductId: opt(row.merged_into_product_id),
    mergedAt: opt(row.merged_at),
    mergeReason: opt(row.merge_reason),
    stockQty: Number(row.stock_qty ?? 0),
    stockLocationCount: Number(row.stock_location_count ?? 0),
    barcodes: arr(row.barcodes).map((item) => {
      const barcode = rec(item);
      return {
        value: txt(barcode.value),
        normalizedValue: txt(barcode.normalized_value),
        active: Boolean(barcode.active),
        isPrimary: Boolean(barcode.is_primary),
      };
    }),
  };
}

export async function listProductMergeCandidates(search = ""): Promise<ProductMergeCandidate[]> {
  if (isDemoMode()) return [];
  const { data, error } = await client().rpc("list_product_merge_candidates", {
    p_search: search,
    p_limit: 300,
  });
  if (error) throw mergeDbError(error.message);
  return arr(data).map(mapCandidate);
}

export async function mergeProductRecords(
  sourceProductId: string,
  targetProductId: string,
  reason = "",
): Promise<ProductMergeResult> {
  if (isDemoMode()) throw new Error("DEMO 모드에서는 상품을 병합할 수 없습니다.");
  const { data, error } = await client().rpc("admin_merge_product", {
    p_source_product_id: sourceProductId,
    p_target_product_id: targetProductId,
    p_reason: reason.trim() || null,
  });
  if (error) throw mergeDbError(error.message);
  const row = rec(data);
  const result: ProductMergeResult = {
    sourceProductId: txt(row.source_product_id),
    targetProductId: txt(row.target_product_id),
    movedQty: Number(row.moved_qty ?? 0),
    movedLocations: Number(row.moved_locations ?? 0),
    movedBarcodes: Number(row.moved_barcodes ?? 0),
    duplicateBarcodesDisabled: Number(row.duplicate_barcodes_disabled ?? 0),
    merged: Boolean(row.merged),
  };
  if (!result.merged) throw new Error("상품 병합이 완료되지 않았습니다. 화면을 새로고침한 뒤 다시 시도하세요.");
  return result;
}
