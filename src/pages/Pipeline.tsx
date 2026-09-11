import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Filter, GitBranch, LayoutDashboard, Plus, Target, Unlock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { brl } from "@/lib/format";
import { dbError } from "@/lib/supabaseError";
import { toast } from "@/hooks/use-toast";
import { closableMonths, compareMonth, currentMonthBase } from "@/lib/dealStatus";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, StatusBadge } from "@/components/shared";
import DealDetailModal from "@/components/DealDetailModal";
import LeadFunnel from "@/components/LeadFunnel";
import PipelineTopRanking from "@/components/PipelineTopRanking";
import PainelDoCorretor, { usePainelDoCorretor } from "@/components/engagement/PainelDoCorretor";
import { ConvertLeadDialog } from "@/components/leads/ConvertLeadDialog";
import { saveLegacyDeal, type LegacyDealRecord } from "@/integrations/supabase/newSchema";
import type { LeadRecord } from "@/integrations/supabase/leads";
import {
  CloseMonthDialog, DealFilters, DealsBoard, DealsToolbar,
  EMPTY_FILTERS, LoseDealDialog, PipelineAnalytics, ReopenDealDialog, ReopenMonthDialog,
  ScheduleVisitDialog,
  applyDealFilters, canWriteDeals, dealMonth, dealRangeError, dealRequiredError,
  baixarPlanilhaDeNegocios, findDuplicateDeal, hasActiveFilter, sortDeals,
  useClosedMonths, useDeals, useDevelopers, useInvalidateDeals, usePipelineRealtime,
  useOpenSeason, usePeople, usePipelineStages, useStagePermissions,
  type DealFilterState,
} from "@/components/pipeline";
// Direto do módulo, e não do barril: o `index.ts` de `components/pipeline` é de
// outra frente nesta rodada. Mesmo caminho que o `useDealActions` abaixo já usa.
import { ALL, MY_TEAM, teamProfileIds } from "@/components/pipeline/filters";
import { useDealActions } from "@/components/pipeline/useDealActions";

/** `null` = fechado · `{ deal: null }` = criando um negócio novo. */
type EditorState = { deal: LegacyDealRecord | null } | null;

/**
 * Pipeline de negócios.
 *
 * Tinha 1375 linhas, 44 `useState` e 26 toasts, com dois editores gravando o
 * mesmo registro (achado A02). Ficou a composição: os blocos vivem em
 * `@/components/pipeline`, cada um dono do próprio estado; aqui sobra o que
 * precisa ser compartilhado — o filtro (lido pela listagem e pelos indicadores)
 * e qual negócio está aberto.
 *
 * O editor é um só: o `DealDetailModal`, usado também para criar.
 *
 * **Nenhuma comemoração é disparada aqui.** O `EngagementLayer` já ouve
 * `game_events` e agrupa os INSERTs de uma venda rateada entre corretores;
 * chamar `celebrate("sale")` também nesta tela tocaria o som duas vezes e
 * quebraria o agrupamento.
 */
