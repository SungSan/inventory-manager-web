import {
  listInventory,
  listLocations,
  listProducts,
} from "@/lib/inventory-api";
import { getSupabaseClient, isDemoMode } from "@/lib/supabase";
import { inferFacility } from "@/lib/work-scope";
import type { Facility } from "@/types/domain";

export interface DashboardMetrics {
  totalQty: number;
  skuCount: number;
  locationCount: number;
  lowStock: number;
}

export type FacilityDashboardMetrics = Record<Facility, DashboardMetrics>;
export interface FacilityFlowSummary {
  inboundQty: number;
  outboundQty: number;
  inboundCount: number;
  outboundCount: number;
}
export type FacilityFlowSummaries = Record<Facility, FacilityFlowSummary>;

const emptyFacilityMetrics = (): FacilityDashboardMetrics => ({
  DAEJA: { totalQty: 0, skuCount: 0, locationCount: 0, lowStock: 0 },
  GWANSAN: { totalQty: 0, skuCount: 0, locationCount: 0, lowStock: 0 },
  UNASSIGNED: { totalQty: 0, skuCount: 0, locationCount: 0, lowStock: 0 },
});

export async function getFacilityDashboardMetrics(): Promise<FacilityDashboardMetrics> {
  const [inventory, locations] = await Promise.all([
    listInventory(),
    listLocations("", false),
  ]);
  const result = emptyFacilityMetrics();
  const skuSets: Record<Facility, Set<string>> = {
    DAEJA: new Set(),
    GWANSAN: new Set(),
    UNASSIGNED: new Set(),
  };
  for (const location of locations)
    result[
      location.facility ?? inferFacility(location.locationCode)
    ].locationCount += 1;
  for (const row of inventory) {
    const facility = row.facility ?? inferFacility(row.locationCode);
    const target = result[facility];
    target.totalQty += row.qty;
    if (row.qty <= 5) target.lowStock += 1;
    skuSets[facility].add(row.productId);
  }
  for (const facility of ["DAEJA", "GWANSAN", "UNASSIGNED"] as Facility[])
    result[facility].skuCount = skuSets[facility].size;
  return result;
}

export async function getFacilityFlowSummaries(
  startDate: string,
  endDate: string,
  overall: Pick<
    DashboardFlowStats,
    "inboundQty" | "outboundQty" | "inboundCount" | "outboundCount"
  >,
): Promise<FacilityFlowSummaries> {
  const result: FacilityFlowSummaries = {
    DAEJA: { inboundQty: 0, outboundQty: 0, inboundCount: 0, outboundCount: 0 },
    GWANSAN: {
      inboundQty: 0,
      outboundQty: 0,
      inboundCount: 0,
      outboundCount: 0,
    },
    UNASSIGNED: {
      inboundQty: 0,
      outboundQty: 0,
      inboundCount: 0,
      outboundCount: 0,
    },
  };
  if (isDemoMode()) return result;
  const supabase = getSupabaseClient();
  if (!supabase) return result;
  const nextDay = new Date(`${endDate}T00:00:00+09:00`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const startIso = new Date(`${startDate}T00:00:00+09:00`).toISOString();
  const endIso = nextDay.toISOString();
  const rows: Array<{
    id: string;
    operation: string;
    qty: number;
    location_code: string | null;
    facility: string | null;
    created_at: string;
    status: string | null;
    reference_type: string | null;
    reversal_of: string | null;
  }> = [];

  // 전체 합계는 DB RPC가 이미 정확하게 계산한다. 휴대폰으로 모든 거래를
  // 다시 내려받지 않고 관산동으로 명시된 거래만 조회한 뒤, 나머지를 현재
  // 운영센터인 대자동으로 계산한다.
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("inventory_transaction_view")
      .select(
        "id,operation,qty,location_code,facility,created_at,status,reference_type,reversal_of",
      )
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .in("operation", ["IB", "OB"])
      .eq("facility", "GWANSAN")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as typeof rows;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const transactionById = new Map(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    if ((row.status ?? "ACTIVE") === "REVERSED") continue;
    if ((row.reference_type ?? "") === "TRANSFER") continue;
    const original = row.reversal_of
      ? transactionById.get(row.reversal_of)
      : undefined;
    if ((original?.reference_type ?? "") === "TRANSFER") continue;
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        hour12: false,
      }).format(new Date(row.created_at)),
    );
    if (hour < 7) continue;
    if (row.operation === "IB") {
      result.GWANSAN.inboundQty += Number(row.qty);
      result.GWANSAN.inboundCount += 1;
    }
    if (row.operation === "OB") {
      result.GWANSAN.outboundQty += Number(row.qty);
      result.GWANSAN.outboundCount += 1;
    }
  }
  result.DAEJA = {
    inboundQty: Math.max(0, overall.inboundQty - result.GWANSAN.inboundQty),
    outboundQty: Math.max(0, overall.outboundQty - result.GWANSAN.outboundQty),
    inboundCount: Math.max(
      0,
      overall.inboundCount - result.GWANSAN.inboundCount,
    ),
    outboundCount: Math.max(
      0,
      overall.outboundCount - result.GWANSAN.outboundCount,
    ),
  };
  return result;
}

