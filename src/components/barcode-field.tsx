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
  const [draft, setDraft] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft("");
    if (autoFocus && !disabled) {
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [autoFocus, disabled, resetToken]);

  const submit = useCallback(
    async (raw: string) => {
      const next = raw.trim();
      if (!next || disabled) return;
      const accepted = await onSubmit(next);
      if (accepted !== false) setDraft("");
    },
    [disabled, onSubmit],
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
            setCameraOpen(false);
            void submit(detected);
          }}
        />
      ) : null}
    </div>
  );
}
