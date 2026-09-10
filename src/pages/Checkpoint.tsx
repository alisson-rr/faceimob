import { useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, LoadingState, PageHeader } from "@/components/shared";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, RefreshCw, Target, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { addDays, endOfWeek, format, isValid, parseISO, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { describeError } from "@/lib/supabaseError";
import { listPeople } from "@/integrations/supabase/newSchema";
import {
  DirectorFunnelSection, TeamCheckpointCard,
  type BrokerRow, type TeamRow,
} from "@/components/checkpoint/FunnelCards";
import {
  buildTargetsMap, emptyAggr, targetsFrom,
  type Targets, type TeamAggr,
} from "@/components/checkpoint/funnel";
import { downloadCheckpointCsv } from "@/components/checkpoint/export";
import {
  checkpointTeams, readsEveryReport, showsEveryTeam, teamsNoQuadro,
} from "@/components/checkpoint/visibility";

type EntryRow = {
  report_id: string; leads: number; ligacoes: number; coleta_docs: number;
  visitas_agendadas: number; visitas_feitas: number;
  analises: number; aprovados: number; vendas: number;
};
type ReportRow = { id: string; team_id: string; report_date: string };

/** Parâmetro da URL com a segunda-feira da semana exibida. */
const PARAM_SEMANA = "semana";
const ISO = "yyyy-MM-dd";

/**
 * Semana da URL, sempre normalizada para a segunda-feira.
 *
 * A tela guardava a semana só em `useState`: F5 e link compartilhado voltavam
 * para a semana corrente, e numa tela feita para reunião isso obriga todo mundo
 * a renavegar. Data inválida no parâmetro cai na semana corrente em vez de
 * quebrar o `format()` mais adiante.
 */
function weekFromParam(raw: string | null): Date {
  const parsed = raw ? parseISO(raw) : null;
  const base = parsed && isValid(parsed) ? parsed : new Date();
  return startOfWeek(base, { weekStartsOn: 1 });
}

/** Catálogo que não depende da semana — equipes, pessoas e metas. */
async function loadCatalogo() {
  const [t, b, tg] = await Promise.all([
    // Sem `active=true`: equipe desativada no meio da semana sumia do quadro
    // junto com os lançamentos dela, sem nenhum aviso. Quem entra no quadro é
    // decidido abaixo, com o que o banco de fato entrega para cada papel.
    supabase.from("teams").select("id,name,manager_id,director_id,active"),
    listPeople(),
    supabase.from("funnel_targets")
      .select("scope,team_id,director_id,lead_to_analysis_pct,analysis_to_approval_pct,approval_to_sale_pct")
      .order("effective_from", { ascending: false }),
  ]);
  if (t.error) throw t.error;
  if (tg.error) throw tg.error;
  return {
    teams: (t.data ?? []).map((team) => ({ ...team, display_name: team.name })) as TeamRow[],
    brokers: b.filter((person) => person.active) as BrokerRow[],
    targetsMap: buildTargetsMap(tg.data ?? []),
  };
}

/** Diários da semana. Só isto muda ao navegar entre semanas. */
async function loadSemana(from: string, to: string) {
  const { data: rep, error: repError } = await supabase
    .from("daily_reports")
    .select("id,team_id,report_date")
    .gte("report_date", from)
    .lte("report_date", to);
  if (repError) throw repError;
  const reports = (rep ?? []) as ReportRow[];
  if (!reports.length) return { reports, entries: [] as EntryRow[] };

  const { data: ent, error: entError } = await supabase
    .from("daily_entries")
    .select("report_id,leads,calls,doc_collections,visits_scheduled,visits_done,analyses_sent,analyses_approved,sales")
    .in("report_id", reports.map((r) => r.id));
  if (entError) throw entError;
  const entries = (ent ?? []).map((entry) => ({
    report_id: entry.report_id,
    leads: entry.leads,
    ligacoes: entry.calls,
    coleta_docs: entry.doc_collections,
    visitas_agendadas: entry.visits_scheduled,
    visitas_feitas: entry.visits_done,
    analises: entry.analyses_sent,
    aprovados: entry.analyses_approved,
    vendas: entry.sales,
  }));
  return { reports, entries };
}

export default function Checkpoint() {
  const { roles, user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const weekStart = weekFromParam(searchParams.get(PARAM_SEMANA));
  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const from = format(weekStart, ISO);
  const to = format(weekEnd, ISO);

  const irPara = useCallback((dia: Date) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(PARAM_SEMANA, format(startOfWeek(dia, { weekStartsOn: 1 }), ISO));
      return next;
    });
  }, [setSearchParams]);

  const equipeParam = searchParams.get("equipe");
  const filtrarEquipe = (valor: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (valor === "all") next.delete("equipe"); else next.set("equipe", valor);
      return next;
    });
  };

  // Duas consultas, não uma: navegar entre semanas refazia as 5 idas ao banco.
  // O catálogo (equipes, pessoas, metas) não muda de semana para semana, e a
  // semana já vista volta do cache do react-query.
  const catalogo = useQuery({ queryKey: ["checkpoint", "catalogo"], queryFn: loadCatalogo });
  const semana = useQuery({
    queryKey: ["checkpoint", "semana", from, to],
    queryFn: () => loadSemana(from, to),
  });

  // `useMemo` e não `?? []` solto: a lista nova a cada render invalidava os
  // memos que dependem dela (lint react-hooks/exhaustive-deps).
  const teams = useMemo(() => catalogo.data?.teams ?? [], [catalogo.data]);
  const brokers = catalogo.data?.brokers ?? [];
  const targetsMap = catalogo.data?.targetsMap ?? {};
  const reports = useMemo(() => semana.data?.reports ?? [], [semana.data]);
  const entries = semana.data?.entries ?? [];

  const loading = catalogo.isPending || semana.isPending;
  const loadError = catalogo.error ?? semana.error;

  // O recorte usa TODOS os papéis (papel é N:N) e a liderança de cada equipe.
  // O quadro do diretor é o das equipes que ele lidera — decisão de tela, mais
  // estreita do que `can_read_all()`; ver `checkpoint/visibility.ts`.
  const escopo = useMemo(
    () => checkpointTeams(teams, roles, user?.id ?? null),
    [teams, roles, user?.id],
  );

  // Equipe desativada entra no quadro ou vira aviso — a regra e o porquê de
  // cada ramo estão em `checkpoint/visibility.ts` (`teamsNoQuadro`).
  const comLancamento = useMemo(() => new Set(reports.map((r) => r.team_id)), [reports]);
  const { quadro, foraPorRecorte } = useMemo(
    () => teamsNoQuadro(escopo.visible, roles, comLancamento),
    [escopo.visible, roles, comLancamento],
  );
  const idsNoQuadro = useMemo(() => new Set(quadro.map((t) => t.id)), [quadro]);

  /**
   * Filtro de equipe vindo da URL, validado contra as opções que existem.
   *
   * O `?equipe=<id>` é o parâmetro do "manda o link", e é justamente aí que ele
   * chega em quem não lidera aquela equipe — ou depois de a equipe sair do
   * quadro. Sem validação, o Radix voltava ao placeholder (nada na tela dizia
   * que havia filtro) e o quadro caía no vazio "você não lidera nenhuma equipe",
   * diagnóstico errado: a pessoa lidera equipes, só não a filtrada.
   */
  const teamFilter = equipeParam && idsNoQuadro.has(equipeParam) ? equipeParam : "all";
  const filtroIgnorado = !loading && !loadError && !!equipeParam && equipeParam !== teamFilter;

  const soDoFiltro = (lista: TeamRow[]) =>
    lista.filter((t) => idsNoQuadro.has(t.id)).filter((t) => teamFilter === "all" || t.id === teamFilter);
  const equipesDirigidas = soDoFiltro(escopo.directed);
  const equipesGerenciadas = soDoFiltro(escopo.managed);
  const filteredTeams = [...equipesDirigidas, ...equipesGerenciadas];

  const teamNameFor = (t: TeamRow) => t.display_name?.trim() || t.name || "Equipe";

  const targetsFor = (key: string): Targets => targetsFrom(targetsMap, key);

  const aggregate = (teamId: string): TeamAggr => {
    const rIds = new Set(reports.filter(r => r.team_id === teamId).map(r => r.id));
    const acc = emptyAggr();
    acc.lancamentos = rIds.size;
    entries.forEach(e => {
      if (!rIds.has(e.report_id)) return;
      acc.leads += e.leads || 0;
      acc.ligacoes += e.ligacoes || 0;
      acc.coleta_docs += e.coleta_docs || 0;
      acc.visitas_agendadas += e.visitas_agendadas || 0;
      acc.visitas_feitas += e.visitas_feitas || 0;
      acc.enviadas += e.analises || 0;
      acc.aprovadas += e.aprovados || 0;
      acc.vendas += e.vendas || 0;
    });
    return acc;
  };

  const exportar = () => {
    downloadCheckpointCsv(
      filteredTeams.map((t) => ({
        equipe: teamNameFor(t),
        ativa: t.active,
        aggr: aggregate(t.id),
        targets: targetsFor(t.id),
      })),
      from,
    );
  };

  const atualizar = () => { void queryClient.invalidateQueries({ queryKey: ["checkpoint"] }); };

  /**
   * Quadro vazio tem quatro causas distintas e cada uma pede uma saída diferente.
   *
   * A versão anterior dizia "você não lidera nenhuma delas" para todo mundo,
   * inclusive para o admin — que lidera nada por definição e mesmo assim lê o
   * diário da empresa inteira.
   */
  const motivoDoQuadroVazio = () => {
    if (foraPorRecorte.length > 0)
      return "As equipes que você lidera estão desativadas e nenhum lançamento delas chegou nesta semana — o banco libera o diário apenas de equipe ativa para quem a lidera. Reative a equipe em Equipes para o quadro voltar.";
    if (showsEveryTeam(roles))
      return "Nenhuma equipe ativa cadastrada. Equipe desativada só aparece na semana em que tem lançamento — navegue até a semana da operação ou reative a equipe em Equipes.";
    if (readsEveryReport(roles))
      return "Você não é gerente nem diretor de nenhuma equipe ativa. Seu papel lê o diário de todas as equipes no banco, mas este quadro é montado por quem lidera cada uma — o funil da diretoria some as equipes que você dirige.";
    return "Há equipes ativas, mas você não lidera nenhuma delas — o recorte é o mesmo do banco (gerente ou diretor da equipe).";
  };

  return (
    <div className="p-6 space-y-4">
      {/* Kit compartilhado (`components/shared`): o <h1> sai do PageHeader e os
          três estados abaixo são LoadingState/EmptyState — é de lá que vêm o
          `role="status"` da espera e o tom de erro, que a versão manual desta
          tela não tinha (quem usa leitor de tela não ouvia nada na carga). */}
      <PageHeader
        title="Checkpoint Semanal"
        eyebrow="Gestão"
        icon={Target}
        description="Funil da semana por equipe, comparado com a meta de conversão de cada estágio."
        actions={
          // `flex-wrap`: os controles mais o Select de 224 px pedem bem mais que
          // os 311 px úteis a 375 px, e sem quebra de linha eles transbordavam
          // 137 px a página inteira (handoff-N §6.1).
          //
          // Sem botão "Imprimir": o app não tem NENHUMA regra `@media print`, e
          // `window.print()` daqui sai com a sidebar, o header de 64 px e os
          // cards sem fundo (o navegador omite `background` por padrão) — as
          // barras de meta somem justamente na folha levada para a reunião.
          // Exportar CSV é o caminho honesto até a folha existir.
          <>
            <Button size="sm" variant="outline" aria-label="Semana anterior" onClick={() => irPara(addDays(weekStart, -7))}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="px-3 py-1 rounded-md border border-primary/30 bg-primary/5 text-xs">
              {format(weekStart, "dd MMM", { locale: ptBR })} — {format(weekEnd, "dd MMM yyyy", { locale: ptBR })}
            </div>
            <Button size="sm" variant="outline" aria-label="Próxima semana" onClick={() => irPara(addDays(weekStart, 7))}><ChevronRight className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => irPara(new Date())}>Hoje</Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Atualizar os números"
              aria-busy={catalogo.isFetching || semana.isFetching}
              onClick={atualizar}
            >
              <RefreshCw className={`h-4 w-4 ${catalogo.isFetching || semana.isFetching ? "animate-spin" : ""}`} /> Atualizar
            </Button>
            <Button size="sm" variant="outline" onClick={exportar} disabled={filteredTeams.length === 0}>
              <Download className="h-4 w-4" /> Exportar CSV
            </Button>
            <Select value={teamFilter} onValueChange={filtrarEquipe}>
              <SelectTrigger className="w-full sm:w-56 h-8 text-xs" aria-label="Filtrar equipe"><SelectValue placeholder="Filtrar equipe" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as equipes</SelectItem>
                {quadro.map(t => <SelectItem key={t.id} value={t.id}>{teamNameFor(t)}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        }
      />

      {/* Filtro que veio no link e não existe para quem abriu: sem isto o quadro
          ficava vazio com cara de falta de permissão e o gatilho do Select, sem
          item correspondente, voltava ao placeholder — filtro ativo e invisível. */}
      {filtroIgnorado && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          O link trouxe um filtro de equipe que não está neste quadro — pode ser equipe que você não
          lidera, desativada ou sem lançamento nesta semana. Mostrando todas as suas equipes.
          <Button size="sm" variant="outline" className="h-7" onClick={() => filtrarEquipe("all")}>
            Limpar filtro
          </Button>
        </p>
      )}

      {/* Equipe desativada que o banco não entrega para este papel: o silêncio
          fazia os lançamentos dela sumirem do total da semana sem explicação.
          Quem lê tudo (`readsEveryReport`) nunca chega aqui — para esse papel a
          equipe some do quadro por não ter lançado nada, e não por permissão. */}
      {!loading && !loadError && foraPorRecorte.length > 0 && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {foraPorRecorte.map(teamNameFor).join(", ")}
          {foraPorRecorte.length > 1 ? " estão desativadas" : " está desativada"} e
          {foraPorRecorte.length > 1 ? " ficam" : " fica"} fora deste quadro: nenhum lançamento delas
          chegou nesta semana, e o banco libera o diário apenas de equipe ativa para quem a lidera —
          pode não ter havido lançamento, ou ele pode existir e não vir para você. O que já foi
          lançado continua gravado: reative a equipe em Equipes ou peça o número a um administrador.
        </p>
      )}

      {loading ? (
        <LoadingState variant="table" rows={3} label="Carregando o checkpoint da semana…" />
      ) : loadError ? (
        <EmptyState
          tone="danger"
          icon={AlertTriangle}
          title="Não foi possível carregar o checkpoint"
          description={`${describeError(loadError, "Verifique a conexão e tente de novo.")} Nenhum número desta tela é confiável enquanto a leitura não voltar.`}
          action={<Button variant="outline" onClick={atualizar}>Tentar novamente</Button>}
        />
      ) : teams.length === 0 ? (
        // "Não há equipe cadastrada" e "há, mas nenhuma é sua" são problemas
        // diferentes: o primeiro é cadastro faltando, o segundo é permissão.
        <EmptyState
          icon={Users}
          title="Nenhuma equipe cadastrada"
          description="O Checkpoint agrega o diário por equipe — cadastre uma equipe ativa para começar."
          action={<Button asChild variant="outline"><Link to="/equipes">Ir para Equipes</Link></Button>}
        />
      ) : filteredTeams.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhuma equipe neste quadro"
          description={motivoDoQuadroVazio()}
        />
      ) : (
        // Bloco de diretoria para o que a pessoa DIRIGE (ou tudo, para admin e
        // sócio); card por equipe para o que ela apenas gerencia. Quem acumula
        // os dois papéis vê as duas coisas — antes só o papel primário contava.
        <div className="space-y-4">
          {equipesDirigidas.length > 0 && (
            <DirectorFunnelSection
              brokers={brokers}
              teams={equipesDirigidas}
              aggregate={aggregate}
              targetsFor={targetsFor}
              teamNameFor={teamNameFor}
            />
          )}
          {equipesGerenciadas.length > 0 && (
            <div className="grid grid-cols-1 gap-4">
              {equipesGerenciadas.map(t => (
                <TeamCheckpointCard
                  key={t.id}
                  aggr={aggregate(t.id)}
                  targets={targetsFor(t.id)}
                  name={teamNameFor(t)}
                  inactive={!t.active}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
