import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { HandMetal, MapPin, Target, TrendingUp, WifiOff } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { recorteDoRanking, useCurrentSeasonId, useSeasonRanking } from "@/hooks/useGameRanking";
// Caminho direto, e não o barril `@/components/dashboard`: o barril arrasta os
// componentes do Dashboard para a camada que monta em toda tela.
import { ALL_MONTHS, useVgvGoal } from "@/components/dashboard/data";
import { brl } from "@/lib/format";
import {
  countSalesSince,
  gameKeys,
  lastSaleAt,
  listRanking,
  type RankingRow,
} from "@/integrations/supabase/game";
import {
  CELEBRATION,
  detectRankUp,
  groupSaleEvents,
  joinNames,
  type SaleEvent,
} from "@/lib/engagement/celebrations";
import { playSound } from "@/lib/engagement/audio";
import { TRECHO_MS, tocarPremiacao } from "@/hooks/useSomDePremiacao";
import { buildScores } from "./ranking";
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
 * `goal` não vem do banco: sai da própria meta de VGV do mês, lida aqui mesmo
 * (ver "meta batida", abaixo).
 */

/** Janela de acúmulo das vendas do mesmo negócio antes de comemorar. */
const SALE_WINDOW_MS = 500;

/**
 * Janela de agrupamento do placar. O trigger grava uma linha de `game_events`
 * por corretor do rateio e por regra, e toda aba logada recebe todas: refazer o
 * ranking a cada linha repetia no servidor a mesma leitura cara N vezes por aba
 * (o cancelamento do TanStack Query só vale no cliente).
 */
const PLACAR_MS = 1500;

/**
 * Tempo do card de venda na tela: o trecho inteiro da música. Aviso permanente
 * não é aviso, é ruído — mas card mais curto que o trecho (eram 6 s contra 7 s)
 * fazia a venda seguinte entrar com a faixa ainda na trava de não empilhar, e
 * a segunda venda seguida ficava muda.
 */
const SALE_DISPLAY_MS = TRECHO_MS;

/** Marca, por pessoa, temporada e mês, de que a meta de VGV já foi comemorada. */
const MARCA_META = "faceimob-meta-batida";

function metaJaComemorada(chave: string): boolean {
  try {
    return localStorage.getItem(chave) !== null;
  } catch {
    return false;
  }
}

function marcarMetaComemorada(chave: string): void {
  try {
    localStorage.setItem(chave, "1");
  } catch {
    // Storage bloqueado: vale só a memória desta sessão (`metaAntes`).
  }
}

const TOAST_MS = 5000;

/**
 * Teto do conjunto de eventos já comemorados.
 *
 * A TV da loja fica dias com a mesma aba aberta; um `Set` que só cresce é
 * vazamento pequeno mas real. Os ids só servem para não comemorar duas vezes o
 * MESMO INSERT, então guardar os últimos mil basta — o Postgres não reenvia
 * eventos antigos depois de mil vendas.
 */
const SEEN_LIMIT = 1000;

/** Espera antes de tentar reassinar o canal que caiu. */
const RESUBSCRIBE_MS = 4000;

type PendingSale = SaleEvent & { seasonId: string };

type SaleCard = { id: string; names: string };

type GameEventRow = {
  id: string;
  profile_id: string;
  ref_id: string | null;
  season_id: string;
  event_code: string;
  /** Relógio do SERVIDOR. É o que move a régua da recuperação — ver `marcaDagua`. */
  occurred_at: string;
};

