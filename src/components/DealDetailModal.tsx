import { useId, useState } from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/supabaseError";
import { useAuth } from "@/contexts/AuthContext";
import type { DealStage } from "@/types/crm";
import { toast } from "@/hooks/use-toast";
import { primaryRole, type PersonRecord, type SaveLegacyDealInput } from "@/integrations/supabase/newSchema";
import {
  DealCcaPanel, DealCommentsPanel, DealForm, dealRequiredError, saveCcaAnalysis, useDealWriteLock,
  type CcaAnalysis, type PipelineStage,
} from "@/components/pipeline";
import DealDocumentUpload from "@/components/DealDocumentUpload";
import DealHistoryPanel from "@/components/DealHistoryPanel";
import TaskPanel from "@/components/TaskPanel";
import VisitPanel from "@/components/VisitPanel";

interface Props {
  /** `null`/ausente = criar. É o único editor de negócio da aplicação (A02). */
  deal?: SaveLegacyDealInput | null;
  open: boolean;
  onClose: () => void;
  onSave: (deal: SaveLegacyDealInput) => Promise<void>;
  onReviewChanged?: () => void | Promise<void>;
  people: PersonRecord[];
  developers: { id: string; name: string }[];
  /** Catálogo de etapas — traz o `id` que `can_enter_stage()` autoriza. */
  stages: PipelineStage[];
  /** Mês-base sugerido para um negócio novo (o do ciclo aberto do game). */
  defaultMonth?: string;
}

type TabKey = "detalhes" | "anexos" | "agenda" | "historico" | "cca";

/**
 * Negócio em branco.
 *
 * `broker1_id` nasce com o próprio usuário quando ele é corretor: o direito de
 * editar o negócio vem de estar em `deal_participants` (`can_edit_deal`), então
 * criar um negócio sem nenhum participante trancaria o criador para fora do que
 * ele acabou de criar — sem conseguir nem reabrir para corrigir.
 *
 * "Ser corretor" aqui é `primaryRole(roles) === 'broker'`, a mesma precedência
 * que a migration 0048 aplica no gatilho `deals_add_creator_participant`, e não
 * `roles.includes('broker')`: `handle_new_auth_user` (0002) dá `broker` a TODO
 * perfil novo e nunca o retira, então admin, gerente e diretor caíam neste
 * pré-preenchimento, viravam "Corretor 1" com 100% do rateio de VGV e os pontos
 * de venda do game — exatamente o que a 0048 tirou do banco e que este
 * formulário estava recolocando por cima. Para eles o campo nasce vazio e a
 * escolha é ato explícito; ninguém fica trancado fora do negócio: admin e CCA
 * passam por `has_permission('cca.review')` e gerente/diretor ganham a própria
 * linha pelo gatilho da 0048.
 */
const emptyDeal = (stageCode: string, month?: string, selfBrokerId?: string): SaveLegacyDealInput => ({
  client: "", developer: "", project: "", unit: "",
  status: "PROPOSTA",
  // Fronteira: o código vem do catálogo do banco e `DealStage` é o espelho dele.
  stage: stageCode as DealStage,
  broker1: "", manager1: "", deal_value: 0,
  broker1_id: selfBrokerId ?? null,
  active: true, created_at: new Date().toISOString(), month_base: month, notes: "",
});

/**
 * Editor do negócio — criar e editar pelo mesmo lugar.
 *
 * Havia dois caminhos gravando o mesmo registro (achado A02): este modal e um
 * diálogo inline no Pipeline, que salvava um subconjunto dos campos (sem
 * gerentes, sem dados do cliente além do nome, sem Status 2). Ficou este, com
 * `deal` opcional para o caso de criação; o inline saiu.
 *
 * As abas que dependem do `id` do negócio (anexos, agenda, histórico, CCA) só
 * abrem depois de salvar — antes elas consultavam com um id inexistente.
 */