export type DashboardFlowPeriod = "DAY" | "WEEK" | "MONTH" | "YEAR";

export interface DashboardFlowPoint {
  bucket: string;
  label: string;
  inboundQty: number;
  outboundQty: number;
  inboundCount: number;
  outboundCount: number;
}

export interface DashboardFlowStats {
  period: DashboardFlowPeriod;
  anchorDate: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
  inboundQty: number;
  outboundQty: number;
  inboundCount: number;
  outboundCount: number;
  series: DashboardFlowPoint[];
  generatedAt: string;
}

const PAGE_SIZE = 1000;
const FLOW_AGGREGATION_MODE = "REAL_FLOW_EXCLUDE_TRANSFER_0700";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function kstToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  if (isDemoMode()) {
    const [inventory, products, locations] = await Promise.all([
      listInventory(),
      listProducts("", false),
      listLocations("", false),
    ]);
    return {
      totalQty: inventory.reduce((sum, row) => sum + row.qty, 0),
      skuCount: products.length,
      locationCount: locations.length,
      lowStock: inventory.filter((row) => row.qty <= 5).length,
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");

  const [productCountResult, locationCountResult] = await Promise.all([
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
    supabase
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
  ]);

  if (productCountResult.error)
    throw new Error(productCountResult.error.message);
  if (locationCountResult.error)
    throw new Error(locationCountResult.error.message);

  let totalQty = 0;
  let lowStock = 0;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("inventory_stock_view")
      .select("product_id,location_id,location_code,qty")
      .order("location_code")
      .order("product_id")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const rows = data ?? [];
    for (const row of rows) {
      const qty = Number(row.qty ?? 0);
      totalQty += qty;
      if (qty <= 5) lowStock += 1;
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return {
    totalQty,
    skuCount: productCountResult.count ?? 0,
    locationCount: locationCountResult.count ?? 0,
    lowStock,
  };
}

export async function getDashboardFlowStats(
  period: DashboardFlowPeriod,
  anchorDate = kstToday(),
): Promise<DashboardFlowStats> {
  if (isDemoMode()) {
    return {
      period,
      anchorDate,
      periodLabel: anchorDate,
      startDate: anchorDate,
      endDate: anchorDate,
      inboundQty: 0,
      outboundQty: 0,
      inboundCount: 0,
      outboundCount: 0,
      series: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");

  const { data, error } = await supabase.rpc("get_dashboard_flow_stats", {
    p_period: period,
    p_anchor_date: anchorDate,
  });

  if (error) {
    const message = error.message || "";
    if (
      message.includes("get_dashboard_flow_stats") ||
      message.includes("schema cache") ||
      message.includes("Could not find")
    ) {
      throw new Error(
        "실시간 입출고 현황 DB 기능이 아직 적용되지 않았습니다. SQL 42를 실행하세요.",
      );
    }
    throw new Error(message);
  }

  const row = asRecord(data);
  if (String(row.aggregation_mode ?? "") !== FLOW_AGGREGATION_MODE) {
    throw new Error(
      "실시간 입출고 현황 집계 기준이 구버전입니다. SQL 42를 실행하세요.",
    );
  }

  return {
    period: String(row.period ?? period) as DashboardFlowPeriod,
    anchorDate: String(row.anchor_date ?? anchorDate),
    periodLabel: String(row.period_label ?? anchorDate),
    startDate: String(row.start_date ?? anchorDate),
    endDate: String(row.end_date ?? anchorDate),
    inboundQty: Number(row.inbound_qty ?? 0),
    outboundQty: Number(row.outbound_qty ?? 0),
    inboundCount: Number(row.inbound_count ?? 0),
    outboundCount: Number(row.outbound_count ?? 0),
    series: asArray(row.series).map((value) => {
      const point = asRecord(value);
      return {
        bucket: String(point.bucket ?? ""),
        label: String(point.label ?? ""),
        inboundQty: Number(point.inbound_qty ?? 0),
        outboundQty: Number(point.outbound_qty ?? 0),
        inboundCount: Number(point.inbound_count ?? 0),
        outboundCount: Number(point.outbound_count ?? 0),
      };
    }),
    generatedAt: String(row.generated_at ?? new Date().toISOString()),
  };
}
