import { useId, useState } from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/supabaseError";
import { useAuth } from "@/contexts/AuthContext";
import type { DealStage } from "@/types/crm";
import { toast } from "@/hooks/use-toast";
import type { PersonRecord, SaveLegacyDealInput } from "@/integrations/supabase/newSchema";
import {
  DealCcaPanel, DealCommentsPanel, DealForm, saveCcaAnalysis,
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
    const self = people.find((person) => person.id === user?.id && person.roles.includes("broker"));
    return emptyDeal(stages[0]?.code ?? "incomplete", defaultMonth, self?.id);
  });
  const [tab, setTab] = useState<TabKey>("detalhes");
  const [cca, setCca] = useState<CcaAnalysis>({});
  const [saving, setSaving] = useState(false);

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
          {tab === "detalhes" && (
            <>
              <DealForm
                form={form} onChange={patch} field={field}
                people={people} developers={developers} stages={stages} isNew={isNew}
              />
              {dealId && <DealCommentsPanel dealId={dealId} people={people} />}
            </>
          )}

          {tab === "anexos" && dealId && (
            <DealDocumentUpload
              dealId={dealId}
              clientName={form.client}
              dealCode={form.code || dealId}
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
          <Button onClick={() => void handleSave()} disabled={saving || !form.client.trim()}>
            {saving ? "Salvando…" : isNew ? "Criar negócio" : "Confirmar alterações"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
