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

const controlListeners = new Set<(state: ClientControlState) => void>();
let controlReady: Promise<RealtimeChannel> | null = null;

function parseControl(payload: unknown): ClientControlState | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  const action = String(value.action ?? "") as ClientControlAction;
  if (action !== "RELOAD" && action !== "SIGN_OUT") return null;
  return { id: String(value.id ?? ""), action, createdAt: String(value.createdAt ?? "") };
}

function ensureControlChannel(): Promise<RealtimeChannel> {
  if (controlReady) return controlReady;
  const supabase = client();
  const channel = supabase
    .channel("san-wms-client-control")
    .on("broadcast", { event: "control" }, ({ payload }) => {
      const state = parseControl(payload);
      if (state) for (const listener of controlListeners) listener(state);
    });
  controlReady = new Promise<RealtimeChannel>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      controlReady = null;
      void supabase.removeChannel(channel);
      reject(new Error("실시간 명령 채널 연결 시간이 초과되었습니다."));
    }, 10_000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        window.clearTimeout(timeout);
        resolve(channel);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        window.clearTimeout(timeout);
        controlReady = null;
        void supabase.removeChannel(channel);
        reject(new Error("실시간 명령 채널에 연결하지 못했습니다."));
      }
    });
  });
  return controlReady;
}

export async function adminIssueClientControl(action: ClientControlAction): Promise<ClientControlState> {
  if (isDemoMode()) return { id: "demo", action, createdAt: new Date().toISOString() };
  const channel = await ensureControlChannel();
  const { data, error } = await client().rpc("admin_issue_client_control", { p_action: action });
  if (error) throw new Error(error.message);
  const event = { id: String(data), action, createdAt: new Date().toISOString() };
  const result = await channel.send({ type: "broadcast", event: "control", payload: event });
  if (result !== "ok") throw new Error("실시간 명령을 전송하지 못했습니다.");
  return event;
}

export function subscribeToClientControl(onControl: (state: ClientControlState) => void): () => void {
  if (isDemoMode()) return () => undefined;
  controlListeners.add(onControl);
  void ensureControlChannel().catch(() => undefined);
  return () => { controlListeners.delete(onControl); };
}

export async function recordMySessionIp(): Promise<string> {
  if (isDemoMode()) return "";
  const { data, error } = await client().rpc("record_my_session_ip");
  if (error) throw new Error(error.message);
  return data == null ? "" : String(data);
}
