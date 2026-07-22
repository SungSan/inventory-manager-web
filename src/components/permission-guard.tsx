"use client";

import { hasPermission, type Permission } from "@/lib/permissions";
import { useUser } from "@/components/user-provider";

export function PermissionGuard({
  permission,
  children,
  fallback,
}: {
  permission: Permission;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { user, loading } = useUser();
  if (loading) return <div className="center-panel">권한 확인 중...</div>;
  if (!user || !hasPermission(user.role, permission)) {
    return fallback ?? (
      <section className="panel">
        <h2>접근 권한이 없습니다.</h2>
        <p className="muted">현재 계정의 역할로는 이 기능을 사용할 수 없습니다.</p>
      </section>
    );
  }
  return children;
}
