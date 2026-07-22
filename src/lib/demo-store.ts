import { normalizeBarcode } from "@/lib/barcode";
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

interface DemoBarcode {
  id: string;
  scanTargetId: string;
  value: string;
  source: BarcodeRecord["source"];
  symbology: string;
  isPrimary: boolean;
  active: boolean;
  createdAt: string;
}

interface DemoState {
  version: 3;
  products: Product[];
  locations: Location[];
  barcodes: DemoBarcode[];
  inventory: Array<{ productId: string; locationId: string; qty: number; updatedAt: string }>;
  transactions: InventoryTransaction[];
  scanEvents: ScanEvent[];
  auditLogs: AuditLog[];
  users: UserProfile[];
  currentUserId: string;
}

const STORAGE_KEY = "barcode-wms-v1-complete-demo";
const CHANGE_EVENT = "wms-demo-store-change";
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const initialState: DemoState = {
  version: 3,
  products: [
    {
      id: "product-1",
      scanTargetId: "target-product-1",
      pCodeNo: "P-10001",
      codeNo: "C-10001",
      masterCodeNo: "M-100",
      artist: "AESPA",
      nameVer: "6TH MINI ALBUM / VER.A",
      active: true,
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: "product-2",
      scanTargetId: "target-product-2",
      pCodeNo: "P-10002",
      codeNo: "C-10002",
      masterCodeNo: "M-100",
      artist: "AESPA",
      nameVer: "6TH MINI ALBUM / VER.B",
      active: true,
      createdAt: now(),
      updatedAt: now(),
    },
  ],
  locations: [
    {
      id: "location-1",
      scanTargetId: "target-location-1",
      locationCode: "D1A-01-02-03",
      zone: "D1A",
      active: true,
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: "location-2",
      scanTargetId: "target-location-2",
      locationCode: "ANGLE-01-01-01",
      zone: "ANGLE",
      active: true,
      createdAt: now(),
      updatedAt: now(),
    },
  ],
  barcodes: [
    {
      id: "barcode-1",
      scanTargetId: "target-product-1",
      value: "8801234567890",
      source: "manufacturer",
      symbology: "EAN-13",
      isPrimary: true,
      active: true,
      createdAt: now(),
    },
    {
      id: "barcode-2",
      scanTargetId: "target-product-2",
      value: "8801234567891",
      source: "manufacturer",
      symbology: "EAN-13",
      isPrimary: true,
      active: true,
      createdAt: now(),
    },
    {
      id: "barcode-common-1",
      scanTargetId: "target-product-1",
      value: "8801234567000",
      source: "manufacturer",
      symbology: "EAN-13",
      isPrimary: false,
      active: true,
      createdAt: now(),
    },
    {
      id: "barcode-common-2",
      scanTargetId: "target-product-2",
      value: "8801234567000",
      source: "manufacturer",
      symbology: "EAN-13",
      isPrimary: false,
      active: true,
      createdAt: now(),
    },
    {
      id: "barcode-3",
      scanTargetId: "target-location-1",
      value: "D1A-01-02-03",
      source: "internal",
      symbology: "CODE-128",
      isPrimary: true,
      active: true,
      createdAt: now(),
    },
    {
      id: "barcode-4",
      scanTargetId: "target-location-2",
      value: "ANGLE-01-01-01",
      source: "internal",
      symbology: "CODE-128",
      isPrimary: true,
      active: true,
      createdAt: now(),
    },
  ],
  inventory: [
    { productId: "product-1", locationId: "location-1", qty: 24, updatedAt: now() },
  ],
  transactions: [],
  scanEvents: [],
  auditLogs: [],
  users: [
    { id: "user-admin", email: "admin@demo.local", displayName: "데모 관리자", role: "admin", active: true },
    { id: "user-manager", email: "manager@demo.local", displayName: "데모 매니저", role: "manager", active: true },
    { id: "user-operator", email: "operator@demo.local", displayName: "데모 작업자", role: "operator", active: true },
    { id: "user-viewer", email: "viewer@demo.local", displayName: "데모 조회자", role: "viewer", active: true },
  ],
  currentUserId: "user-admin",
};

function cloneInitial(): DemoState {
  return JSON.parse(JSON.stringify(initialState)) as DemoState;
}

