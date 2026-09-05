import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  DollarSign,
  FileText,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, KpiCard, LoadingState, SectionCard } from "@/components/shared";
import ComparativeFunnel from "@/components/ComparativeFunnel";
import { num } from "@/lib/format";
import { DAILY_METRICS, type DailyMetricKey } from "@/lib/metrics";
import { describeError } from "@/lib/supabaseError";
import type { Lead } from "@/types/crm";
import { ALL_MONTHS, useFunnelStages, type DealRow } from "./data";
import {
  ALL_TEAMS,
  EMPTY_DAILY,
  EMPTY_FUNNEL,
  RULER_LABEL,
  directorPipeline,
  pickFunnelRuler,
  useDirectorDaily,
  useLedTeamsScope,
  useFunnelTargets,
  type DirectorDaily,
} from "./directorData";

/**
 * Os cinco indicadores do diario que o diretor acompanha, na ordem do catalogo.
 *
 * "Coleta Docs" e o unico SEM par medido: o comparativo compara
 * leads/analises/aprovacoes/vendas, e `pipeline_stages` nao tem etapa de coleta
 * documental (o catalogo vai de "Visita Agendada" direto para "Em Análise") —
 * entao nao ha o que medir contra o declarado. Dizer isso no cartao vale mais
 * do que deixar quem le procurar o par que nao existe.
 */
const KPIS: { key: keyof DirectorDaily & DailyMetricKey; icon: LucideIcon; hint?: string }[] = [
  { key: "leads", icon: Users },
  { key: "coleta_docs", icon: FileText, hint: "declarado no diário · sem etapa equivalente no CRM" },
  { key: "analises", icon: ClipboardCheck },
  { key: "aprovados", icon: CheckCircle2 },
  { key: "vendas", icon: DollarSign },
];

const metricLabel = (key: DailyMetricKey) =>
  DAILY_METRICS.find((metric) => metric.key === key)?.label ?? key;

export interface DirectorPanelProps {
  /** O mesmo período do filtro do topo. "Todos os meses" não serve aqui. */
  month: string;
  /** Negócios e leads que o Dashboard já carregou — o "medido" sai deles. */
  deals: DealRow[];
  /**
   * A CONSULTA de leads, não só a lista.
   *
   * `leads` sozinho chegava `undefined` quando a consulta falhava, e
   * `directorPipeline(deals, leads ?? [], …)` transformava a ausência em ZERO
   * MEDIDO: o comparativo pintava "10 vs 0 · 0% de aderência" em vermelho, ou
   * disparava "Nenhum lançamento em MM/AAAA", e o erro só aparecia para quem
   * abrisse a aba Leads. É o mesmo defeito que `aderencia()` já corrige do outro
   * lado — 0 vs 0 não é 100%, é ausência de dado.
   */
  leads: {
    data: Lead[] | undefined;
    isPending: boolean;
    error: Error | null;
    /** Sem isto o "Tentar de novo" era botão morto quando quem falhou foi leads. */
    refetch: () => void;
  };
  /**
   * Quem está olhando: o diretor (equipes onde ele é `teams.director_id`) ou o
   * gerente (onde ele é `teams.manager_id`). O escopo é o MESMO consulta —
   * `auth_led_team_ids()` —, só o texto muda.
   */
  escopo?: "diretoria" | "equipe";
}

/**
 * Diario declarado × pipeline medido, nas equipes que a pessoa lidera.
 *
 * Vive como ABA do Dashboard, nao como painel separado: enquanto o diretor era
 * desviado para uma tela so com este comparativo, quem manda na operacao via
 * MENOS numero que o corretor que ele dirige — sem meta, sem VGV, sem ranking,
 * sem funil por etapa — e nao tinha como voltar ao painel completo.
 *
 * O GERENTE ve a mesma aba com a propria equipe: a RLS de `daily_reports` e
 * `daily_entries` ja liberava a leitura para ele (`auth_led_team_ids()` casa
 * `manager_id`), e ele nao tinha tela nenhuma que puxasse o declarado ao lado do
 * medido — so o /checkpoint, que ate agora cobrava por outra regua.
 */
