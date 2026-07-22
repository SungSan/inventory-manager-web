"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getCurrentUser, setCurrentDemoUser, subscribeToInventory } from "@/lib/inventory-api";
import type { UserProfile } from "@/types/domain";

interface UserContextValue {
  user: UserProfile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  switchDemoUser: (userId: string) => Promise<void>;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * 화면을 가리지 않는 사용자 정보 갱신.
   * 데모 저장소는 스캔 로그를 포함한 모든 변경에서 이벤트를 발생시키므로,
   * 구독 갱신 때 loading=true로 바꾸면 PermissionGuard가 현재 페이지를
   * 언마운트하고 입출고 단계 상태가 초기화된다.
   */
  const refreshSilently = useCallback(async () => {
    setUser(await getCurrentUser());
  }, []);

  const refresh = useCallback(async () => {
    try {
      await refreshSilently();
    } finally {
      setLoading(false);
    }
  }, [refreshSilently]);

  useEffect(() => {
    let active = true;

    void getCurrentUser()
      .then((nextUser) => {
        if (active) setUser(nextUser);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    // 백그라운드 데이터 변경은 권한 화면을 내리지 않고 조용히 반영한다.
    const unsubscribe = subscribeToInventory(() => {
      void getCurrentUser().then((nextUser) => {
        if (active) setUser(nextUser);
      });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const switchDemoUser = useCallback(async (userId: string) => {
    setLoading(true);
    try {
      await setCurrentDemoUser(userId);
      await refreshSilently();
    } finally {
      setLoading(false);
    }
  }, [refreshSilently]);

  const value = useMemo(
    () => ({ user, loading, refresh, switchDemoUser }),
    [user, loading, refresh, switchDemoUser],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser(): UserContextValue {
  const value = useContext(UserContext);
  if (!value) throw new Error("UserProvider가 필요합니다.");
  return value;
}
