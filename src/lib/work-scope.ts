import type { Facility, ProductCategory } from "@/types/domain";

export type ProductCategoryFilter = ProductCategory | "ALL";

export const productCategoryLabel: Record<ProductCategory, string> = {
  ALBUM: "앨범",
  MD: "MD",
};

export const facilityLabel: Record<Facility, string> = {
  DAEJA: "대자동",
  GWANSAN: "관산동",
  UNASSIGNED: "미지정",
};

export function inferFacility(locationCode: string): Facility {
  const code = locationCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.startsWith("D")) return "DAEJA";
  if (code.startsWith("K1") || code.startsWith("KN")) return "GWANSAN";
  return "UNASSIGNED";
}

export function readRememberedCategory(key: string): ProductCategory {
  if (typeof window === "undefined") return "ALBUM";
  return window.localStorage.getItem(key) === "MD" ? "MD" : "ALBUM";
}

export function rememberCategory(key: string, value: ProductCategory): void {
  if (typeof window !== "undefined") window.localStorage.setItem(key, value);
}
