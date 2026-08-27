import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Flame, Lightbulb, Megaphone, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SectionCard, StatusBadge } from "@/components/shared";
import { Podium, type PodiumEntry } from "@/components/engagement";
import type { PipelineDeal } from "@/types/crm";
import { useGameRanking } from "@/hooks/useGameRanking";

type Props = { deals: PipelineDeal[] };

/**
 * Faixa de pódio do Pipeline. O desenho vem do `Podium` compartilhado — a
 * configuração de medalha vivia aqui com cores fixas de tema escuro
 * (`slate-300`, `amber-400`, `orange-400`), invisíveis no tema claro e
 * divergentes do pódio da Gamificação. Agora é o mesmo componente e os mesmos
 * tokens `gold/silver/bronze` do pódio do header.
 */
export default function PipelineTopRanking({ deals }: Props) {
  const dealsForHook = deals.map((d) => ({
    broker1_name: d.broker1,
    broker2_name: d.broker2,
    stage: d.stage,
    active: d.active,
  }));
  const { role, scoped } = useGameRanking(dealsForHook);
  const [openInfo, setOpenInfo] = useState(false);
  const [tip, setTip] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string | null; message: string } | null>(null);

  const loadInfo = async () => {
    const [{ data: tips }, { data: notices }] = await Promise.all([
      supabase.from("gold_tips").select("body").eq("active", true).order("created_at", { ascending: false }).limit(1),
      supabase.from("important_notices").select("title,body").eq("active", true).order("created_at", { ascending: false }).limit(1),
    ]);
    setTip(tips?.[0]?.body ?? null);
    setNotice(notices?.[0] ? { title: notices[0].title, message: notices[0].body } : null);
  };

  const openInfoDialog = async () => { await loadInfo(); setOpenInfo(true); };

  if (!scoped.length) return null;

  // O escopo já vem do servidor: geral, diretoria, gerência ou equipe.
  const entries: PodiumEntry[] = scoped.slice(0, 3).map((s) => ({
    id: s.broker.id,
    name: s.broker.name,
    points: s.points,
    avatarUrl: s.broker.avatar_url,
    detail: `${s.vendas}V · ${s.aprovados}A · ${s.analises}An`,
  }));

  const scopeLabel =
    role === "admin" ? "Ranking geral" :
    role === "director" ? "Sua diretoria" :
    role === "manager" ? "Sua gerência" :
    role === "broker" ? "Sua equipe" : "Ranking";

  return (
    <>
      <SectionCard
        title={`Ranking do game — ${scopeLabel}`}
        icon={Flame}
        className="mx-auto max-w-4xl"
        actions={
          <StatusBadge tone="neutral" icon={TrendingUp}>
            {scoped.length} participantes
          </StatusBadge>
        }
      >
        <Podium entries={entries} size="sm" onSelect={() => void openInfoDialog()} />
      </SectionCard>
      <InfoDialog open={openInfo} onOpenChange={setOpenInfo} tip={tip} notice={notice} />
    </>
  );
}

function InfoDialog({
  open, onOpenChange, tip, notice,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  tip: string | null; notice: { title: string | null; message: string } | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-warning" /> Mensagem do dia
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-primary">
              <Megaphone className="h-4 w-4" /> {notice?.title || "Aviso"}
            </div>
            <p className="whitespace-pre-wrap text-sm text-foreground">
              {notice?.message || "Sem avisos ativos no momento."}
            </p>
          </div>
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-warning">
              <Lightbulb className="h-4 w-4" /> Dica de ouro
            </div>
            <p className="whitespace-pre-wrap text-sm text-foreground">
              {tip || "Nenhuma dica de ouro publicada ainda."}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
