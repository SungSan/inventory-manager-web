import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function isDemoMode(): boolean {
  return (process.env.NEXT_PUBLIC_APP_MODE ?? "demo") !== "supabase";
}

export function getSupabaseClient(): SupabaseClient | null {
  if (isDemoMode()) return null;
  if (client !== undefined) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
