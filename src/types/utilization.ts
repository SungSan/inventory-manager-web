export type UtilizationStatus = "SAFE" | "WARNING" | "DANGER" | "INACTIVE" | "UNCONFIGURED";

export interface ZoneUtilization {
  zoneCode: string;
  displayName: string;
  capacityPlt: number;
  occupiedPlt: number;
  utilizationPercent: number;
  status: UtilizationStatus;
  warningPercent: number;
  dangerPercent: number;
  active: boolean;
  sortOrder: number;
  totalLocations: number;
  emptyLocations: number;
  skuCount: number;
  totalQty: number;
  updatedAt?: string;
}

export interface ZoneUtilizationSettingInput {
  zoneCode: string;
  displayName: string;
  capacityPlt: number;
  warningPercent: number;
  dangerPercent: number;
  active: boolean;
  sortOrder: number;
}
