import { supabase } from "./client";

/**
 * Central de notificações.
 *
 * `notify_lead_assigned` já gravava aqui e nada lia: o único aviso existente era
 * o popup por realtime do `NewLeadNotifier`, que evapora se o corretor não
 * estiver com a tela aberta. Esta é a parte persistente — o que aconteceu
 * enquanto ele estava fora continua esperando no próximo login.
 */

export type NotificationRecord = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const COLUMNS = "id,kind,title,body,link,read_at,created_at";

/** A policy já restringe a `profile_id = auth.uid()`; não há filtro a passar. */
export async function listMyNotifications(limit = 30): Promise<NotificationRecord[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as NotificationRecord[];
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}

export async function markAllNotificationsRead(profileId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("profile_id", profileId)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}
