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
  addEntry, buildTargetsMap, directorTargetKey, emptyAggr, GLOBAL_TARGET_KEY,
  ISO_DATE, lancamentoKey, missingDays, monthRange, targetsForKey,
  type Targets, type TeamAggr,
} from "@/components/checkpoint/funnel";
import type { DailyEntryColumns } from "@/lib/dailyFunnel";
import { downloadCheckpointCsv } from "@/components/checkpoint/export";
import {
  checkpointManagers, checkpointTeams, managerFocus, PARAM_GERENTE,
  showsEveryTeam, teamsNoQuadro,
} from "@/components/checkpoint/visibility";

/**
 * Linha de `daily_entries` com o relatório de origem — nos nomes do BANCO.
 *
 * A tela renomeava coluna por coluna aqui (`calls` → `ligacoes`, `visits_done`
 * → `visitas_feitas`…), uma terceira cópia da tradução que o Diário já faz em
 * `fromDailyEntry`. Quem traduz agora é `addEntry`.
 */
type EntryRow = DailyEntryColumns & { report_id: string };
type ReportRow = { id: string; team_id: string; report_date: string };
type Diarios = { reports: ReportRow[]; entries: EntryRow[] };

/** Parâmetro da URL com a segunda-feira da semana exibida. */
const PARAM_SEMANA = "semana";
/** Valor do seletor de gerente que significa "o meu próprio quadro". */
const MEU_QUADRO = "__meu__";
const SEM_INTERVALO: Diarios = { reports: [], entries: [] };

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

/**
 * Diários de um intervalo. Serve à semana do quadro e ao acumulado do mês.
 *
 * A consulta filtra por DATA e não por equipe de propósito: quem recorta por
 * equipe é a RLS (`daily_reports_select` / `daily_entries_select`, migration
 * 0109), e é ela a fronteira. Até a 0109 o recorte do diretor existia só no
 * React — `can_read_all()` entregava o diário de todas as equipes da casa e a
 * tela jogava fora o que não era dele, com a operação inteira visível na aba de
 * rede. Não repor esse filtro aqui é o que mantém uma única fonte de verdade:
 * se o quadro vier vazio, o lugar de olhar é a policy, não este arquivo.
 * Prova executável em `supabase/tests/97_diario_hierarquia.sql`.
 */
async function loadIntervalo(from: string, to: string): Promise<Diarios> {
  const { data: rep, error: repError } = await supabase
    .from("daily_reports")
    .select("id,team_id,report_date")
    .gte("report_date", from)
    .lte("report_date", to);
  if (repError) throw repError;
  const reports = (rep ?? []) as ReportRow[];
  if (!reports.length) return { reports, entries: [] };

  const { data: ent, error: entError } = await supabase
    .from("daily_entries")
    .select("report_id,leads,calls,doc_collections,visits_scheduled,visits_done,analyses_sent,analyses_approved,sales")
    .in("report_id", reports.map((r) => r.id));
  if (entError) throw entError;
  return { reports, entries: (ent ?? []) as EntryRow[] };
}

/** Soma os lançamentos das equipes pedidas. Mesma conta para a semana e o mês. */
function somar({ reports, entries }: Diarios, teamIds: ReadonlySet<string>): TeamAggr {
  const rIds = new Set(reports.filter((r) => teamIds.has(r.team_id)).map((r) => r.id));
  const acc = emptyAggr();
  acc.lancamentos = rIds.size;
  entries.forEach((e) => {
    if (rIds.has(e.report_id)) addEntry(acc, e);
  });
  return acc;
}