export default function DealDetailModal({
  deal, open, onClose, onSave, onReviewChanged, people, developers, stages, defaultMonth,
}: Props) {
  const { user } = useAuth();
  const id = useId();
  const field = (name: string) => `${id}-${name}`;

  const [form, setForm] = useState<SaveLegacyDealInput>(() => {
    if (deal) return { ...deal };
    const self = people.find((person) => person.id === user?.id && primaryRole(person.roles) === "broker");
    return emptyDeal(stages[0]?.code ?? "incomplete", defaultMonth, self?.id);
  });
  const [tab, setTab] = useState<TabKey>("detalhes");
  const [cca, setCca] = useState<CcaAnalysis>({});
  const [saving, setSaving] = useState(false);
  /** Já houve uma tentativa de salvar. Só depois dela o campo obrigatório vazio
   *  vira erro: cobrar antes pintaria de vermelho um formulário recém-aberto. */
  const [tentouSalvar, setTentouSalvar] = useState(false);

  // A MESMA resposta que desabilita os campos (`DealForm` chama este hook com
  // este mesmo `form`). Enquanto só o formulário a lia, o mês fechado e o perfil
  // sem escrita deixavam ~40 campos cinzas com "Confirmar alterações"
  // habilitado: o clique ia ao banco só para voltar recusado por
  // `deals_guard_closed_month`/`can_edit_deal`. Gesto que a tela oferece e o
  // banco recusa é exatamente o que `useDealWriteLock` existe para eliminar.
  const lock = useDealWriteLock(form);

  // Derivado na renderização, não guardado em state: escolher a construtora
  // apaga a frase no mesmo instante, sem efeito nem segundo clique em salvar.
  const developerError = tentouSalvar ? dealRequiredError(form) : null;

  const dealId = deal?.id ?? null;
  const isNew = !dealId;

  const patch = (next: Partial<SaveLegacyDealInput>) =>
    setForm((previous) => ({ ...previous, ...next }));

  const handleSave = async () => {
    if (!form.client.trim()) {
      toast({ variant: "destructive", title: "O nome do cliente é obrigatório" });
      return;
    }
    // Sem participante o negócio nasce fora do alcance de `can_edit_deal()`:
    // ninguém além de admin e CCA conseguiria abri-lo de novo.
    if (!form.broker1_id && !form.manager1_id) {
      toast({
        variant: "destructive",
        title: "Escolha ao menos um corretor ou gerente",
        description: "É o vínculo que dá acesso ao negócio depois de salvo.",
      });
      return;
    }
    // "Construtora *" é recusa de CAMPO, e por isso não vai para toast: a frase
    // aparece uma vez, presa ao Select que a causou (`aria-invalid` +
    // `aria-describedby`), e o mesmo `dealRequiredError` continua guardando a
    // gravação em `Pipeline.onSave` para qualquer caminho que não passe aqui.
    setTentouSalvar(true);
    // A frase fica na aba "Detalhes", e é onde o operador está: `dealRequiredError`
    // só cobra na CRIAÇÃO, e no negócio novo as outras quatro abas estão
    // desabilitadas até existir um `id`.
    if (dealRequiredError(form)) return;
    setSaving(true);
    try {
      await onSave(form);
      if (dealId && Object.keys(cca).length > 0) await saveCcaAnalysis(dealId, cca);
      toast({ title: isNew ? "Negócio criado" : "Alterações salvas" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: describeError(err, "As alterações não foram gravadas."),
      });
    } finally {
      setSaving(false);
    }
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: "detalhes", label: "Detalhes" },
    { key: "anexos", label: "Anexos" },
    { key: "agenda", label: "Agenda" },
    { key: "historico", label: "Histórico" },
    { key: "cca", label: "CCA" },
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="glass-strong max-h-[92vh] max-w-2xl overflow-y-auto p-0">
        <DialogTitle className="sr-only">
          {isNew ? "Novo negócio" : `Negócio de ${form.client || "cliente sem nome"}`}
        </DialogTitle>

        <div className="flex items-center justify-between border-b border-border px-4 pb-0 pt-4">
          <div className="flex gap-4 overflow-x-auto" role="tablist" aria-label="Seções do negócio">
            {tabs.map((item) => {
              const enabled = item.key === "detalhes" || !isNew;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.key}
                  disabled={!enabled}
                  title={enabled ? undefined : "Disponível depois de salvar o negócio"}
                  onClick={() => setTab(item.key)}
                  className={cn(
                    "whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "disabled:cursor-not-allowed disabled:opacity-40",
                    tab === item.key
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <Button variant="ghost" size="icon" className="mb-3 h-8 w-8" onClick={onClose} aria-label="Fechar">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="space-y-4 p-4">
          {/* O motivo da trava vive AQUI, acima das abas, e não dentro do
              `DealForm`: o "Confirmar alterações" do rodapé está desabilitado
              nas cinco abas, e o formulário que explicava o cinza só é montado
              em "Detalhes". O caso concreto é o CCA — o analista preenchia a
              análise inteira, achava o botão apagado e não recebia motivo
              nenhum. Mesmo `lock` que desabilita o botão; uma frase, um lugar. */}
          {lock.reason === "role" && (
            <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              Somente leitura. Seu perfil enxerga o negócio, mas o banco recusa a gravação
              (<code>can_edit_deal</code>) — por isso os campos e o botão de confirmar ficam
              desabilitados em vez de aceitar o que seria perdido no salvamento.
            </p>
          )}

          {lock.reason === "month" && (
            <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              Mês <strong className="text-foreground">{lock.month}</strong> fechado. O banco
              recusa qualquer gravação neste negócio (<code>deals_guard_closed_month</code>) até um
              administrador reabrir o período — por isso os campos e o botão de confirmar ficam
              desabilitados em vez de aceitar o que seria perdido no salvamento.
            </p>
          )}

          {/* A terceira razão do `lock`, e a que mais confundia: `useDealWriteLock`
              fecha a trava quando a consulta de `closed_months` está pendente ou
              FALHOU, e a frase morava só no `DealForm` — que nem é montado fora de
              "Detalhes". Nas outras quatro abas o botão ficava cinza sem motivo. */}
          {lock.reason === "unknown" && (
            <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              Não consegui confirmar se o mês <strong className="text-foreground">{lock.month}</strong>{" "}
              está fechado, então a gravação fica bloqueada em vez de arriscar perder o que for
              digitado. Recarregue a página para tentar de novo.
            </p>
          )}

          {tab === "detalhes" && (
            <>
              <DealForm
                form={form} onChange={patch} field={field}
                people={people} developers={developers} stages={stages} isNew={isNew}
                developerError={developerError}
              />
              {dealId && <DealCommentsPanel dealId={dealId} people={people} />}
            </>
          )}

          {tab === "anexos" && dealId && (
            <DealDocumentUpload
              dealId={dealId}
              clientName={form.client}
              dealCode={form.code || dealId}
              // O que vale é o gravado (`deal`), não o `form`: trocar a construtora
              // na aba Detalhes sem confirmar ainda deixa o banco sem ela.
              hasDeveloper={Boolean(deal?.developer_id)}
              // A MESMA resposta que desabilita os campos: sem ela o gerente
              // clicava "Aprovar e enviar ao CCA" num negócio de mês fechado e
              // recebia a recusa crua de `deals_guard_closed_month` em toast.
              closedMonth={lock.reason === "month" ? lock.month : null}
              // A trava por mês não confirmado desce junto: sem ela "Enviar ao
              // gerente", "Devolver" e "Aprovar e enviar ao CCA" ficavam vivos
              // enquanto o resto do modal já estava travado pelo mesmo `lock`.
              unconfirmedMonth={lock.reason === "unknown" ? lock.month : null}
              onReviewChanged={onReviewChanged}
            />
          )}

          {tab === "agenda" && dealId && (
            <div className="space-y-4">
              <TaskPanel refType="deal" refId={dealId} />
              <div className="border-t border-border pt-3"><VisitPanel dealId={dealId} /></div>
            </div>
          )}

          {tab === "historico" && dealId && <DealHistoryPanel dealId={dealId} />}

          {tab === "cca" && dealId && <DealCcaPanel dealId={dealId} value={cca} onChange={setCca} />}
        </div>

        <div className="flex justify-end gap-3 border-t border-border p-4">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => void handleSave()}
            disabled={saving || lock.readOnly || !form.client.trim()}
          >
            {saving ? "Salvando…" : isNew ? "Criar negócio" : "Confirmar alterações"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
