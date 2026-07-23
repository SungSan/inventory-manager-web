"use client";

import { useState } from "react";
import { CameraScanner } from "@/components/camera-scanner";

export function CameraSearchField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [cameraOpen, setCameraOpen] = useState(false);

  return (
    <>
      <label className="compact-search">
        <span>{label}</span>
        <div className="barcode-input-row">
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            autoComplete="off"
          />
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setCameraOpen(true)}
          >
            카메라
          </button>
        </div>
      </label>

      {cameraOpen ? (
        <CameraScanner
          onClose={() => setCameraOpen(false)}
          onDetected={(detected) => {
            onChange(detected);
            setCameraOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