export default function Pipeline() {
  const { user, isAdmin, roles, can } = useAuth();

  // Espelha o `with check` de `deals_insert`. O sócio (e, desde a 0053, o SDR e
  // o marketing) tem `menu.pipeline` e enxerga os negócios, mas o banco recusa a
  // escrita: sem este gate ele abria o formulário inteiro de "Adicionar negócio"
  // para levar 42501 no fim, sem nenhuma marca de que a tela é só de leitura
  // para ele. O `some(includes)` que estava aqui liberava os três, porque todo
  // perfil carrega 'broker' desde o cadastro — daí o papel EFETIVO.
  const canWrite = isAdmin || canWriteDeals(roles);

  /**
   * Extrair a planilha é ato de quem responde pelo número, não de quem trabalha
   * nele: ela sai com VGV, percentual e VGV POR CORRETOR do recorte inteiro —
   * a folha de comissão da operação num arquivo que anda por WhatsApp. Pedido
   * do cliente em 05/09/2026: só administrador e sócio.
   *
   * A trava é a matriz (`pipeline.export`, migration 0092), e não uma lista de
   * papéis no código: quem administra permissões já tem onde mudar isso, e
   * `can()` curto-circuita em admin igual ao `has_permission()` do banco.
   */
  const podeExtrair = can("pipeline.export");

  const [tab, setTab] = useState<"deals" | "leads">("deals");
  const [extraindo, setExtraindo] = useState(false);
  // `null` = ninguém mexeu nos filtros ainda, e o recorte de abertura é
  // DERIVADO do papel (abaixo). Guardar o padrão em `useState` congelaria o
  // valor lido na primeira pintura, quando o `AuthContext` ainda está em
  // `loading` e `roles` é `[]` — o gerente abriria a tela em "todos" e nunca
  // mais voltaria para a equipe dele.
  const [filtrosEscolhidos, setFiltrosEscolhidos] = useState<DealFilterState | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [view, setView] = useState<"table" | "kanban">("table");
  const [editor, setEditor] = useState<EditorState>(null);
  const [visitDeal, setVisitDeal] = useState<LegacyDealRecord | null>(null);
  const [losing, setLosing] = useState<{ deal: LegacyDealRecord; preset?: string } | null>(null);
  const [reopening, setReopening] = useState<LegacyDealRecord | null>(null);
  const [closeMonthOpen, setCloseMonthOpen] = useState(false);
  const [reopenMonthOpen, setReopenMonthOpen] = useState(false);
  const [convertingLead, setConvertingLead] = useState<LeadRecord | null>(null);

  // Abre sozinho só para o corretor, e só na primeira vez do dia; para todo o
  // resto (e para ele, do segundo acesso em diante) existe o botão "Painel".
  const painel = usePainelDoCorretor();

  const dealsQuery = useDeals();
  const stagesQuery = usePipelineStages();
  const peopleQuery = usePeople();
  const developersQuery = useDevelopers();
  const closedMonths = useClosedMonths();
  // A matriz de etapas entra na espera da listagem de propósito: `can_exit` é
  // lido pelo cartão e pelas ações, e enquanto ela não chega a trava é fechada.
  // Sem isto o kanban aparecia por um instante sem alça nenhuma — e um arraste
  // rápido levava "Movimentação não permitida" por corrida, não por regra.
  const stagePerms = useStagePermissions();
  const openSeason = useOpenSeason();
  const invalidateDeals = useInvalidateDeals();
  usePipelineRealtime();

  const deals = useMemo(() => dealsQuery.data ?? [], [dealsQuery.data]);
  const stages = useMemo(() => stagesQuery.data ?? [], [stagesQuery.data]);
  const people = useMemo(() => peopleQuery.data ?? [], [peopleQuery.data]);
  const developers = useMemo(() => developersQuery.data ?? [], [developersQuery.data]);

  /**
   * O diálogo de perda é o ÚNICO caminho para OFF e DISTRATO: o botão "Perder"
   * da tabela e do cartão chega aqui, e o Select de status da tabela desvia
   * para cá em vez de gravar (`useDealActions`).
   *
   * A abertura é livre de propósito. Encerrar negócio é trabalho do corretor —
   * o que o cliente restringiu (10/09/2026) foram DOIS motivos, OFF e distrato,
   * não o ato. Enquanto esta porta cobrava a permissão de OFF/distrato, o
   * corretor perdia também QUEDA e REPROVADO, que são dele. A restrição por
   * motivo mora DENTRO do `LoseDealDialog`, nas opções do Select, e a de etapa
   * na matriz `stage_permissions` — os dois lugares onde a escrita acontece.
   */
  const abrirPerda = useCallback(
    (deal: LegacyDealRecord, preset?: string) => setLosing({ deal, preset }),
    [],
  );
  const closed = useMemo(() => closedMonths.data ?? [], [closedMonths.data]);
  const { moveDeal, changeStatus } = useDealActions({
    stages, closedMonths: closed, onNeedsLossConfirmation: abrirPerda,
  });

  /** Eu + quem eu lidero — o mesmo conjunto de `auth_visible_profiles()`. */
  const myTeam = useMemo(() => teamProfileIds(people, user?.id), [people, user?.id]);

  /**
   * Recorte de abertura da lista (pedido B8 do cliente, 10/09/2026).
   *
   * O gerente abre na equipe dele; administrador e sócio abrem na operação
   * inteira, que é o que eles vêm ver. Quem não lidera ninguém não tem recorte a
   * escolher — para o corretor, a lista da RLS já é só a dele.
   */
  const recorteInicial = !isAdmin && myTeam.size > 1 && roles.includes("manager") ? MY_TEAM : ALL;
  const filters = useMemo(
    () => filtrosEscolhidos ?? { ...EMPTY_FILTERS, team: recorteInicial },
    [filtrosEscolhidos, recorteInicial],
  );

  const brokers = useMemo(
    () => people.filter((person) => person.active && person.roles.includes("broker")),
    [people],
  );
  const managers = useMemo(
    () => people.filter((person) => person.active
      && (person.roles.includes("manager") || person.roles.includes("director"))),
    [people],
  );
  /** Meses presentes nos negócios — o filtro de mês era campo de texto livre. */
  // `compareMonth` e não `sort()` de string: "12/2025" vem depois de "01/2026"
  // na ordem alfabética, e a lista abriria com o mês errado no topo.
  const months = useMemo(
    () => [...new Set(deals.map(dealMonth).filter(Boolean))].sort((a, b) => compareMonth(b, a)),
    [deals],
  );

  const visible = useMemo(
    () => sortDeals(applyDealFilters(deals, filters, myTeam)),
    [deals, filters, myTeam],
  );
  const activeCount = useMemo(() => visible.filter((deal) => deal.active).length, [visible]);

  /**
   * O download é assíncrono (a biblioteca do `.xlsx` só é buscada no clique) e
   * pode falhar — rede caída no meio do `import()`, memória em recorte grande.
   * Sem este `catch` o clique simplesmente não fazia nada e o erro morria no
   * console: quem exporta ficaria esperando um arquivo que nunca vem.
   */
  const extrair = useCallback(async () => {
    setExtraindo(true);
    try {
      await baixarPlanilhaDeNegocios(visible);
    } catch (erro) {
      toast({
        variant: "destructive",
        title: "Não consegui gerar a planilha",
        description: erro instanceof Error ? erro.message : "Tente de novo em instantes.",
      });
    } finally {
      setExtraindo(false);
    }
  }, [visible]);

  const pendingReviews = deals.filter((deal) => deal.document_review_status === "pending").length;
  // `visible`, e não `deals`: a contagem ao lado, na mesma frase, é filtrada —
  // ler "3 negócio(s) ativo(s) · R$ 12 mi em VGV" com o VGV da base inteira
  // descrevia dois conjuntos diferentes na mesma linha.
  const vgv = visible.filter((deal) => deal.active).reduce((total, deal) => total + (deal.deal_value || 0), 0);

  // O mês do fechamento é o do ciclo aberto do game (migration 0032), não o do
  // relógio nem o que estiver no filtro.
  const seasonMonth = openSeason.data
    ? `${openSeason.data.period_start.slice(5, 7)}/${openSeason.data.period_start.slice(0, 4)}`
    : null;
  // O botão só morre quando NÃO SOBRA mês para fechar. Enquanto ele desligava
  // no "mês da temporada já fechado", 08/2026 — onde estão 26 dos 32 negócios —
  // não tinha como ser congelado por tela nenhuma.
  const fechaveis = useMemo(
    () => closableMonths(months, closed, seasonMonth),
    [months, closed, seasonMonth],
  );

  // O cabeçalho e a régua de contadores afirmavam sobre o banco ANTES de ler o
  // banco: com as consultas em voo, `visible` é `[]` e o `<h1>` dizia "0
  // negócio(s) ativo(s) · R$ 0 em VGV", a régua "0 ativos" e o botão do admin
  // "Todos os meses fechados" — o oposto do que o fechamento se propôs a
  // consertar. É o mesmo achado A01 que o `DealsBoard` corrigiu, um nível acima.
  const carregando = dealsQuery.isPending || closedMonths.isPending || openSeason.isPending;
  const falhou = Boolean(dealsQuery.error ?? closedMonths.error);

  const patchFilters = (patch: Partial<DealFilterState>) =>
    setFiltrosEscolhidos((previous) => ({ ...(previous ?? filters), ...patch }));

  return (
    <div className="space-y-6">
      <PipelineTopRanking deals={deals} />

      <PageHeader
        title="Pipeline"
        eyebrow="Comercial"
        icon={GitBranch}
        description={
          carregando
            ? "Carregando negócios…"
            : falhou
              ? "Não consegui ler os negócios."
              // O recorte entra na frase: o filtro mora num painel FECHADO por
              // padrão, e sem isto o gerente lia um total menor sem nada na
              // tela dizendo que a lista está estreitada na equipe dele.
              : `${activeCount} negócio(s) ativo(s) · ${brl(vgv)} em VGV`
                + (filters.team === MY_TEAM ? " · só a sua equipe." : ".")
        }
        actions={
          <>
            {/* Fora do ternário das abas: o Painel é o mesmo quadro nas duas. */}
            <Button variant="outline" size="sm" onClick={painel.abrir}>
              <LayoutDashboard className="mr-1 h-4 w-4" /> Painel
            </Button>
            {tab === "deals" ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setShowFilters((open) => !open)}>
                  <Filter className="mr-1 h-4 w-4" /> Filtrar
                </Button>
                {canWrite ? (
                  <Button size="sm" onClick={() => setEditor({ deal: null })}>
                    <Plus className="mr-1 h-4 w-4" /> Adicionar negócio
                  </Button>
                ) : (
                  <StatusBadge tone="neutral">Somente leitura</StatusBadge>
                )}
                {podeExtrair && (
                  <Button
                    variant="outline" size="sm"
                    disabled={visible.length === 0 || extraindo}
                    onClick={() => void extrair()}
                  >
                    <Download className="mr-1 h-4 w-4" />
                    {extraindo ? "Gerando…" : "Extrair planilha"}
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    variant="highlight" size="sm"
                    disabled={carregando || falhou || fechaveis.length === 0}
                    onClick={() => setCloseMonthOpen(true)}
                  >
                    <Target className="mr-1 h-4 w-4" />
                    {/* "Todos os meses fechados" é uma AFIRMAÇÃO sobre o banco:
                        só depois da resposta. Enquanto as consultas estão em voo
                        o rótulo continua "Fechar mês", desabilitado. */}
                    {!carregando && !falhou && fechaveis.length === 0
                      ? "Todos os meses fechados"
                      : "Fechar mês"}
                  </Button>
                )}
                {/* Reabrir só aparece quando há mês fechado — e só para o admin,
                    que é quem a policy `closed_months_write` autoriza. Sem este
                    botão, o "Fale com o administrador para reabrir" que a tela
                    escreve em três lugares apontava para um caminho que só
                    existia em SQL na mão. */}
                {isAdmin && closed.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setReopenMonthOpen(true)}>
                    <Unlock className="mr-1 h-4 w-4" /> Reabrir mês
                  </Button>
                )}
              </>
            ) : (
              // Criar lead é da tela de Leads (achado F02): o botão daqui inseria
              // direto em `leads` com `status: 'queued'` e um `assigned_to` que a
              // roleta sobrescreve — e a policy só aceita gestor, então o corretor
              // levava erro de RLS num botão que a tela mostrava a ele.
              <Button variant="outline" size="sm" asChild>
                <Link to="/leads"><Users className="mr-1 h-4 w-4" /> Abrir tela de Leads</Link>
              </Button>
            )}
          </>
        }
      />

      <div className="flex w-fit rounded-full border border-border p-0.5" role="tablist" aria-label="Seções do pipeline">
        {([["deals", "Negócios"], ["leads", "Leads"]] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>


      {tab === "deals" ? (
        <div className="flex flex-col gap-4 lg:flex-row">
          {showFilters && (
            <DealFilters
              filters={filters}
              onChange={patchFilters}
              onClear={() => setFiltrosEscolhidos(EMPTY_FILTERS)}
              onClose={() => setShowFilters(false)}
              stages={stages}
              developers={developers}
              brokers={brokers}
              managers={managers}
              months={months}
              teamCount={myTeam.size}
            />
          )}

          <div className="min-w-0 flex-1 space-y-2">
            <DealsToolbar
              search={filters.search}
              onSearch={(search) => patchFilters({ search })}
              view={view}
              onView={setView}
              analyticsOpen={showAnalytics}
              onToggleAnalytics={() => setShowAnalytics((open) => !open)}
              activeCount={activeCount}
              listedCount={visible.length}
              pendingReviews={pendingReviews}
              onFilterPendingReviews={() => patchFilters({ documentReview: "pending" })}
              countsUnknown={carregando || falhou}
            />

            <DealsBoard
              view={view}
              deals={visible}
              stages={stages}
              // A trava do mês fechado e as listas de pessoas/construtoras
              // entram na espera junto com a matriz de etapas, e pelo mesmo
              // motivo: `closedMonths` falhando devolvia `[]`, e mês congelado
              // virava mês editável na tabela, no cartão e no `blockedMoveReason`
              // — a única trava da tela que falhava ABERTA. `usePeople`/
              // `useDevelopers` eram engolidos por `?? []`: o filtro de corretor
              // e os Selects do modal abriam vazios, sem erro e sem "Tentar de
              // novo", com a mesma cara de uma base sem cadastro.
              isPending={dealsQuery.isPending || stagesQuery.isPending || stagePerms.isPending
                || closedMonths.isPending || peopleQuery.isPending || developersQuery.isPending}
              error={dealsQuery.error ?? stagesQuery.error ?? stagePerms.error
                ?? closedMonths.error ?? peopleQuery.error ?? developersQuery.error}
              filtered={hasActiveFilter(filters)}
              canWrite={canWrite}
              onRetry={() => {
                void dealsQuery.refetch();
                void stagesQuery.refetch();
                void stagePerms.refetch();
                void closedMonths.refetch();
                void peopleQuery.refetch();
                void developersQuery.refetch();
              }}
              onClearFilters={() => setFiltrosEscolhidos(EMPTY_FILTERS)}
              onNewDeal={() => setEditor({ deal: null })}
              onOpen={(deal) => setEditor({ deal })}
              onMove={moveDeal}
              onStatusChange={changeStatus}
              onScheduleVisit={setVisitDeal}
              onLose={abrirPerda}
              onReopen={setReopening}
              closedMonths={closed}
            />
          </div>

          {showAnalytics && <PipelineAnalytics deals={deals} stages={stages} />}
        </div>
      ) : (
        <LeadFunnel actorName={user?.email || "Usuário"} onConvert={setConvertingLead} />
      )}

      {editor && (
        <DealDetailModal
          key={editor.deal?.id ?? "novo"}
          deal={editor.deal}
          open
          stages={stages}
          people={people}
          developers={developers}
          defaultMonth={seasonMonth ?? undefined}
          onClose={() => setEditor(null)}
          onReviewChanged={invalidateDeals}
          onSave={async (updated) => {
            // VGV negativo e desconto fora de 0–100 chegavam ao banco e voltavam
            // como 23514 ("Um dos campos está fora do valor permitido") — sem
            // dizer qual, num formulário de ~40 campos. O `min`/`max` do input
            // não trava: só vale em validação de formulário, e não há `<form>`.
            const foraDeFaixa = dealRangeError(updated);
            if (foraDeFaixa) throw dbError("deals", { code: "P0001", message: foraDeFaixa });

            // "Construtora *" tinha o asterisco e nada o cobrava — o banco
            // aceita `developer_id` nulo. O negócio salvava, o cartão passava a
            // mostrar "Sem construtora" e a conferência documental, que escolhe
            // os documentos pela construtora, ficava sem como pedir nada.
            // Empreendimento fica de fora: sem digitação livre no Select e com
            // construtora sem catálogo sendo caso real, cobrá-lo aqui recusava
            // a criação por um campo que a tela não tem como preencher.
            const semObrigatorio = dealRequiredError(updated);
            if (semObrigatorio) throw dbError("deals", { code: "P0001", message: semObrigatorio });

            // Cadastro repetido do mesmo cliente na mesma unidade entrava sem
            // aviso: dois negócios, dois rateios e o VGV contado duas vezes.
            // `P0001` porque a mensagem é nossa e em pt-BR — é o contrato que
            // `describeError` usa para os `raise exception` das migrations.
            const repetido = findDuplicateDeal(deals, updated);
            if (repetido) {
              throw dbError("deals", {
                code: "P0001",
                message: `Já existe um negócio ativo de ${repetido.client} em `
                  + `${repetido.project || "sem empreendimento"} · unidade ${repetido.unit}. `
                  + "Abra o negócio existente em vez de cadastrar outro.",
              });
            }
            await saveLegacyDeal(updated);
            await invalidateDeals();
            setEditor(null);
          }}
        />
      )}

      {visitDeal && (
        <ScheduleVisitDialog
          deal={visitDeal}
          stages={stages}
          onClose={() => setVisitDeal(null)}
          onScheduled={invalidateDeals}
        />
      )}

      {losing && (
        <LoseDealDialog
          deal={losing.deal}
          presetStatus={losing.preset}
          stages={stages}
          onClose={() => setLosing(null)}
          onConfirmed={invalidateDeals}
        />
      )}

      {reopening && (
        <ReopenDealDialog
          deal={reopening}
          stages={stages}
          onClose={() => setReopening(null)}
          onReopened={invalidateDeals}
        />
      )}

      {closeMonthOpen && (
        <CloseMonthDialog
          season={openSeason.data ?? null}
          fallbackMonth={seasonMonth ?? months[0] ?? currentMonthBase()}
          deals={deals}
          closedMonths={closed}
          onClose={() => setCloseMonthOpen(false)}
        />
      )}

      {reopenMonthOpen && (
        <ReopenMonthDialog
          closedMonths={closed}
          deals={deals}
          onClose={() => setReopenMonthOpen(false)}
        />
      )}

      {convertingLead && (
        <ConvertLeadDialog
          lead={convertingLead}
          onClose={() => setConvertingLead(null)}
          onConverted={async () => { await invalidateDeals(); setTab("deals"); }}
        />
      )}

      {/* Sempre montado, e não `{painel.open && …}`: o `Dialog` do Radix precisa
          da transição de fechado→aberto para prender o foco e devolvê-lo ao
          botão. O conteúdo (e as consultas dele) só monta com o modal aberto. */}
      <PainelDoCorretor open={painel.open} onOpenChange={painel.setOpen} />
    </div>
  );
}
