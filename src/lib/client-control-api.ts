import { getSupabaseClient, isDemoMode } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type ClientControlAction = "RELOAD" | "SIGN_OUT";

export interface ClientControlState {
  id: string;
  action: ClientControlAction;
  createdAt: string;
}

function client() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");
  return supabase;
}

export async function adminIssueClientControl(action: ClientControlAction): Promise<ClientControlState> {
  if (isDemoMode()) return { id: "demo", action, createdAt: new Date().toISOString() };
  const { data, error } = await client().rpc("admin_issue_client_control", { p_action: action });
  if (error) throw new Error(error.message);
  const event = { id: String(data), action, createdAt: new Date().toISOString() };
  const channel = client().channel("san-wms-client-control");
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("실시간 명령 채널 연결 시간이 초과되었습니다.")), 5_000);
    channel.subscribe(async (status) => {
      if (status !== "SUBSCRIBED") return;
      window.clearTimeout(timeout);
      const result = await channel.send({ type: "broadcast", event: "control", payload: event });
      if (result !== "ok") reject(new Error("실시간 명령을 전송하지 못했습니다."));
      else resolve();
    });
  }).finally(() => { void client().removeChannel(channel); });
  return event;
}

export function subscribeToClientControl(onControl: (state: ClientControlState) => void): () => void {
  if (isDemoMode()) return () => undefined;
  const channel: RealtimeChannel = client()
    .channel("san-wms-client-control")
    .on("broadcast", { event: "control" }, ({ payload }) => {
      if (!payload || typeof payload !== "object") return;
      const value = payload as Record<string, unknown>;
      const action = String(value.action ?? "") as ClientControlAction;
      if (action !== "RELOAD" && action !== "SIGN_OUT") return;
      onControl({ id: String(value.id ?? ""), action, createdAt: String(value.createdAt ?? "") });
    })
    .subscribe();
  return () => { void client().removeChannel(channel); };
}

export async function recordMySessionIp(): Promise<string> {
  if (isDemoMode()) return "";
  const { data, error } = await client().rpc("record_my_session_ip");
  if (error) throw new Error(error.message);
  return data == null ? "" : String(data);
}
