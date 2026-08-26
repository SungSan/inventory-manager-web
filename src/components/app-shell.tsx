"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { AuthGate } from "@/components/auth-gate";
import { useBenefitFeatureAccess } from "@/components/benefit-feature-guard";
import { NumericInputGuard } from "@/components/numeric-input-guard";
import { StocktakeLiveEnhancer } from "@/components/stocktake-live-enhancer";
import { WorkRequestIndicator } from "@/components/work-request-indicator";
import { WorkRequestRuleEnhancer } from "@/components/work-request-rule-enhancer";
import { useUser } from "@/components/user-provider";
import { APP_VERSION_LABEL } from "@/lib/app-version";
import { hasPermission, roleLabels, type Permission } from "@/lib/permissions";
import { desktopActivityStorageKey } from "@/lib/session-guard-api";
import { isDemoMode, getSupabaseClient } from "@/lib/supabase";
import { listUsers, subscribeToInventory } from "@/lib/inventory-api";
import type { UserProfile } from "@/types/domain";
import styles from "./app-shell.module.css";

type NavItem = { href: string; label: string; permission?: Permission; benefitFeature?: boolean };
type PresenceUser = { userId: string; displayName: string; pageLabel: string; path: string; onlineAt: number; lastActiveAt: number };
type PresenceDisplay = PresenceUser & { disconnectedAt?: number };

const AWAY_AFTER_MS = 10 * 60 * 1000;
const OFFLINE_VISIBLE_MS = 10 * 60 * 1000;
const ACTIVITY_TRACK_THROTTLE_MS = 30 * 1000;

const nav: NavItem[] = [
  { href: "/", label: "대시보드", permission: "view_dashboard" },
  { href: "/scan", label: "입고·출고", permission: "scan_inventory" },
  { href: "/inventory", label: "재고조회", permission: "view_inventory" },
  { href: "/transfers", label: "재고이관", permission: "transfer_inventory" },
  { href: "/external-transfers", label: "외부이관", permission: "external_transfer" },
  { href: "/work-requests", label: "업무요청", permission: "work_requests" },
  { href: "/benefits", label: "특전 자동계산", benefitFeature: true },
  { href: "/shipment-documents", label: "출고명세서", permission: "shipment_documents" },
  { href: "/products", label: "상품관리", permission: "manage_products" },
  { href: "/barcodes", label: "바코드", permission: "manage_barcodes" },
  { href: "/locations", label: "로케이션", permission: "manage_locations" },
  { href: "/location-map", label: "로케이션맵", permission: "view_inventory" },
  { href: "/utilization", label: "용적률", permission: "view_inventory" },
  { href: "/stocktakes", label: "재고실사", permission: "stocktake_inventory" },
  { href: "/logs", label: "로그", permission: "view_logs" },
  { href: "/import", label: "데이터이전", permission: "import_data" },
  { href: "/users", label: "사용자", permission: "manage_users" },
  { href: "/my-consent", label: "내 동의내역", permission: "view_dashboard" },
];

const mobilePrimary = [
  { href: "/", label: "홈", icon: "⌂" },
  { href: "/scan", label: "입출고", icon: "⇅" },
  { href: "/inventory", label: "재고조회", icon: "▦" },
  { href: "/transfers", label: "재고이관", icon: "⇄" },
];

function isRouteActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

