export type NumberInputValue = number | "";

export function parseIntegerDraft(
  raw: string,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): NumberInputValue {
  if (raw.trim() === "") return "";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return "";
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function numberOrZero(value: NumberInputValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function isIntegerInputValue(
  value: NumberInputValue | undefined,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= min
    && value <= max;
}
