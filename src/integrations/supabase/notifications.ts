import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

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
export async function listMyNotifications(limit = 30, onlyUnread = false): Promise<NotificationRecord[]> {
  let query = supabase
    .from("notifications")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (onlyUnread) query = query.is("read_at", null);
  const { data, error } = await query;
  if (error) throw dbError("listar notificações", error);
  return (data ?? []) as NotificationRecord[];
}

/**
 * Quantas não lidas existem DE VERDADE.
 *
 * O contador do sino saía de `items.filter(...)` sobre a página baixada, que
 * tem no máximo `limit` linhas: medido no banco de homologação, um corretor com
 * 106 avisos não lidos via "30" — o número que ele mais olha estava errado, e
 * errado sempre para menos. `head: true` traz só a contagem, sem as linhas.
 *
 * A contagem passa pela MESMA policy da lista (`profile_id = auth.uid()` e
 * `channel = 'in_app'`), então o número e a lista não podem divergir de dono.
 */
export async function countMyUnreadNotifications(): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) throw dbError("contar notificações não lidas", error);
  return count ?? 0;
}

/**
 * Apaga um aviso. A policy `notifications_delete` só alcança as linhas do
 * próprio perfil; `select('id')` é o que separa "apagou" de "a RLS recusou e o
 * PostgREST respondeu 204".
 */
export async function deleteNotification(id: string): Promise<void> {
  const { data, error } = await supabase.from("notifications").delete().eq("id", id).select("id");
  if (error) throw dbError("apagar notificação", error);
  if (!data?.length) {
    throw dbError("apagar notificação", {
      code: "42501",
      message: "nenhuma linha apagada (RLS ou notificação já removida)",
    });
  }
}

/**
 * `select("id")` não é enfeite: sem ele o PostgREST responde 204 mesmo quando a
 * RLS não deixou NENHUMA linha ser tocada. A tela pintava o item como lido e o
 * banco continuava com `read_at` nulo — o aviso voltava no próximo carregamento
 * sem que ninguém entendesse por quê.
 *
 * Zero linha aqui é sempre problema: quem chama já sabe que a notificação
 * existe e está não lida (veio da própria lista).
 */
export async function markNotificationRead(id: string): Promise<void> {
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) throw dbError("marcar notificação como lida", error);
  if (!data?.length) {
    throw dbError("marcar notificação como lida", {
      code: "42501",
      message: "nenhuma linha atualizada (RLS ou notificação removida)",
    });
  }
}

/** Devolve quantas linhas foram realmente marcadas — 0 com não lidas na tela é falha. */
export async function markAllNotificationsRead(profileId: string): Promise<number> {
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("profile_id", profileId)
    .is("read_at", null)
    .select("id");
  if (error) throw dbError("marcar notificações como lidas", error);
  return data?.length ?? 0;
}
