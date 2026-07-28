from pathlib import Path


def replace_one(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if old not in text:
        if new in text:
            return
        raise SystemExit(f"replacement not found: {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


api = Path("src/lib/inventory-api.ts")
text = api.read_text(encoding="utf-8")
start_marker = "let realtimeSubscriptionSequence = 0;"
end_marker = "\nexport function resetDemo(): void {"

if "export type RealtimeScope =" not in text:
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    block = '''export type RealtimeScope =
  | "user"
  | "dashboard"
  | "inventory"
  | "logs"
  | "workRequests"
  | "utilization"
  | "users"
  | "transfers"
  | "products"
  | "barcodes"
  | "locations"
  | "externalTransfers"
  | "locationMap";

const REALTIME_SCOPE_TABLES: Record<RealtimeScope, readonly string[]> = {
  user: ["profiles"],
  dashboard: ["inventory_balances", "inventory_transactions", "scan_events", "products", "locations"],
  inventory: ["inventory_balances", "products", "locations", "barcodes"],
  logs: ["inventory_transactions", "scan_events", "audit_logs"],
  workRequests: [
    "work_requests", "work_request_items", "work_request_candidates", "work_request_scans",
    "work_request_events", "work_request_notifications", "work_request_change_requests",
    "work_request_documents", "work_request_document_items", "work_request_document_allocations",
    "worker_kpi_settings", "worker_kpi_overrides", "business_calendar",
  ],
  utilization: ["utilization_zones", "inventory_balances", "locations"],
  users: ["profiles", "worker_kpi_settings", "worker_kpi_overrides", "terms_acceptances", "profile_name_history"],
  transfers: ["transfer_jobs", "transfer_job_items", "inventory_balances"],
  products: ["products", "barcodes", "scan_targets"],
  barcodes: ["barcodes", "scan_targets", "products", "locations"],
  locations: ["locations", "barcodes", "scan_targets", "inventory_balances"],
  externalTransfers: [
    "external_transfer_jobs", "external_transfer_items", "external_transfer_allocations",
    "external_shipment_documents", "external_shipment_items", "external_shipment_allocations",
    "inventory_balances",
  ],
  locationMap: [
    "locations", "inventory_balances", "transfer_jobs", "transfer_job_items",
    "inventory_cycle_settings", "inventory_cycle_item_profiles", "inventory_cycle_location_profiles",
    "inventory_cycle_dirty_locations", "location_map_zone_settings",
  ],
};

export interface RealtimeSubscriptionOptions {
  scope?: RealtimeScope;
  debounceMs?: number;
  fallbackMs?: number;
}

let realtimeSubscriptionSequence = 0;

export function subscribeToInventory(
  callback: () => void | Promise<void>,
  options: RealtimeSubscriptionOptions = {},
): () => void {
  const scope = options.scope ?? "inventory";
  const debounceMs = Math.max(0, options.debounceMs ?? 250);
  const fallbackMs = Math.max(0, options.fallbackMs ?? 0);
  const tables = [...new Set(REALTIME_SCOPE_TABLES[scope])];

  let disposed = false;
  let running = false;
  let rerunRequested = false;
  let hiddenDirty = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;

  const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

  const execute = async () => {
    if (disposed) return;
    if (isHidden()) {
      hiddenDirty = true;
      return;
    }
    if (running) {
      rerunRequested = true;
      return;
    }

    running = true;
    try {
      do {
        rerunRequested = false;
        await callback();
      } while (rerunRequested && !disposed && !isHidden());
    } catch (error) {
      console.error(`SAN WMS realtime refresh failed (${scope})`, error);
    } finally {
      running = false;
    }
  };

  const schedule = (delay = debounceMs) => {
    if (disposed) return;
    if (isHidden()) {
      hiddenDirty = true;
      return;
    }
    if (running) {
      rerunRequested = true;
      return;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void execute();
    }, delay);
  };

  const handleVisibility = () => {
    if (!isHidden() && hiddenDirty) {
      hiddenDirty = false;
      schedule(0);
    }
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibility);
  }

  let unsubscribeSource: () => void = () => undefined;

  if (isDemoMode()) {
    unsubscribeSource = demoSubscribe(() => schedule());
  } else {
    const supabase = getSupabaseClient();
    if (supabase) {
      realtimeSubscriptionSequence += 1;
      const channelName = [
        "wms-live", scope, Date.now().toString(36),
        realtimeSubscriptionSequence.toString(36), Math.random().toString(36).slice(2, 8),
      ].join("-");
      const channel = supabase.channel(channelName);
      for (const table of tables) {
        channel.on("postgres_changes", { event: "*", schema: "public", table }, () => schedule());
      }
      channel.subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(`Supabase Realtime subscription failed (${scope})`, status, error);
        }
      });
      unsubscribeSource = () => { void supabase.removeChannel(channel); };
    }
  }

  if (fallbackMs > 0) {
    fallbackTimer = setInterval(() => schedule(), fallbackMs);
  }

  return () => {
    if (disposed) return;
    disposed = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (fallbackTimer) clearInterval(fallbackTimer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibility);
    }
    unsubscribeSource();
  };
}
'''
    text = text[:start] + block + text[end:]
    api.write_text(text, encoding="utf-8")


replacements: dict[str, list[tuple[str, str]]] = {
    "src/app/work-requests/[id]/page.tsx": [
        ("useEffect(()=>{void load();return subscribeToInventory(()=>void load());},[load]);",
         "useEffect(()=>{void load();return subscribeToInventory(load,{scope:\"workRequests\",fallbackMs:60_000});},[load]);"),
    ],
    "src/app/work-requests/page.tsx": [
        ("useEffect(()=>{void loadRequests();return subscribeToInventory(()=>void loadRequests());},[loadRequests]);",
         "useEffect(()=>{void loadRequests();return subscribeToInventory(loadRequests,{scope:\"workRequests\",fallbackMs:60_000});},[loadRequests]);"),
    ],
    "src/app/logs/page.tsx": [
        ("useEffect(() => subscribeToInventory(() => void load()), [load]);",
         "useEffect(() => subscribeToInventory(load, { scope: \"logs\", fallbackMs: 120_000 }), [load]);"),
    ],
    "src/app/inventory/page.tsx": [
        ("useEffect(() => subscribeToInventory(() => void load()), [load]);",
         "useEffect(() => subscribeToInventory(load, { scope: \"inventory\", fallbackMs: 60_000 }), [load]);"),
    ],
    "src/app/utilization/page.tsx": [
        ("return subscribeToInventory(() => void load());",
         "return subscribeToInventory(load, { scope: \"utilization\", fallbackMs: 60_000 });"),
    ],
    "src/app/users/page.tsx": [
        ("useEffect(() => { void load(); return subscribeToInventory(() => void load()); }, [load]);",
         "useEffect(() => { void load(); return subscribeToInventory(load, { scope: \"users\", fallbackMs: 60_000 }); }, [load]);"),
    ],
    "src/app/transfers/page.tsx": [
        ("return subscribeToInventory(() => void load());",
         "return subscribeToInventory(load, { scope: \"transfers\", fallbackMs: 60_000 });"),
    ],
    "src/app/page.tsx": [
        ("return subscribeToInventory(() => void load());",
         "return subscribeToInventory(load, { scope: \"dashboard\", fallbackMs: 60_000 });"),
    ],
    "src/app/products/page.tsx": [
        ("useEffect(() => subscribeToInventory(() => void load()), [load]);",
         "useEffect(() => subscribeToInventory(load, { scope: \"products\", fallbackMs: 120_000 }), [load]);"),
    ],
    "src/app/barcodes/page.tsx": [
        ("useEffect(() => subscribeToInventory(() => void load()), [load]);",
         "useEffect(() => subscribeToInventory(load, { scope: \"barcodes\", fallbackMs: 120_000 }), [load]);"),
    ],
    "src/app/locations/page.tsx": [
        ("useEffect(() => subscribeToInventory(() => void load()), [load]);",
         "useEffect(() => subscribeToInventory(load, { scope: \"locations\", fallbackMs: 120_000 }), [load]);"),
    ],
    "src/app/external-transfers/page.tsx": [
        ("return subscribeToInventory(() => void loadJobs());",
         "return subscribeToInventory(loadJobs, { scope: \"externalTransfers\", fallbackMs: 60_000 });"),
    ],
    "src/components/app-shell.tsx": [
        ("return subscribeToInventory(loadUsers);",
         "return subscribeToInventory(loadUsers, { scope: \"users\" });"),
    ],
    "src/components/location-map-view.tsx": [
        ("return subscribeToInventory(() => void load());",
         "return subscribeToInventory(load, { scope: \"locationMap\", fallbackMs: 60_000 });"),
    ],
    "src/components/user-provider.tsx": [
        ('''const unsubscribe = subscribeToInventory(() => {
      void getCurrentUser().then((nextUser) => {
        if (active) setUser(nextUser);
      });
    });''', '''const unsubscribe = subscribeToInventory(async () => {
      const nextUser = await getCurrentUser();
      if (active) setUser(nextUser);
    }, { scope: "user", fallbackMs: 120_000 });'''),
    ],
    "src/components/work-request-indicator.tsx": [
        ('''useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const unsubscribe = subscribeToInventory(() => void load());
    return () => { window.clearInterval(timer); unsubscribe(); };
  }, [load]);''', '''useEffect(() => {
    void load();
    return subscribeToInventory(load, { scope: "workRequests", fallbackMs: 60_000 });
  }, [load]);'''),
    ],
}

for path, changes in replacements.items():
    for old, new in changes:
        replace_one(path, old, new)


replace_one(
    "src/components/scan-workflow-v5.tsx",
    '''export function ScanWorkflowV5() {
  useEffect(() => {
    const timer = window.setInterval(() => {
      document.querySelectorAll<HTMLLabelElement>("label").forEach(injectNotePreset);
    }, 200);
    return () => window.clearInterval(timer);
  }, []);''',
    '''export function ScanWorkflowV5() {
  useEffect(() => {
    const applyTo = (root: ParentNode) => {
      if (root instanceof HTMLLabelElement) injectNotePreset(root);
      root.querySelectorAll<HTMLLabelElement>("label").forEach(injectNotePreset);
    };

    applyTo(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement) applyTo(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);''',
)


replace_one(
    "src/components/work-request-rule-enhancer.tsx",
    '''    void loadEarliestDate();

    const interval = window.setInterval(() => {
      if (cancelled) return;
      replaceNotice();

      const input = findRequestedDateInput();
      if (!input || appliedRef.current) return;

      if (input.dataset.requestRuleBound !== "true") {
        input.dataset.requestRuleBound = "true";
        input.addEventListener("pointerdown", () => { touched = true; }, { once: true });
        input.addEventListener("keydown", () => { touched = true; }, { once: true });
      }

      if (!earliestDate || touched) return;
      setControlledInputValue(input, earliestDate);
      retries += 1;
      if (retries >= 8) appliedRef.current = true;
    }, 250);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };''',
    '''    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let animationFrame: number | null = null;

    const apply = () => {
      if (cancelled) return;
      replaceNotice();

      const input = findRequestedDateInput();
      if (!input || appliedRef.current) return;

      if (input.dataset.requestRuleBound !== "true") {
        input.dataset.requestRuleBound = "true";
        input.addEventListener("pointerdown", () => { touched = true; }, { once: true });
        input.addEventListener("keydown", () => { touched = true; }, { once: true });
      }

      if (!earliestDate || touched) return;
      setControlledInputValue(input, earliestDate);
      retries += 1;
      if (retries >= 8) appliedRef.current = true;
    };

    const scheduleApply = () => {
      if (cancelled || animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        apply();
      });
    };

    const retry = () => {
      if (cancelled || appliedRef.current || retries >= 12) return;
      scheduleApply();
      retries += 1;
      retryTimer = setTimeout(retry, 250);
    };

    void loadEarliestDate().finally(scheduleApply);
    scheduleApply();
    retryTimer = setTimeout(retry, 250);
    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer.disconnect();
      if (retryTimer) clearTimeout(retryTimer);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };''',
)


full_data = Path("src/lib/full-data-api.ts")
full_text = full_data.read_text(encoding="utf-8")
if "let inventoryLoadInFlight" not in full_text:
    full_text = full_text.replace(
        "const PAGE_SIZE = 1000;\n",
        '''const PAGE_SIZE = 1000;
const RESULT_REUSE_MS = 750;
let inventoryLoadInFlight: Promise<InventoryRow[]> | null = null;
let cachedInventoryRows: InventoryRow[] = [];
let cachedInventoryAt = 0;
let hasInventoryCache = false;
''',
        1,
    )
    old_function = full_text[full_text.index("export async function listAllInventoryRows") :]
    new_function = '''async function loadAllInventoryRows(): Promise<InventoryRow[]> {
  if (isDemoMode()) return listInventory("");

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");

  const result: InventoryRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("inventory_stock_view")
      .select("*")
      .order("location_code")
      .order("product_id")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const rows = data ?? [];
    result.push(...rows.map((row) => ({
      productId: row.product_id,
      locationId: row.location_id,
      pCodeNo: row.p_code_no ?? "",
      codeNo: row.code_no ?? "",
      masterCodeNo: row.master_code_no ?? "",
      artist: row.artist ?? "",
      nameVer: row.name_ver ?? "",
      locationCode: row.location_code,
      zone: row.zone ?? "",
      qty: Number(row.qty),
      updatedAt: row.updated_at,
    })));

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return result;
}

export async function listAllInventoryRows(): Promise<InventoryRow[]> {
  const now = Date.now();
  if (inventoryLoadInFlight) return inventoryLoadInFlight;
  if (hasInventoryCache && now - cachedInventoryAt < RESULT_REUSE_MS) return cachedInventoryRows;

  inventoryLoadInFlight = loadAllInventoryRows();
  try {
    const rows = await inventoryLoadInFlight;
    cachedInventoryRows = rows;
    cachedInventoryAt = Date.now();
    hasInventoryCache = true;
    return rows;
  } finally {
    inventoryLoadInFlight = null;
  }
}
'''
    full_text = full_text.replace(old_function, new_function, 1)
    full_data.write_text(full_text, encoding="utf-8")


replace_one("src/components/app-shell.tsx", "SAN WMS · V4.3.1", "SAN WMS · V4.4.0")
replace_one("package.json", '"version": "4.3.1"', '"version": "4.4.0"')
replace_one("public/sw.js", "san-wms-v4-3-1-static", "san-wms-v4-4-0-static")


sql = Path("supabase/27_REALTIME_PERFORMANCE_INDEXES.sql")
if not sql.exists():
    sql.write_text('''-- SAN WMS V4.4.0
-- 동시 작업 성능 안정화를 위한 조회 인덱스

begin;

create index if not exists idx_barcodes_normalized_active
  on public.barcodes(normalized_value)
  where active = true;

create index if not exists idx_inventory_transactions_created_at
  on public.inventory_transactions(created_at desc);

create index if not exists idx_scan_events_created_at
  on public.scan_events(created_at desc);

create index if not exists idx_audit_logs_created_at
  on public.audit_logs(created_at desc);

create index if not exists idx_inventory_balances_updated_at
  on public.inventory_balances(updated_at desc);

create index if not exists idx_work_requests_status_ship_date
  on public.work_requests(status, requested_ship_date);

create index if not exists idx_work_request_notifications_user_pending
  on public.work_request_notifications(user_id, available_from desc)
  where acknowledged_at is null;

analyze public.barcodes;
analyze public.inventory_transactions;
analyze public.scan_events;
analyze public.audit_logs;
analyze public.inventory_balances;
analyze public.work_requests;
analyze public.work_request_notifications;

commit;

select 'SAN WMS V4.4.0 realtime performance indexes completed' as result;
''', encoding="utf-8")
