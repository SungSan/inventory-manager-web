"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraScanner } from "@/components/camera-scanner";
import { resolveBarcodeCandidates } from "@/lib/inventory-api";
import {
  containsHangul,
  isValidLocationBarcodeFormat,
  normalizeLocationBarcodeInput,
} from "@/lib/location-barcode";

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
  const submittingRef = useRef(false);
  const lastSubmissionRef = useRef({ value: "", at: 0 });
  const inputKind = useMemo(() => inferBarcodeInputKind(label, placeholder), [label, placeholder]);

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

  const finalValue = useCallback(async (raw: string): Promise<string> => {
    if (inputKind === "location") return normalizeLocationBarcodeInput(raw);

    if (inputKind === "mixed" && containsHangul(raw)) {
      const locationCandidate = normalizeLocationBarcodeInput(raw);
      if (isValidLocationBarcodeFormat(locationCandidate)) {
        try {
          // 혼합 입력창은 locations 테이블의 코드 검색이 아니라 실제 바코드 판별 RPC로 검증합니다.
          // 등록된 LOC 바코드 또는 LOC 코드로 확인된 경우에만 변환값을 사용합니다.
          const matches = await resolveBarcodeCandidates(
            locationCandidate,
            "location",
            "MIXED_LOCATION_PRECHECK",
          );
          if (matches.some(isResolvedLocationMatch)) return locationCandidate;
        } catch {
          // LOC 후보 확인이 실패하면 상품 바코드 원문 처리 흐름을 유지합니다.
        }
      }
    }

    return raw.trim();
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
              composingRef.current = false;
              const completed = inputKind === "location"
                ? normalizeLocationBarcodeInput(event.currentTarget.value)
                : event.currentTarget.value;
              setDraft(completed);

              if (pendingEnterRef.current) {
                pendingEnterRef.current = false;
                window.setTimeout(() => void submit(inputRef.current?.value ?? completed), 0);
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();

              if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) {
                pendingEnterRef.current = true;
                return;
              }

              void submit(event.currentTarget.value);
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
