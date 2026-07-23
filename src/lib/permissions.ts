import type { UserRole } from "@/types/domain";

export type Permission =
  | "view_dashboard"
  | "view_inventory"
  | "view_logs"
  | "scan_inventory"
  | "stocktake_inventory"
  | "transfer_inventory"
  | "external_transfer"
  | "manage_products"
  | "manage_locations"
  | "manage_barcodes"
  | "reverse_transactions"
  | "import_data"
  | "manage_users";

const rolePermissions: Record<UserRole, Permission[]> = {
  viewer: ["view_dashboard", "view_inventory", "view_logs"],
  operator: [
    "view_dashboard", "view_inventory", "view_logs", "scan_inventory",
    "stocktake_inventory", "transfer_inventory", "external_transfer",
    "manage_products", "manage_locations", "manage_barcodes",
  ],
  manager: [
    "view_dashboard", "view_inventory", "view_logs", "scan_inventory",
    "stocktake_inventory", "transfer_inventory", "external_transfer",
    "manage_products", "manage_locations", "manage_barcodes",
    "reverse_transactions", "import_data",
  ],
  admin: [
    "view_dashboard", "view_inventory", "view_logs", "scan_inventory",
    "stocktake_inventory", "transfer_inventory", "external_transfer",
    "manage_products", "manage_locations", "manage_barcodes",
    "reverse_transactions", "import_data", "manage_users",
  ],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return rolePermissions[role].includes(permission);
}

export const roleLabels: Record<UserRole, string> = {
  admin: "관리자",
  manager: "매니저",
  operator: "작업자",
  viewer: "조회자",
};
