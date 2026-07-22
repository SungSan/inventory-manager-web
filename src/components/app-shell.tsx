"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { useUser } from "@/components/user-provider";
import { hasPermission, roleLabels, type Permission } from "@/lib/permissions";
import { isDemoMode, getSupabaseClient } from "@/lib/supabase";
import { listUsers, subscribeToInventory } from "@/lib/inventory-api";
import type { UserProfile } from "@/types/domain";

const nav: Array<{ href: string; label: string; permission: Permission }> = [
  { href: "/", label: "대시보드", permission: "view_dashboard" },
  { href: "/scan", label: "입고·출고", permission: "scan_inventory" },
  { href: "/inventory", label: "재고조회", permission: "view_inventory" },
  { href: "/utilization", label: "용적률", permission: "view_inventory" },
  { href: "/location-map", label: "로케이션맵", permission: "view_inventory" },
  { href: "/transfers", label: "재고이관", permission: "transfer_inventory" },
  { href: "/products", label: "상품관리", permission: "manage_products" },
  { href: "/locations", label: "로케이션", permission: "manage_locations" },
  { href: "/barcodes", label: "바코드", permission: "manage_barcodes" },
  { href: "/logs", label: "로그", permission: "view_logs" },
  { href: "/import", label: "데이터이전", permission: "import_data" },
  { href: "/users", label: "사용자", permission: "manage_users" },
];

function ShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, switchDemoUser } = useUser();
  const [users, setUsers] = useState<UserProfile[]>([]);

  useEffect(() => {
    if (!isDemoMode()) return;
    const loadUsers = () => void listUsers().then(setUsers);
    loadUsers();
    return subscribeToInventory(loadUsers);
  }, []);

  const visibleNav = useMemo(() => user ? nav.filter((item) => hasPermission(user.role, item.permission)) : [], [user]);

  return (
    <div className="app-layout">
      <header className="topbar">
        <div>
          <p className="eyebrow">SAN WMS · V3.5.5</p>
          <h1>재고관리</h1>
        </div>
        <div className="topbar-meta">
          <span className={`mode-badge ${isDemoMode() ? "demo" : "live"}`}>{isDemoMode() ? "DEMO" : "LIVE"}</span>
          {user ? <span className="user-chip">{user.displayName} · {roleLabels[user.role]}</span> : null}
          {isDemoMode() && user ? (
            <select className="user-switch" value={user.id} onChange={(event) => void switchDemoUser(event.target.value)} aria-label="데모 사용자 변경">
              {users.map((item) => <option key={item.id} value={item.id}>{item.displayName} ({roleLabels[item.role]})</option>)}
            </select>
          ) : null}
          {!isDemoMode() ? (
            <button className="button button-compact button-secondary" onClick={() => void getSupabaseClient()?.auth.signOut()}>로그아웃</button>
          ) : null}
        </div>
      </header>

      <nav className="main-nav" aria-label="주요 메뉴">
        {visibleNav.map((item) => (
          <Link key={item.href} href={item.href} className={pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href)) ? "active" : ""}>
            {item.label}
          </Link>
        ))}
      </nav>
      <main className="content">{children}</main>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return <AuthGate><ShellContent>{children}</ShellContent></AuthGate>;
}