export default function Checkpoint() {
  const { roles, user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const weekStart = weekFromParam(searchParams.get(PARAM_SEMANA));
  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const from = format(weekStart, ISO_DATE);
  const to = format(weekEnd, ISO_DATE);
  // O mês acompanha a semana navegada, com a âncora da 0071 — ver `monthRange`.
  const mesRange = useMemo(() => monthRange(weekStart, new Date()), [weekStart]);
  const mesFrom = format(mesRange.start, ISO_DATE);
  const mesTo = format(mesRange.end, ISO_DATE);

  const irPara = useCallback((dia: Date) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(PARAM_SEMANA, format(startOfWeek(dia, { weekStartsOn: 1 }), ISO_DATE));
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

  /** Entrar no checkpoint de um gerente — ou voltar ao próprio quadro. */
  const abrirGerente = (valor: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (valor === MEU_QUADRO) next.delete(PARAM_GERENTE); else next.set(PARAM_GERENTE, valor);
      // A equipe filtrada quase nunca existe nos dois quadros: manter o filtro
      // trocava o quadro do gerente por um vazio com aviso de filtro ignorado.
      next.delete("equipe");
      return next;
    });
  };

  // Duas consultas, não uma: navegar entre semanas refazia as 5 idas ao banco.
  // O catálogo (equipes, pessoas, metas) não muda de semana para semana, e a
  // semana já vista volta do cache do react-query.
  const catalogo = useQuery({ queryKey: ["checkpoint", "catalogo"], queryFn: loadCatalogo });
  const semana = useQuery({
    queryKey: ["checkpoint", "intervalo", from, to],
    queryFn: () => loadIntervalo(from, to),
  });
  // O acumulado do mês vinha pronto da RPC pública (0039). Aqui ele é consulta
  // separada de propósito: navegar entre semanas do mesmo mês reusa esta do
  // cache, e a falha dela não derruba o quadro da semana.
  const mes = useQuery({
    queryKey: ["checkpoint", "intervalo", mesFrom, mesTo],
    queryFn: () => loadIntervalo(mesFrom, mesTo),
  });

  // `useMemo` e não `?? []` solto: a lista nova a cada render invalidava os
  // memos que dependem dela (lint react-hooks/exhaustive-deps).
  const teams = useMemo(() => catalogo.data?.teams ?? [], [catalogo.data]);
  const brokers = catalogo.data?.brokers ?? [];
  const targetsMap = catalogo.data?.targetsMap ?? {};
  const diarios = semana.data ?? SEM_INTERVALO;
  const reports = useMemo(() => semana.data?.reports ?? [], [semana.data]);

  const loading = catalogo.isPending || semana.isPending;
  const loadError = catalogo.error ?? semana.error;

  // O recorte usa TODOS os papéis (papel é N:N) e a liderança de cada equipe.
  // O quadro do diretor é o das equipes que ele lidera, e desde a 0109 esse é
  // também o recorte do BANCO: aqui só se organiza (diretoria × gerência) o que
  // a RLS já entregou. Ver `checkpoint/visibility.ts`.
  const escopoTotal = useMemo(
    () => checkpointTeams(teams, roles, user?.id ?? null),
    [teams, roles, user?.id],
  );

  /**
   * Hierarquia pedida pelo cliente em 10/09/2026: o diretor vê o dele e o dos
   * gerentes dele, e consegue ENTRAR no checkpoint de um gerente. Admin e sócio
   * alcançam todos; para o gerente a lista fica vazia e o seletor some — ele só
   * alcançaria a si mesmo, que é a tela em que já está.
   */
  const gerentes = useMemo(
    () => checkpointManagers(escopoTotal.visible, user?.id ?? null),
    [escopoTotal.visible, user?.id],
  );
  const gerenteParam = searchParams.get(PARAM_GERENTE);
  const focado = useMemo(
    () => (gerenteParam ? managerFocus(escopoTotal.visible, gerenteParam) : null),
    [escopoTotal.visible, gerenteParam],
  );
  const escopo = focado ?? escopoTotal;
  const gerenteIgnorado = !loading && !loadError && !!gerenteParam && !focado;

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

  // Memoizadas juntas: o mês e as pendências dependem desta lista, e recriá-la
  // a cada render refazia a soma do mês inteiro sem nada ter mudado.
  const { equipesDirigidas, equipesGerenciadas, filteredTeams } = useMemo(() => {
    const soDoFiltro = (lista: TeamRow[]) =>
      lista.filter((t) => idsNoQuadro.has(t.id)).filter((t) => teamFilter === "all" || t.id === teamFilter);
    const dirigidas = soDoFiltro(escopo.directed);
    const gerenciadas = soDoFiltro(escopo.managed);
    return {
      equipesDirigidas: dirigidas,
      equipesGerenciadas: gerenciadas,
      filteredTeams: [...dirigidas, ...gerenciadas],
    };
  }, [escopo, idsNoQuadro, teamFilter]);

  const teamNameFor = (t: TeamRow) => t.display_name?.trim() || t.name || "Equipe";
  /**
   * Nome do gerente. "Sem gerente" e "gerente que não veio na lista" são coisas
   * diferentes: `brokers` só traz ficha ATIVA, e um uuid cru na tela não ajuda
   * ninguém a cobrar o diário.
   */
  const nomeDe = (id: string | null) => {
    if (!id) return "sem gerente";
    return brokers.find((b) => b.id === id)?.name?.trim() || "gerente sem ficha ativa";
  };

  const targetsFor = (key: string): Targets => targetsForKey(targetsMap, key);

  const aggregate = (teamId: string): TeamAggr => somar(diarios, new Set([teamId]));

  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  /**
   * Dias úteis sem lançamento nas equipes do quadro — a cobrança da reunião de
   * segunda, que só existia na tela pública do diretor.
   *
   * Equipe desativada fica de fora, como na RPC: cobrar diário de equipe que
   * não opera mais é ruído garantido toda semana.
   */
  const pendencias = useMemo(() => {
    const comEntrada = new Set(diarios.entries.map((e) => e.report_id));
    const lancado = new Set(
      diarios.reports
        .filter((r) => comEntrada.has(r.id))
        .map((r) => lancamentoKey(r.team_id, r.report_date)),
    );
    const ativas = filteredTeams.filter((t) => t.active).map((t) => t.id);
    return missingDays(weekStart, new Date(), ativas, lancado);
  }, [diarios, weekStart, filteredTeams]);

  // Intervalo vazio é mês que ainda não começou (semana futura): o card sairia
  // zerado com o rótulo "de 01/10 a 02/09", que não quer dizer nada.
  const mesComecou = mesRange.end >= mesRange.start;
  const aggrMes = useMemo(
    () => (mes.data && mesComecou ? somar(mes.data, new Set(filteredTeams.map((t) => t.id))) : null),
    [mes.data, mesComecou, filteredTeams],
  );
  /**
   * A régua do mês é a da diretoria quando o quadro é de uma só — a mesma
   * precedência da RPC. Com mais de uma diretoria na tela nenhuma meta de
   * diretor é "a" meta, e a global é a única honesta: sem isto o mesmo número
   * sairia vermelho no card do mês e verde no da semana, logo acima.
   */
  const diretorias = new Set(filteredTeams.map((t) => t.director_id).filter((id): id is string => !!id));
  const metaDoMes = targetsFor(
    diretorias.size === 1 ? directorTargetKey([...diretorias][0]) : GLOBAL_TARGET_KEY,
  );

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
   * Quadro vazio tem causas distintas e cada uma pede uma saída diferente.
   *
   * A versão anterior dizia "você não lidera nenhuma delas" para todo mundo,
   * inclusive para o admin — que lidera nada por definição e mesmo assim lê o
   * diário da empresa inteira.
   */
  const motivoDoQuadroVazio = () => {
    if (foraPorRecorte.length > 0)
      return "As equipes que você lidera estão desativadas e nenhum lançamento delas chegou nesta semana — o banco libera o diário apenas de equipe ativa para quem a lidera. Reative a equipe em Equipes para o quadro voltar.";
    if (focado)
      return "Este gerente não tem equipe ativa neste quadro. Ele pode ter sido trocado na equipe, ou ela pode estar desativada — confira em Equipes.";
    if (showsEveryTeam(roles))
      return "Nenhuma equipe ativa cadastrada. Equipe desativada só aparece na semana em que tem lançamento — navegue até a semana da operação ou reative a equipe em Equipes.";
    // O ramo do diretor ("seu papel lê o diário de todas as equipes no banco")
    // saiu na 0109: agora ele lê só as equipes que dirige, então a explicação
    // dele é a mesma do gerente — e era o texto que prometia o dado da casa.
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
            {/* Some para quem não tem ninguém abaixo: seletor com um item só,
                que é a própria pessoa, é ruído. */}
            {gerentes.length > 0 && (
              <Select value={focado && gerenteParam ? gerenteParam : MEU_QUADRO} onValueChange={abrirGerente}>
                <SelectTrigger className="w-full sm:w-56 h-8 text-xs" aria-label="Abrir o checkpoint de um gerente">
                  <SelectValue placeholder="Abrir gerente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MEU_QUADRO}>Meu quadro</SelectItem>
                  {gerentes.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {nomeDe(g.id)} ({g.teams.length})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </>
        }
      />

      {/* Dentro do checkpoint de outra pessoa: sem esta faixa o diretor lia os
          números do gerente achando que eram os dele. */}
      {focado && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          Você está no checkpoint de <b>{nomeDe(gerenteParam)}</b> — as equipes que ele gerencia, como ele as vê.
          <Button size="sm" variant="outline" className="h-7" onClick={() => abrirGerente(MEU_QUADRO)}>
            Voltar ao meu quadro
          </Button>
        </p>
      )}

      {/* Gerente que veio no link e não está no seu recorte: falha fechada com
          explicação, em vez de quadro vazio com cara de "não há número". */}
      {gerenteIgnorado && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          O link trouxe um gerente que não está no seu recorte — você só abre o checkpoint de quem
          gerencia equipe que você lidera. Mostrando o seu quadro.
          <Button size="sm" variant="outline" className="h-7" onClick={() => abrirGerente(MEU_QUADRO)}>
            Limpar
          </Button>
        </p>
      )}

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
          // A 0104 deixou /equipes só para administrador e sócio: para os demais
          // o botão levava ao "Acesso não liberado" do guard de rota.
          action={isAdmin ? <Button asChild variant="outline"><Link to="/equipes">Ir para Equipes</Link></Button> : undefined}
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
          {/* Pendências da semana: `<details>` nativo em vez de diálogo — o
              resumo já é a cobrança, e quem precisa da lista abre. */}
          {pendencias.length > 0 && (
            <details className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-bold text-destructive">
                Checkpoints não efetuados nesta semana ({pendencias.length} {pendencias.length === 1 ? "dia" : "dias"}) — quem não lançou
              </summary>
              <ul className="mt-2 space-y-1.5">
                {pendencias.map((dia) => (
                  <li key={dia.date}>
                    <span className="font-semibold">{format(parseISO(dia.date), "dd/MM (EEEE)", { locale: ptBR })}</span>
                    <span className="text-muted-foreground">
                      {" — "}
                      {dia.teamIds.map((id) => {
                        const t = teamById.get(id);
                        return t ? `${teamNameFor(t)} (${nomeDe(t.manager_id)})` : id;
                      }).join(" • ")}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

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

          {/* Acumulado do mês, no mesmo card da semana: é o bloco `month` que a
              tela pública do diretor mostrava (0039) e que aqui não existia. */}
          {mes.error ? (
            <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              O acumulado do mês não carregou ({describeError(mes.error, "tente atualizar")}). Os números
              da semana acima continuam válidos.
            </p>
          ) : aggrMes && (
            <TeamCheckpointCard
              aggr={aggrMes}
              targets={metaDoMes}
              name={`Acumulado do mês — ${format(mesRange.start, "MMMM", { locale: ptBR })}, de ${format(mesRange.start, "dd/MM")} a ${format(mesRange.end, "dd/MM")}`}
            />
          )}
        </div>
      )}
    </div>
  );
}
