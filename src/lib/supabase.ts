import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

function getSupabaseConfig(): { url: string; anonKey: string } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ""
  ).trim();

  return { url, anonKey };
}

export function isDemoMode(): boolean {
  const explicitMode = (process.env.NEXT_PUBLIC_APP_MODE ?? "").trim().toLowerCase();
  if (explicitMode === "demo") return true;

  const { url, anonKey } = getSupabaseConfig();
  return !url || !anonKey;
}

export function getSupabaseClient(): SupabaseClient | null {
  if (isDemoMode()) return null;
  if (client !== undefined) return client;

  const { url, anonKey } = getSupabaseConfig();

  if (!url || !anonKey) {
    console.error("Supabase URL 또는 publishable/anon key가 설정되지 않았습니다.");
    client = null;
    return client;
  }

  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return client;
}
