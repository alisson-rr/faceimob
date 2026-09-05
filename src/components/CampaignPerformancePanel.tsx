import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Loader2, Megaphone, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { EmptyState, LoadingState } from "@/components/shared";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  AD_PLATFORMS,
  AD_PLATFORM_LABEL,
  costPerLead,
  createAdCampaign,
  deleteAdCampaign,
  roas,
  roasLabel,
  updateAdCampaign,
  type AdPlatform,
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
  /** Última vez que `total_spend` veio da plataforma. `null` = valor digitado. */
  syncedAt: string | null;
  leads: number;
  conversions: number;
  /** Negócios GANHOS da campanha — o denominador do custo por VENDA. */
  sales: number;
  /** VGV dos negócios ganhos que vieram desta campanha. */
  revenue: number;
};

/** Sem valor no `Select` do Radix: string vazia é proibida como `value`. */
const SEM_CONSTRUTORA = "__nenhuma__";
const SEM_STATUS = "__sem_status__";

const vazio = () => ({
  externalId: "",
  name: "",
  platform: "meta" as AdPlatform,
  developerId: SEM_CONSTRUTORA,
  status: "ACTIVE",
  spend: "",
  budget: "",
});

export interface CampaignPerformancePanelProps {
  rows: CampaignResult[];
  /** Quantas campanhas existem ANTES do filtro de canal e status da tela.
   *  Com `rows` vazio e `total > 0` o vazio é do filtro, não do cadastro — o
   *  painel dizia "nenhuma campanha cadastrada" enquanto a tabela logo abaixo,
   *  na mesma dobra, dizia corretamente que era o filtro. */
  total?: number;
  /** INTEIRA, ativas e inativas: a campanha de construtora desativada precisa
   *  continuar nomeando a construtora dela — filtrar aqui virava travessão numa
   *  tabela e o nome na outra, na mesma dobra. */
  developers: { id: string; name: string; active: boolean }[];
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
 * O `total_spend` é digitado: nenhuma linha de código o escreve sozinha. Puxar
 * gasto, orçamento e status da Meta exige token da Marketing API com escopo
 * `ads_read` — que o cofre não tem. O botão de sincronizar existe desabilitado
 * com o motivo escrito, porque um botão que erra em silêncio é pior.
 */
export default function CampaignPerformancePanel({ rows, total, developers, loading, error, onReload }: CampaignPerformancePanelProps) {
  const { toast } = useToast();
  const { isAdmin, roles, previewRole } = useAuth();
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(vazio());

  // Espelha `ad_campaigns_write` (`has_any_role('admin','marketing')`).
  // `reports.view_finance` também vale para diretor, gerente e sócio, que só
  // leem — o formulário aparecia para eles e todo Salvar voltava com 42501.
  const effectiveRoles = previewRole ? [previewRole] : roles;
  const canEdit = isAdmin || effectiveRoles.includes("marketing");

  const developerName = (id: string | null) => developers.find((d) => d.id === id)?.name ?? "—";

  /** Ativas + a que está vinculada à campanha em correção: não se cria vínculo
   *  novo com construtora desativada, mas o vínculo antigo precisa aparecer no
   *  gatilho — sem ela na lista, o Radix renderiza vazio e o operador perde o
   *  vínculo só de tocar no campo. Mesmo desenho do popup de aportes. */
  const opcoes = developers.filter((d) => d.active || d.id === form.developerId);

  const startEdit = (row: CampaignResult) => {
    setEditing(row.id);
    setForm({
      externalId: row.externalId,
      name: row.name,
      platform: row.platform,
      developerId: row.developerId ?? SEM_CONSTRUTORA,
      status: row.rawStatus ?? SEM_STATUS,
      spend: String(row.spend ?? 0),
      budget: row.dailyBudget === null ? "" : String(row.dailyBudget),
    });
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm(vazio());
  };

  const add = async () => {
    if (!form.externalId.trim() || !form.name.trim()) {
      return toast({ title: "Informe o id externo e o nome da campanha", variant: "destructive" });
    }
    const spend = form.spend.trim() === "" ? 0 : Number(form.spend);
    if (!Number.isFinite(spend) || spend < 0) {
      return toast({ title: "Investimento inválido", description: "Use um número maior ou igual a zero.", variant: "destructive" });
    }
    // Branco é "sem orçamento lançado" (null), e não zero: zero significaria
    // campanha com teto de R$ 0,00, que é outra afirmação.
    const budget = form.budget.trim() === "" ? null : Number(form.budget);
    if (budget !== null && (!Number.isFinite(budget) || budget < 0)) {
      return toast({ title: "Orçamento diário inválido", description: "Use um número maior ou igual a zero, ou deixe em branco.", variant: "destructive" });
    }
    setSaving(true);
    try {
      const payload = {
        externalId: form.externalId.trim(),
        platform: form.platform,
        name: form.name.trim(),
        developerId: form.developerId === SEM_CONSTRUTORA ? null : form.developerId,
        status: form.status === SEM_STATUS ? null : form.status,
        dailyBudget: budget,
        totalSpend: spend,
      };
      // Cadastro NUNCA sobrescreve: `createAdCampaign` insere e o unique global
      // de `external_id` (0067) devolve a recusa. A conferência não pode ser
      // feita aqui contra `rows`, que chega FILTRADO por canal e status — a
      // campanha escondida pelo filtro passaria pela guarda.
      if (editing) await updateAdCampaign(editing, payload);
      else await createAdCampaign(payload);
      cancelEdit();
      onReload();
      toast({ title: editing ? "Campanha atualizada" : "Campanha registrada" });
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
            <p className="text-xs font-semibold">{editing ? "Corrigir campanha" : "Cadastrar campanha"}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <Input
                placeholder="ID da campanha na plataforma"
                value={form.externalId}
                onChange={(e) => setForm((p) => ({ ...p, externalId: e.target.value }))}
                className="h-8 text-xs"
                aria-label="ID externo da campanha"
              />
              <Input
                placeholder="Nome"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="h-8 text-xs"
                aria-label="Nome da campanha"
              />
              <Select value={form.platform} onValueChange={(v) => setForm((p) => ({ ...p, platform: v as AdPlatform }))}>
                <SelectTrigger className="h-8 text-xs" aria-label="Plataforma da campanha"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AD_PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>{AD_PLATFORM_LABEL[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={form.developerId} onValueChange={(v) => setForm((p) => ({ ...p, developerId: v }))}>
                <SelectTrigger className="h-8 text-xs" aria-label="Construtora da campanha"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_CONSTRUTORA}>Sem construtora</SelectItem>
                  {opcoes.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.active ? d.name : `${d.name} (inativa)`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}>
                <SelectTrigger className="h-8 text-xs" aria-label="Status da campanha"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Ativa</SelectItem>
                  <SelectItem value="PAUSED">Pausada</SelectItem>
                  <SelectItem value={SEM_STATUS}>Sem status</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="Investido (R$)"
                value={form.spend}
                onChange={(e) => setForm((p) => ({ ...p, spend: e.target.value }))}
                className="h-8 text-xs"
                aria-label="Total investido"
              />
              {/* `daily_budget` já era lido e aceito pela camada de dados, e
                  nenhuma tela o preenchia: a coluna existia sempre nula. É o
                  teto que a plataforma cobra por dia, não o acumulado. */}
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="Orçamento diário (R$)"
                value={form.budget}
                onChange={(e) => setForm((p) => ({ ...p, budget: e.target.value }))}
                className="h-8 text-xs"
                aria-label="Orçamento diário"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Sem essa segunda frase, mudar o status para "Pausada" aqui
                  passa por ter pausado a campanha na Meta — e o dinheiro
                  continua saindo. O registro é local enquanto não houver token
                  com escopo `ads_management`. */}
              <p className="text-xs text-muted-foreground">
                O ID externo tem de ser o mesmo que a plataforma envia no webhook — é ele que liga o lead à campanha.
                Status e investido são o registro local: mudar aqui não pausa nem altera nada na Meta.
              </p>
              <div className="flex gap-2">
                {editing && (
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
            <Button size="sm" variant="outline" disabled className="h-8 text-xs gap-1">
              <RefreshCw className="h-4 w-4" /> Sincronizar gasto com a Meta
            </Button>
            <p className="text-xs text-muted-foreground">
              Indisponível: falta o token da Marketing API com escopo <code className="text-foreground">ads_read</code> e o
              id da conta de anúncios (<code className="text-foreground">act_…</code>) no cofre de integrações. Com eles, este
              botão passa a puxar gasto, orçamento diário e status, e a coluna Investido deixa de ser digitada. Alterar
              orçamento, pausar ou duplicar campanha na Meta exige ainda o escopo{" "}
              <code className="text-foreground">ads_management</code> e não existe nesta tela. Enquanto não chegar, o
              investido é digitado aqui.
            </p>
          </div>
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
          (total ?? 0) > 0 ? (
            <EmptyState
              icon={Megaphone}
              title="Nenhuma campanha neste filtro"
              description={`Volte para "Todos canais" e "Todos status" para ver as ${num(total ?? 0)} cadastradas.`}
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
                  return (
                    <tr key={r.id} className="border-b border-border/10">
                      <td className="p-2 font-medium">
                        {r.name}
                        <span className="block text-muted-foreground">{developerName(r.developerId)}</span>
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {brl(r.spend, { cents: true })}
                        {/* A idade do número que divide TODAS as contas da linha.
                            Sem isto não havia como saber se o gasto é de ontem
                            ou de julho — e o ROAS herda essa incerteza. */}
                        {/* "digitado", nunca "sincronizado": NENHUM código escreve
                            `ad_campaigns.synced_at` — não há Marketing API neste
                            sistema, e o botão de sincronizar ao lado está
                            desabilitado dizendo isso. A coluna só tem valor de
                            semente (medido em 06/09: 6 campanhas com data de
                            28/07 e 26/08), e a tela imprimia "sincronizado
                            28/07/2026" em todas — dizendo que houve conversa com
                            a Meta que nunca houve, justamente no número que
                            divide o ROAS. A data continua visível porque a idade
                            do gasto importa; o que muda é de onde ela veio. */}
                        <span className="block font-normal text-muted-foreground">
                          {r.syncedAt ? `digitado · atualizado ${date(r.syncedAt)}` : "digitado"}
                          {r.dailyBudget !== null && ` · ${brl(r.dailyBudget)}/dia`}
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
