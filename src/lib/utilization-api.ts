import { getSupabaseClient, isDemoMode } from "@/lib/supabase";
import type {
  ZoneUtilization,
  ZoneUtilizationSettingInput,
  UtilizationStatus,
} from "@/types/utilization";

function client() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");
  return supabase;
}

function ensureLiveMode(): void {
  if (isDemoMode()) {
    throw new Error("용적률 기능은 LIVE 모드에서만 사용할 수 있습니다.");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapZoneUtilization(value: unknown): ZoneUtilization {
  const row = asRecord(value);
  return {
    zoneCode: String(row.zone_code ?? row.zoneCode ?? ""),
    displayName: String(row.display_name ?? row.displayName ?? row.zone_code ?? ""),
    capacityPlt: Number(row.capacity_plt ?? row.capacityPlt ?? 0),
    occupiedPlt: Number(row.occupied_plt ?? row.occupiedPlt ?? 0),
    utilizationPercent: Number(row.utilization_percent ?? row.utilizationPercent ?? 0),
    status: String(row.status ?? "SAFE") as UtilizationStatus,
    warningPercent: Number(row.warning_percent ?? row.warningPercent ?? 70),
    dangerPercent: Number(row.danger_percent ?? row.dangerPercent ?? 80),
    active: row.active === undefined ? true : Boolean(row.active),
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
    totalLocations: Number(row.total_locations ?? row.totalLocations ?? 0),
    emptyLocations: Number(row.empty_locations ?? row.emptyLocations ?? 0),
    skuCount: Number(row.sku_count ?? row.skuCount ?? 0),
    totalQty: Number(row.total_qty ?? row.totalQty ?? 0),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export async function listZoneUtilization(): Promise<ZoneUtilization[]> {
  ensureLiveMode();
  const { data, error } = await client().rpc("list_zone_utilization");
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []).map(mapZoneUtilization);
}

export async function upsertZoneUtilizationSetting(
  input: ZoneUtilizationSettingInput,
): Promise<void> {
  ensureLiveMode();
  const { error } = await client().rpc("upsert_zone_utilization_setting", {
    p_zone_code: input.zoneCode,
    p_display_name: input.displayName,
    p_capacity_plt: input.capacityPlt,
    p_warning_percent: input.warningPercent,
    p_danger_percent: input.dangerPercent,
    p_active: input.active,
    p_sort_order: input.sortOrder,
  });
  if (error) throw new Error(error.message);
}