export function EngagementLayer({ children }: { children: ReactNode }) {
  const { user, roles, isAdmin } = useAuth();
  const profileId = user?.id ?? null;
  const queryClient = useQueryClient();

  const [saleQueue, setSaleQueue] = useState<SaleCard[]>([]);
  const sale = saleQueue[0] ?? null;

  /**
   * Canal de realtime fora do ar.
   *
   * O reassinar automático existia desde sempre e a TV da loja ficava muda no
   * intervalo sem NADA na tela dizendo isso — quem está na loja não tem como
   * distinguir "ninguém vendeu" de "parei de escutar". Enquanto isto for
   * `true`, venda fechada não vira som nem card.
   */
  const [semCanal, setSemCanal] = useState(false);

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

    // Marco (meta batida, subiu no ranking) toca a faixa que o cliente entregou;
    // o resto continua no catálogo sintetizado. O hook respeita o mesmo
    // interruptor de som e, com `prefers-reduced-motion` ou faixa recusada,
    // toca no lugar o som curto do próprio marco — o da tabela.
    if (kind === "goal" || kind === "rank_up") tocarPremiacao({ sintetizado: spec.sound });
    else playSound(spec.sound);
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
    // Venda é o marco que o cliente pediu com a faixa dele. O card dura o
    // trecho inteiro, então o card seguinte encontra a faixa livre: duas vendas
    // seguidas são duas comemorações, uma depois da outra, nunca sobrepostas.
    tocarPremiacao({ sintetizado: CELEBRATION.sale.sound });
    fireConfetti(CELEBRATION.sale.confetti);
    const timer = setTimeout(() => setSaleQueue((queue) => queue.slice(1)), SALE_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [saleId]);

  // ── venda: acumula os eventos do mesmo negócio antes de comemorar ─────────
  const pending = useRef<PendingSale[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout>>();
  const seen = useRef<Set<string>>(new Set());
  const placarTimer = useRef<ReturnType<typeof setTimeout>>();

  /**
   * Refaz o placar: o ranking (todos os recortes), a temporada e a lista de
   * temporadas — o primeiro evento de uma temporada recém-aberta é o que tira a
   * TV da loja do placar encerrado, e a TV escolhe a temporada exibida naquela
   * lista. Regras e resultados congelados não mudam com INSERT em `game_events`
   * e ficam fora.
   */
  const atualizarPlacar = useCallback(() => {
    clearTimeout(placarTimer.current);
    placarTimer.current = undefined;
    return queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === "game" && (queryKey[1] === "ranking" || queryKey[1] === "season" || queryKey[1] === "seasons"),
    });
  }, [queryClient]);

  const flushSales = useCallback(async () => {
    const events = pending.current;
    pending.current = [];
    if (!events.length) return;

    // O nome do card sai do ranking, e antes do agrupamento ele chegava aqui já
    // refeito. A invalidação pendente roda agora: o `fetchQuery` abaixo reusa a
    // leitura em voo em vez de devolver a foto de antes da venda.
    if (placarTimer.current) void atualizarPlacar();

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
  }, [atualizarPlacar, celebrate, queryClient]);

  // ── realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!profileId) return;

    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    /** `true` depois da primeira queda: a próxima conexão precisa recuperar. */
    let recovering = false;
    /**
     * Instante da última venda JÁ COMEMORADA, pelo relógio do SERVIDOR. É a
     * régua que permite dizer, na volta, quantas comemorações se perderam.
     *
     * Avança em dois pontos, e precisa dos dois: a leitura de `lastSaleAt()` a
     * cada conexão e cada venda que chega ao vivo. Só com a primeira, a régua
     * ficava parada no instante em que a TV conectou de manhã — as doze vendas
     * do expediente, todas com card e fanfarra, voltavam a ser contadas na
     * queda das 17h e o aviso afirmava que ninguém tinha comemorado nenhuma.
     */
    let marcaDagua: string | null = null;
    /**
     * A régua já foi estabelecida?
     *
     * `null` em `marcaDagua` tem dois significados opostos: "nunca houve venda"
     * — e aí "desde sempre" é o intervalo certo — e "ainda não consegui ler",
     * caminho em que `countSalesSince(null)` perde o filtro e conta a HISTÓRIA
     * INTEIRA (8 vendas no banco de homologação de hoje). Sem esta bandeira os
     * dois são o mesmo `null`, e a queda logo na PRIMEIRA assinatura — em que
     * `aoConectar` nunca rodou — fazia a TV anunciar o histórico como se tivesse
     * acabado de acontecer.
     */
    let temRegua = false;

    /**
     * O que acontece a cada conexão bem-sucedida.
     *
     * Na primeira, só marca a régua. Na volta de uma queda, conta as vendas que
     * fecharam no intervalo e diz quantas foram. A decisão de não comemorar o
     * passado continua (comemorar cinco vendas de uma vez seria ruído), mas
     * agora ela deixa rastro: antes a loja simplesmente não ficava sabendo.
     */
    const aoConectar = async (recuperando: boolean) => {
      if (recuperando) {
        // `null` aqui é "não deu para medir o intervalo": ou a régua nunca foi
        // estabelecida, ou a contagem falhou. Número inventado é pior que
        // número nenhum — mas calar seria a mesma falha silenciosa que este
        // bloco veio corrigir, então a volta avisa mesmo sem o número.
        let perdidas: number | null = null;
        if (temRegua) {
          try {
            perdidas = await countSalesSince(marcaDagua);
          } catch {
            perdidas = null;
          }
        }
        if (disposed) return;
        if (perdidas === null) {
          toast("Conexão ao vivo restabelecida", {
            icon: <WifiOff className="h-4 w-4 text-warning" />,
            description: "Não consegui conferir se alguma venda fechou durante a queda.",
            duration: TOAST_MS,
          });
        } else if (perdidas > 0) {
          toast("Conexão ao vivo restabelecida", {
            icon: <WifiOff className="h-4 w-4 text-warning" />,
            description: `${perdidas} venda(s) fecharam enquanto a conexão estava caída e não foram comemoradas. O placar já está atualizado.`,
            duration: TOAST_MS,
          });
        }
      }
      try {
        marcaDagua = await lastSaleAt();
        temRegua = true;
      } catch {
        // Régua anterior preservada: a leitura falhou, mas a que já existe — da
        // conexão passada ou da última venda comemorada — continua valendo.
      }
    };

    const assinar = () => {
      const ch = supabase.channel(`engagement-${profileId}`);
      channel = ch;

      ch.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "game_events" },
        (payload) => {
          const row = payload.new as GameEventRow;
          // Qualquer pontuação mexe no placar — o ranking deixa de ser a foto do
          // momento em que a tela abriu. Uma releitura por rajada (`PLACAR_MS`),
          // não uma por linha: a venda sozinha já grava várias.
          if (!placarTimer.current) placarTimer.current = setTimeout(() => void atualizarPlacar(), PLACAR_MS);
          if (row.event_code !== "venda") return;
          if (seen.current.has(row.id)) return;
          if (seen.current.size >= SEEN_LIMIT) seen.current.clear();
          seen.current.add(row.id);
          // A régua avança na venda que ESTÁ sendo comemorada: sem isto, a volta
          // de uma queda no fim do dia recontava o expediente inteiro.
          //
          // Última recebida vence, sem comparar com a régua atual: o realtime
          // entrega o timestamptz na grafia de texto do Postgres
          // ("2026-09-02 12:00:00.1+00") e o PostgREST em ISO
          // ("2026-09-02T12:00:00.1+00:00") — comparar as duas como STRING erra
          // (espaço < "T") e a régua deixaria de avançar justo no caso que este
          // trecho existe para cobrir. O valor volta cru para o `gt` do
          // Postgres, que entende as duas grafias.
          // ponytail: assume entrega em ordem de commit (é um stream só);
          // evoluir para comparar epoch se aparecer contagem errada com vendas
          // no mesmo segundo. Quem valida é a fronteira — sem `occurred_at` a
          // régua fica onde está, e não vira `null`.
          if (row.occurred_at) {
            marcaDagua = row.occurred_at;
            temRegua = true;
          }
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

      ch.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "checkins", filter: `profile_id=eq.${profileId}` },
        () => celebrate("checkin"),
      );

      ch.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "lead_events", filter: `actor_id=eq.${profileId}` },
        (payload) => {
          const row = payload.new as { kind: string };
          if (row.kind === "claimed") celebrate("lead_claimed");
        },
      );

      /**
       * `subscribe()` era chamado sem callback: uma queda do canal passava
       * despercebida e a TV da loja ficava muda para sempre.
       *
       * A queda é tratada em três partes, e até 06/09 só a primeira existia:
       *
       * 1. reassina em `RESUBSCRIBE_MS` e recupera o placar (`invalidateQueries`
       *    refaz o ranking a partir do banco);
       * 2. **avisa na tela enquanto está fora do ar** (`semCanal`) — sem isso,
       *    quem está na loja não distingue "ninguém vendeu" de "parei de
       *    escutar", que é o defeito que o item 1 dizia ter corrigido;
       * 3. **deixa rastro do que passou** (`aoConectar`): a venda fechada
       *    DURANTE a queda continua sem comemoração — comemorar o passado vira
       *    ruído —, mas a volta diz quantas foram.
       */
      ch.subscribe((status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          setSemCanal(false);
          const recuperando = recovering;
          if (recuperando) {
            recovering = false;
            void queryClient.invalidateQueries({ queryKey: gameKeys.all });
          }
          void aoConectar(recuperando);
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          recovering = true;
          setSemCanal(true);
          void supabase.removeChannel(ch);
          channel = null;
          clearTimeout(retry);
          retry = setTimeout(assinar, RESUBSCRIBE_MS);
        }
      });
    };

    assinar();

    return () => {
      disposed = true;
      clearTimeout(retry);
      clearTimeout(flushTimer.current);
      clearTimeout(placarTimer.current);
      placarTimer.current = undefined;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [profileId, celebrate, flushSales, queryClient, atualizarPlacar]);

  // ── subida no ranking: só o próprio usuário, só quando sobe ───────────────
  const { data: seasonId } = useCurrentSeasonId();
  const { data: ranking } = useSeasonRanking(seasonId);
  /**
   * A memória é POR TEMPORADA.
   *
   * Guardar só a ordem deixava a lista da temporada velha viva na troca: ao
   * fechar o jogo, `useSeasonRanking` muda de chave, `ranking` volta
   * `undefined`, `order` fica vazio e o efeito saía cedo sem limpar nada.
   * Quando a lista nova chegava — todo mundo em 0 ponto, ordenada por nome —
   * `detectRankUp` comparava temporadas diferentes e quem tem nome no começo do
   * alfabeto recebia "Você subiu para Nº 2", com som e confete, em todas as
   * abas abertas da loja, no instante em que o admin encerrou o jogo.
   */
  const previous = useRef<{ seasonId: string | null; order: string[] }>({ seasonId: null, order: [] });

  /**
   * A ordem tem que ser DETERMINÍSTICA, senão "Você subiu para Nº X" dispara
   * sem ninguém subir: `listRanking` ordena só por pontos no servidor e nove
   * corretores empatados em 0 voltavam em ordem qualquer a cada refetch.
   * `buildScores` é o mesmo desempate da tela e do congelamento (pontos, depois
   * nome), então duas leituras do mesmo placar dão a mesma lista.
   */
  const order = useMemo(() => buildScores(ranking ?? []).map((row) => row.brokerId), [ranking]);

  useEffect(() => {
    if (!order.length) return;
    const trocouTemporada = previous.current.seasonId !== (seasonId ?? null);
    const antes = trocouTemporada ? [] : previous.current.order;
    previous.current = { seasonId: seasonId ?? null, order };
    const jump = detectRankUp(antes, order, profileId);
    if (jump) celebrate("rank_up", jump);
  }, [order, seasonId, profileId, celebrate]);

  // ── meta batida: a própria meta de VGV do mês, uma vez por temporada ──────
  /**
   * `goal` só tem gatilho aqui. A meta é a MESMA da faixa do corretor no card
   * de game (`PipelineTopRanking`): `goals` com scope 'profile' e metric 'vgv',
   * gravada na ficha de /equipes; o realizado é o `vgv` do mesmo mês pela mesma
   * RPC do placar. As chaves de cache são as mesmas — com o Pipeline aberto,
   * nenhuma leitura a mais — e o intervalo precisa continuar igual ao
   * `intervaloDoMes` de lá (não é importado: o card importa este barril).
   *
   * Só no recorte individual (`soMinhaPosicao`): para gerente e diretor o
   * `useGoal` pode devolver a soma das equipes lideradas, e comparar isso com o
   * VGV só da pessoa daria "meta batida" falso. E o ranking do mês só é lido com
   * meta de perfil cadastrada: sem alvo não há o que cruzar, e a leitura custa
   * ~1 s por corretor na carga real.
   */
  const individual = recorteDoRanking(roles, isAdmin).soMinhaPosicao;
  const hoje = new Date();
  const mesDaMeta = format(hoje, "MM/yyyy");
  const { data: meta } = useVgvGoal(individual ? mesDaMeta : ALL_MONTHS);
  const alvo = meta?.scope === "profile" && meta.target && meta.target > 0 ? meta.target : null;
  const { data: placarDoMes } = useSeasonRanking(alvo ? seasonId : null, {
    from: format(startOfMonth(hoje), "yyyy-MM-dd"),
    to: format(endOfMonth(hoje), "yyyy-MM-dd"),
  });
  // Fora da lista é zero, como na faixa do card; lista ainda não lida é "não sei".
  const vgvDoMes = placarDoMes
    ? placarDoMes.find((linha) => linha.profile_id === profileId)?.vgv ?? 0
    : undefined;

  /**
   * Comemora a TRAVESSIA, não o estado: a primeira leitura — e cada mês,
   * temporada ou pessoa nova — é só a linha de base. Quem abre o app com a meta
   * já batida não ganha música no carregamento; quem cruza com a tela aberta (a
   * venda chega pelo realtime, que invalida o placar) ganha. A marca no
   * localStorage segura o "uma vez": distrato que derruba o VGV e venda que
   * cruza de novo não repetem a festa, nem depois de recarregar.
   *
   * ponytail: marca por navegador — com o CRM aberto no celular e no notebook
   * na hora da venda, comemora nos dois; evoluir para marca no banco quando meta
   * batida virar evento do servidor.
   */
  const metaAntes = useRef<{ chave: string; alvo: number; batida: boolean } | null>(null);
  useEffect(() => {
    // Sem leitura completa não há linha de base: meta apagada e recriada depois
    // que o VGV passou dela não pode parecer travessia.
    if (!profileId || !seasonId || !alvo || vgvDoMes === undefined) {
      metaAntes.current = null;
      return;
    }
    const chave = `${MARCA_META}:${profileId}:${seasonId}:${mesDaMeta}`;
    const batida = vgvDoMes >= alvo;
    const antes = metaAntes.current;
    metaAntes.current = { chave, alvo, batida };
    // Meta alterada em /equipes também é linha de base nova: quem cruza é o VGV,
    // não o número que o gerente baixou. O alvo fica fora da `chave` porque ela
    // é a marca do "uma vez por temporada" — subir a meta não reabre a festa.
    if (!batida || !antes || antes.chave !== chave || antes.alvo !== alvo || antes.batida) return;
    if (metaJaComemorada(chave)) return;
    marcarMetaComemorada(chave);
    celebrate("goal", {
      title: "Meta de VGV do mês batida!",
      detail: `${brl(vgvDoMes)} de ${brl(alvo)} neste mês.`,
    });
  }, [profileId, seasonId, alvo, vgvDoMes, mesDaMeta, celebrate]);

  return (
    <CelebrationContext.Provider value={celebrate}>
      {children}
      <SaleCelebration sale={sale} />
      {semCanal && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-4 z-[60] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning shadow-sm"
        >
          <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Sem conexão ao vivo — venda fechada agora não vai tocar. Reconectando…
        </div>
      )}
      <MotivationalPopup />
      <NewLeadNotifier />
    </CelebrationContext.Provider>
  );
}
