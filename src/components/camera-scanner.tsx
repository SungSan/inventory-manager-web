"use client";

import { useEffect, useRef, useState } from "react";

interface ZoomCapabilities {
  min: number;
  max: number;
  step?: number;
}

interface ExtendedTrackCapabilities extends MediaTrackCapabilities {
  focusMode?: string[];
  zoom?: ZoomCapabilities;
}

interface ExtendedConstraintSet extends MediaTrackConstraintSet {
  focusMode?: string;
  zoom?: number;
}

function cameraScore(device: MediaDeviceInfo): number {
  const label = device.label.toLowerCase();
  let score = 0;

  if (/back|rear|environment|후면|뒷면/.test(label)) score += 100;
  if (/main|primary|standard|1x|기본|메인/.test(label)) score += 45;
  if (/front|user|selfie|전면/.test(label)) score -= 250;
  if (/ultra|0[.,]5|wide angle|dual wide|triple|광각/.test(label)) score -= 180;

  return score;
}

function choosePreferredCamera(devices: MediaDeviceInfo[]): MediaDeviceInfo | undefined {
  const ranked = [...devices].sort((a, b) => cameraScore(b) - cameraScore(a));
  const best = ranked[0];
  if (!best || cameraScore(best) <= 0) return undefined;
  return best;
}

async function tuneCamera(video: HTMLVideoElement): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 180));

  const stream = video.srcObject instanceof MediaStream ? video.srcObject : null;
  const track = stream?.getVideoTracks()[0];
  if (!track) return;

  if (typeof track.getCapabilities !== "function") return;
  const capabilities = track.getCapabilities() as ExtendedTrackCapabilities;
  const advanced: ExtendedConstraintSet[] = [];

  if (capabilities.focusMode?.includes("continuous")) {
    advanced.push({ focusMode: "continuous" });
  }

  if (capabilities.zoom) {
    const { min, max } = capabilities.zoom;
    const targetZoom = Math.min(max, Math.max(min, 1.6));
    if (targetZoom > min) advanced.push({ zoom: targetZoom });
  }

  if (advanced.length === 0) return;

  try {
    await track.applyConstraints({ advanced });
  } catch {
    // 기기별로 지원 범위가 다르므로 자동 초점/줌 적용 실패는 스캔을 막지 않습니다.
  }
}

export function CameraScanner({
  onDetected,
  onClose,
}: {
  onDetected: (value: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const onDetectedRef = useRef(onDetected);
  const completedRef = useRef(false);
  const [error, setError] = useState("");
  const [detected, setDetected] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [requestedDeviceId, setRequestedDeviceId] = useState("");
  const [activeDeviceId, setActiveDeviceId] = useState("");
  const [activeCameraLabel, setActiveCameraLabel] = useState("");

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let active = true;

    async function start() {
      try {
        setError("");
        setDetected(false);
        completedRef.current = false;
        controlsRef.current?.stop();
        controlsRef.current = null;

        const { BrowserCodeReader, BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader(undefined, 180);

        if (!videoRef.current) return;

        // 권한을 먼저 얻어야 모바일 브라우저가 후면 렌즈 이름을 제공하는 경우가 많습니다.
        const permissionStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        });
        permissionStream.getTracks().forEach((track) => track.stop());
        await new Promise<void>((resolve) => window.setTimeout(resolve, 120));

        const videoDevices = await BrowserCodeReader.listVideoInputDevices();
        if (!active) return;
        setDevices(videoDevices);

        const requested = videoDevices.find((device) => device.deviceId === requestedDeviceId);
        const preferred = requested ?? choosePreferredCamera(videoDevices);

        const callback = (result: { getText: () => string } | undefined) => {
          if (!active || !result || completedRef.current) return;
          const value = result.getText().trim();
          if (!value) return;

          completedRef.current = true;
          setDetected(true);
          window.setTimeout(() => {
            if (active) onDetectedRef.current(value);
          }, 140);
        };

        const controls = preferred
          ? await reader.decodeFromVideoDevice(preferred.deviceId, videoRef.current, callback)
          : await reader.decodeFromConstraints(
              {
                audio: false,
                video: {
                  facingMode: { ideal: "environment" },
                  width: { ideal: 1920 },
                  height: { ideal: 1080 },
                  aspectRatio: { ideal: 16 / 9 },
                  frameRate: { ideal: 30 },
                },
              },
              videoRef.current,
              callback,
            );

        if (!active) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
        await tuneCamera(videoRef.current);

        const stream = videoRef.current.srcObject instanceof MediaStream ? videoRef.current.srcObject : null;
        const track = stream?.getVideoTracks()[0];
        const settings = track?.getSettings();
        const currentDeviceId = settings?.deviceId ?? preferred?.deviceId ?? "";
        setActiveDeviceId(currentDeviceId);
        setActiveCameraLabel(track?.label || preferred?.label || "후면 카메라");
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "카메라를 시작할 수 없습니다.");
      }
    }

    void start();

    return () => {
      active = false;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [requestedDeviceId]);

  return (
    <div className="modal-backdrop">
      <section className="camera-modal" aria-modal="true" role="dialog">
        <div className="section-heading camera-heading">
          <div>
            <p className="eyebrow">CAMERA SCAN</p>
            <h2>바코드를 중앙선에 수평으로 맞추세요</h2>
          </div>
          <button className="button button-secondary" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className={`camera-preview ${detected ? "detected" : ""}`}>
          <video ref={videoRef} className="camera-video" muted playsInline />
          <div className="scan-guide" aria-hidden="true">
            <div className="scan-guide-frame" />
            <div className="scan-guide-line" />
          </div>
          <div className="camera-detection-status" aria-live="polite">
            {detected ? "바코드 인식 완료" : "가이드라인 안에 바코드를 크게 맞추세요"}
          </div>
        </div>

        {devices.length > 1 ? (
          <label className="camera-device-select">
            <span>카메라 선택</span>
            <select
              value={activeDeviceId}
              onChange={(event) => setRequestedDeviceId(event.target.value)}
              disabled={detected}
            >
              {devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `카메라 ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {activeCameraLabel ? <p className="camera-device-note">사용 중: {activeCameraLabel} · 자동 초점 및 약 1.6배 줌 우선</p> : null}
        {error ? <p className="inline-error">{error}</p> : null}
        <p className="muted camera-help">
          기본 후면 렌즈를 우선 선택합니다. 화면이 지나치게 넓으면 위 카메라 선택에서 다른 후면 렌즈를 선택하세요.
        </p>
      </section>
    </div>
  );
}
