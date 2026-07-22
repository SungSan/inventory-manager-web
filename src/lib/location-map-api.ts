import { getSupabaseClient, isDemoMode } from "@/lib/supabase";
import type { Location } from "@/types/domain";

export type ActiveTransferRole = "SOURCE" | "DESTINATION" | "BOTH";

export interface LocationMapState {
  locationId: string;
  unavailable: boolean;
  unavailableReason?: string;
  activeTransferCount: number;
  activeTransferRole?: ActiveTransferRole;
}

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

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
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

export async function listLocationMapStates(): Promise<LocationMapState[]> {
  if (isDemoMode()) return [];
  const { data, error } = await client().rpc("list_location_map_states");
  if (error) throw new Error(error.message);
  return asArray(data).map((value) => {
    const row = asRecord(value);
    const role = optionalString(row.active_transfer_role ?? row.activeTransferRole);
    return {
      locationId: String(row.location_id ?? row.locationId ?? ""),
      unavailable: Boolean(row.unavailable),
      unavailableReason: optionalString(row.unavailable_reason ?? row.unavailableReason),
      activeTransferCount: Number(row.active_transfer_count ?? row.activeTransferCount ?? 0),
      activeTransferRole: role as ActiveTransferRole | undefined,
    };
  }).filter((row) => row.locationId);
}

export async function adminSetLocationUnavailable(
  locationId: string,
  unavailable: boolean,
  reason = "",
): Promise<void> {
  ensureLiveMode();
  const { error } = await client().rpc("admin_set_location_unavailable", {
    p_location_id: locationId,
    p_unavailable: unavailable,
    p_reason: reason.trim() || null,
  });
  if (error) throw new Error(error.message);
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
