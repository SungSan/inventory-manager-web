"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraScanner } from "@/components/camera-scanner";
import { resolveBarcodeCandidates } from "@/lib/inventory-api";
import {
  containsHangul,
  convertHangulToQwerty,
  normalizeLocationBarcodeInput,
} from "@/lib/location-barcode";
import { getSupabaseClient } from "@/lib/supabase";

type BarcodeInputKind = "generic" | "location" | "mixed";

function inferBarcodeInputKind(label: string, placeholder: string): BarcodeInputKind {
  const hint = `${label} ${placeholder}`;
  const hasLocation = /로케이션|\bLOC\b/i.test(hint);
  const hasProduct = /상품|SKU/i.test(hint);
  if (hasLocation && hasProduct) return "mixed";
  return hasLocation ? "location" : "generic";
}

function isResolvedLocationMatch(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const match = value as { target?: { type?: string; location?: unknown } };
  return match.target?.type === "location" && Boolean(match.target.location);
}

function buildHidLocationCandidates(raw: string): string[] {
  const qwertyWithSpaces = convertHangulToQwerty(raw.normalize("NFKC"))
    .replace(/[\r\n\t]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  const compact = qwertyWithSpaces.replace(/\s+/g, "");
  const standardLocation = normalizeLocationBarcodeInput(compact);

  return Array.from(
    new Set([qwertyWithSpaces, compact, standardLocation].filter((candidate) => Boolean(candidate))),
  );
}

async function findActiveLocationCode(candidates: string[]): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase || candidates.length === 0) return null;

  const { data, error } = await supabase
    .from("locations")
    .select("location_code")
    .eq("active", true)
    .in("location_code", candidates)
    .limit(1);

  if (error) return null;
  const locationCode = data?.[0]?.location_code;
  return typeof locationCode === "string" && locationCode.trim() ? locationCode.trim() : null;
}

async function resolveMixedHidLocation(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      const locationMatches = await resolveBarcodeCandidates(
        candidate,
        "location",
        "MIXED_HID_LOCATION_PRECHECK",
      );
      if (locationMatches.some(isResolvedLocationMatch)) return candidate;
    } catch {
      // 후보별 RPC 확인 실패 시 다음 후보와 locations 정확 조회를 계속 진행한다.
    }
  }

  // ERROR, RETURN, GLOBI STANDBY처럼 표준 하이픈 규칙이 없는 LOC 코드도 확인한다.
  return findActiveLocationCode(candidates);
}

