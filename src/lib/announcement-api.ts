import { getSupabaseClient, isDemoMode } from "@/lib/supabase";

export interface LoginAnnouncement {
  id: string;
  title: string;
  content: string;
  allowNeverShow: boolean;
  createdAt: string;
}
export interface AdminAnnouncement extends LoginAnnouncement {
  isActive: boolean;
  updatedAt: string;
  createdByLabel: string;
}

function client() {
  const value = getSupabaseClient();
  if (!value) throw new Error("Supabase 연결 설정을 확인하세요.");
  return value;
}
function row(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
function mapAnnouncement(value: unknown): LoginAnnouncement {
  const item = row(value);
  return {
    id: String(item.id ?? ""), title: String(item.title ?? ""), content: String(item.content ?? ""),
    allowNeverShow: Boolean(item.allow_never_show), createdAt: String(item.created_at ?? ""),
  };
}

export async function getLoginAnnouncement(): Promise<LoginAnnouncement | null> {
  if (isDemoMode()) return null;
  const { data, error } = await client().rpc("get_login_announcement");
  if (error) throw new Error(error.message);
  return data ? mapAnnouncement(data) : null;
}
export async function dismissLoginAnnouncement(id: string): Promise<void> {
  const { error } = await client().rpc("dismiss_login_announcement", { p_announcement_id: id });
  if (error) throw new Error(error.message);
}
export async function adminListAnnouncements(): Promise<AdminAnnouncement[]> {
  const { data, error } = await client().rpc("admin_list_announcements");
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []).map((value) => {
    const item = row(value);
    return {
      ...mapAnnouncement(item), isActive: Boolean(item.is_active),
      updatedAt: String(item.updated_at ?? ""), createdByLabel: String(item.created_by_label ?? ""),
    };
  });
}
export async function adminSaveAnnouncement(input: {
  id?: string; title: string; content: string; isActive: boolean; allowNeverShow: boolean;
}): Promise<string> {
  const { data, error } = await client().rpc("admin_save_announcement", {
    p_id: input.id ?? null, p_title: input.title, p_content: input.content,
    p_is_active: input.isActive, p_allow_never_show: input.allowNeverShow,
  });
  if (error) throw new Error(error.message);
  return String(data);
}