function OnlinePresenceTicker({ user, pathname, pageLabel }: { user: UserProfile | null; pathname: string; pageLabel: string }) {
  const [presenceUsers, setPresenceUsers] = useState<PresenceDisplay[]>([]);
  const [clock, setClock] = useState(Date.now());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastActiveAtRef = useRef(Date.now());
  const lastTrackedAtRef = useRef(0);
  const currentMetaRef = useRef({ pathname, pageLabel });
  currentMetaRef.current = { pathname, pageLabel };

  const ownPresence = useCallback((): PresenceUser | null => {
    if (!user) return null;
    return {
      userId: user.id,
      displayName: user.displayName,
      pageLabel: currentMetaRef.current.pageLabel,
      path: currentMetaRef.current.pathname,
      onlineAt: Date.now(),
      lastActiveAt: lastActiveAtRef.current,
    };
  }, [user]);

  useEffect(() => {
    if (!user) { setPresenceUsers([]); return; }
    const initialPresence = ownPresence();
    if (!initialPresence) return;
    if (isDemoMode()) { setPresenceUsers([initialPresence]); return; }
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const channel = supabase.channel("san-wms-online-users", { config: { presence: { key: user.id } } });
    channelRef.current = channel;
    const syncPresence = () => {
      const latestByUser = new Map<string, PresenceUser>();
      for (const presences of Object.values(channel.presenceState<PresenceUser>())) {
        for (const presence of presences) {
          if (!presence.userId || !presence.displayName) continue;
          const previous = latestByUser.get(presence.userId);
          if (!previous || presence.lastActiveAt >= previous.lastActiveAt) latestByUser.set(presence.userId, presence);
        }
      }
      const detectedAt = Date.now();
      setPresenceUsers((previous) => {
        const next = new Map<string, PresenceDisplay>();
        for (const presence of latestByUser.values()) next.set(presence.userId, presence);
        for (const item of previous) {
          if (!next.has(item.userId)) next.set(item.userId, { ...item, disconnectedAt: item.disconnectedAt ?? detectedAt });
        }
        return [...next.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, "ko-KR"));
      });
    };

    channel
      .on("presence", { event: "sync" }, syncPresence)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          lastTrackedAtRef.current = Date.now();
          void channel.track(initialPresence);
        }
      });

    return () => { channelRef.current = null; void supabase.removeChannel(channel); };
  }, [ownPresence, user]);

  useEffect(() => {
    const presence = ownPresence();
    if (!presence) return;
    if (isDemoMode()) { setPresenceUsers([presence]); return; }
    if (channelRef.current) {
      lastTrackedAtRef.current = Date.now();
      void channelRef.current.track(presence);
    }
  }, [ownPresence, pageLabel, pathname]);

  useEffect(() => {
    if (!user) return;
    const recordActivity = () => {
      const now = Date.now();
      lastActiveAtRef.current = now;
      if (now - lastTrackedAtRef.current < ACTIVITY_TRACK_THROTTLE_MS) return;
      const presence = ownPresence();
      if (!presence) return;
      lastTrackedAtRef.current = now;
      if (isDemoMode()) setPresenceUsers([presence]);
      else if (channelRef.current) void channelRef.current.track(presence);
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "pointermove", "keydown", "touchstart", "scroll", "focus"];
    for (const eventName of events) window.addEventListener(eventName, recordActivity, { passive: true });
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => {
      for (const eventName of events) window.removeEventListener(eventName, recordActivity);
      window.clearInterval(timer);
    };
  }, [ownPresence, user]);

  const visibleUsers = presenceUsers.filter((item) => !item.disconnectedAt || clock - item.disconnectedAt < OFFLINE_VISIBLE_MS);
  const connectedCount = visibleUsers.filter((item) => !item.disconnectedAt).length;
  const statusOf = (item: PresenceDisplay) => item.disconnectedAt ? "OFFLINE" : clock - item.lastActiveAt >= AWAY_AFTER_MS ? "AWAY" : "ACTIVE";
  const statusLabel = { ACTIVE: "작업중", AWAY: "자리비움", OFFLINE: "접속종료" } as const;

  return <details className={styles.presenceMenu}>
    <summary className={styles.presenceSummary} aria-label={`접속 현황 ${visibleUsers.length}명`}>
      <span className={`${styles.presencePulse} ${connectedCount === 0 ? styles.presencePulseIdle : ""}`} aria-hidden="true" />
      <span>접속 {connectedCount}</span>
    </summary>
    <div className={styles.presencePopover}>
      <div className={styles.presencePopoverHeader}><strong>접속 현황</strong><span>{visibleUsers.length}명</span></div>
      <div className={styles.presenceList}>
        {visibleUsers.length > 0 ? visibleUsers.map((item) => {
          const status = statusOf(item);
          return <div className={styles.presenceItem} key={item.userId}>
            <span className={`${styles.presenceDot} ${styles[`presenceDot${status}`]}`} aria-hidden="true" />
            <div className={styles.presenceIdentity}><strong>{item.displayName}</strong><small>{statusLabel[status]}</small></div>
            <span>{item.pageLabel}</span>
          </div>;
        }) : <p className={styles.presenceEmpty}>접속자가 없습니다.</p>}
      </div>
      <div className={styles.presenceLegend}><span><i className={styles.presenceDotACTIVE} />10분 이내</span><span><i className={styles.presenceDotAWAY} />10분 이상</span><span><i className={styles.presenceDotOFFLINE} />종료 후 10분</span></div>
    </div>
  </details>;
}

function ShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, switchDemoUser } = useUser();
  const { allowed: benefitFeatureAllowed } = useBenefitFeatureAccess();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPinned, setDrawerPinned] = useState(false);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelHoverClose() {
    if (hoverCloseTimer.current !== null) {
      clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
  }

  function closeDrawer() {
    cancelHoverClose();
    setDrawerPinned(false);
    setDrawerOpen(false);
  }

  function openDrawer() {
    cancelHoverClose();
    setDrawerOpen(true);
  }

  function openDrawerFromHover() {
    cancelHoverClose();
    setDrawerOpen(true);
  }

  function scheduleHoverClose() {
    if (drawerPinned) return;
    cancelHoverClose();
    hoverCloseTimer.current = setTimeout(() => {
      setDrawerOpen(false);
      hoverCloseTimer.current = null;
    }, 220);
  }

  function toggleDesktopDrawer() {
    cancelHoverClose();
    if (drawerPinned) {
      setDrawerPinned(false);
      setDrawerOpen(false);
      return;
    }
    setDrawerPinned(true);
    setDrawerOpen(true);
  }

  useEffect(() => {
    if (!isDemoMode()) return;
    const loadUsers = () => void listUsers().then(setUsers);
    loadUsers();
    return subscribeToInventory(loadUsers, { scope: "users" });
  }, []);

  useEffect(() => {
    cancelHoverClose();
    setDrawerPinned(false);
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => () => cancelHoverClose(), []);

  useEffect(() => {
    if (!drawerOpen) return;
    const shouldLockBody = window.matchMedia("(max-width: 1199px)").matches;
    const previousOverflow = document.body.style.overflow;
    if (shouldLockBody) document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      if (shouldLockBody) document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen]);

  const visibleNav = useMemo(
    () => user ? nav.filter((item) => {
      if (item.benefitFeature) return benefitFeatureAllowed;
      return item.permission ? hasPermission(user.role, item.permission) : false;
    }) : [],
    [user, benefitFeatureAllowed],
  );

  const mobileNav = useMemo(
    () => mobilePrimary.filter((item) => visibleNav.some((navItem) => navItem.href === item.href)),
    [visibleNav],
  );

  const currentNav = useMemo(
    () => visibleNav.find((item) => isRouteActive(pathname, item.href)),
    [pathname, visibleNav],
  );

  function signOut() {
    if (user) localStorage.removeItem(desktopActivityStorageKey(user.id));
    void getSupabaseClient()?.auth.signOut({ scope: "local" });
  }

  function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
    return (
      <nav className={styles.sideNav} aria-label="주요 메뉴">
        {visibleNav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`${styles.sideLink} ${isRouteActive(pathname, item.href) ? styles.sideLinkActive : ""}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    );
  }

  function Brand() {
    return (
      <div className={styles.brand}>
        <span className={styles.brandMark}>S</span>
        <div className={styles.brandText}>
          <strong>SAN WMS</strong>
          <small>재고관리 · {APP_VERSION_LABEL}</small>
        </div>
      </div>
    );
  }

  function SessionPanel() {
    return (
      <div className={styles.sidebarFooter}>
        <div className={styles.sessionRow}>
          <span className={`${styles.sidebarMode} ${isDemoMode() ? styles.sidebarModeDemo : styles.sidebarModeLive}`}>
            {isDemoMode() ? "DEMO" : "LIVE"}
          </span>
          {user ? <span className={styles.sidebarUser}>{user.displayName} · {roleLabels[user.role]}</span> : null}
        </div>
        {isDemoMode() && user ? (
          <select
            className={styles.sidebarSelect}
            value={user.id}
            onChange={(event) => void switchDemoUser(event.target.value)}
            aria-label="데모 사용자 변경"
          >
            {users.map((item) => (
              <option key={item.id} value={item.id}>{item.displayName} ({roleLabels[item.role]})</option>
            ))}
          </select>
        ) : null}
        {!isDemoMode() ? (
          <button type="button" className={styles.sidebarLogout} onClick={signOut}>로그아웃</button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <StocktakeLiveEnhancer />
      <WorkRequestRuleEnhancer />
      <NumericInputGuard />

      <aside
        className={styles.desktopRail}
        aria-label="SAN WMS 빠른 메뉴"
        onMouseEnter={openDrawerFromHover}
        onMouseLeave={scheduleHoverClose}
      >
        <Link href="/" className={styles.railBrand} aria-label="대시보드" title="대시보드">S</Link>
        <button
          type="button"
          className={styles.railMenuButton}
          onClick={toggleDesktopDrawer}
          aria-label={drawerPinned ? "고정 메뉴 닫기" : "전체 메뉴 고정 열기"}
          aria-expanded={drawerOpen}
          aria-controls="san-wms-navigation-drawer"
          title={drawerPinned ? "메뉴 고정 해제" : "마우스를 올리면 자동으로 열립니다 · 클릭하면 고정"}
        >
          ☰
        </button>
        <div className={styles.railCurrent} title={currentNav?.label ?? "현재 메뉴"} aria-hidden="true">
          <span />
        </div>
        <div className={styles.railSpacer} />
        <span
          className={`${styles.railStatus} ${isDemoMode() ? styles.railStatusDemo : styles.railStatusLive}`}
          title={isDemoMode() ? "DEMO" : "LIVE"}
          aria-label={isDemoMode() ? "데모 모드" : "실운영 모드"}
        />
      </aside>

      <button
        type="button"
        aria-label="메뉴 닫기"
        className={`${styles.drawerBackdrop} ${drawerOpen ? styles.drawerBackdropOpen : ""}`}
        onClick={closeDrawer}
      />
      <aside
        id="san-wms-navigation-drawer"
        className={`${styles.drawer} ${drawerOpen ? styles.drawerOpen : ""}`}
        aria-hidden={!drawerOpen}
        inert={!drawerOpen}
        onMouseEnter={cancelHoverClose}
        onMouseLeave={scheduleHoverClose}
      >
        <div className={styles.drawerHeader}>
          <Brand />
          <button type="button" className={styles.drawerClose} onClick={closeDrawer} aria-label="메뉴 닫기">×</button>
        </div>
        <NavigationLinks onNavigate={closeDrawer} />
        <SessionPanel />
      </aside>

      <div className={styles.workspace}>
        <header className={styles.workspaceHeader}>
          <button
            type="button"
            className={styles.mobileMenuButton}
            onClick={openDrawer}
            aria-label="전체 메뉴 열기"
            aria-expanded={drawerOpen}
            aria-controls="san-wms-navigation-drawer"
          >
            ☰
          </button>
          <div className={styles.workspaceTitle}>
            <p className="eyebrow">SAN WMS · {APP_VERSION_LABEL}</p>
            <h1>재고관리</h1>
          </div>
          <div className={styles.workspaceActions}>
            <OnlinePresenceTicker user={user} pathname={pathname} pageLabel={currentNav?.label ?? "알 수 없는 화면"} />
            <WorkRequestIndicator />
          </div>
        </header>
        <main className={styles.content}>{children}</main>
      </div>

      <nav
        className={styles.bottomNav}
        aria-label="모바일 빠른 메뉴"
        style={{ gridTemplateColumns: `repeat(${mobileNav.length + 1}, minmax(0, 1fr))` }}
      >
        {mobileNav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.bottomLink} ${isRouteActive(pathname, item.href) ? styles.bottomLinkActive : ""}`}
          >
            <span className={styles.bottomIcon} aria-hidden="true">{item.icon}</span>
            <span className={styles.bottomLabel}>{item.label}</span>
          </Link>
        ))}
        <button type="button" className={styles.bottomMore} onClick={openDrawer} aria-label="전체 메뉴 열기">
          <span className={styles.bottomIcon} aria-hidden="true">☰</span>
          <span className={styles.bottomLabel}>전체</span>
        </button>
      </nav>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return <AuthGate><ShellContent>{children}</ShellContent></AuthGate>;
}
