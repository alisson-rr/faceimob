import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HandMetal, MapPin, Target, TrendingUp } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentSeasonId, useSeasonRanking } from "@/hooks/useGameRanking";
import { gameKeys, listRanking, type RankingRow } from "@/integrations/supabase/game";
import {
  CELEBRATION,
  detectRankUp,
  groupSaleEvents,
  joinNames,
  type SaleEvent,
} from "@/lib/engagement/celebrations";
import { playSound } from "@/lib/engagement/audio";
import { fireConfetti } from "./Confetti";
import { CelebrationContext, type Celebrate, type CelebrationPayload } from "./context";
import SaleCelebration from "@/components/SaleCelebration";
import NewLeadNotifier from "@/components/NewLeadNotifier";
import { MotivationalPopup } from "@/components/MotivationalPopup";

/**
 * Camada de engajamento — o único lugar do app que toca som e solta confete.
 *
 * Concentra três coisas que estavam espalhadas: a API `celebrate()`, os canais
 * de realtime que disparam comemoração e a montagem dos avisos globais (card de
 * venda, popup motivacional, aviso de lead). O que cada comemoração faz sai da
 * tabela `CELEBRATION` — uma linha por tipo, em `lib/engagement/celebrations`.
 *
 * Só os eventos que o banco realmente emite estão ligados: venda (`game_events`),
 * check-in (`checkins`) e atendimento de lead (`lead_events` com `kind='claimed'`).
 * `goal` existe na API e ainda não tem gatilho — nada no banco publica meta.
 */

/** Janela de acúmulo das vendas do mesmo negócio antes de comemorar. */
const SALE_WINDOW_MS = 500;

/** Tempo do card de venda na tela. Aviso permanente não é aviso, é ruído. */
const SALE_DISPLAY_MS = 6000;

const TOAST_MS = 5000;

type PendingSale = SaleEvent & { seasonId: string };

type SaleCard = { id: string; names: string };

type GameEventRow = {
  id: string;
  profile_id: string;
  ref_id: string | null;
  season_id: string;
  event_code: string;
};

