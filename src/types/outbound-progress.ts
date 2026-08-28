export interface OutboundUploadRow {
  trackingNo: string;
  orderNo: string;
  productBarcode: string;
  requiredQty: number;
  sourceRow: number;
}
export interface OutboundLocationHint {
  locationCode: string;
  qty: number;
}
export interface OutboundPickingItem {
  id: string;
  productId?: string;
  productBarcode: string;
  artist: string;
  nameVer: string;
  orderNos: string[];
  requiredQty: number;
  pickedQty: number;
  locations: OutboundLocationHint[];
  resolution: "MATCHED" | "UNREGISTERED" | "AMBIGUOUS";
}
export interface OutboundShipment {
  id: string;
  trackingNo: string;
  items: OutboundPickingItem[];
  manualQuantityAllowed: boolean;
  status: "READY" | "IN_PROGRESS" | "COMPLETED" | "REVIEW";
  assignedWorker?: string;
}
export interface OutboundJob {
  id: string;
  name: string;
  createdAt: string;
  status: "DRAFT" | "READY" | "IN_PROGRESS" | "COMPLETED";
  shipments: OutboundShipment[];
}
