import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Copy, Loader2, Megaphone, Pause, Pencil, Play, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { MetaReportImportDialog } from "@/components/marketing/MetaReportImportDialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  AD_PLATFORMS,
  AD_PLATFORM_LABEL,
  AD_STATUSES,
  adStatusLabel,
  costPerLead,
  createAdCampaign,
  deleteAdCampaign,
  origemDoGasto,
  problemaNaCampanha,
  roas,
  roasLabel,
  setAdCampaignStatus,
  updateAdCampaign,
  type AdCampaignInput,
  type AdPlatform,
  type CampoDaCampanha,
} from "@/integrations/supabase/analytics";
import { brl, date, num } from "@/lib/format";
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
 * O `total_spend` tem duas origens, e a coluna Investido diz qual é a de cada
 * linha: digitado no formulário, ou vindo do relatório exportado do Gerenciador
 * de Anúncios (0113) — que carrega o PERÍODO que ele cobre. Sincronizar sozinho
 * continua fora: exige token da Marketing API com escopo `ads_read`, que o cofre
 * não tem, e o botão segue desabilitado com o motivo escrito porque um botão que
 * erra em silêncio é pior.
 *
 * A gestão que este painel entrega — cadastrar, corrigir, pausar/reativar,
 * copiar, lançar verba e período — é toda LOCAL, pelo mesmo motivo: alterar
 * campanha na Meta exigiria o escopo `ads_management` e revisão do app. O que
 * a tela pode fazer é não mentir sobre isso, e por isso cada superfície de
 * escrita repete de onde o número vem.
 */
export default function CampaignPerformancePanel({ rows, allRows, developers, leadSources, loading, error, onReload }: CampaignPerformancePanelProps) {
  const { toast } = useToast();
  const { isAdmin, roles, previewRole } = useAuth();
  const cadastradas = allRows ?? rows;
  const [saving, setSaving] = useState(false);
  const [importando, setImportando] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [alternando, setAlternando] = useState<string | null>(null);
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

  const developerName = (id: string | null) => developers.find((d) => d.id === id)?.name ?? "—";

  /** `aria-invalid` + a frase ligada ao campo recusado: o toast some, e sem
   *  isto o operador de teclado ficava com o foco no Salvar e nenhum campo
   *  marcado. */
  const erroDe = (campo: CampoDaCampanha) =>
    recusado?.campo === campo ? { "aria-invalid": true, "aria-describedby": ERRO_ID } : {};

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
                  {...erroDe("externalId")}
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
                  {...erroDe("name")}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="campanha-plataforma" className="text-xs">Plataforma da campanha</Label>
                <Select value={form.platform} onValueChange={(v) => setForm((p) => ({ ...p, platform: v as AdPlatform }))}>
                  <SelectTrigger id="campanha-plataforma" className="h-8 text-xs" aria-label="Plataforma da campanha"><SelectValue /></SelectTrigger>
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
                  <SelectTrigger id={CAMPO_ID.status} className="h-8 text-xs" aria-label="Status da campanha" {...erroDe("status")}><SelectValue /></SelectTrigger>
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
                  {...erroDe("totalSpend")}
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
                  {...erroDe("dailyBudget")}
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
                  {...erroDe("lifetimeBudget")}
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
                  {...erroDe("endsOn")}
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
              {/* Sem essa segunda frase, mudar o status para "Pausada" aqui
                  passa por ter pausado a campanha na Meta — e o dinheiro
                  continua saindo. O registro é local enquanto não houver token
                  com escopo `ads_management`. */}
              <p className="text-xs text-muted-foreground">
                O ID externo tem de ser o mesmo que a plataforma envia no webhook — é ele que liga o lead à campanha.
                Status, verba, período, origem e investido são o registro local, todos digitados: mudar aqui não pausa
                nem altera nada na Meta, e o vínculo com a origem é só cadastro — quem roteia o lead para a IA ou para
                a roleta é o próprio cadastro da origem, pelo formulário ou pelo utm que ela declara.
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

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
            {/* O caminho que EXISTE: o relatório que o gestor exporta traz o
                mesmo gasto da Marketing API e não depende de app revisado. */}
            <Button size="sm" variant="outline" onClick={() => setImportando(true)} className="h-8 text-xs gap-1">
              <Upload className="h-4 w-4" /> Importar relatório da Meta
            </Button>
            {/* Continua desabilitado e com o motivo escrito: a sincronização
                automática é outra coisa, e um botão que erra em silêncio é pior. */}
            <Button size="sm" variant="outline" disabled className="h-8 text-xs gap-1">
              <RefreshCw className="h-4 w-4" /> Sincronizar sozinho
            </Button>
            <p className="text-xs text-muted-foreground">
              O <b>gasto</b> pode vir do relatório exportado do Gerenciador de Anúncios (CSV/XLSX): a coluna
              Investido passa a dizer de que período ele é, e reimportar o mesmo arquivo não soma duas vezes.
              A sincronização automática segue indisponível — falta o token da Marketing API com escopo{" "}
              <code className="text-foreground">ads_read</code> e o id da conta (<code className="text-foreground">act_…</code>)
              no cofre. <b>O resto desta tela continua sendo registro local e digitado</b>: cadastrar, pausar, copiar e
              mudar verba valem no CRM e não tocam na Meta — pausar o gasto de verdade exige o escopo{" "}
              <code className="text-foreground">ads_management</code> e continua no Gerenciador de Anúncios.
            </p>
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
                  {canEdit && <th className="p-2 text-right font-medium">Ações</th>}
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
                  return (
                    <tr key={r.id} className="border-b border-border/10">
                      <td className="p-2 font-medium">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {r.name}
                          {/* O status vive aqui porque é daqui que ele é
                              trocado: pausar sem ver o estado atual é chute. */}
                          <StatusBadge tone={ativa ? "success" : r.rawStatus ? "warning" : "neutral"}>
                            {adStatusLabel(r.rawStatus)}
                          </StatusBadge>
                        </span>
                        <span className="block text-muted-foreground">
                          {developerName(r.developerId)}
                          {origem && ` · ${origem}`}
                        </span>
                        {periodo && <span className="block font-normal text-muted-foreground">{periodo}</span>}
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
                          {origemDoGasto(r.syncedAt, r.spendPeriodStart, r.spendPeriodEnd)}
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
                      {canEdit && (
                        <td className="p-2 text-right whitespace-nowrap">
                          {/* Um clique, sem formulário: é o gesto que a ata
                              pede. O rótulo diz "no CRM" porque a Meta não é
                              tocada — o botão não pode sugerir o contrário. */}
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
                        </td>
                      )}
                    </tr>
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