export function EngagementLayer({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const profileId = user?.id ?? null;
  const queryClient = useQueryClient();

  const [saleQueue, setSaleQueue] = useState<SaleCard[]>([]);
  const sale = saleQueue[0] ?? null;

  const celebrate = useCallback<Celebrate>((kind, payload?: CelebrationPayload) => {
    const spec = CELEBRATION[kind];
    if (!spec) return;

    if (spec.visual === "card") {
      // Som e confete da venda saem quando o card chega à frente da fila: duas
      // vendas seguidas viram duas comemorações, não duas fanfarras sobrepostas.
      const id = payload?.id ?? `sale-${Date.now()}`;
      setSaleQueue((queue) =>
        queue.some((item) => item.id === id)
          ? queue
          : [...queue, { id, names: payload?.title || "Equipe" }],
      );
      return;
    }

    playSound(spec.sound);
    fireConfetti(spec.confetti, payload?.origin);

    if (spec.visual !== "toast") return;

    if (kind === "lead_claimed") {
      toast("Lead em atendimento", {
        icon: <HandMetal className="h-4 w-4 text-success" />,
        description: payload?.title
          ? `${payload.title} está travado com você.`
          : payload?.detail ?? "O lead está travado com você — o cronômetro parou.",
        duration: TOAST_MS,
      });
    } else if (kind === "checkin") {
      toast("Check-in confirmado", {
        icon: <MapPin className="h-4 w-4 text-success" />,
        description: payload?.detail ?? "Você entrou na roleta de leads.",
        duration: TOAST_MS,
      });
    } else if (kind === "rank_up") {
      toast(`Você subiu para Nº ${payload?.to ?? "?"}`, {
        icon: <TrendingUp className="h-4 w-4 text-success" />,
        description: payload?.from ? `Estava em ${payload.from}º no ranking.` : undefined,
        duration: TOAST_MS,
      });
    } else if (kind === "goal") {
      toast(payload?.title ?? "Meta batida!", {
        icon: <Target className="h-4 w-4 text-warning" />,
        description: payload?.detail,
        duration: TOAST_MS,
      });
    }
  }, []);

  // ── card de venda: um por vez, som e confete ao entrar em cena ─────────────
  const saleId = sale?.id ?? null;
  useEffect(() => {
    if (!saleId) return;
    playSound(CELEBRATION.sale.sound);
    fireConfetti(CELEBRATION.sale.confetti);
    const timer = setTimeout(() => setSaleQueue((queue) => queue.slice(1)), SALE_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [saleId]);

  // ── venda: acumula os eventos do mesmo negócio antes de comemorar ─────────
  const pending = useRef<PendingSale[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout>>();
  const seen = useRef<Set<string>>(new Set());

  const flushSales = useCallback(async () => {
    const events = pending.current;
    pending.current = [];
    if (!events.length) return;

    for (const batch of groupSaleEvents(events)) {
      const seasonId = events.find((event) => batch.eventIds.includes(event.id))?.seasonId;
      let names: string[] = [];
      if (seasonId) {
        try {
          // Nome pelo ranking, não por `profiles`: o RLS de profiles esconde
          // quem está fora do escopo e todo corretor via "Equipe". Quem seguir
          // fora do escopo continua anônimo, de propósito.
          const rows = await queryClient.fetchQuery<RankingRow[]>({
            queryKey: gameKeys.ranking(seasonId),
            queryFn: () => listRanking(seasonId),
            staleTime: 30_000,
          });
          const byId = new Map(rows.map((row) => [row.profile_id, row.full_name]));
          names = batch.profileIds.map((id) => byId.get(id) ?? "").filter(Boolean);
        } catch {
          // Sem nome resolvido a comemoração continua: vira "Equipe".
        }
      }
      celebrate("sale", { id: batch.key, title: joinNames(names) });
    }
  }, [celebrate, queryClient]);

  // ── realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!profileId) return;

    const channel = supabase.channel(`engagement-${profileId}`);

    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "game_events" },
      (payload) => {
        const row = payload.new as GameEventRow;
        // Qualquer pontuação mexe no placar — o ranking deixa de ser a foto do
        // momento em que a tela abriu.
        void queryClient.invalidateQueries({ queryKey: gameKeys.all });
        if (row.event_code !== "venda") return;
        if (seen.current.has(row.id)) return;
        seen.current.add(row.id);
        pending.current.push({
          id: row.id,
          profileId: row.profile_id,
          refId: row.ref_id ?? null,
          seasonId: row.season_id,
        });
        clearTimeout(flushTimer.current);
        flushTimer.current = setTimeout(() => void flushSales(), SALE_WINDOW_MS);
      },
    );

    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "checkins", filter: `profile_id=eq.${profileId}` },
      () => celebrate("checkin"),
    );

    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "lead_events", filter: `actor_id=eq.${profileId}` },
      (payload) => {
        const row = payload.new as { kind: string };
        if (row.kind === "claimed") celebrate("lead_claimed");
      },
    );

    channel.subscribe();
    return () => {
      clearTimeout(flushTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [profileId, celebrate, flushSales, queryClient]);

  // ── subida no ranking: só o próprio usuário, só quando sobe ───────────────
  const { data: seasonId } = useCurrentSeasonId();
  const { data: ranking } = useSeasonRanking(seasonId);
  const previousOrder = useRef<string[]>([]);

  const order = useMemo(() => (ranking ?? []).map((row) => row.profile_id), [ranking]);

  useEffect(() => {
    if (!order.length) return;
    const jump = detectRankUp(previousOrder.current, order, profileId);
    previousOrder.current = order;
    if (jump) celebrate("rank_up", jump);
  }, [order, profileId, celebrate]);

  return (
    <CelebrationContext.Provider value={celebrate}>
      {children}
      <SaleCelebration sale={sale} />
      <MotivationalPopup />
      <NewLeadNotifier />
    </CelebrationContext.Provider>
  );
}
