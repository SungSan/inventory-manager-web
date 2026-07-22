export function normalizeBarcode(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

export function normalizeLocationCode(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

export function inferBarcodeSymbology(value: string): string {
  const normalized = normalizeBarcode(value);

  if (/^\d{13}$/.test(normalized)) return "EAN-13";
  if (/^\d{12}$/.test(normalized)) return "UPC-A";
  if (/^\d{8}$/.test(normalized)) return "EAN-8";
  if (/^[A-Z0-9\-._/]+$/.test(normalized)) return "CODE-128/INTERNAL";
  return "UNKNOWN";
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