function readState(): DemoState {
  if (typeof window === "undefined") return cloneInitial();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seed = cloneInitial();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }
  try {
    const parsed = JSON.parse(raw) as DemoState & { version?: number };
    if (!Array.isArray(parsed.products) || !Array.isArray(parsed.locations) || !Array.isArray(parsed.barcodes)) {
      throw new Error("invalid state");
    }
    parsed.version = 3;
    parsed.inventory ??= [];
    parsed.transactions ??= [];
    parsed.scanEvents ??= [];
    parsed.auditLogs ??= [];
    parsed.users ??= cloneInitial().users;
    parsed.currentUserId ??= parsed.users[0]?.id ?? "user-admin";
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    return parsed;
  } catch {
    const seed = cloneInitial();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }
}

function writeState(state: DemoState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function actor(state: DemoState): UserProfile {
  return state.users.find((user) => user.id === state.currentUserId) ?? state.users[0];
}

function addAudit(
  state: DemoState,
  action: string,
  entityType: string,
  entityId: string | undefined,
  entityLabel: string | undefined,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  note?: string,
): void {
  const user = actor(state);
  state.auditLogs.unshift({
    id: id("audit"),
    action,
    entityType,
    entityId,
    entityLabel,
    before,
    after,
    note,
    actorId: user.id,
    actorLabel: user.displayName,
    createdAt: now(),
  });
  state.auditLogs = state.auditLogs.slice(0, 5000);
}

function productByTarget(state: DemoState, scanTargetId: string): Product | undefined {
  return state.products.find((item) => item.scanTargetId === scanTargetId);
}

function locationByTarget(state: DemoState, scanTargetId: string): Location | undefined {
  return state.locations.find((item) => item.scanTargetId === scanTargetId);
}

function targetLabel(state: DemoState, scanTargetId: string): { type: "product" | "location"; id: string; label: string } | null {
  const product = productByTarget(state, scanTargetId);
  if (product) return { type: "product", id: product.id, label: `${product.artist} · ${product.nameVer}` };
  const location = locationByTarget(state, scanTargetId);
  if (location) return { type: "location", id: location.id, label: location.locationCode };
  return null;
}

function targetTypeByScanTarget(state: DemoState, scanTargetId: string): "product" | "location" | null {
  if (productByTarget(state, scanTargetId)) return "product";
  if (locationByTarget(state, scanTargetId)) return "location";
  return null;
}

function ensureBarcodeAssignable(
  state: DemoState,
  value: string,
  targetType: "product" | "location",
  scanTargetId?: string,
  exceptId?: string,
): string {
  const normalized = normalizeBarcode(value);
  if (!normalized) throw new Error("바코드 번호를 입력하세요.");

  const sameValue = state.barcodes.filter(
    (item) => item.id !== exceptId && normalizeBarcode(item.value) === normalized,
  );
  if (scanTargetId && sameValue.some((item) => item.scanTargetId === scanTargetId)) {
    throw new Error("이 대상에는 이미 같은 바코드가 연결되어 있습니다.");
  }

  const conflictingType = sameValue.some((item) => {
    const existingType = targetTypeByScanTarget(state, item.scanTargetId);
    return existingType && existingType !== targetType;
  });
  if (conflictingType) {
    throw new Error("같은 번호를 상품과 로케이션에 동시에 사용할 수 없습니다.");
  }

  if (targetType === "location" && sameValue.length > 0) {
    throw new Error("로케이션 바코드는 다른 로케이션과 중복될 수 없습니다.");
  }

  return normalized;
}

function productIdentity(product: Pick<Product, "pCodeNo" | "codeNo" | "masterCodeNo" | "artist" | "nameVer">): string {
  return [product.pCodeNo, product.codeNo, product.masterCodeNo, product.artist, product.nameVer]
    .map((value) => value.trim().toUpperCase())
    .join("||");
}

export async function demoGetCurrentUser(): Promise<UserProfile> {
  const state = readState();
  return actor(state);
}

export async function demoSetCurrentUser(userId: string): Promise<void> {
  const state = readState();
  const user = state.users.find((item) => item.id === userId && item.active);
  if (!user) throw new Error("사용자를 찾을 수 없습니다.");
  state.currentUserId = user.id;
  writeState(state);
}

export async function demoListUsers(): Promise<UserProfile[]> {
  return readState().users;
}

export async function demoUpdateUserRole(userId: string, role: UserRole): Promise<void> {
  const state = readState();
  const user = state.users.find((item) => item.id === userId);
  if (!user) throw new Error("사용자를 찾을 수 없습니다.");
  const before = { role: user.role };
  user.role = role;
  addAudit(state, "USER_ROLE_CHANGED", "user", user.id, user.displayName, before, { role });
  writeState(state);
}

export async function demoResolveBarcodes(
  value: string,
  expectedTargetType?: "product" | "location",
  context = "LOOKUP",
): Promise<ResolvedBarcode[]> {
  const state = readState();
  const normalized = normalizeBarcode(value);
  const matching = state.barcodes.filter(
    (item) => item.active && normalizeBarcode(item.value) === normalized,
  );
  const user = actor(state);

  const allResolved: ResolvedBarcode[] = [];
  for (const barcode of matching) {
    const product = productByTarget(state, barcode.scanTargetId);
    const location = locationByTarget(state, barcode.scanTargetId);
    if (product?.active) {
      allResolved.push({
        barcodeId: barcode.id,
        barcodeValue: barcode.value,
        targetType: "product",
        targetId: product.id,
        target: { type: "product", product },
      });
    } else if (location?.active) {
      allResolved.push({
        barcodeId: barcode.id,
        barcodeValue: barcode.value,
        targetType: "location",
        targetId: location.id,
        target: { type: "location", location },
      });
    }
  }

  const deduped = Array.from(new Map(allResolved.map((item) => [`${item.targetType}:${item.targetId}`, item])).values());
  const filtered = expectedTargetType
    ? deduped.filter((item) => item.targetType === expectedTargetType)
    : deduped;

  const result: ScanEvent["result"] = deduped.length === 0
    ? "NOT_FOUND"
    : expectedTargetType && filtered.length === 0
      ? "WRONG_TYPE"
      : "SUCCESS";

  const labels = filtered.map((item) => {
    if ("product" in item.target) return `${item.target.product.artist} · ${item.target.product.nameVer}`;
    if ("location" in item.target) return item.target.location.locationCode;
    return item.target.label;
  });

  state.scanEvents.unshift({
    id: id("scan"),
    rawValue: value,
    normalizedValue: normalized,
    expectedTargetType,
    resolvedTargetType: filtered[0]?.targetType ?? deduped[0]?.targetType,
    targetLabel: labels.length > 3 ? `${labels.slice(0, 3).join(", ")} 외 ${labels.length - 3}개` : labels.join(", ") || undefined,
    result,
    context: labels.length > 1 ? `${context}_MULTI_MATCH_${labels.length}` : context,
    actorId: user.id,
    actorLabel: user.displayName,
    createdAt: now(),
  });
  state.scanEvents = state.scanEvents.slice(0, 10000);
  writeState(state);
  return filtered;
}

export async function demoResolveBarcode(
  value: string,
  expectedTargetType?: "product" | "location",
  context = "LOOKUP",
): Promise<ResolvedBarcode | null> {
  const matches = await demoResolveBarcodes(value, expectedTargetType, context);
  return matches[0] ?? null;
}

export async function demoPostMovement(input: MovementInput): Promise<MovementResult> {
  const state = readState();
  const duplicate = state.transactions.find((tx) => tx.id === input.idempotencyKey);
  if (duplicate) {
    const product = state.products.find((item) => item.id === duplicate.productId);
    const location = state.locations.find((item) => item.id === duplicate.locationId);
    if (!product || !location) throw new Error("중복 처리 내역을 복원할 수 없습니다.");
    return {
      transactionId: duplicate.id,
      operation: duplicate.operation,
      product,
      location,
      beforeQty: duplicate.beforeQty,
      afterQty: duplicate.afterQty,
      quantity: duplicate.qty,
    };
  }

  const productBarcodeCandidates = state.barcodes.filter(
    (item) => item.active && normalizeBarcode(item.value) === normalizeBarcode(input.productBarcode),
  );
  const locationBarcodeCandidates = state.barcodes.filter(
    (item) => item.active && normalizeBarcode(item.value) === normalizeBarcode(input.locationBarcode),
  );
  if (productBarcodeCandidates.length === 0) throw new Error("등록되지 않은 상품 바코드입니다.");
  if (locationBarcodeCandidates.length === 0) throw new Error("등록되지 않은 로케이션 바코드입니다.");

  const product = input.productId
    ? state.products.find((item) => item.id === input.productId && item.active)
    : productBarcodeCandidates
        .map((item) => productByTarget(state, item.scanTargetId))
        .find((item): item is Product => Boolean(item?.active));
  const location = input.locationId
    ? state.locations.find((item) => item.id === input.locationId && item.active)
    : locationBarcodeCandidates
        .map((item) => locationByTarget(state, item.scanTargetId))
        .find((item): item is Location => Boolean(item?.active));

  if (!product) throw new Error("선택한 상품을 찾을 수 없습니다.");
  if (!location) throw new Error("선택한 로케이션을 찾을 수 없습니다.");

  const productBarcode = productBarcodeCandidates.find((item) => item.scanTargetId === product.scanTargetId);
  const locationBarcode = locationBarcodeCandidates.find((item) => item.scanTargetId === location.scanTargetId);
  if (!productBarcode) throw new Error("선택한 상품과 스캔 바코드가 연결되어 있지 않습니다.");
  if (!locationBarcode) throw new Error("선택한 로케이션과 스캔 바코드가 연결되어 있지 않습니다.");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new Error("수량은 1 이상의 정수여야 합니다.");

  let balance = state.inventory.find((row) => row.productId === product.id && row.locationId === location.id);
  if (!balance) {
    balance = { productId: product.id, locationId: location.id, qty: 0, updatedAt: now() };
    state.inventory.push(balance);
  }
  const beforeQty = balance.qty;
  const afterQty = input.operation === "IB" ? beforeQty + input.quantity : beforeQty - input.quantity;
  if (afterQty < 0) throw new Error(`재고 부족: 현재 ${beforeQty}개, 출고 요청 ${input.quantity}개`);

  balance.qty = afterQty;
  balance.updatedAt = now();
  const user = actor(state);
  const transaction: InventoryTransaction = {
    id: input.idempotencyKey,
    operation: input.operation,
    status: "ACTIVE",
    productId: product.id,
    locationId: location.id,
    productLabel: `${product.artist} ${product.nameVer}`,
    locationCode: location.locationCode,
    qty: input.quantity,
    beforeQty,
    afterQty,
    productBarcodeValue: productBarcode.value,
    locationBarcodeValue: locationBarcode.value,
    createdAt: now(),
    note: input.note,
    actorId: user.id,
    actorLabel: user.displayName,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
  };
  state.transactions.unshift(transaction);
  addAudit(
    state,
    input.operation === "IB" ? "INVENTORY_INBOUND" : "INVENTORY_OUTBOUND",
    "inventory_transaction",
    transaction.id,
    `${transaction.productLabel} @ ${transaction.locationCode}`,
    { qty: beforeQty },
    { qty: afterQty },
    input.note,
  );
  writeState(state);
  return { transactionId: transaction.id, operation: input.operation, product, location, beforeQty, afterQty, quantity: input.quantity };
}

export async function demoReverseTransaction(transactionId: string, reason: string): Promise<InventoryTransaction> {
  const state = readState();
  const original = state.transactions.find((tx) => tx.id === transactionId);
  if (!original) throw new Error("거래를 찾을 수 없습니다.");
  if (original.status !== "ACTIVE") throw new Error("이미 취소되었거나 취소 거래입니다.");

  const balance = state.inventory.find((row) => row.productId === original.productId && row.locationId === original.locationId);
  if (!balance) throw new Error("현재 재고를 찾을 수 없습니다.");

  const reverseOperation = original.operation === "IB" ? "OB" : "IB";
  const beforeQty = balance.qty;
  const afterQty = reverseOperation === "IB" ? beforeQty + original.qty : beforeQty - original.qty;
  if (afterQty < 0) throw new Error(`입고 취소 불가: 현재 재고 ${beforeQty}개가 원거래 수량 ${original.qty}개보다 적습니다.`);

  balance.qty = afterQty;
  balance.updatedAt = now();
  const user = actor(state);
  const reversal: InventoryTransaction = {
    id: id("reversal"),
    operation: reverseOperation,
    status: "REVERSAL",
    productId: original.productId,
    locationId: original.locationId,
    productLabel: original.productLabel,
    locationCode: original.locationCode,
    qty: original.qty,
    beforeQty,
    afterQty,
    productBarcodeValue: original.productBarcodeValue,
    locationBarcodeValue: original.locationBarcodeValue,
    createdAt: now(),
    note: reason || `거래 ${original.id} 취소`,
    actorId: user.id,
    actorLabel: user.displayName,
    reversalOf: original.id,
  };
  original.status = "REVERSED";
  original.reversedBy = reversal.id;
  state.transactions.unshift(reversal);
  addAudit(
    state,
    "TRANSACTION_REVERSED",
    "inventory_transaction",
    original.id,
    `${original.productLabel} @ ${original.locationCode}`,
    { status: "ACTIVE", qty: beforeQty },
    { status: "REVERSED", qty: afterQty, reversalId: reversal.id },
    reason,
  );
  writeState(state);
  return reversal;
}

export async function demoListInventory(search = ""): Promise<InventoryRow[]> {
  const state = readState();
  const keyword = search.trim().toUpperCase();
  return state.inventory
    .map((balance) => {
      const product = state.products.find((item) => item.id === balance.productId);
      const location = state.locations.find((item) => item.id === balance.locationId);
      if (!product || !location) return null;
      const productBarcodes = state.barcodes
        .filter((item) => item.scanTargetId === product.scanTargetId && item.active)
        .map((item) => item.value);
      return {
        row: {
          productId: product.id,
          locationId: location.id,
          pCodeNo: product.pCodeNo,
          codeNo: product.codeNo,
          masterCodeNo: product.masterCodeNo,
          artist: product.artist,
          nameVer: product.nameVer,
          locationCode: location.locationCode,
          zone: location.zone,
          qty: balance.qty,
          updatedAt: balance.updatedAt,
        } satisfies InventoryRow,
        productBarcodes,
      };
    })
    .filter((item): item is { row: InventoryRow; productBarcodes: string[] } => Boolean(item))
    .filter(({ row, productBarcodes }) => !keyword || [
      row.pCodeNo, row.codeNo, row.masterCodeNo, row.artist, row.nameVer, row.locationCode, ...productBarcodes,
    ].some((value) => value.toUpperCase().includes(keyword)))
    .map(({ row }) => row)
    .sort((a, b) => `${a.artist}${a.nameVer}${a.locationCode}`.localeCompare(`${b.artist}${b.nameVer}${b.locationCode}`));
}

export async function demoListTransactions(search = "", operation = "ALL", limit = 500): Promise<InventoryTransaction[]> {
  const keyword = search.trim().toUpperCase();
  return readState().transactions
    .filter((tx) => operation === "ALL" || tx.operation === operation)
    .filter((tx) => !keyword || [tx.productLabel, tx.locationCode, tx.productBarcodeValue, tx.locationBarcodeValue, tx.actorLabel ?? "", tx.note ?? ""]
      .some((value) => value.toUpperCase().includes(keyword)))
    .slice(0, limit);
}

export async function demoListRecentTransactions(limit = 20): Promise<InventoryTransaction[]> {
  return readState().transactions.slice(0, limit);
}

export async function demoListProducts(search = "", includeInactive = true): Promise<Product[]> {
  const keyword = search.trim().toUpperCase();
  return readState().products
    .filter((product) => includeInactive || product.active)
    .filter((product) => !keyword || [product.pCodeNo, product.codeNo, product.masterCodeNo, product.artist, product.nameVer]
      .some((value) => value.toUpperCase().includes(keyword)))
    .sort((a, b) => `${a.artist}${a.nameVer}`.localeCompare(`${b.artist}${b.nameVer}`));
}

export async function demoCreateProduct(input: ProductInput): Promise<Product> {
  const state = readState();
  if (!input.codeNo.trim()) throw new Error("CODE_NO는 필수입니다.");
  if (!input.artist.trim() || !input.nameVer.trim()) throw new Error("아티스트와 상품명/버전을 입력하세요.");
  const candidateIdentity = productIdentity({
    pCodeNo: input.pCodeNo, codeNo: input.codeNo, masterCodeNo: input.masterCodeNo, artist: input.artist, nameVer: input.nameVer,
  });
  if (state.products.some((item) => productIdentity(item) === candidateIdentity)) throw new Error("동일한 상품/버전이 이미 등록되어 있습니다.");

  const timestamp = now();
  const product: Product = {
    id: id("product"),
    scanTargetId: id("target-product"),
    pCodeNo: input.pCodeNo.trim(),
    codeNo: input.codeNo.trim(),
    masterCodeNo: input.masterCodeNo.trim(),
    artist: input.artist.trim(),
    nameVer: input.nameVer.trim(),
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  ensureBarcodeAssignable(state, input.primaryBarcode, "product", product.scanTargetId);
  state.products.push(product);
  state.barcodes.push({
    id: id("barcode"),
    scanTargetId: product.scanTargetId,
    value: input.primaryBarcode.trim(),
    source: input.barcodeSource ?? "manufacturer",
    symbology: "AUTO",
    isPrimary: true,
    active: true,
    createdAt: timestamp,
  });
  addAudit(state, "PRODUCT_CREATED", "product", product.id, `${product.artist} · ${product.nameVer}`, null, product as unknown as Record<string, unknown>);
  writeState(state);
  return product;
}

export async function demoUpdateProduct(productId: string, patch: Partial<Product>): Promise<Product> {
  const state = readState();
  const product = state.products.find((item) => item.id === productId);
  if (!product) throw new Error("상품을 찾을 수 없습니다.");
  const nextProduct = { ...product, ...patch };
  if (state.products.some((item) => item.id !== productId && productIdentity(item) === productIdentity(nextProduct))) {
    throw new Error("동일한 상품/버전이 이미 등록되어 있습니다.");
  }
  const before = { ...product };
  Object.assign(product, patch, { updatedAt: now() });
  addAudit(state, "PRODUCT_UPDATED", "product", product.id, `${product.artist} · ${product.nameVer}`, before as unknown as Record<string, unknown>, product as unknown as Record<string, unknown>);
  writeState(state);
  return product;
}

export async function demoListLocations(search = "", includeInactive = true): Promise<Location[]> {
  const keyword = search.trim().toUpperCase();
  return readState().locations
    .filter((location) => includeInactive || location.active)
    .filter((location) => !keyword || [location.locationCode, location.zone].some((value) => value.toUpperCase().includes(keyword)))
    .sort((a, b) => a.locationCode.localeCompare(b.locationCode));
}

export async function demoCreateLocation(input: LocationInput): Promise<Location> {
  const state = readState();
  const code = input.locationCode.trim().toUpperCase();
  if (!code) throw new Error("로케이션 코드를 입력하세요.");
  if (state.locations.some((item) => item.locationCode === code)) throw new Error("이미 등록된 로케이션입니다.");
  const barcode = (input.barcodeValue || code).trim();
  const timestamp = now();
  const location: Location = {
    id: id("location"),
    scanTargetId: id("target-location"),
    locationCode: code,
    zone: input.zone.trim().toUpperCase() || code.split("-")[0],
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  ensureBarcodeAssignable(state, barcode, "location", location.scanTargetId);
  state.locations.push(location);
  state.barcodes.push({
    id: id("barcode"),
    scanTargetId: location.scanTargetId,
    value: barcode,
    source: "internal",
    symbology: "CODE-128",
    isPrimary: true,
    active: true,
    createdAt: timestamp,
  });
  addAudit(state, "LOCATION_CREATED", "location", location.id, location.locationCode, null, location as unknown as Record<string, unknown>);
  writeState(state);
  return location;
}

export async function demoUpdateLocation(locationId: string, patch: Partial<Location>): Promise<Location> {
  const state = readState();
  const location = state.locations.find((item) => item.id === locationId);
  if (!location) throw new Error("로케이션을 찾을 수 없습니다.");
  if (patch.locationCode) {
    const code = patch.locationCode.trim().toUpperCase();
    if (state.locations.some((item) => item.id !== locationId && item.locationCode === code)) throw new Error("이미 등록된 로케이션입니다.");
    patch.locationCode = code;
  }
  const before = { ...location };
  Object.assign(location, patch, { updatedAt: now() });
  addAudit(state, "LOCATION_UPDATED", "location", location.id, location.locationCode, before as unknown as Record<string, unknown>, location as unknown as Record<string, unknown>);
  writeState(state);
  return location;
}

export async function demoListTargets(targetType: "product" | "location", search = ""): Promise<ScannableTargetOption[]> {
  if (targetType === "product") {
    return (await demoListProducts(search, false)).map((item) => ({
      targetType: "product",
      targetId: item.id,
      scanTargetId: item.scanTargetId,
      label: `${item.artist} · ${item.nameVer}`,
      description: `${item.codeNo} / ${item.pCodeNo}`,
    }));
  }
  return (await demoListLocations(search, false)).map((item) => ({
    targetType: "location",
    targetId: item.id,
    scanTargetId: item.scanTargetId,
    label: item.locationCode,
    description: item.zone,
  }));
}

export async function demoListBarcodes(search = "", targetType = "ALL"): Promise<BarcodeRecord[]> {
  const state = readState();
  const keyword = search.trim().toUpperCase();
  return state.barcodes
    .map((barcode) => {
      const target = targetLabel(state, barcode.scanTargetId);
      if (!target) return null;
      return {
        id: barcode.id,
        scanTargetId: barcode.scanTargetId,
        targetType: target.type,
        targetId: target.id,
        targetLabel: target.label,
        value: barcode.value,
        normalizedValue: normalizeBarcode(barcode.value),
        source: barcode.source,
        symbology: barcode.symbology,
        isPrimary: barcode.isPrimary,
        active: barcode.active,
        createdAt: barcode.createdAt,
      } satisfies BarcodeRecord;
    })
    .filter((item): item is BarcodeRecord => Boolean(item))
    .filter((item) => targetType === "ALL" || item.targetType === targetType)
    .filter((item) => !keyword || [item.value, item.targetLabel, item.source, item.symbology].some((value) => value.toUpperCase().includes(keyword)))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.targetLabel.localeCompare(b.targetLabel));
}

export async function demoRegisterBarcode(input: BarcodeRegistrationInput): Promise<void> {
  const state = readState();
  const target = input.targetType === "product"
    ? state.products.find((item) => item.id === input.targetId)
    : state.locations.find((item) => item.id === input.targetId);
  if (!target) throw new Error("연결할 대상을 찾을 수 없습니다.");
  const normalized = ensureBarcodeAssignable(state, input.barcodeValue, input.targetType, target.scanTargetId);
  if (input.makePrimary) state.barcodes.filter((item) => item.scanTargetId === target.scanTargetId).forEach((item) => { item.isPrimary = false; });
  const barcode: DemoBarcode = {
    id: id("barcode"),
    scanTargetId: target.scanTargetId,
    value: normalized,
    source: input.source,
    symbology: input.symbology ?? "UNKNOWN",
    isPrimary: Boolean(input.makePrimary),
    active: true,
    createdAt: now(),
  };
  state.barcodes.push(barcode);
  addAudit(state, "BARCODE_CREATED", "barcode", barcode.id, normalized, null, barcode as unknown as Record<string, unknown>);
  writeState(state);
}

export async function demoUpdateBarcode(barcodeId: string, patch: { active?: boolean; isPrimary?: boolean }): Promise<void> {
  const state = readState();
  const barcode = state.barcodes.find((item) => item.id === barcodeId);
  if (!barcode) throw new Error("바코드를 찾을 수 없습니다.");
  const before = { ...barcode };
  if (patch.isPrimary) {
    state.barcodes.filter((item) => item.scanTargetId === barcode.scanTargetId).forEach((item) => { item.isPrimary = false; });
    barcode.isPrimary = true;
    barcode.active = true;
  }
  if (typeof patch.active === "boolean") {
    barcode.active = patch.active;
    if (!patch.active) barcode.isPrimary = false;
  }
  addAudit(state, "BARCODE_UPDATED", "barcode", barcode.id, barcode.value, before as unknown as Record<string, unknown>, barcode as unknown as Record<string, unknown>);
  writeState(state);
}

export async function demoListScanEvents(search = "", result = "ALL", limit = 1000): Promise<ScanEvent[]> {
  const keyword = search.trim().toUpperCase();
  return readState().scanEvents
    .filter((event) => result === "ALL" || event.result === result)
    .filter((event) => !keyword || [event.rawValue, event.targetLabel ?? "", event.actorLabel ?? "", event.context ?? ""].some((value) => value.toUpperCase().includes(keyword)))
    .slice(0, limit);
}

export async function demoListAuditLogs(search = "", limit = 1000): Promise<AuditLog[]> {
  const keyword = search.trim().toUpperCase();
  return readState().auditLogs
    .filter((event) => !keyword || [event.action, event.entityType, event.entityLabel ?? "", event.actorLabel ?? "", event.note ?? ""].some((value) => value.toUpperCase().includes(keyword)))
    .slice(0, limit);
}

export async function demoImportInventoryRows(rows: ImportInventoryRow[]): Promise<ImportResult> {
  const state = readState();
  const result: ImportResult = { productsCreated: 0, locationsCreated: 0, barcodesCreated: 0, balancesUpserted: 0, rowsProcessed: 0 };

  for (const sourceRow of rows) {
    const row: ImportInventoryRow = {
      locationCode: sourceRow.locationCode.trim().toUpperCase(),
      pCodeNo: sourceRow.pCodeNo.trim(),
      codeNo: sourceRow.codeNo.trim(),
      masterCodeNo: sourceRow.masterCodeNo.trim(),
      artist: sourceRow.artist.trim(),
      nameVer: sourceRow.nameVer.trim(),
      qty: sourceRow.qty,
      productBarcode: (sourceRow.productBarcode || sourceRow.codeNo).trim(),
      locationBarcode: (sourceRow.locationBarcode || sourceRow.locationCode).trim().toUpperCase(),
    };

    if (!row.codeNo || !row.locationCode) {
      throw new Error(`${result.rowsProcessed + 1}행: CODE_NO와 LOCATION은 필수입니다.`);
    }
    if (!Number.isInteger(row.qty) || row.qty < 0) {
      throw new Error(`${result.rowsProcessed + 1}행: QTY는 0 이상의 정수여야 합니다.`);
    }

    const incomingIdentity = productIdentity(row);
    let product = state.products.find((item) => productIdentity(item) === incomingIdentity);

    if (!product) {
      const incompleteCandidates = state.products.filter(
        (item) => item.codeNo.trim().toUpperCase() === row.codeNo.toUpperCase()
          && (!item.artist.trim() || !item.nameVer.trim()),
      );
      if (incompleteCandidates.length === 1) {
        product = incompleteCandidates[0];
        const before = { ...product };
        product.pCodeNo = row.pCodeNo || product.pCodeNo;
        product.masterCodeNo = row.masterCodeNo || product.masterCodeNo;
        product.artist = row.artist || product.artist;
        product.nameVer = row.nameVer || product.nameVer;
        product.updatedAt = now();
        addAudit(
          state,
          "PRODUCT_COMPLETED_BY_IMPORT",
          "product",
          product.id,
          `${product.artist} · ${product.nameVer}`,
          before as unknown as Record<string, unknown>,
          product as unknown as Record<string, unknown>,
        );
      }
    }

    if (!product) {
      const timestamp = now();
      product = {
        id: id("product"),
        scanTargetId: id("target-product"),
        pCodeNo: row.pCodeNo,
        codeNo: row.codeNo,
        masterCodeNo: row.masterCodeNo,
        artist: row.artist,
        nameVer: row.nameVer,
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.products.push(product);
      result.productsCreated++;
    }

    if (row.productBarcode) {
      const alreadyLinked = state.barcodes.some(
        (item) => item.scanTargetId === product!.scanTargetId
          && normalizeBarcode(item.value) === normalizeBarcode(row.productBarcode!),
      );
      if (!alreadyLinked) {
        ensureBarcodeAssignable(state, row.productBarcode, "product", product.scanTargetId);
        state.barcodes.push({
          id: id("barcode"),
          scanTargetId: product.scanTargetId,
          value: row.productBarcode,
          source: "manufacturer",
          symbology: "AUTO",
          isPrimary: !state.barcodes.some((item) => item.scanTargetId === product!.scanTargetId),
          active: true,
          createdAt: now(),
        });
        result.barcodesCreated++;
      }
    }

    let location = state.locations.find((item) => item.locationCode === row.locationCode);
    if (!location) {
      const timestamp = now();
      location = {
        id: id("location"),
        scanTargetId: id("target-location"),
        locationCode: row.locationCode,
        zone: row.locationCode.split("-")[0],
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      ensureBarcodeAssignable(state, row.locationBarcode || row.locationCode, "location", location.scanTargetId);
      state.locations.push(location);
      state.barcodes.push({
        id: id("barcode"),
        scanTargetId: location.scanTargetId,
        value: row.locationBarcode || row.locationCode,
        source: "internal",
        symbology: "CODE-128",
        isPrimary: true,
        active: true,
        createdAt: timestamp,
      });
      result.locationsCreated++;
      result.barcodesCreated++;
    } else if (row.locationBarcode) {
      const locationBarcodeExists = state.barcodes.some(
        (item) => item.scanTargetId === location!.scanTargetId
          && normalizeBarcode(item.value) === normalizeBarcode(row.locationBarcode!),
      );
      if (!locationBarcodeExists) {
        ensureBarcodeAssignable(state, row.locationBarcode, "location", location.scanTargetId);
        state.barcodes.push({
          id: id("barcode"),
          scanTargetId: location.scanTargetId,
          value: row.locationBarcode,
          source: "internal",
          symbology: "CODE-128",
          isPrimary: !state.barcodes.some((item) => item.scanTargetId === location!.scanTargetId),
          active: true,
          createdAt: now(),
        });
        result.barcodesCreated++;
      }
    }

    let balance = state.inventory.find(
      (item) => item.productId === product!.id && item.locationId === location!.id,
    );
    if (!balance) {
      balance = { productId: product.id, locationId: location.id, qty: row.qty, updatedAt: now() };
      state.inventory.push(balance);
    } else {
      balance.qty = row.qty;
      balance.updatedAt = now();
    }
    result.balancesUpserted++;
    result.rowsProcessed++;
  }

  addAudit(
    state,
    "INVENTORY_IMPORTED",
    "import",
    id("import"),
    `${result.rowsProcessed}개 행`,
    null,
    result as unknown as Record<string, unknown>,
    "동일 바코드 다중 상품 및 상품별 다중 로케이션을 유지하여 가져옴",
  );
  writeState(state);
  return result;
}

export function demoSubscribe(callback: () => void): () => void {
  const localHandler = () => callback();
  const storageHandler = (event: StorageEvent) => { if (event.key === STORAGE_KEY) callback(); };
  window.addEventListener(CHANGE_EVENT, localHandler);
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, localHandler);
    window.removeEventListener("storage", storageHandler);
  };
}

export function resetDemoData(): void {
  writeState(cloneInitial());
}

export function exportDemoData(): string {
  return JSON.stringify(readState(), null, 2);
}
