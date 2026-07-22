"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient, isDemoMode } from "@/lib/supabase";
import { UserProvider } from "@/components/user-provider";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!isDemoMode());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
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
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) setMessage(error.message);
          }}
        >
          <p className="eyebrow">SAN WMS</p>
          <h1>작업자 로그인</h1>
          <label>이메일<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>비밀번호<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="button button-primary" type="submit">로그인</button>
          {message ? <p className="inline-error">{message}</p> : null}
        </form>
      </main>
    );
  }

  return <UserProvider>{children}</UserProvider>;
}
