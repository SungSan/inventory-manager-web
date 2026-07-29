"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraScanner } from "@/components/camera-scanner";
import { resolveBarcodeCandidates } from "@/lib/inventory-api";
import {
  containsHangul,
  convertHangulToQwerty,
  isValidLocationBarcodeFormat,
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

function normalizeHidQwertyCandidate(raw: string): string {
  return convertHangulToQwerty(raw.normalize("NFKC"))
    .replace(/[\s\r\n\t]+/g, "")
    .toUpperCase();
}

async function activeLocationCodeExists(locationCode: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from("locations")
    .select("id")
    .eq("location_code", locationCode)
    .eq("active", true)
    .limit(1);

  if (error) return false;
  return Boolean(data?.length);
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

    // PM3 HID 입력이 한국어 IME를 통과해 완성형 한글·자모·공백으로 뭉개진 경우,
    // 최종 문자열 전체를 두벌식 QWERTY 키값으로 복원한다.
    const qwertyCandidate = normalizeHidQwertyCandidate(raw);
    if (!qwertyCandidate || containsHangul(qwertyCandidate)) return original;

    const locationCandidate = normalizeLocationBarcodeInput(qwertyCandidate);
    if (isValidLocationBarcodeFormat(locationCandidate)) {
      try {
        const locationMatches = await resolveBarcodeCandidates(
          locationCandidate,
          "location",
          "MIXED_HID_LOCATION_PRECHECK",
        );
        if (locationMatches.some(isResolvedLocationMatch)) return locationCandidate;
      } catch {
        // RPC 확인 실패 시 정확한 활성 LOC 코드 조회로 한 번 더 검증한다.
      }

      if (await activeLocationCodeExists(locationCandidate)) return locationCandidate;
    }

    try {
      // 혼합 스캔창에서는 복원값이 실제 등록된 상품 또는 LOC 바코드일 때만 채택한다.
      // 일반 한글 텍스트나 미등록 값은 원문으로 되돌려 오탐을 방지한다.
      const registeredMatches = await resolveBarcodeCandidates(
        qwertyCandidate,
        undefined,
        "MIXED_HID_BARCODE_PRECHECK",
      );
      if (registeredMatches.length > 0) return qwertyCandidate;
    } catch {
      // 판별 RPC 실패 시 기존 원문 처리 흐름을 유지한다.
    }

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
