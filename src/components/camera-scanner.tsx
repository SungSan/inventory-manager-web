"use client";

import { useEffect, useRef, useState } from "react";
import { useUser } from "@/components/user-provider";

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

interface CameraPreference {
  deviceId: string;
  label: string;
}

interface CameraTuneResult {
  focusApplied: boolean;
  zoomApplied: boolean;
}

function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function preferenceKey(userId: string): string {
  return `san-wms:camera:${userId || "anonymous"}`;
}

function loadCameraPreference(userId: string): CameraPreference | null {
  try {
    const raw = window.localStorage.getItem(preferenceKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CameraPreference>;
    if (!parsed.deviceId && !parsed.label) return null;
    return { deviceId: parsed.deviceId ?? "", label: parsed.label ?? "" };
  } catch {
    return null;
  }
}

function saveCameraPreference(userId: string, device: CameraPreference): void {
  try {
    window.localStorage.setItem(preferenceKey(userId), JSON.stringify(device));
  } catch {
    // 저장소가 차단된 브라우저에서는 현재 세션에서만 선택값을 사용합니다.
  }
}

function cameraScore(device: MediaDeviceInfo): number {
  const label = device.label.toLowerCase();
  let score = 0;

  if (/back|rear|environment|후면|뒷면/.test(label)) score += 100;
  if (/main|primary|standard|1x|기본|메인|wide camera/.test(label)) score += 55;
  if (/front|user|selfie|전면/.test(label)) score -= 300;
  if (/ultra\s*wide|0[.,]5x?|초광각/.test(label)) score -= 220;
  if (/telephoto|망원|3x|5x/.test(label)) score -= 120;
  if (/dual\s*wide|triple/.test(label)) score -= 20;

  return score;
}

function choosePreferredCamera(devices: MediaDeviceInfo[]): MediaDeviceInfo | undefined {
  const ranked = [...devices].sort((a, b) => cameraScore(b) - cameraScore(a));
  const best = ranked[0];
  if (!best || cameraScore(best) <= 0) return undefined;
  return best;
}

async function applyAdvancedConstraint(
  track: MediaStreamTrack,
  constraint: ExtendedConstraintSet,
): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [constraint] });
    return true;
  } catch {
    return false;
  }
}

async function tuneCamera(video: HTMLVideoElement, forceRefocus = false): Promise<CameraTuneResult> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, forceRefocus ? 40 : 220));

  const stream = video.srcObject instanceof MediaStream ? video.srcObject : null;
  const track = stream?.getVideoTracks()[0];
  if (!track || typeof track.getCapabilities !== "function") {
    return { focusApplied: false, zoomApplied: false };
  }

  const capabilities = track.getCapabilities() as ExtendedTrackCapabilities;
  const focusModes = capabilities.focusMode ?? [];
  let focusApplied = false;

  if (forceRefocus && focusModes.includes("single-shot")) {
    focusApplied = await applyAdvancedConstraint(track, { focusMode: "single-shot" });
    if (focusApplied) await new Promise<void>((resolve) => window.setTimeout(resolve, 180));
  }

  if (focusModes.includes("continuous")) {
    focusApplied = await applyAdvancedConstraint(track, { focusMode: "continuous" }) || focusApplied;
  } else if (!focusApplied && focusModes.includes("single-shot")) {
    focusApplied = await applyAdvancedConstraint(track, { focusMode: "single-shot" });
  }

  let zoomApplied = false;
  // iPhone Safari에서는 디지털 줌이 렌즈 전환이나 근거리 초점 불안정을 유발할 수 있어 자동 줌을 적용하지 않습니다.
  if (!isIOSDevice() && capabilities.zoom) {
    const { min, max } = capabilities.zoom;
    const targetZoom = Math.min(max, Math.max(min, 1.4));
    if (targetZoom > min) {
      zoomApplied = await applyAdvancedConstraint(track, { zoom: targetZoom });
    }
  }

  return { focusApplied, zoomApplied };
}

