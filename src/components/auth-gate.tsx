"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient, isDemoMode } from "@/lib/supabase";
import { desktopActivityStorageKey } from "@/lib/session-guard-api";
import { UserProvider } from "@/components/user-provider";
import { IdentityConsentGate } from "@/components/identity-consent-gate";
import { DesktopSessionGuard } from "@/components/desktop-session-guard";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!isDemoMode());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordInputKey, setPasswordInputKey] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (isDemoMode()) return;
    const supabase = getSupabaseClient();
    if (!supabase) {
      setMessage("Supabase 환경변수가 없습니다.");
      setLoading(false);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) setPassword("");
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession) {
        setPassword("");
        setMessage("");
        setPasswordInputKey((value) => value + 1);
      }
      setSession(nextSession);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (isDemoMode()) return <UserProvider>{children}</UserProvider>;
  if (loading) return <div className="center-panel">로그인 상태 확인 중...</div>;

  if (!session) {
    return (
      <main className="login-page">
        <form
          className="login-card"
          onSubmit={async (event) => {
            event.preventDefault();
            setMessage("");
            const supabase = getSupabaseClient();
            if (!supabase) return;
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) {
              setMessage(error.message);
              return;
            }
            if (data.user) {
              setPassword("");
              localStorage.setItem(desktopActivityStorageKey(data.user.id), String(Date.now()));
            }
          }}
        >
          <Image className="login-brand-logo" src="/san-wms-logo-horizontal-dark.svg" alt="SAN WMS" width={284} height={64} priority />
          <h1>작업자 로그인</h1>
          <label>이메일<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>비밀번호<input key={passwordInputKey} type="password" autoComplete="off" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="button button-primary" type="submit">로그인</button>
          {message ? <p className="inline-error">{message}</p> : null}
        </form>
      </main>
    );
  }

  return (
    <IdentityConsentGate>
      <DesktopSessionGuard userId={session.user.id}>
        <UserProvider>{children}</UserProvider>
      </DesktopSessionGuard>
    </IdentityConsentGate>
  );
}