export function DirectorPanel({ month, deals, leads, escopo = "diretoria" }: DirectorPanelProps) {
  const { user, previewRole } = useAuth();
  const daDiretoria = escopo === "diretoria";
  const deQuem = daDiretoria ? "da diretoria" : "da sua equipe";
  const [teamFilter, setTeamFilter] = useState<string>(ALL_TEAMS);

  const scopeQuery = useLedTeamsScope(user?.id ?? null);
  const scope = scopeQuery.data;

  const teamIds = useMemo(() => {
    if (!scope) return [];
    return teamFilter === ALL_TEAMS ? scope.teams.map((team) => team.id) : [teamFilter];
  }, [scope, teamFilter]);

  const brokerIds = useMemo(() => {
    if (!scope) return [];
    const wanted = new Set(teamIds);
    return scope.brokers
      .filter((broker) => broker.team_id && wanted.has(broker.team_id))
      .map((broker) => broker.id);
  }, [scope, teamIds]);

  const mesValido = month !== ALL_MONTHS;
  const dailyQuery = useDirectorDaily(mesValido ? teamIds : [], month);
  const daily = dailyQuery.data ?? EMPTY_DAILY;
  // O catalogo de etapas diz o que e "alcancou a analise" — a ordem e do banco.
  // Mesma consulta do funil por etapa (chave `["dashboard","stages"]`), entao
  // abrir esta aba nao gera requisicao nova.
  const stagesQuery = useFunnelStages();
  // A regua vem do banco (`funnel_targets`), como no /checkpoint: o mesmo
  // diretor era cobrado por 53% la e por 50% aqui, e o selo divergia.
  const targetsQuery = useFunnelTargets();
  const ruler = useMemo(
    () => pickFunnelRuler(targetsQuery.data ?? {}, { directorId: user?.id ?? null, teamIds }),
    [targetsQuery.data, user?.id, teamIds],
  );
  const pipeline = useMemo(
    () =>
      mesValido
        ? directorPipeline(deals, leads.data ?? [], brokerIds, month, stagesQuery.data ?? [])
        : { ...EMPTY_FUNNEL },
    [mesValido, deals, leads.data, brokerIds, month, stagesQuery.data],
  );

  const failed =
    scopeQuery.error ?? dailyQuery.error ?? leads.error ?? stagesQuery.error ?? targetsQuery.error;
  const equipeAtual = scope?.teams.find((team) => team.id === teamFilter)?.name;

  const filtroDeEquipe = (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={teamFilter} onValueChange={setTeamFilter}>
        <SelectTrigger className="w-[220px]" aria-label="Filtrar por equipe">
          <SelectValue placeholder="Equipe" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_TEAMS}>Todas as equipes</SelectItem>
          {(scope?.teams ?? []).map((team) => (
            <SelectItem key={team.id} value={team.id}>
              {team.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const card = (children: ReactNode) => (
    <SectionCard
      title="Diário × pipeline"
      description={
        mesValido
          ? `Declarado pelas equipes e medido no CRM em ${month}`
          : "Declarado pelas equipes e medido no CRM"
      }
      icon={UsersRound}
      actions={scope && scope.teams.length > 0 ? filtroDeEquipe : undefined}
    >
      {children}
    </SectionCard>
  );

  if (!mesValido) {
    return card(
      <EmptyState
        icon={CalendarRange}
        title="O comparativo é mensal"
        description="Escolha um mês no filtro do topo para comparar o diário declarado pelas equipes com o que o pipeline registrou."
      />,
    );
  }

  if (failed) {
    const retry = () => {
      if (scopeQuery.error) void scopeQuery.refetch();
      if (dailyQuery.error) void dailyQuery.refetch();
      if (leads.error) leads.refetch();
      if (stagesQuery.error) void stagesQuery.refetch();
      if (targetsQuery.error) void targetsQuery.refetch();
    };
    return card(
      <EmptyState
        icon={AlertTriangle}
        tone="danger"
        title={`Não consegui carregar o comparativo ${deQuem}`}
        description={describeError(failed, "A consulta falhou. Verifique a conexão e tente de novo.")}
        action={
          <Button variant="outline" onClick={retry}>
            Tentar de novo
          </Button>
        }
      />,
    );
  }

  // Sem o catalogo o lado medido leria zero em analise e aprovado — divergencia
  // inventada. Espera-se por ele como se espera pelo diario.
  // A regua entra na espera pelo mesmo motivo do catalogo: sem ela o painel
  // pintaria o selo contra 10/40/50 e trocaria de cor um instante depois.
  if (
    scopeQuery.isPending ||
    dailyQuery.isLoading ||
    leads.isPending ||
    stagesQuery.isPending ||
    targetsQuery.isPending
  ) {
    return card(<LoadingState variant="block" label={`Carregando o diário ${deQuem}…`} />);
  }

  if (scope && scope.teams.length === 0) {
    return card(
      <EmptyState
        icon={UsersRound}
        title={daDiretoria ? "Nenhuma equipe sob esta diretoria" : "Nenhuma equipe sob a sua gerência"}
        description={
          // O escopo sai de `teams.director_id`/`teams.manager_id` = <seu id>,
          // nao do papel: quem previsualiza cai sempre aqui, e sem esta frase
          // parece defeito da tela.
          previewRole === "director" || previewRole === "manager"
            ? "O escopo desta aba vem das equipes em que VOCÊ é o diretor ou o gerente cadastrado, não do papel pré-visualizado — por isso a pré-visualização não serve para auditar este comparativo. Vincule a liderança às equipes em Equipes."
            : `Este comparativo soma o diário das equipes que você lidera, e nenhuma equipe aponta para você como ${daDiretoria ? "diretor" : "gerente"}. Peça a um administrador para vincular as equipes em Equipes.`
        }
      />,
    );
  }

  // Equipe sem corretor MEMBRO: o "medido" sai de `team_members`, entao ele vem
  // zero e o funil pintaria divergencia total — que aqui e falta de vinculo, nao
  // falta de venda. Dizer isso vale mais do que a barra vermelha.
  const semCorretor = brokerIds.length === 0;

  const semDado =
    Object.values(daily).every((valor) => valor === 0) &&
    Object.values(pipeline).every((valor) => valor === 0);

  if (semDado && !semCorretor) {
    const porEquipe = teamFilter !== ALL_TEAMS;
    return card(
      <EmptyState
        icon={ClipboardCheck}
        title={`Nenhum lançamento em ${month}`}
        description={
          porEquipe
            ? `Nem o diário nem o pipeline de ${equipeAtual || "desta equipe"} registraram movimento neste período. Veja todas as equipes ou escolha outro mês no filtro do topo.`
            : "Nem o diário das equipes nem o pipeline registraram movimento neste período. Os indicadores e o funil voltam assim que houver lançamento; escolha outro mês no filtro do topo."
        }
        action={
          porEquipe ? (
            <Button variant="outline" onClick={() => setTeamFilter(ALL_TEAMS)}>
              Ver todas as equipes
            </Button>
          ) : undefined
        }
      />,
    );
  }

  return card(
    <div className="flex flex-col gap-5">
      {semCorretor && (
        <p
          role="status"
          className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-foreground"
        >
          {teamFilter === ALL_TEAMS
            ? `Nenhuma equipe ${daDiretoria ? "desta diretoria" : "sob a sua gerência"} tem corretor vinculado como membro.`
            : `${equipeAtual || "Esta equipe"} não tem corretor vinculado como membro.`}{" "}
          O lado <strong>medido</strong> do funil fica zerado por falta de vínculo em Equipes — não por
          falta de venda. O <strong>declarado</strong> continua valendo.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {KPIS.map(({ key, icon, hint }) => (
          <KpiCard
            key={key}
            label={metricLabel(key)}
            value={num(daily[key])}
            icon={icon}
            hint={hint ?? "declarado no diário"}
          />
        ))}
      </div>

      <ComparativeFunnel
        daily={{
          leads: daily.leads,
          analises: daily.analises,
          aprovados: daily.aprovados,
          vendas: daily.vendas,
        }}
        pipeline={pipeline}
        targets={ruler}
        targetsLabel={RULER_LABEL[ruler.scope]}
      />
    </div>,
  );
}