export function CameraScanner({
  onDetected,
  onClose,
}: {
  onDetected: (value: string) => void;
  onClose: () => void;
}) {
  const { user } = useUser();
  const userId = user?.id ?? "anonymous";
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
  const [focusDescription, setFocusDescription] = useState("");
  const [focusBusy, setFocusBusy] = useState(false);
  const [restartToken, setRestartToken] = useState(0);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let active = true;

    async function start() {
      try {
        setError("");
        setDetected(false);
        setFocusDescription("");
        completedRef.current = false;
        controlsRef.current?.stop();
        controlsRef.current = null;

        const { BrowserCodeReader, BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();

        if (!videoRef.current) return;

        // 권한을 먼저 얻어야 모바일 브라우저가 실제 렌즈 이름과 장치 ID를 제공하는 경우가 많습니다.
        const permissionStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        });
        permissionStream.getTracks().forEach((track) => track.stop());
        await new Promise<void>((resolve) => window.setTimeout(resolve, 120));

        const videoDevices = await BrowserCodeReader.listVideoInputDevices();
        if (!active) return;
        setDevices(videoDevices);

        const rememberedPreference = loadCameraPreference(userId);
        const requested = videoDevices.find((device) => device.deviceId === requestedDeviceId);
        const remembered = videoDevices.find((device) => device.deviceId === rememberedPreference?.deviceId)
          ?? videoDevices.find((device) => Boolean(rememberedPreference?.label) && device.label === rememberedPreference?.label);
        const preferred = requested ?? remembered ?? choosePreferredCamera(videoDevices);

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

        const videoConstraints: MediaTrackConstraints = preferred
          ? {
              deviceId: { exact: preferred.deviceId },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              aspectRatio: { ideal: 16 / 9 },
              frameRate: { ideal: 30 },
            }
          : {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              aspectRatio: { ideal: 16 / 9 },
              frameRate: { ideal: 30 },
            };

        const controls = await reader.decodeFromConstraints(
          { audio: false, video: videoConstraints },
          videoRef.current,
          callback,
        );

        if (!active) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
        const tuneResult = await tuneCamera(videoRef.current);

        const stream = videoRef.current.srcObject instanceof MediaStream ? videoRef.current.srcObject : null;
        const track = stream?.getVideoTracks()[0];
        const settings = track?.getSettings();
        const currentDeviceId = settings?.deviceId ?? preferred?.deviceId ?? "";
        const currentLabel = track?.label || preferred?.label || "후면 카메라";
        setActiveDeviceId(currentDeviceId);
        setActiveCameraLabel(currentLabel);
        setFocusDescription(
          tuneResult.focusApplied
            ? "연속 자동초점 적용"
            : isIOSDevice()
              ? "iPhone 브라우저 기본 자동초점 사용"
              : "기기 기본 자동초점 사용",
        );

        if (currentDeviceId || currentLabel) {
          saveCameraPreference(userId, { deviceId: currentDeviceId, label: currentLabel });
        }
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
  }, [requestedDeviceId, restartToken, userId]);

  async function refocus() {
    if (!videoRef.current || focusBusy || detected) return;
    setFocusBusy(true);
    try {
      const result = await tuneCamera(videoRef.current, true);
      if (result.focusApplied) {
        setFocusDescription("자동초점을 다시 적용했습니다.");
      } else {
        // Safari가 focusMode를 공개하지 않는 경우 스트림 재시작으로 네이티브 자동초점을 다시 유도합니다.
        setFocusDescription("카메라 자동초점을 다시 시작합니다.");
        setRestartToken((value) => value + 1);
      }
    } finally {
      setFocusBusy(false);
    }
  }

  function selectCamera(deviceId: string) {
    const device = devices.find((item) => item.deviceId === deviceId);
    if (device) saveCameraPreference(userId, { deviceId: device.deviceId, label: device.label });
    setRequestedDeviceId(deviceId);
  }

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
          <video ref={videoRef} className="camera-video" muted playsInline autoPlay />
          <div className="scan-guide" aria-hidden="true">
            <div className="scan-guide-frame" />
            <div className="scan-guide-line" />
          </div>
          <div className="camera-detection-status" aria-live="polite">
            {detected ? "바코드 인식 완료" : "가이드라인 안에 바코드를 크게 맞추세요"}
          </div>
        </div>

        <div className="action-row">
          {devices.length > 1 ? (
            <label className="camera-device-select">
              <span>기본 카메라 선택</span>
              <select
                value={activeDeviceId || requestedDeviceId}
                onChange={(event) => selectCamera(event.target.value)}
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
          <button
            type="button"
            className="button button-secondary"
            disabled={detected || focusBusy}
            onClick={() => void refocus()}
          >
            {focusBusy ? "초점 조정 중..." : "초점 다시 맞추기"}
          </button>
        </div>

        {activeCameraLabel ? (
          <p className="camera-device-note">
            사용 중: {activeCameraLabel} · {focusDescription} · 이 사용자와 기기의 기본값으로 저장됨
          </p>
        ) : null}
        {error ? <p className="inline-error">{error}</p> : null}
        <p className="muted camera-help">
          후면 1배 메인 렌즈를 우선합니다. iPhone은 자동 줌을 사용하지 않으며, 초점이 흐리면 바코드를 15~30cm 정도 떨어뜨린 뒤 초점 다시 맞추기를 누르세요.
        </p>
      </section>
    </div>
  );
}
