"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
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

const nav: Array<{ href: string; label: string; permission: Permission }> = [
  { href: "/", label: "대시보드", permission: "view_dashboard" },
  { href: "/scan", label: "입고·출고", permission: "scan_inventory" },
  { href: "/inventory", label: "재고조회", permission: "view_inventory" },
  { href: "/transfers", label: "재고이관", permission: "transfer_inventory" },
  { href: "/external-transfers", label: "외부이관", permission: "external_transfer" },
  { href: "/work-requests", label: "업무요청", permission: "work_requests" },
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

function ShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, switchDemoUser } = useUser();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!isDemoMode()) return;
    const loadUsers = () => void listUsers().then(setUsers);
    loadUsers();
    return subscribeToInventory(loadUsers, { scope: "users" });
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen]);

  const visibleNav = useMemo(
    () => user ? nav.filter((item) => hasPermission(user.role, item.permission)) : [],
    [user],
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

      <aside className={styles.desktopRail} aria-label="SAN WMS 빠른 메뉴">
        <Link href="/" className={styles.railBrand} aria-label="대시보드" title="대시보드">S</Link>
        <button
          type="button"
          className={styles.railMenuButton}
          onClick={() => setDrawerOpen(true)}
          aria-label="전체 메뉴 열기"
          aria-expanded={drawerOpen}
          aria-controls="san-wms-navigation-drawer"
          title="전체 메뉴"
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
        onClick={() => setDrawerOpen(false)}
      />
      <aside
        id="san-wms-navigation-drawer"
        className={`${styles.drawer} ${drawerOpen ? styles.drawerOpen : ""}`}
        aria-hidden={!drawerOpen}
        inert={!drawerOpen}
      >
        <div className={styles.drawerHeader}>
          <Brand />
          <button type="button" className={styles.drawerClose} onClick={() => setDrawerOpen(false)} aria-label="메뉴 닫기">×</button>
        </div>
        <NavigationLinks onNavigate={() => setDrawerOpen(false)} />
        <SessionPanel />
      </aside>

      <div className={styles.workspace}>
        <header className={styles.workspaceHeader}>
          <button
            type="button"
            className={styles.mobileMenuButton}
            onClick={() => setDrawerOpen(true)}
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
        <button type="button" className={styles.bottomMore} onClick={() => setDrawerOpen(true)} aria-label="전체 메뉴 열기">
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
