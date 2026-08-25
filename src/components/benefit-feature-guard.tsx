"use client";

import { useCallback, useEffect, useState } from "react";
import { useUser } from "@/components/user-provider";
import { getMyBenefitFeatureAccess } from "@/lib/benefit-api";

export function useBenefitFeatureAccess() {
  const { user, loading: userLoading } = useUser();
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) { setAllowed(false); setLoading(false); return; }
    try { setAllowed(await getMyBenefitFeatureAccess()); }
    catch { setAllowed(false); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(timer); };
  }, [refresh]);

  return { allowed, loading: userLoading || loading, refresh };
}

export function BenefitFeatureGuard({ children }: { children: React.ReactNode }) {
  const { allowed, loading } = useBenefitFeatureAccess();
  if (loading) return <div className="center-panel">특전 자동계산 사용 승인 확인 중...</div>;
  if (!allowed) return <section className="panel"><h2>접근 권한이 없습니다.</h2><p className="muted">이 기능은 역할과 별개로 관리자가 계정별 사용 승인을 한 경우에만 사용할 수 있습니다.</p></section>;
  return children;
}
