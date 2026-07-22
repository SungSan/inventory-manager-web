"use client";

import { useEffect, useRef, useState } from "react";

export function CameraScanner({
  onDetected,
  onClose,
}: {
  onDetected: (value: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lastValueRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function start() {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();

        if (!videoRef.current) return;

        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result) => {
            if (!active || !result) return;
            const value = result.getText().trim();
            const now = Date.now();

            if (
              lastValueRef.current.value === value &&
              now - lastValueRef.current.at < 1200
            ) {
              return;
            }

            lastValueRef.current = { value, at: now };
            onDetected(value);
          },
        );

        controlsRef.current = controls;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "카메라를 시작할 수 없습니다.");
      }
    }

    void start();

    return () => {
      active = false;
      controlsRef.current?.stop();
    };
  }, [onDetected]);

  return (
    <div className="modal-backdrop">
      <section className="camera-modal" aria-modal="true" role="dialog">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CAMERA SCAN</p>
            <h2>바코드를 화면 중앙에 맞추세요</h2>
          </div>
          <button className="button button-secondary" onClick={onClose}>
            닫기
          </button>
        </div>

        <video ref={videoRef} className="camera-video" muted playsInline />

        {error ? <p className="inline-error">{error}</p> : null}
        <p className="muted">
          카메라 스캔은 HTTPS 또는 localhost에서만 사용할 수 있습니다.
        </p>
      </section>
    </div>
  );
}
