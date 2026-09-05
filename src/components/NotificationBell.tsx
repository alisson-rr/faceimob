import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { dateTime, num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { resolveLink } from "@/lib/notificationLink";
import {
  countMyUnreadNotifications,
  deleteNotification,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRecord,
} from "@/integrations/supabase/notifications";

/** Tamanho da página do sino. "Carregar mais" soma outra. */
const PAGE = 30;

/**
 * Janela de coalescência do realtime.
 *
 * Cada evento recarregava a lista inteira. Com 159 avisos represados e o cron
 * de despacho pausado, despausar sem limpar a fila disparava uma recarga por
 * INSERT — o cabeçalho ficava em "Carregando..." até a fila acabar. Aqui a
 * primeira mudança agenda UMA recarga e as que chegarem dentro da janela
 * entram de carona.
 */
const RECARGA_MS = 600;

/**
 * Sino de notificações.
 *
 * O popup de lead novo (`NewLeadNotifier`) só existe enquanto a aba está aberta.
 * `notifications` é a parte que sobrevive: `notify_lead_assigned` já gravava lá
 * e nada lia, então o que acontecia com o corretor fora do sistema se perdia.
 *
 * "Nada por aqui" é afirmação, não desculpa: enquanto o `catch` era vazio,
 * falha de rede e recusa de RLS viravam caixa de entrada limpa — a tela dizia
 * ao corretor que não havia aviso nenhum justamente quando não conseguia saber.
 * Por isso o erro tem estado próprio, mensagem de `describeError` e um botão de
 * tentar de novo.
 *
 * O contador do badge NÃO sai da lista carregada: ele é uma consulta de
 * contagem própria. A lista tem teto (`limit`), a caixa de entrada não —
 * contar sobre a página fazia 106 não lidas aparecerem como "30".
 */
export default function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      // A contagem vem junto da lista de propósito: se as duas chamadas
      // ficassem em momentos diferentes, o badge e o painel discordariam.
      const [lista, naoLidas] = await Promise.all([
        listMyNotifications(limit, onlyUnread),
        countMyUnreadNotifications(),
      ]);
      setItems(lista);
      setUnread(naoLidas);
      setError(null);
    } catch (err) {
      // Sino é acessório: não pode quebrar o cabeçalho — mas também não pode
      // mentir que a caixa está vazia.
      setError(describeError(err, "Não foi possível carregar seus avisos."));
    } finally {
      setLoading(false);
    }
  }, [user?.id, limit, onlyUnread]);

  useEffect(() => { void load(); }, [load]);

  // O realtime lê a versão mais recente de `load` por referência: sem isto o
  // canal era derrubado e reassinado a cada "Carregar mais" e a cada troca de
  // filtro, e um INSERT no meio da troca se perdia.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => {
    if (!user?.id) return;
    let recarga: ReturnType<typeof setTimeout> | null = null;
    const agendar = () => {
      if (recarga) return;
      recarga = setTimeout(() => {
        recarga = null;
        void loadRef.current();
      }, RECARGA_MS);
    };
    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        "postgres_changes",
        // `*` e não `INSERT`: marcar lida em outro aparelho é um UPDATE, e
        // apagar é um DELETE. Só com INSERT, esta aba continuava mostrando o
        // badge de um aviso que já tinha sido lido em outro lugar.
        { event: "*", schema: "public", table: "notifications", filter: `profile_id=eq.${user.id}` },
        agendar,
      )
      .subscribe();
    return () => {
      if (recarga) clearTimeout(recarga);
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // Esc fecha e devolve o foco ao sino — o painel é sobreposto e sem isso quem
  // navega por teclado fica preso atrás dele.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const openItem = async (item: NotificationRecord) => {
    if (!item.read_at) {
      try {
        await markNotificationRead(item.id);
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read_at: new Date().toISOString() } : i)));
        setUnread((n) => Math.max(0, n - 1));
      } catch (err) {
        // Continua navegando: o destino é o que a pessoa pediu. O que não pode
        // é pintar como lido o que o banco recusou.
        toast({
          variant: "destructive",
          title: "Não foi possível marcar como lida",
          description: describeError(err, "O aviso continua não lido. Tente de novo."),
        });
      }
    }
    if (item.link) {
      setOpen(false);
      navigate(resolveLink(item.link));
    }
  };

  const removeItem = async (item: NotificationRecord) => {
    try {
      await deleteNotification(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      if (!item.read_at) setUnread((n) => Math.max(0, n - 1));
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível apagar o aviso",
        description: describeError(err, "O aviso continua na lista. Tente de novo."),
      });
    }
  };

  const readAll = async () => {
    if (!user?.id) return;
    setBusy(true);
    try {
      const atualizadas = await markAllNotificationsRead(user.id);
      if (atualizadas === 0 && unread > 0) {
        throw new Error("nenhuma notificação foi marcada");
      }
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível marcar todas como lidas",
        description: describeError(err, "Os avisos continuam não lidos. Tente de novo."),
      });
    } finally {
      setBusy(false);
    }
  };

  const trocarFiltro = () => {
    setOnlyUnread((v) => !v);
    setLimit(PAGE);
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notificações (${num(unread)} não lidas)` : "Notificações"}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative p-1.5 rounded-md hover:bg-primary/10 transition-colors"
      >
        <Bell className="h-4 w-4 text-muted-foreground" />
        {unread > 0 && (
          // O número real fica no `aria-label`; no desenho, três dígitos
          // empurrariam o avatar para fora a 375 px.
          <Badge size="sm" className="absolute -top-1 -right-1 h-4 min-w-4 px-1 tabular-nums" aria-hidden>
            {unread > 99 ? "99+" : unread}
          </Badge>
        )}
      </button>

      {open && (
        <>
          {/* Fecha ao clicar fora. Era um <button> de tela inteira e entrava na
              ordem de tabulação: um Tab a partir do sino caía num controle
              invisível chamado "Fechar notificações". Para teclado o caminho é
              Esc, tratado acima. */}
          <div
            aria-hidden
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          {/* `max-w`: o painel e ancorado em `right-0` num container cuja borda
              direita fica a 318 px numa tela de 375 — as 320 px do `w-80` saiam
              2 px pela esquerda. `100vw-4rem` da 311 px e cabe; a 1280 px o
              limite e 1216 e nao tem efeito nenhum. */}
          <div
            role="dialog"
            aria-label="Notificações"
            className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-4rem)] z-50 rounded-lg border border-border/60 bg-popover shadow-lg overflow-hidden"
          >
            <div className="flex items-center justify-between gap-1 px-3 py-2 border-b border-border/40">
              {/* `truncate`: a 375 px o painel tem 311 px e o título divide a
                  linha com dois botões — sem isto o "Marcar todas" saía pela
                  direita. */}
              <span className="min-w-0 truncate text-xs font-semibold">
                Notificações{unread > 0 ? ` · ${num(unread)} não lidas` : ""}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  aria-pressed={onlyUnread}
                  onClick={trocarFiltro}
                >
                  {onlyUnread ? "Ver todas" : "Só não lidas"}
                </Button>
                {unread > 0 && (
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={readAll} disabled={busy}>
                    {busy ? "Marcando..." : "Marcar todas"}
                  </Button>
                )}
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {loading ? (
                <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Carregando...
                </div>
              ) : error ? (
                <div className="space-y-2 p-4 text-center">
                  <p className="text-xs text-destructive">{error}</p>
                  <p className="text-xs text-muted-foreground">
                    Não dá para saber se há avisos novos enquanto isto não carregar.
                  </p>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void load()}>
                    <RotateCcw className="h-3 w-3" aria-hidden /> Tentar de novo
                  </Button>
                </div>
              ) : items.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground text-center">
                  {onlyUnread ? "Nenhum aviso não lido." : "Nada por aqui."}
                </p>
              ) : (
                <>
                  {items.map((i) => (
                    // Container, e não um <button> só: o botão de apagar não
                    // pode ficar DENTRO do botão que abre o aviso.
                    <div
                      key={i.id}
                      className={`flex items-start gap-1 border-b border-border/20 hover:bg-primary/5 transition-colors ${
                        i.read_at ? "opacity-60" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => openItem(i)}
                        className="min-w-0 flex-1 px-3 py-2 text-left"
                      >
                        <p className="text-xs font-medium truncate">{i.title}</p>
                        {i.body && <p className="text-xs text-muted-foreground line-clamp-2">{i.body}</p>}
                        <p className="text-xs text-muted-foreground">{dateTime(i.created_at)}</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeItem(i)}
                        aria-label={`Apagar aviso: ${i.title}`}
                        className="mr-1 mt-2 shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  ))}
                  {/* Com 159 avisos não lidos no banco, o limite fixo escondia
                      tudo o que ficou para trás sem dizer que havia mais. */}
                  {items.length >= limit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-full rounded-none text-xs"
                      onClick={() => setLimit((v) => v + PAGE)}
                    >
                      Carregar mais
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
