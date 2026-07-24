"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { acknowledgeWorkRequestNotification, getWorkRequestBadge, listMyWorkRequestNotifications, type WorkRequestBadge, type WorkRequestNotification } from "@/lib/work-request-api";
import { subscribeToInventory } from "@/lib/inventory-api";
import styles from "./work-request-indicator.module.css";

export function WorkRequestIndicator() {
  const [badge, setBadge] = useState<WorkRequestBadge>({ pending: 0, today: 0, tomorrow: 0, changeApprovals: 0 });
  const [notifications, setNotifications] = useState<WorkRequestNotification[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [nextBadge, nextNotifications] = await Promise.all([getWorkRequestBadge(), listMyWorkRequestNotifications()]);
      setBadge(nextBadge);
      setNotifications(nextNotifications);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "업무요청 알림을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const unsubscribe = subscribeToInventory(() => void load());
    return () => { window.clearInterval(timer); unsubscribe(); };
  }, [load]);

  const popup = useMemo(() => notifications.find((item) => !item.acknowledgedAt), [notifications]);

  async function acknowledge(item: WorkRequestNotification) {
    try {
      await acknowledgeWorkRequestNotification(item.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "알림 확인 처리에 실패했습니다.");
    }
  }

  if (badge.pending === 0 && !popup) return null;

  return (
    <div className={styles.wrap}>
      {badge.pending > 0 ? (
        <Link href="/work-requests?tab=work" className={styles.badge} title={`오늘 ${badge.today}건 · 내일 ${badge.tomorrow}건`}>
          <span>대기 중인 작업</span><strong>{badge.pending}</strong>
        </Link>
      ) : null}
      {popup ? (
        <aside className={styles.popup} role="dialog" aria-live="assertive">
          <div>
            <p className="eyebrow">WORK REQUEST</p>
            <h3>{popup.requestNo}</h3>
          </div>
          <p>{popup.message}</p>
          <div className={styles.meta}>
            {badge.today > 0 ? <span>오늘 출고 {badge.today}건</span> : null}
            {badge.tomorrow > 0 ? <span>내일 출고 {badge.tomorrow}건</span> : null}
            {badge.changeApprovals > 0 ? <span>수정 승인 {badge.changeApprovals}건</span> : null}
          </div>
          {error ? <p className="inline-error">{error}</p> : null}
          <div className={styles.actions}>
            <button className="button button-secondary button-compact" onClick={() => void acknowledge(popup)}>확인</button>
            <Link className="button button-primary button-compact" href={`/work-requests/${popup.workRequestId}`} onClick={() => void acknowledge(popup)}>업무 열기</Link>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
