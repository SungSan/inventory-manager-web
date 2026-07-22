import { getSupabaseClient, isDemoMode } from "@/lib/supabase";
import type { Location } from "@/types/domain";

function client() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");
  return supabase;
}

function ensureLiveMode(): void {
  if (isDemoMode()) throw new Error("LOC MAP 관리는 LIVE 모드에서만 사용할 수 있습니다.");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapLocation(value: unknown): Location {
  const row = asRecord(value);
  return {
    id: String(row.id ?? ""),
    scanTargetId: String(row.scan_target_id ?? row.scanTargetId ?? ""),
    locationCode: String(row.location_code ?? row.locationCode ?? ""),
    zone: String(row.zone ?? ""),
    active: row.active === undefined ? true : Boolean(row.active),
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export async function adminUpsertMapLocation(
  locationCode: string,
  barcodeValue = "",
): Promise<Location> {
  ensureLiveMode();
  const { data, error } = await client().rpc("admin_upsert_map_location", {
    p_location_code: locationCode,
    p_barcode_value: barcodeValue.trim() || null,
  });
  if (error) throw new Error(error.message);
  const location = mapLocation(data);
  if (!location.id) throw new Error("저장된 로케이션 정보를 불러오지 못했습니다.");
  return location;
}

export async function adminSetMapLocationActive(
  locationId: string,
  active: boolean,
): Promise<Location> {
  ensureLiveMode();
  const { data, error } = await client().rpc("admin_set_map_location_active", {
    p_location_id: locationId,
    p_active: active,
  });
  if (error) throw new Error(error.message);
  const location = mapLocation(data);
  if (!location.id) throw new Error("변경된 로케이션 정보를 불러오지 못했습니다.");
  return location;
}