export function BarcodeField({
  label,
  placeholder,
  value,
  onSubmit,
  autoFocus = false,
  disabled = false,
  resetToken,
}: {
  label: string;
  placeholder: string;
  value?: string;
  onSubmit: (value: string) => void | boolean | Promise<void | boolean>;
  autoFocus?: boolean;
  disabled?: boolean;
  resetToken?: string | number;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const pendingEnterRef = useRef(false);
  const pendingCompositionTimerRef = useRef<number | null>(null);
  const submittingRef = useRef(false);
  const lastSubmissionRef = useRef({ value: "", at: 0 });
  const inputKind = useMemo(() => inferBarcodeInputKind(label, placeholder), [label, placeholder]);

  const clearPendingCompositionTimer = useCallback(() => {
    if (pendingCompositionTimerRef.current !== null) {
      window.clearTimeout(pendingCompositionTimerRef.current);
      pendingCompositionTimerRef.current = null;
    }
  }, []);

  // 상위 화면에서 확정된 상품/로케이션 바코드를 입력창에도 그대로 유지합니다.
  useEffect(() => {
    setDraft(value ?? "");
  }, [value, resetToken]);

  // 단계가 바뀌어 disabled 상태가 되어도 확정된 스캔값을 지우지 않습니다.
  useEffect(() => {
    if (autoFocus && !disabled) {
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [autoFocus, disabled, resetToken]);

  useEffect(() => () => clearPendingCompositionTimer(), [clearPendingCompositionTimer]);

  const finalValue = useCallback(async (raw: string): Promise<string> => {
    if (inputKind === "location") return normalizeLocationBarcodeInput(raw);

    const original = raw.trim();
    if (inputKind !== "mixed" || !containsHangul(raw)) return original;

    // PM3 HID 입력이 한국어 IME를 통과한 최종 문자열에서 LOC 후보를 복원한다.
    // 문자열 LOC의 실제 공백과 IME가 삽입한 불필요한 공백을 모두 대응하기 위해
    // 공백 유지형, 공백 제거형, 기존 표준 하이픈형 후보를 각각 검증한다.
    const candidates = buildHidLocationCandidates(raw);
    if (candidates.length === 0 || candidates.some((candidate) => containsHangul(candidate))) {
      return original;
    }

    const resolvedLocation = await resolveMixedHidLocation(candidates);
    if (resolvedLocation) return resolvedLocation;

    // 상품 바코드에는 한글 역변환을 적용하지 않는다.
    return original;
  }, [inputKind]);

  const submit = useCallback(
    async (raw: string) => {
      if (disabled || submittingRef.current) return;
      submittingRef.current = true;

      try {
        const next = await finalValue(raw);
        if (!next) return;

        const now = Date.now();
        if (lastSubmissionRef.current.value === next && now - lastSubmissionRef.current.at < 120) return;
        lastSubmissionRef.current = { value: next, at: now };
        setDraft(next);

        const accepted = await onSubmit(next);
        if (accepted !== false) {
          setDraft(value === undefined ? "" : next);
        }
      } finally {
        submittingRef.current = false;
      }
    },
    [disabled, finalValue, onSubmit, value],
  );

  return (
    <div className="barcode-field">
      <label>
        <span>{label}</span>
        <div className="barcode-input-row">
          <input
            ref={inputRef}
            value={draft}
            disabled={disabled}
            placeholder={placeholder}
            autoCapitalize="characters"
            autoComplete="off"
            inputMode="text"
            onChange={(event) => setDraft(event.target.value)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={(event) => {
              const rawValue = event.currentTarget.value;
              composingRef.current = false;
              setDraft(inputKind === "location" ? normalizeLocationBarcodeInput(rawValue) : rawValue);

              if (pendingEnterRef.current) {
                pendingEnterRef.current = false;
                clearPendingCompositionTimer();
                window.setTimeout(() => void submit(rawValue), 0);
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const rawValue = event.currentTarget.value;

              if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) {
                pendingEnterRef.current = true;
                clearPendingCompositionTimer();

                // 일부 Android HID/한글 IME는 Enter 뒤 compositionend를 보내지 않는다.
                // DOM의 최종 조합 문자열이 확정될 시간을 준 뒤 한 번만 제출한다.
                pendingCompositionTimerRef.current = window.setTimeout(() => {
                  pendingCompositionTimerRef.current = null;
                  if (!pendingEnterRef.current) return;
                  pendingEnterRef.current = false;
                  composingRef.current = false;
                  void submit(inputRef.current?.value ?? rawValue);
                }, 220);
                return;
              }

              void submit(rawValue);
            }}
            onKeyUp={(event) => {
              if (event.key !== "Enter" || !pendingEnterRef.current || event.nativeEvent.isComposing) return;
              const rawValue = event.currentTarget.value;
              pendingEnterRef.current = false;
              composingRef.current = false;
              clearPendingCompositionTimer();
              void submit(rawValue);
            }}
          />
          <button
            type="button"
            className="button button-secondary"
            disabled={disabled}
            onClick={() => void submit(draft)}
          >
            입력
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={disabled}
            onClick={() => setCameraOpen(true)}
          >
            카메라
          </button>
        </div>
      </label>

      {value ? <p className="scan-value">스캔값: {value}</p> : null}

      {cameraOpen ? (
        <CameraScanner
          onClose={() => setCameraOpen(false)}
          onDetected={(detected) => {
            setDraft(detected);
            setCameraOpen(false);
            void submit(detected);
          }}
        />
      ) : null}
    </div>
  );
}
