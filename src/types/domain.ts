export type TargetType = "product" | "location" | "shipment" | "container" | string;
export type MovementType = "IB" | "OB";
export type BarcodeSource = "manufacturer" | "internal" | "custom" | "future";
export type UserRole = "admin" | "manager" | "operator" | "viewer";
export type TransactionStatus = "ACTIVE" | "REVERSED" | "REVERSAL";
export type ScanResult = "SUCCESS" | "NOT_FOUND" | "WRONG_TYPE" | "ERROR";

export interface Product {
  id: string;
  scanTargetId: string;
  pCodeNo: string;
  codeNo: string;
  masterCodeNo: string;
  artist: string;
  nameVer: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Location {
  id: string;
  scanTargetId: string;
  locationCode: string;
  zone: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface BarcodeRecord {
  id: string;
  scanTargetId: string;
  targetType: "product" | "location";
  targetId: string;
  targetLabel: string;
  value: string;
  normalizedValue: string;
  source: BarcodeSource;
  symbology: string;
  isPrimary: boolean;
  active: boolean;
  createdAt: string;
}

export interface ResolvedBarcode {
  barcodeId: string;
  barcodeValue: string;
  targetType: TargetType;
  targetId: string;
  target:
    | { type: "product"; product: Product }
    | { type: "location"; location: Location }
    | { type: string; label: string; data?: Record<string, unknown> };
}

export interface InventoryRow {
  productId: string;
  locationId: string;
  pCodeNo: string;
  codeNo: string;
  masterCodeNo: string;
  artist: string;
  nameVer: string;
  locationCode: string;
  zone: string;
  qty: number;
  updatedAt: string;
}

export interface InventoryTransaction {
  id: string;
  operation: MovementType;
  status: TransactionStatus;
  productId: string;
  locationId: string;
  productLabel: string;
  locationCode: string;
  qty: number;
  beforeQty: number;
  afterQty: number;
  productBarcodeValue: string;
  locationBarcodeValue: string;
  createdAt: string;
  note?: string;
  actorId?: string;
  actorLabel?: string;
  reversalOf?: string;
  reversedBy?: string;
  referenceType?: string;
  referenceId?: string;
}

export interface MovementInput {
  operation: MovementType;
  productBarcode: string;
  locationBarcode: string;
  productId?: string;
  locationId?: string;
  quantity: number;
  idempotencyKey: string;
  note?: string;
  referenceType?: string;
  referenceId?: string;
}

export interface MovementResult {
  transactionId: string;
  operation: MovementType;
  product: Product;
  location: Location;
  beforeQty: number;
  afterQty: number;
  quantity: number;
}

export interface BarcodeRegistrationInput {
  targetType: "product" | "location";
  targetId: string;
  barcodeValue: string;
  source: BarcodeSource;
  symbology?: string;
  makePrimary?: boolean;
}

export interface ScannableTargetOption {
  targetType: "product" | "location";
  targetId: string;
  scanTargetId: string;
  label: string;
  description: string;
}

export interface ProductInput {
  pCodeNo: string;
  codeNo: string;
  masterCodeNo: string;
  artist: string;
  nameVer: string;
  primaryBarcode: string;
  barcodeSource?: BarcodeSource;
}

export interface LocationInput {
  locationCode: string;
  zone: string;
  barcodeValue?: string;
}

export interface ScanEvent {
  id: string;
  rawValue: string;
  normalizedValue: string;
  expectedTargetType?: string;
  resolvedTargetType?: string;
  targetLabel?: string;
  result: ScanResult;
  context?: string;
  actorId?: string;
  actorLabel?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId?: string;
  entityLabel?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  note?: string;
  actorId?: string;
  actorLabel?: string;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
}

export interface ImportInventoryRow {
  locationCode: string;
  pCodeNo: string;
  codeNo: string;
  masterCodeNo: string;
  artist: string;
  nameVer: string;
  qty: number;
  productBarcode?: string;
  locationBarcode?: string;
}

export interface ImportResult {
  productsCreated: number;
  locationsCreated: number;
  barcodesCreated: number;
  balancesUpserted: number;
  rowsProcessed: number;
}
