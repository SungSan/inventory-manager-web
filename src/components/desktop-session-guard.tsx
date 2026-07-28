"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { getSupabaseClient, isDemoMode } from "@/lib/supabase";
import {
  desktopActivityStorageKey,
  getDesktopSessionGuardStatus,
  verifyCurrentUserPin,
} from "@/lib/session-guard-api";
import styles from "./desktop-session-guard.module.css";

const LOCK_AFTER_MS = 10 * 60 * 1000;
const LOGOUT_AFTER_MS = 40 * 60 * 1000;
const ACTIVITY_WRITE_THROTTLE_MS = 2_000;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

function isMobileOrTabletDevice(): boolean {
  const browserNavigator = navigator as Navigator & {
    userAgentData?: { mobile?: boolean };
  };

  if (browserNavigator.userAgentData?.mobile) return true;
  if (/Android|iPhone|iPad|iPod|IEMobile|Mobile/i.test(navigator.userAgent)) return true;

  // iPadOS가 데스크톱 Safari 식별자를 사용하는 경우를 포함한다.
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export function DesktopSessionGuard({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const activityKey = desktopActivityStorageKey(userId);
  const [desktopEnabled, setDesktopEnabled] = useState(false);
  const [pinLockEnabled, setPinLockEnabled] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [lockedUntil, setLockedUntil] = useState("");
  const [checking, setChecking] = useState(false);
  const [secondsUntilLogout, setSecondsUntilLogout] = useState(LOGOUT_AFTER_MS / 1000);

  const lastActivityRef = useRef(Date.now());
  const lastActivityWriteRef = useRef(0);
  const lockedRef = useRef(false);
  const pinLockEnabledRef = useRef(false);
  const signingOutRef = useRef(false);

  useEffect(() => {
    pinLockEnabledRef.current = pinLockEnabled;
  }, [pinLockEnabled]);

  const persistActivity = useCallback((activityAt = Date.now()) => {
    lastActivityRef.current = activityAt;
    lastActivityWriteRef.current = activityAt;
    localStorage.setItem(activityKey, String(activityAt));
    setSecondsUntilLogout(Math.ceil(LOGOUT_AFTER_MS / 1000));
  }, [activityKey]);

  const signOut = useCallback(async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    try {
      localStorage.removeItem(activityKey);
      await getSupabaseClient()?.auth.signOut({ scope: "local" });
    } finally {
      signingOutRef.current = false;
    }
  }, [activityKey]);

  const evaluateIdle = useCallback((now = Date.now()): "active" | "locked" | "logout" => {
    const idleMs = Math.max(0, now - lastActivityRef.current);
    setSecondsUntilLogout(Math.max(0, Math.ceil((LOGOUT_AFTER_MS - idleMs) / 1000)));

    if (idleMs >= LOGOUT_AFTER_MS) {
      void signOut();
      return "logout";
    }

    if (pinLockEnabledRef.current && idleMs >= LOCK_AFTER_MS) {
      if (!lockedRef.current) {
        lockedRef.current = true;
        setLocked(true);
        setPin("");
        setMessage("");
        setLockedUntil("");
      }
      return "locked";
    }

    return "active";
  }, [signOut]);

  useEffect(() => {
    if (isDemoMode() || isMobileOrTabletDevice()) return;

    const storedActivity = Number(localStorage.getItem(activityKey));
    const initialActivity = Number.isFinite(storedActivity) && storedActivity > 0
      ? storedActivity
      : Date.now();

    lastActivityRef.current = initialActivity;
    lastActivityWriteRef.current = initialActivity;
    if (!Number.isFinite(storedActivity) || storedActivity <= 0) {
      localStorage.setItem(activityKey, String(initialActivity));
    }

    setDesktopEnabled(true);

    let cancelled = false;
    void getDesktopSessionGuardStatus()
      .then((status) => {
        if (cancelled) return;
        setPinLockEnabled(status.enabled && status.pinConfigured);
        setDisplayName(status.displayName ?? "");
      })
      .catch(() => {
        // 28번 SQL 적용 전에는 10분 PIN 잠금만 비활성화한다.
        // 40분 자동 로그아웃은 그대로 유지해 배포 순서에 따른 사용 불능을 방지한다.
        if (!cancelled) setPinLockEnabled(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activityKey]);

  useEffect(() => {
    if (!desktopEnabled) return;

    const recordActivity = () => {
      if (lockedRef.current) return;
      const now = Date.now();
      if (now - lastActivityWriteRef.current < ACTIVITY_WRITE_THROTTLE_MS) return;
      persistActivity(now);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== activityKey || !event.newValue) return;
      const activityAt = Number(event.newValue);
      if (!Number.isFinite(activityAt) || activityAt <= lastActivityRef.current) return;
      lastActivityRef.current = activityAt;
      lastActivityWriteRef.current = activityAt;
    };

    const handleReturnToWindow = () => {
      if (document.visibilityState !== "visible") return;
      const result = evaluateIdle();
      if (result === "active") recordActivity();
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "pointermove",
      "keydown",
      "wheel",
      "scroll",
    ];

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, recordActivity, { passive: true });
    });
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleReturnToWindow);
    document.addEventListener("visibilitychange", handleReturnToWindow);

    const timer = window.setInterval(() => evaluateIdle(), 1_000);
    evaluateIdle();

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, recordActivity);
      });
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleReturnToWindow);
      document.removeEventListener("visibilitychange", handleReturnToWindow);
      window.clearInterval(timer);
    };
  }, [activityKey, desktopEnabled, evaluateIdle, persistActivity]);

  useEffect(() => {
    if (!locked) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [locked]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pin.length !== 6 || checking) return;

    setChecking(true);
    setMessage("");
    setLockedUntil("");
    try {
      const result = await verifyCurrentUserPin(pin);
      if (!result.ok) {
        const attempts = result.remainingAttempts == null
          ? ""
          : ` 남은 입력 횟수: ${result.remainingAttempts}회`;
        setMessage(`${result.message || "PIN을 확인하지 못했습니다."}${attempts}`);
        setLockedUntil(result.lockedUntil ?? "");
        setPin("");
        return;
      }

      lockedRef.current = false;
      setLocked(false);
      setPin("");
      setMessage("");
      setLockedUntil("");
      persistActivity(Date.now());
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "PIN 확인 중 오류가 발생했습니다.");
    } finally {
      setChecking(false);
    }
  }

  const logoutMinutes = Math.max(1, Math.ceil(secondsUntilLogout / 60));

  return (
    <>
      {children}
      {desktopEnabled && pinLockEnabled && locked ? (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="desktop-lock-title">
          <section className={styles.card}>
            <header className={styles.header}>
              <p className="eyebrow">SAN WMS · PC SECURITY LOCK</p>
              <h1 id="desktop-lock-title">화면이 잠겼습니다.</h1>
              <p className="muted">
                {displayName ? `${displayName} 계정이 ` : ""}10분 동안 활동이 없어 보호 잠금되었습니다.
              </p>
            </header>

            <form className={styles.form} onSubmit={unlock}>
              <label>
                개인 PIN 6자리
                <input
                  className={styles.pinInput}
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={pin}
                  onChange={(event) => setPin(digitsOnly(event.target.value))}
                  autoComplete="current-password"
                  autoFocus
                  disabled={checking}
                />
              </label>

              <p className={styles.notice}>
                PIN을 입력하지 않으면 마지막 활동 시점부터 40분 후 자동 로그아웃됩니다. 약 {logoutMinutes}분 남았습니다.
              </p>

              {message ? <p className={styles.error}>{message}</p> : null}
              {lockedUntil ? (
                <p className={styles.error}>
                  다시 입력 가능: {new Date(lockedUntil).toLocaleString("ko-KR")}
                </p>
              ) : null}

              <div className={styles.actions}>
                <button type="button" className="button button-secondary" onClick={() => void signOut()} disabled={checking}>
                  로그아웃
                </button>
                <button type="submit" className="button button-primary" disabled={checking || pin.length !== 6}>
                  {checking ? "PIN 확인 중..." : "잠금 해제"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
