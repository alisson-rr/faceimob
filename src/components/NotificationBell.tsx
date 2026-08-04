import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRecord,
} from "@/integrations/supabase/notifications";

const formatWhen = (v: string) => new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/**
 * Sino de notificações.
 *
 * O popup de lead novo (`NewLeadNotifier`) só existe enquanto a aba está aberta.
 * `notifications` é a parte que sobrevive: `notify_lead_assigned` já gravava lá
 * e nada lia, então o que acontecia com o corretor fora do sistema se perdia.
 */
export default function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      setItems(await listMyNotifications());
    } catch {
      // Sino é acessório: falhar aqui não pode quebrar o cabeçalho.
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `profile_id=eq.${user.id}` },
        () => void load(),
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user?.id, load]);

  const unread = items.filter((i) => !i.read_at).length;

  const openItem = async (item: NotificationRecord) => {
    if (!item.read_at) {
      await markNotificationRead(item.id).catch(() => {});
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read_at: new Date().toISOString() } : i)));
    }
    if (item.link) {
      setOpen(false);
      navigate(item.link);
    }
  };

  const readAll = async () => {
    if (!user?.id) return;
    await markAllNotificationsRead(user.id).catch(() => {});
    await load();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notificações (${unread} não lidas)` : "Notificações"}
        aria-expanded={open}
        className="relative p-1.5 rounded-md hover:bg-primary/10 transition-colors"
      >
        <Bell className="h-4 w-4 text-muted-foreground" />
        {unread > 0 && (
          <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[9px] tabular-nums">{unread}</Badge>
        )}
      </button>

      {open && (
        <>
          {/* Fecha ao clicar fora sem prender o foco num overlay opaco. */}
          <button
            type="button"
            aria-label="Fechar notificações"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-80 z-50 rounded-lg border border-border/60 bg-popover shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
              <span className="text-xs font-semibold">Notificações</span>
              {unread > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={readAll}>
                  Marcar todas como lidas
                </Button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {loading ? (
                <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Carregando...
                </div>
              ) : items.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground text-center">Nada por aqui.</p>
              ) : (
                items.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => openItem(i)}
                    className={`w-full text-left px-3 py-2 border-b border-border/20 hover:bg-primary/5 transition-colors ${
                      i.read_at ? "opacity-60" : ""
                    }`}
                  >
                    <p className="text-xs font-medium truncate">{i.title}</p>
                    {i.body && <p className="text-[10px] text-muted-foreground line-clamp-2">{i.body}</p>}
                    <p className="text-[10px] text-muted-foreground">{formatWhen(i.created_at)}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
