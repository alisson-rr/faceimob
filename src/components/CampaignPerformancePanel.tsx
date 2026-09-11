import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ChevronDown, ChevronRight, Copy, Link2, Loader2, Megaphone, Pause, Pencil, Play, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { MetaCampaignActions } from "@/components/marketing/MetaCampaignActions";
import { MetaReportImportDialog } from "@/components/marketing/MetaReportImportDialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  AD_PLATFORMS,
  AD_PLATFORM_LABEL,
  AD_STATUSES,
  CANAL_META_LABEL,
  PERIODOS_META,
  PERIODO_META_LABEL,
  adStatusLabel,
  costPerLead,
  createAdCampaign,
  deleteAdCampaign,
  fetchMetaMetricas,
  fetchMetaPorCanal,
  fetchMetaSyncStatus,
  origemDoGasto,
  periodoMeta,
  problemaNaCampanha,
  roas,
  roasLabel,
  setAdCampaignStatus,
  sincronizarMeta,
  updateAdCampaign,
  vincularConstrutora,
  type AdCampaignInput,
  type AdPlatform,
  type CampoDaCampanha,
  type CanalMeta,
  type MetaCanalRow,
  type MetaMetricaRow,
  type MetaSyncConta,
  type NivelDeVerba,
  type PeriodoMeta,
  type SpendSource,
} from "@/integrations/supabase/analytics";
import { brl, date, dateTime, num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";

/** O que o painel precisa de cada campanha — `CampaignRow` de `Marketing` serve. */
export type CampaignResult = {
  id: string;
  externalId: string;
  name: string;
  platform: AdPlatform;
  developerId: string | null;
  /** Cru do banco (`ACTIVE`/`PAUSED`/nulo), não o rótulo traduzido. */
  rawStatus: string | null;
  spend: number;
  /** Orçamento diário da plataforma. `null` = a campanha não tem teto lançado. */
  dailyBudget: number | null;
  /** Verba CONTRATADA (0089). Com o investido ao lado, é o que responde
   *  "quanto ainda posso gastar" — a pergunta que faz alguém pausar. */
  lifetimeBudget: number | null;
  /** Período de veiculação, `YYYY-MM-DD` (0089). */
  startsOn: string | null;
  endsOn: string | null;
  /** Origem de lead que a campanha alimenta (0089). */
  leadSourceId: string | null;
  /** Última vez que `total_spend` veio da plataforma. `null` = valor digitado. */
  syncedAt: string | null;
  /** Recorte do relatório importado que `total_spend` cobre (0113). Nulo nos
   *  dois = o gasto foi digitado. */
  spendPeriodStart: string | null;
  spendPeriodEnd: string | null;
  /** Conta de anúncios da sincronização (0115). Preenchida = campanha
   *  sincronizada: nome, status, verba e investido vêm da Meta, travados no
   *  banco (`ad_campaigns_guard_meta`) e no formulário. */
  metaAccountId: string | null;
  metaChannel: CanalMeta | null;
  metaBudgetLevel: NivelDeVerba | null;
  /** Status de entrega na Meta, que pode diferir do configurado. */
  metaEffectiveStatus: string | null;
  /** Procedência do investido: planilha, sincronização ou as duas. */
  spendSource: SpendSource | null;
  /** Construtora sugerida pelo nome da campanha (F0), à espera do Vincular. */
  developerSuggestedId: string | null;
  leads: number;
  conversions: number;
  /** Negócios GANHOS da campanha — o denominador do custo por VENDA. */
  sales: number;
  /** VGV dos negócios ganhos que vieram desta campanha. */
  revenue: number;
};

/** Sem valor no `Select` do Radix: string vazia é proibida como `value`. */
const SEM_CONSTRUTORA = "__nenhuma__";
const SEM_ORIGEM = "__sem_origem__";
const SEM_STATUS = "__sem_status__";

type FormState = {
  externalId: string;
  name: string;
  platform: AdPlatform;
  developerId: string;
  leadSourceId: string;
  status: string;
  spend: string;
  budget: string;
  lifetime: string;
  startsOn: string;
  endsOn: string;
};

const vazio = (): FormState => ({
  externalId: "",
  name: "",
  platform: "meta",
  developerId: SEM_CONSTRUTORA,
  leadSourceId: SEM_ORIGEM,
  status: "ACTIVE",
  spend: "",
  budget: "",
  lifetime: "",
  startsOn: "",
  endsOn: "",
});

/** Linha do banco → campos do formulário. Serve a Editar e a Copiar: as duas
 *  partem da mesma campanha e divergem só no que a cópia sobrescreve. */
const formDe = (row: CampaignResult): FormState => ({
  externalId: row.externalId,
  name: row.name,
  platform: row.platform,
  developerId: row.developerId ?? SEM_CONSTRUTORA,
  leadSourceId: row.leadSourceId ?? SEM_ORIGEM,
  status: row.rawStatus ?? SEM_STATUS,
  spend: String(row.spend ?? 0),
  budget: row.dailyBudget === null ? "" : String(row.dailyBudget),
  lifetime: row.lifetimeBudget === null ? "" : String(row.lifetimeBudget),
  startsOn: row.startsOn ?? "",
  endsOn: row.endsOn ?? "",
});

/** Branco é "não lançado" (`null`), e não zero: zero significaria teto de
 *  R$ 0,00, que é outra afirmação. */
const verba = (texto: string): number | null => (texto.trim() === "" ? null : Number(texto));

/** `id` do controle de cada campo que a validação pode recusar — é por ele que
 *  o `<Label>` se liga ao campo e que a recusa leva o foco até ele. Um mapa e
 *  não `id={campo}`: o `id` é global na página e "name" colidiria fácil. */
const CAMPO_ID: Record<CampoDaCampanha, string> = {
  externalId: "campanha-id-externo",
  name: "campanha-nome",
  status: "campanha-status",
  totalSpend: "campanha-investido",
  dailyBudget: "campanha-orcamento",
  lifetimeBudget: "campanha-verba",
  endsOn: "campanha-fim",
};

/** Um só parágrafo de erro por formulário: só um campo é recusado por vez —
 *  `problemaNaCampanha` para no primeiro problema. */
const ERRO_ID = "campanha-erro";
/** A frase "vêm da Meta" do formulário, ligada aos campos travados. */
const DA_META_ID = "campanha-da-meta";
/** O que o gatilho `ad_campaigns_guard_meta` (0115) recusa à mão numa campanha
 *  sincronizada: o formulário trava os mesmos (e a plataforma junto). */
const CAMPOS_DA_META = new Set<CampoDaCampanha>(["externalId", "name", "status", "totalSpend", "dailyBudget", "lifetimeBudget"]);
const SYNC_MOTIVO_ID = "meta-sync-motivo";

/** Os três canais do padrão F0 aparecem sempre; misto e outro, quando têm
 *  campanha — sem eles a soma dos canais ficaria menor que o investido. */
const CANAIS_PRINCIPAIS: CanalMeta[] = ["formulario", "whatsapp", "landing_page"];
const CANAIS_EXTRAS: CanalMeta[] = ["misto", "outro"];
/** O que a Meta contou como resultado em cada canal (`resultadoDoCanal`, na sincronização). */
const RESULTADO_DO_CANAL: Record<CanalMeta, string> = {
  formulario: "leads do formulário",
  whatsapp: "conversas iniciadas",
  landing_page: "leads do pixel na LP",
  misto: "soma dos três contadores",
  outro: "nada conta como resultado",
};

/** A frase de cada conta. Falha aparece como falha, com a data e a última boa —
 *  nunca como número zerado. */
function situacaoDaConta(c: MetaSyncConta): { texto: string; falhou: boolean } {
  const boa = c.last_sync_ok_at;
  const ultima = c.ultima;
  if (ultima?.status === "rodando") {
    return {
      texto: `sincronizando agora, desde ${dateTime(ultima.started_at)}${boa ? ` · última sincronização boa, em ${dateTime(boa)}` : ""}.`,
      falhou: false,
    };
  }
  const erro = ultima ? (ultima.status === "falhou" ? ultima.error ?? "sem motivo registrado" : null) : c.last_sync_error;
  if (erro) {
    const quando = ultima?.finished_at ?? ultima?.started_at ?? c.last_sync_attempt_at;
    return {
      texto: `A última sincronização falhou${quando ? ` em ${dateTime(quando)}` : ""}: ${erro.replace(/\.$/, "")}. ${
        boa
          ? `Os números abaixo são da última sincronização boa, em ${dateTime(boa)}.`
          : "Esta conta nunca sincronizou: ainda não há número da Meta dela."
      }`,
      falhou: true,
    };
  }
  return {
    texto: boa ? `Última sincronização boa: ${dateTime(boa)}.` : "Ainda não sincronizou: não há número da Meta desta conta.",
    falhou: false,
  };
}

/** Card "Resultado por canal — segundo a Meta". A soma dos canais é o investido
 *  segundo a Meta no período, e a linha de total diz isso. */
function MetaPorCanal({ linhas }: { linhas: MetaCanalRow[] }) {
  if (linhas.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhum gasto da Meta sincronizado neste período.</p>;
  }
  const de = new Map(linhas.map((l) => [l.channel, l]));
  const canais = [...CANAIS_PRINCIPAIS, ...CANAIS_EXTRAS.filter((c) => de.has(c))];
  const total = linhas.reduce((s, l) => s + l.spend, 0);
  const campanhas = linhas.reduce((s, l) => s + l.campanhas, 0);
  return (
    <>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {canais.map((canal) => {
          const l = de.get(canal);
          return (
            <div key={canal} className="rounded-lg border border-border/40 p-3">
              <p className="text-xs font-semibold">{CANAL_META_LABEL[canal]}</p>
              {l ? (
                <>
                  <dl className="mt-1 grid grid-cols-3 gap-2 text-center">
                    <div><dt className="text-xs text-muted-foreground">Gasto</dt><dd className="text-sm font-bold tabular-nums">{brl(l.spend, { cents: true })}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Resultados</dt><dd className="text-sm font-bold tabular-nums">{num(l.resultados)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Custo/resultado</dt><dd className="text-sm font-bold tabular-nums">{brl(l.custo_por_resultado, { cents: true })}</dd></div>
                  </dl>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {RESULTADO_DO_CANAL[canal]} · {num(l.campanhas)} {l.campanhas === 1 ? "campanha" : "campanhas"}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Nenhuma campanha deste canal com gasto no período.</p>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Investido segundo a Meta no período: <b className="text-foreground">{brl(total, { cents: true })}</b>, em{" "}
        {num(campanhas)} {campanhas === 1 ? "campanha" : "campanhas"} — a soma dos canais acima.
      </p>
    </>
  );
}

const pctMeta = (v: number | null) =>
  v === null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

/** Os números da Meta de uma campanha no período, ao expandir a linha. */
function MetaDetalhe({ m, umDia }: { m: MetaMetricaRow; umDia: boolean }) {
  const itens: [string, string][] = [
    ["Investido (Meta, no período)", brl(m.spend, { cents: true })],
    ["Impressões", num(m.impressions)],
    ["Cliques no link", num(m.link_clicks)],
    ["CTR (link)", pctMeta(m.ctr)],
    ["CPC (link)", brl(m.cpc, { cents: true })],
    ["CPM", brl(m.cpm, { cents: true })],
    ["Alcance", num(m.reach)],
    ["Formulário · conversas · pixel", `${num(m.leads_form)} · ${num(m.conversations)} · ${num(m.lp_leads)}`],
  ];
  return (
    <div className="space-y-1">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        {itens.map(([rotulo, valor]) => (
          <div key={rotulo}>
            <dt className="text-muted-foreground">{rotulo}</dt>
            <dd className="tabular-nums">{valor}</dd>
          </div>
        ))}
      </dl>
      {!umDia && (
        <p className="text-muted-foreground">
          Alcance só no período de um dia (escolha &quot;Ontem&quot;): a Meta conta pessoa única por período, e somar
          os dias inventaria número.
        </p>
      )}
    </div>
  );
}

/** Rolagem + foco no elemento, como o envio do diário faz com o campo que
 *  impede o salvamento: sem isso o retorno do clique fica fora da vista, a
 *  600px de distância de quem clicou. */
const irPara = (id: string) => {
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
  el?.focus();
};

export interface CampaignPerformancePanelProps {
  rows: CampaignResult[];
  /** As campanhas ANTES do filtro de canal e status da tela. Serve a duas
   *  coisas que não podem sair de `rows`:
   *    · o vazio — com `rows` vazio e alguma campanha cadastrada, o vazio é do
   *      filtro, e o painel dizia "nenhuma campanha cadastrada" enquanto a
   *      tabela logo abaixo, na mesma dobra, dizia corretamente que era o filtro;
   *    · o casamento do relatório importado — contra a lista filtrada, a
   *      campanha escondida pelo filtro apareceria como "não cadastrada" e o
   *      gasto dela ficaria de fora do CPL sem ninguém ter mexido no cadastro.
   *  Ausente: o painel usa o que recebeu. */
  allRows?: CampaignResult[];
  /** INTEIRA, ativas e inativas: a campanha de construtora desativada precisa
   *  continuar nomeando a construtora dela — filtrar aqui virava travessão numa
   *  tabela e o nome na outra, na mesma dobra. */
  developers: { id: string; name: string; active: boolean }[];
  /** Origens de lead, ativas e inativas — mesma razão da lista de construtoras:
   *  o vínculo antigo com origem desativada precisa continuar aparecendo. */
  leadSources: { id: string; label: string; active: boolean }[];
  loading: boolean;
  /** Mensagem de falha da carga; sem ela a lista vazia mentiria sobre o estado. */
  error?: string | null;
  /** Recarrega a fonte da tela — usado depois de cadastrar e no "Tentar de novo". */
  onReload: () => void;
}

/**
 * Investimento × resultado por campanha — e o cadastro delas.
 *
 * O cruzamento existe porque o `meta-ads-webhook` grava `campaign_id` no lead
 * com o mesmo id externo da campanha. Sem cadastrar a campanha e seu gasto, o
 * lead fica rastreado mas sem custo — dá para contar, não para avaliar.
 *
 * As linhas vêm de quem chama, e não de uma consulta própria: o painel contava
 * leads pelo `select` de `leads` (recortado pelo RLS — para marketing, só a fila
 * e o próprio perfil) enquanto a tabela da mesma tela usava a RPC agregada, que
 * conta a empresa inteira. Dois números da MESMA campanha, lado a lado. A RPC é
 * a fonte correta: conta igual para todo papel e não expõe dado pessoal.
 *
 * O `total_spend` é a soma do livro do gasto, e a coluna Investido diz de onde
 * veio cada linha: digitado no formulário, relatório exportado do Gerenciador
 * (0113, com o PERÍODO que cobre) ou sincronização com a Marketing API (0115).
 * Os números "segundo a Meta" do período — resultado do canal, custo por
 * resultado, CTR, CPC, CPM, alcance — chegam prontos de `meta_metricas` e ficam
 * ROTULADOS como da Meta, ao lado do CPL e do ROAS do CRM, que não mudam de
 * conta nem de lugar: a Meta conta conversa e lead do pixel; o CRM conta o lead
 * que chegou.
 *
 * Na campanha cadastrada à mão, a gestão continua LOCAL (pausar no CRM não toca
 * a Meta, e a tela diz isso). Na sincronizada, nome, status, verba e investido
 * vêm da Meta — o banco os recusa à mão e o formulário os trava —, e pausar,
 * ativar e mudar verba passam por `MetaCampaignActions`, que vai à Meta com
 * confirmação e registro.
 */
export default function CampaignPerformancePanel({ rows, allRows, developers, leadSources, loading, error, onReload }: CampaignPerformancePanelProps) {
  const { toast } = useToast();
  const { isAdmin, roles, previewRole, can } = useAuth();
  const queryClient = useQueryClient();
  const cadastradas = allRows ?? rows;
  const [saving, setSaving] = useState(false);
  const [importando, setImportando] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [alternando, setAlternando] = useState<string | null>(null);
  const [vinculando, setVinculando] = useState<string | null>(null);
  /** Linha com os números da Meta abertos (CTR, CPC, CPM e alcance). */
  const [aberta, setAberta] = useState<string | null>(null);
  /** Período dos números "segundo a Meta". O investido e os leads do CRM, que
   *  são acumulados, não mudam com ele. */
  const [recorte, setRecorte] = useState<PeriodoMeta>("7d");
  const [editing, setEditing] = useState<string | null>(null);
  /** O formulário nasceu de "Copiar": muda o cabeçalho e acende o aviso do ID
   *  externo provisório, que é o único campo que a cópia não pode adivinhar. */
  const [copiando, setCopiando] = useState(false);
  /** Campo que impediu o último Salvar — vira `aria-invalid` e a frase ligada
   *  por `aria-describedby`. O toast sozinho anuncia o problema e some, e o
   *  foco fica no botão Salvar: quem não enxerga o formulário inteiro não
   *  descobre QUAL dos onze campos recusou. */
  const [recusado, setRecusado] = useState<{ campo: CampoDaCampanha; frase: string } | null>(null);
  const [form, setForm] = useState(vazio());

  // Espelha `ad_campaigns_write` (`has_any_role('admin','marketing')`).
  // `reports.view_finance` também vale para diretor, gerente e sócio, que só
  // leem — o formulário aparecia para eles e todo Salvar voltava com 42501.
  const effectiveRoles = previewRole ? [previewRole] : roles;
  const canEdit = isAdmin || effectiveRoles.includes("marketing");
  /** Sincronizar, pausar, ativar e mudar verba na Meta. A trava é o
   *  `has_permission` da edge e do banco (0116); aqui só não se oferece o que
   *  seria recusado. */
  const podeMeta = can("marketing.meta_manage");

  /** A campanha em correção veio da Meta: os campos dela ficam travados. Sai
   *  da lista, e não de um estado paralelo, para não divergir da linha. */
  const emEdicao = editing ? cadastradas.find((c) => c.id === editing) ?? null : null;
  const daMeta = Boolean(emEdicao?.metaAccountId);

  const { from, to } = periodoMeta(recorte);
  const sync = useQuery({ queryKey: ["marketing", "meta", "sync-status"], queryFn: fetchMetaSyncStatus, staleTime: 60_000 });
  const contas = sync.data ?? [];
  // Sem conta de anúncios a Meta não aparece: nem colunas, nem card.
  const temConta = contas.length > 0;
  const metricas = useQuery({
    queryKey: ["marketing", "meta", "metricas", from, to],
    queryFn: () => fetchMetaMetricas(from, to),
    enabled: temConta,
    staleTime: 60_000,
  });
  const porCanal = useQuery({
    queryKey: ["marketing", "meta", "por-canal", from, to],
    queryFn: () => fetchMetaPorCanal(from, to),
    enabled: temConta,
    staleTime: 60_000,
  });
  const metaDe = new Map((metricas.data ?? []).map((m) => [m.campaign_id, m]));
  /** Primeiro dia sincronizado (o mais recente entre as contas): período que
   *  começa antes dele está incompleto, e a tela diz isso em vez de mostrar a
   *  soma menor como se fosse o período inteiro. */
  const coberturaDesde = (metricas.data ?? []).reduce<string | null>(
    (acc, m) => (m.cobertura_desde && (acc === null || m.cobertura_desde > acc) ? m.cobertura_desde : acc),
    null,
  );
  const incompleto = coberturaDesde !== null && from < coberturaDesde;

  const motivoSemSync = !sync.isSuccess
    ? null
    : !contas.some((c) => c.enabled)
      ? "Nenhuma conta de anúncios ligada: quem administra escolhe as contas em Admin › Meta Ads."
      : contas.some((c) => c.ultima?.status === "rodando")
        ? "Já há uma sincronização em andamento."
        : null;

  const sincronizar = useMutation({
    mutationFn: () => sincronizarMeta(),
    onSuccess: (r) => {
      const falhas = r.contas.filter((c) => c.status !== "ok");
      if (falhas.length > 0) {
        toast({
          title: falhas.every((c) => c.status === "em_andamento")
            ? "Já havia uma sincronização em andamento"
            : falhas.length === r.contas.length
              ? "A sincronização falhou"
              : `A sincronização falhou em ${falhas.length} de ${r.contas.length} contas`,
          description: falhas[0].erro ?? "O motivo fica ao lado de cada conta.",
          variant: "destructive",
        });
        return;
      }
      const conflitos = r.contas.flatMap((c) => c.conflitos ?? []);
      toast({
        title: "Sincronizado com a Meta",
        description: conflitos.length > 0
          ? `${num(conflitos.length)} ${conflitos.length === 1 ? "campanha ficou" : "campanhas ficaram"} de fora: ${conflitos[0]}`
          : "Gasto, verba, status e resultados atualizados.",
      });
    },
    onError: (e) => toast({ title: "A sincronização não rodou", description: e.message, variant: "destructive" }),
    // Em qualquer desfecho a execução ficou registrada ('ok' ou 'falhou', com a
    // frase) e o livro pode ter mudado: tudo de /marketing relê.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["marketing"] }),
  });

  const developerName = (id: string | null) => developers.find((d) => d.id === id)?.name ?? "—";

  /** Campo que vem da Meta, na campanha sincronizada: travado, com a frase do
   *  motivo ligada a ele. Nos demais casos, `aria-invalid` + a frase da recusa:
   *  o toast some, e sem isto o operador de teclado ficava com o foco no Salvar
   *  e nenhum campo marcado. */
  const atributosDe = (campo: CampoDaCampanha) =>
    daMeta && CAMPOS_DA_META.has(campo)
      ? { disabled: true, "aria-describedby": DA_META_ID }
      : recusado?.campo === campo ? { "aria-invalid": true, "aria-describedby": ERRO_ID } : {};

  /** Status gravado fora do catálogo da operação (ARCHIVED e afins, que o CHECK
   *  do banco aceita): vira um item próprio no Select, senão o gatilho fica em
   *  branco e o Editar apaga o valor que ninguém pediu para mudar. */
  const statusForaDoCatalogo =
    form.status !== SEM_STATUS && !(AD_STATUSES as readonly string[]).includes(form.status)
      ? form.status
      : null;

  /** Ativas + a que está vinculada à campanha em correção: não se cria vínculo
   *  novo com construtora desativada, mas o vínculo antigo precisa aparecer no
   *  gatilho — sem ela na lista, o Radix renderiza vazio e o operador perde o
   *  vínculo só de tocar no campo. Mesmo desenho do popup de aportes. */
  const opcoes = developers.filter((d) => d.active || d.id === form.developerId);
  const origens = leadSources.filter((s) => s.active || s.id === form.leadSourceId);
  const sourceName = (id: string | null) => leadSources.find((s) => s.id === id)?.label ?? null;

  const startEdit = (row: CampaignResult) => {
    setEditing(row.id);
    setCopiando(false);
    setRecusado(null);
    setForm(formDe(row));
    // O formulário fica ACIMA da tabela: sem levar a vista e o foco até ele, o
    // clique em Editar não muda nada dentro do campo de visão de quem clicou.
    irPara(CAMPO_ID.externalId);
  };

  /**
   * "Copiar campanha": a mesma verba, o mesmo período e o mesmo vínculo, com
   * nome e ID externo novos — é a redigitação que hoje é a fonte de erro.
   *
   * Nasce PAUSADA e passa pelo formulário em vez de gravar direto: o ID externo
   * é o único campo que a cópia não pode adivinhar (a campanha nova ainda não
   * existe na plataforma), e um id provisório gravado em silêncio produziria
   * uma linha que nunca casa com lead nenhum e soma no KPI de investimento.
   * Pelo formulário, o Salvar é o mesmo `createAdCampaign` — insert-only, com o
   * unique global de `external_id` (0067) valendo.
   */
  const startCopy = (row: CampaignResult) => {
    setEditing(null);
    setCopiando(true);
    setRecusado(null);
    setForm({
      ...formDe(row),
      name: `${row.name} (cópia)`,
      // Sufixo aleatório porque copiar duas vezes a mesma campanha colidiria
      // no unique — e a recusa cairia num rascunho que o operador ia refazer.
      externalId: `${row.externalId}-copia-${crypto.randomUUID().slice(0, 4)}`,
      status: "PAUSED",
      // Gasto é histórico da campanha copiada: herdar seria inventar gasto que
      // a cópia não teve, no número que divide o CPL e o ROAS.
      spend: "0",
    });
    irPara(CAMPO_ID.externalId);
  };

  const cancelEdit = () => {
    setEditing(null);
    setCopiando(false);
    setRecusado(null);
    setForm(vazio());
  };

  const add = async () => {
    const payload: AdCampaignInput = {
      externalId: form.externalId.trim(),
      platform: form.platform,
      name: form.name.trim(),
      developerId: form.developerId === SEM_CONSTRUTORA ? null : form.developerId,
      leadSourceId: form.leadSourceId === SEM_ORIGEM ? null : form.leadSourceId,
      status: form.status === SEM_STATUS ? null : form.status,
      dailyBudget: verba(form.budget),
      lifetimeBudget: verba(form.lifetime),
      startsOn: form.startsOn || null,
      endsOn: form.endsOn || null,
      totalSpend: form.spend.trim() === "" ? 0 : Number(form.spend),
      // Na sincronizada, `updateAdCampaign` deixa de fora o que vem da Meta.
      metaAccountId: emEdicao?.metaAccountId ?? null,
    };
    // A MESMA recusa que `createAdCampaign`/`updateAdCampaign` aplicam antes do
    // round-trip: aqui ela só chega antes, sem uma segunda regra para manter.
    const problema = problemaNaCampanha(payload);
    if (problema) {
      // Toast E campo: a frase por si só não diz onde ela caiu num formulário
      // de onze campos que pode estar fora da vista na hora do clique.
      setRecusado(problema);
      toast({ title: "Campanha não salva", description: problema.frase, variant: "destructive" });
      irPara(CAMPO_ID[problema.campo]);
      return;
    }
    setRecusado(null);
    setSaving(true);
    try {
      // Cadastro NUNCA sobrescreve: `createAdCampaign` insere e o unique global
      // de `external_id` (0067) devolve a recusa. A conferência não pode ser
      // feita aqui contra `rows`, que chega FILTRADO por canal e status — a
      // campanha escondida pelo filtro passaria pela guarda.
      if (editing) await updateAdCampaign(editing, payload);
      else await createAdCampaign(payload);
      // A cópia NASCE pausada, mas o status é editável no rascunho: afirmar
      // "nasceu pausada" depois de o operador ter escolhido Ativa seria dizer
      // um fato que o sistema não conferiu.
      const eraCopia = copiando;
      const nasceuPausada = eraCopia && payload.status === "PAUSED";
      cancelEdit();
      onReload();
      toast({
        title: editing ? "Campanha atualizada" : eraCopia ? "Cópia registrada" : "Campanha registrada",
        ...(nasceuPausada
          ? { description: "Nasceu pausada: confira a verba e o período antes de ativar." }
          : eraCopia
            ? { description: "Registrada já ativa: ela entra na conta de investimento a partir de agora." }
            : {}),
      });
    } catch (e) {
      toast({
        title: "Não foi possível salvar",
        description: describeError(e, e instanceof Error ? e.message : "Não foi possível registrar a campanha."),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  /**
   * Pausar/reativar em um clique — o gesto que a ata pede.
   *
   * Grava só `status`; reabrir o formulário inteiro para trocar um estado leva
   * junto qualquer campo que a tela tenha carregado torto. A campanha sem
   * status conhecido (`null`) entra como Ativa, que é o único destino que faz
   * sentido para quem clica em "Ativar".
   */
  const alternarStatus = async (row: CampaignResult) => {
    const proximo = row.rawStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setAlternando(row.id);
    try {
      await setAdCampaignStatus(row.id, proximo);
      if (editing === row.id) setForm((p) => ({ ...p, status: proximo }));
      onReload();
      toast({
        title: proximo === "PAUSED" ? "Campanha pausada no CRM" : "Campanha reativada no CRM",
        // Sem esta frase, pausar aqui passa por ter pausado o gasto na Meta.
        description: "Registro local: a Meta não é alterada por aqui.",
      });
    } catch (e) {
      toast({
        title: "Não foi possível alterar o status",
        description: describeError(e, e instanceof Error ? e.message : "Não foi possível alterar o status."),
        variant: "destructive",
      });
    } finally {
      setAlternando(null);
    }
  };

  /** Aceita a construtora que a sincronização sugeriu pelo nome (F0). Grava só
   *  `developer_id`: o resto da campanha sincronizada é da Meta. */
  const vincular = async (row: CampaignResult, construtora: { id: string; name: string }) => {
    setVinculando(row.id);
    try {
      await vincularConstrutora(row.id, construtora.id);
      onReload();
      toast({ title: "Construtora vinculada", description: `${row.name} → ${construtora.name}` });
    } catch (e) {
      toast({
        title: "Não foi possível vincular",
        description: describeError(e, e instanceof Error ? e.message : "Não foi possível vincular a construtora."),
        variant: "destructive",
      });
    } finally {
      setVinculando(null);
    }
  };

  const remove = async (row: CampaignResult) => {
    if (!confirm(`Excluir a campanha "${row.name}"? Os leads dela continuam no CRM, mas ficam sem custo.`)) return;
    setRemoving(row.id);
    try {
      await deleteAdCampaign(row.id);
      if (editing === row.id) cancelEdit();
      onReload();
      toast({ title: "Campanha excluída" });
    } catch (e) {
      toast({
        title: "Não foi possível excluir",
        description: describeError(e, e instanceof Error ? e.message : "Não foi possível excluir a campanha."),
        variant: "destructive",
      });
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-primary" /> Investimento × resultado por campanha
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {canEdit && (
          <div className="space-y-2 rounded-lg border border-border/40 bg-secondary/20 p-3">
            <p className="text-xs font-semibold">
              {editing ? "Corrigir campanha" : copiando ? "Cópia de campanha (rascunho)" : "Cadastrar campanha"}
            </p>
            {copiando && (
              <p role="status" className="text-xs text-warning">
                Verba, período e vínculos vieram da campanha copiada. O ID externo abaixo é provisório: troque pelo id
                real da campanha nova na plataforma, senão nenhum lead casa com ela. O rascunho nasce Pausado.
              </p>
            )}
            {daMeta && (
              <p id={DA_META_ID} role="status" className="text-xs text-muted-foreground">
                Campanha sincronizada: ID externo, nome, plataforma, status, verba e investido vêm da Meta e não se editam
                aqui — pausar, ativar e mudar verba ficam nos botões da linha, que vão à Meta com confirmação. O vínculo
                com construtora, origem e período de veiculação continua editável.
              </p>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {/* Rótulo VISÍVEL em todo campo, como no popup de aportes: com
                  `aria-label` sozinho, os dois `<input type=date>` viravam duas
                  caixas "dd/mm/aaaa" idênticas e, na edição, os três campos de
                  dinheiro perdiam o placeholder assim que carregavam o valor —
                  três números soltos, sem dizer qual é gasto, qual é teto
                  diário e qual é verba contratada. */}
              <div className="space-y-1">
                <Label htmlFor={CAMPO_ID.externalId} className="text-xs">ID externo da campanha</Label>
                <Input
                  id={CAMPO_ID.externalId}
                  placeholder="ID da campanha na plataforma"
                  value={form.externalId}
                  onChange={(e) => setForm((p) => ({ ...p, externalId: e.target.value }))}
                  className="h-8 text-xs"
                  {...atributosDe("externalId")}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={CAMPO_ID.name} className="text-xs">Nome da campanha</Label>
                <Input
                  id={CAMPO_ID.name}
                  placeholder="Nome"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className="h-8 text-xs"
                  {...atributosDe("name")}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="campanha-plataforma" className="text-xs">Plataforma da campanha</Label>
                <Select value={form.platform} onValueChange={(v) => setForm((p) => ({ ...p, platform: v as AdPlatform }))}>
                  <SelectTrigger
                    id="campanha-plataforma"
                    className="h-8 text-xs"
                    aria-label="Plataforma da campanha"
                    disabled={daMeta}
                    aria-describedby={daMeta ? DA_META_ID : undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AD_PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>{AD_PLATFORM_LABEL[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="campanha-construtora" className="text-xs">Construtora da campanha</Label>
                <Select value={form.developerId} onValueChange={(v) => setForm((p) => ({ ...p, developerId: v }))}>
                  <SelectTrigger id="campanha-construtora" className="h-8 text-xs" aria-label="Construtora da campanha"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_CONSTRUTORA}>Sem construtora</SelectItem>
                    {opcoes.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.active ? d.name : `${d.name} (inativa)`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* O vínculo é REGISTRO, e a tela precisa dizer isso: quem roteia
                  o lead é `lead_sources`, pelo `form_id`/`utm_source` que a
                  própria origem cadastra — o `meta-ads-webhook` não lê esta
                  coluna. Sem a ressalva, o campo passa por chave de roteamento
                  e alguém espera que trocá-lo mude o agente de SDR do lead. */}
              <div className="space-y-1">
                <Label htmlFor="campanha-origem" className="text-xs">Origem de lead da campanha</Label>
                <Select value={form.leadSourceId} onValueChange={(v) => setForm((p) => ({ ...p, leadSourceId: v }))}>
                  <SelectTrigger id="campanha-origem" className="h-8 text-xs" aria-label="Origem de lead da campanha"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_ORIGEM}>Sem origem de lead</SelectItem>
                    {origens.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.active ? s.label : `${s.label} (inativa)`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={CAMPO_ID.status} className="text-xs">Status da campanha</Label>
                <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}>
                  <SelectTrigger id={CAMPO_ID.status} className="h-8 text-xs" aria-label="Status da campanha" {...atributosDe("status")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {/* Do MESMO `AD_STATUSES` que a validação cobra: um estado a
                        mais no catálogo não pode aparecer aqui sem ser aceito lá. */}
                    {AD_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{adStatusLabel(s)}</SelectItem>
                    ))}
                    {/* O CHECK do banco aceita qualquer MAIÚSCULA (0084), para a
                        sincronização futura poder gravar ARCHIVED. Sem este item
                        o gatilho renderizava VAZIO nessa linha, e o operador que
                        abrisse o Editar para corrigir a verba perdia o status. */}
                    {statusForaDoCatalogo && (
                      <SelectItem value={statusForaDoCatalogo}>{statusForaDoCatalogo}</SelectItem>
                    )}
                    <SelectItem value={SEM_STATUS}>Sem status</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={CAMPO_ID.totalSpend} className="text-xs">Total investido (R$)</Label>
                <Input
                  id={CAMPO_ID.totalSpend}
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0,00"
                  value={form.spend}
                  onChange={(e) => setForm((p) => ({ ...p, spend: e.target.value }))}
                  className="h-8 text-xs"
                  {...atributosDe("totalSpend")}
                />
              </div>
              {/* `daily_budget` já era lido e aceito pela camada de dados, e
                  nenhuma tela o preenchia: a coluna existia sempre nula. É o
                  teto que a plataforma cobra por dia, não o acumulado. */}
              <div className="space-y-1">
                <Label htmlFor={CAMPO_ID.dailyBudget} className="text-xs">Orçamento diário (R$)</Label>
                <Input
                  id={CAMPO_ID.dailyBudget}
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="teto por dia"
                  value={form.budget}
                  onChange={(e) => setForm((p) => ({ ...p, budget: e.target.value }))}
                  className="h-8 text-xs"
                  {...atributosDe("dailyBudget")}
                />
              </div>
              {/* Verba CONTRATADA, não gasto: com o investido ao lado, a linha
                  responde "quanto ainda posso gastar" — que é a pergunta que
                  antecede pausar. */}
              <div className="space-y-1">
                <Label htmlFor={CAMPO_ID.lifetimeBudget} className="text-xs">Verba total (R$)</Label>
                <Input
                  id={CAMPO_ID.lifetimeBudget}
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="verba contratada"
                  value={form.lifetime}
                  onChange={(e) => setForm((p) => ({ ...p, lifetime: e.target.value }))}
                  className="h-8 text-xs"
                  {...atributosDe("lifetimeBudget")}
                />
              </div>
              {/* `<input type=date>` nativo: o próprio navegador dá teclado,
                  calendário e formato local, e o valor já sai `YYYY-MM-DD`,
                  que é o que a coluna `date` espera. */}
              <div className="space-y-1">
                <Label htmlFor="campanha-inicio" className="text-xs">Início da veiculação</Label>
                <Input
                  id="campanha-inicio"
                  type="date"
                  value={form.startsOn}
                  onChange={(e) => setForm((p) => ({ ...p, startsOn: e.target.value }))}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={CAMPO_ID.endsOn} className="text-xs">Fim da veiculação</Label>
                <Input
                  id={CAMPO_ID.endsOn}
                  type="date"
                  value={form.endsOn}
                  onChange={(e) => setForm((p) => ({ ...p, endsOn: e.target.value }))}
                  className="h-8 text-xs"
                  {...atributosDe("endsOn")}
                />
              </div>
            </div>
            {/* A frase da recusa também FICA na tela, ligada ao campo por
                `aria-describedby`: o toast anuncia e some, e quem usa leitor de
                tela ficava com o foco no botão Salvar, sem ligação com o campo. */}
            {recusado && (
              <p id={ERRO_ID} role="alert" className="text-xs text-destructive">
                {recusado.frase}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Sem a frase do registro local, mudar o status para "Pausada"
                  numa campanha cadastrada à mão passa por ter pausado a
                  campanha na Meta — e o dinheiro continua saindo. Na
                  sincronizada, esses campos nem se editam aqui. */}
              <p className="text-xs text-muted-foreground">
                O ID externo tem de ser o mesmo que a plataforma envia no webhook — é ele que liga o lead à campanha.
                Na campanha cadastrada à mão, status, verba, período, origem e investido são o registro local, todos
                digitados: mudar aqui não pausa nem altera nada na Meta. Na sincronizada, nome, status, verba e
                investido vêm da Meta. O vínculo com a origem é só cadastro — quem roteia o lead para a IA ou para a
                roleta é o próprio cadastro da origem, pelo formulário ou pelo utm que ela declara.
              </p>
              <div className="flex gap-2">
                {/* Também no rascunho de cópia: `startCopy` deixa `editing`
                    nulo, e quem clicasse em Copiar na linha errada ficava com
                    onze campos preenchidos pela máquina e nenhuma saída — a
                    campanha seguinte nasceria com a verba e o período de outra. */}
                {(editing || copiando) && (
                  <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-8 text-xs gap-1">
                    <X className="h-4 w-4" /> Cancelar
                  </Button>
                )}
                <Button size="sm" onClick={add} disabled={saving} className="h-8 text-xs gap-1">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Salvar
                </Button>
              </div>
            </div>
          </div>
        )}

        {(canEdit || podeMeta) && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
            {/* O plano B: o relatório que o gestor exporta traz o mesmo gasto da
                Marketing API, e vale justamente quando a sincronização quebrou. */}
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setImportando(true)} className="h-8 text-xs gap-1">
                <Upload className="h-4 w-4" /> Importar relatório da Meta
              </Button>
            )}
            {/* Era o "Sincronizar sozinho" desligado: com o token e as contas no
                FACEIMOB, ele chama a meta-sync no modo manual. Sem conta ligada ou
                com uma execução rodando, fica desligado e diz por quê — botão que
                erra em silêncio é pior. */}
            {podeMeta && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => sincronizar.mutate()}
                disabled={!sync.isSuccess || motivoSemSync !== null || sincronizar.isPending}
                aria-describedby={motivoSemSync ? SYNC_MOTIVO_ID : undefined}
                className="h-8 text-xs gap-1"
              >
                {sincronizar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {sincronizar.isPending ? "Sincronizando…" : "Sincronizar agora"}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              O <b>gasto</b> vem da sincronização com a Meta, todo dia às 06:00 e pelo botão ao lado, ou do relatório
              exportado do Gerenciador de Anúncios (CSV/XLSX), que continua valendo como plano B: um recorte importado
              substitui os dias sincronizados que ele cobre, e reimportar o mesmo arquivo não soma duas vezes. A coluna
              Investido diz de onde veio cada número. Nas campanhas sincronizadas, pausar, ativar e mudar verba vão
              para a Meta, com confirmação; nas cadastradas à mão, continuam registro local.
            </p>
            {podeMeta && motivoSemSync && (
              <p id={SYNC_MOTIVO_ID} className="text-xs text-warning">{motivoSemSync}</p>
            )}
          </div>
        )}

        {/* O casamento é contra as campanhas que a tela JÁ carregou — sem uma
            segunda consulta — e contra a lista SEM filtro: a campanha escondida
            pelo filtro de canal apareceria como "não cadastrada" e o gasto dela
            ficaria fora do CPL sem ninguém ter mexido no cadastro. */}
        {canEdit && importando && (
          <MetaReportImportDialog
            campanhas={cadastradas}
            onClose={() => setImportando(false)}
            onImported={onReload}
          />
        )}

        {/* A situação de cada conta fica à vista de quem lê os números: falha
            aparece como falha, com a data e a última boa, e os números abaixo
            continuam os da última sincronização boa — nunca zerados. */}
        {sync.isError ? (
          <p role="status" className="text-xs text-destructive">
            {describeError(sync.error, "Não consegui ler a situação da sincronização com a Meta.")}
          </p>
        ) : (
          contas.some((c) => c.enabled) && (
            <ul aria-label="Sincronização com a Meta" className="space-y-1 text-xs">
              {contas.filter((c) => c.enabled).map((c) => {
                const s = situacaoDaConta(c);
                return (
                  <li key={c.id} className={s.falhou ? "text-destructive" : "text-muted-foreground"}>
                    <span className="font-medium text-foreground">{c.name ?? c.act_id}:</span> {s.texto}
                  </li>
                );
              })}
            </ul>
          )
        )}

        {temConta && (
          <section aria-labelledby="meta-por-canal-titulo" className="space-y-2 rounded-lg border border-border/40 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 id="meta-por-canal-titulo" className="text-xs font-semibold">Resultado por canal — segundo a Meta</h3>
              <Select value={recorte} onValueChange={(v) => setRecorte(v as PeriodoMeta)}>
                <SelectTrigger className="h-8 w-48 text-xs" aria-label="Período dos números da Meta"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODOS_META.map((p) => (
                    <SelectItem key={p} value={p}>{PERIODO_META_LABEL[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {from === to ? date(from) : `${date(from)} a ${date(to)}`} · custo por resultado = gasto das campanhas do
              canal ÷ resultados delas, contados pela Meta. As colunas (Meta) da tabela seguem este período; o CPL e o
              ROAS continuam os do CRM, acumulados.
            </p>
            {incompleto && coberturaDesde && (
              <p role="status" className="text-xs text-warning">
                Dados da Meta completos só desde {date(coberturaDesde)}: o período escolhido começa antes da primeira
                sincronização, então pode estar incompleto.
              </p>
            )}
            {porCanal.isPending ? (
              <LoadingState variant="list" rows={1} label="Carregando os números da Meta…" />
            ) : porCanal.isError ? (
              <p role="status" className="text-xs text-destructive">
                {describeError(porCanal.error, "Não consegui ler os números da Meta.")}
              </p>
            ) : (
              <MetaPorCanal linhas={porCanal.data} />
            )}
          </section>
        )}

        {loading ? (
          <LoadingState variant="table" rows={3} label="Carregando o desempenho das campanhas…" />
        ) : error ? (
          <EmptyState
            icon={AlertTriangle}
            tone="danger"
            title="Não consegui carregar as campanhas"
            description={error}
            action={<Button variant="outline" onClick={onReload}>Tentar de novo</Button>}
          />
        ) : rows.length === 0 ? (
          cadastradas.length > 0 ? (
            <EmptyState
              icon={Megaphone}
              title="Nenhuma campanha neste filtro"
              description={`Volte para "Todos canais" e "Todos status" para ver as ${num(cadastradas.length)} cadastradas.`}
            />
          ) : (
            <EmptyState
              icon={Megaphone}
              title="Nenhuma campanha cadastrada"
              description="Cadastre a primeira aqui, com o mesmo ID externo que a plataforma envia no webhook — é ele que liga o lead à campanha."
            />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40 text-muted-foreground">
                  <th className="p-2 text-left font-medium">Campanha</th>
                  <th className="p-2 text-right font-medium">Investido</th>
                  <th className="p-2 text-right font-medium">Leads</th>
                  <th className="p-2 text-right font-medium">Conversões</th>
                  <th className="p-2 text-right font-medium">Custo/lead</th>
                  {/* Negócio, não venda: `conversions` é lead com
                      `converted_deal_id` — proposta em aberto conta aqui e
                      venda perdida também. Venda é `outcome = 'won'`, que é o
                      que a aba "Por construtora" chama de Vendas. */}
                  <th className="p-2 text-right font-medium">Custo/negócio</th>
                  {/* A coluna que faltava: quem lia "custo/negócio R$ 1.200"
                      entendia "paguei 1.200 por uma venda" e podia não ter
                      vendido nada. `sales` vem da mesma RPC (0081). */}
                  <th className="p-2 text-right font-medium">Custo/venda</th>
                  <th className="p-2 text-right font-medium">VGV atribuído</th>
                  <th className="p-2 text-right font-medium">ROAS</th>
                  {/* Depois do ROAS, e não entre as colunas do CRM: o CPL e o
                      ROAS não mudam de lugar, e os números da Meta ficam
                      rotulados como da Meta, no período escolhido acima. */}
                  {temConta && (
                    <>
                      <th className="p-2 text-left font-medium">Canal (Meta)</th>
                      <th className="p-2 text-right font-medium">Resultado (Meta)</th>
                      <th className="p-2 text-right font-medium">Custo/resultado (Meta)</th>
                    </>
                  )}
                  {(canEdit || podeMeta) && <th className="p-2 text-right font-medium">Ações</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const retorno = roas(r.revenue, r.spend);
                  const ativa = r.rawStatus === "ACTIVE";
                  const origem = sourceName(r.leadSourceId);
                  // Sem período lançado não se inventa "desde sempre": a
                  // ausência da linha é a resposta honesta.
                  const periodo = r.startsOn || r.endsOn
                    ? `${r.startsOn ? date(r.startsOn) : "sem início"} → ${r.endsOn ? date(r.endsOn) : "sem fim"}`
                    : null;
                  const sincronizada = r.metaAccountId !== null;
                  const mm = metaDe.get(r.id);
                  const detalheId = `meta-detalhe-${r.id}`;
                  const expandida = aberta === r.id;
                  // A sugestão vale só enquanto ninguém vinculou: o vínculo é decisão humana.
                  const sugerida = !r.developerId && r.developerSuggestedId
                    ? developers.find((d) => d.id === r.developerSuggestedId) ?? null
                    : null;
                  return (
                    <Fragment key={r.id}>
                    <tr className="border-b border-border/10">
                      <td className="p-2 font-medium">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {r.name}
                          {/* O status vive aqui porque é daqui que ele é
                              trocado: pausar sem ver o estado atual é chute. */}
                          <StatusBadge tone={ativa ? "success" : r.rawStatus ? "warning" : "neutral"}>
                            {adStatusLabel(r.rawStatus)}
                          </StatusBadge>
                          {/* Configurada ativa não quer dizer entregando: a Meta
                              diz CAMPAIGN_PAUSED, WITH_ISSUES e afins. */}
                          {r.metaEffectiveStatus && r.metaEffectiveStatus !== r.rawStatus && (
                            <StatusBadge tone="info">na Meta: {adStatusLabel(r.metaEffectiveStatus)}</StatusBadge>
                          )}
                        </span>
                        <span className="block text-muted-foreground">
                          {developerName(r.developerId)}
                          {origem && ` · ${origem}`}
                        </span>
                        {periodo && <span className="block font-normal text-muted-foreground">{periodo}</span>}
                        {sugerida && (
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 font-normal">
                            <StatusBadge tone="info">Sugerido pelo nome: {sugerida.name}</StatusBadge>
                            {canEdit && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 px-2 text-xs"
                                aria-label={`Vincular ${r.name} a ${sugerida.name}`}
                                disabled={vinculando === r.id}
                                onClick={() => void vincular(r, sugerida)}
                              >
                                {vinculando === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                                Vincular
                              </Button>
                            )}
                          </span>
                        )}
                        {mm && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mt-1 h-7 gap-1 px-1 text-xs font-normal"
                            aria-expanded={expandida}
                            aria-controls={detalheId}
                            onClick={() => setAberta(expandida ? null : r.id)}
                          >
                            {expandida ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            CTR, CPC, CPM e alcance
                          </Button>
                        )}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {brl(r.spend, { cents: true })}
                        {/* A idade do número que divide TODAS as contas da linha.
                            Sem isto não havia como saber se o gasto é de ontem
                            ou de julho — e o ROAS herda essa incerteza. */}
                        {/* De `origemDoGasto`, e não escrita aqui: a mesma frase
                            aparece na tabela de baixo, e escrita nos dois
                            lugares ela divergiu — esta dizia "digitado" e a
                            outra, "sincronizado", para a MESMA linha. */}
                        <span className="block font-normal text-muted-foreground">
                          {origemDoGasto(r.syncedAt, r.spendPeriodStart, r.spendPeriodEnd, r.spendSource)}
                          {r.dailyBudget !== null && ` · ${brl(r.dailyBudget)}/dia`}
                          {/* Verba contratada ao lado do gasto: a diferença é o
                              que ainda dá para gastar, e é ela que justifica
                              pausar. */}
                          {r.lifetimeBudget !== null && ` · verba ${brl(r.lifetimeBudget)}`}
                        </span>
                      </td>
                      <td className="p-2 text-right tabular-nums">{num(r.leads)}</td>
                      <td className="p-2 text-right tabular-nums">{num(r.conversions)}</td>
                      {/* Divisão por zero vira travessão: "R$ 0,00 por lead" mentiria
                          sobre campanha que ainda não recebeu lead nenhum. */}
                      <td className="p-2 text-right tabular-nums">{brl(costPerLead(r.spend, r.leads), { cents: true })}</td>
                      <td className="p-2 text-right tabular-nums">{brl(costPerLead(r.spend, r.conversions), { cents: true })}</td>
                      {/* Mesma conta, denominador diferente: negócio GANHO. Sem
                          venda o travessão é a resposta certa — a campanha ainda
                          não tem custo por venda, e zero seria mentira. */}
                      <td className="p-2 text-right tabular-nums">{brl(costPerLead(r.spend, r.sales), { cents: true })}</td>
                      <td className="p-2 text-right tabular-nums">{r.revenue > 0 ? brl(r.revenue) : "—"}</td>
                      {/* ROAS = VGV ganho ÷ gasto. Sem gasto não há retorno a
                          medir; sem venda, o zero é informação verdadeira. */}
                      <td className="p-2 text-right tabular-nums font-semibold">{roasLabel(retorno)}</td>
                      {temConta && (
                        <>
                          <td className="p-2 text-left">{r.metaChannel ? CANAL_META_LABEL[r.metaChannel] : "—"}</td>
                          {/* Sem linha no período é travessão, e não zero: a
                              campanha pode não ter entregado ou o dia não ter sido
                              sincronizado — o aviso de cobertura diz qual. */}
                          <td className="p-2 text-right tabular-nums">{mm ? num(mm.resultados) : "—"}</td>
                          <td className="p-2 text-right tabular-nums">{mm ? brl(mm.custo_por_resultado, { cents: true }) : "—"}</td>
                        </>
                      )}
                      {(canEdit || podeMeta) && (
                        <td className="p-2 text-right">
                          <div className="flex flex-col items-end gap-1">
                            {/* Na sincronizada, pausar, ativar e mudar verba vão
                                à Meta, com confirmação e registro. O pausar
                                local ali levaria 42501 do gatilho da 0115 — e,
                                se passasse, seria status inventado. */}
                            {sincronizada && (
                              <MetaCampaignActions
                                campaign={{
                                  id: r.id,
                                  name: r.name,
                                  status: r.rawStatus,
                                  dailyBudget: r.dailyBudget,
                                  metaAccountId: r.metaAccountId,
                                  metaBudgetLevel: r.metaBudgetLevel,
                                }}
                                onDone={onReload}
                              />
                            )}
                            {canEdit && (
                              <div className="flex whitespace-nowrap">
                                {/* Um clique, sem formulário: é o gesto que a ata
                                    pede. O rótulo diz "no CRM" porque a Meta não é
                                    tocada — o botão não pode sugerir o contrário. */}
                                {!sincronizada && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    aria-label={ativa ? `Pausar ${r.name} no CRM` : `Ativar ${r.name} no CRM`}
                                    disabled={alternando === r.id}
                                    onClick={() => void alternarStatus(r)}
                                  >
                                    {alternando === r.id
                                      ? <Loader2 className="h-4 w-4 animate-spin" />
                                      : ativa
                                        ? <Pause className="h-4 w-4 text-warning" />
                                        : <Play className="h-4 w-4 text-success" />}
                                  </Button>
                                )}
                                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Copiar ${r.name}`} onClick={() => startCopy(r)}>
                                  <Copy className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Editar ${r.name}`} onClick={() => startEdit(r)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  aria-label={`Excluir ${r.name}`}
                                  disabled={removing === r.id}
                                  onClick={() => void remove(r)}
                                >
                                  {removing === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                                </Button>
                              </div>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                    {/* Sempre no DOM quando há número, escondida pelo `hidden`:
                        o `aria-controls` do botão aponta para algo que existe. */}
                    {mm && (
                      <tr id={detalheId} hidden={!expandida} className="border-b border-border/10 bg-muted/20">
                        <td colSpan={9 + (temConta ? 3 : 0) + (canEdit || podeMeta ? 1 : 0)} className="p-2 text-xs">
                          <MetaDetalhe m={mm} umDia={from === to} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
