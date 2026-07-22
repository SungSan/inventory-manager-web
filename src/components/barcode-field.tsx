"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraScanner } from "@/components/camera-scanner";

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

  const submit = useCallback(
    async (raw: string) => {
      const next = raw.trim();
      if (!next || disabled) return;
      const accepted = await onSubmit(next);
      if (accepted !== false) {
        setDraft(value === undefined ? "" : next);
      }
    },
    [disabled, onSubmit, value],
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
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit(draft);
              }
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
