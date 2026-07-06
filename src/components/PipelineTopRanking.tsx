import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Trophy, Medal, Star, Flame, Lightbulb, Megaphone, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { PipelineDeal } from "@/types/crm";
import { useGameRanking, type ScoreRow as Score } from "@/hooks/useGameRanking";

type Props = { deals: PipelineDeal[] };

export default function PipelineTopRanking({ deals }: Props) {
  const dealsForHook = deals.map((d) => ({
    broker1_name: (d as any).broker1,
    broker2_name: (d as any).broker2,
    stage: d.stage,
    status: (d as any).status,
    active: (d as any).active,
  }));
  const { role, myBroker, allScores, scoped } = useGameRanking(dealsForHook);
  const [openInfo, setOpenInfo] = useState(false);
  const [tip, setTip] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string | null; message: string } | null>(null);

  const loadInfo = async () => {
    const [{ data: tips }, { data: notices }] = await Promise.all([
      (supabase as any).from("gold_tips").select("content").eq("active", true).order("created_at", { ascending: false }).limit(1),
      (supabase as any).from("important_notices").select("title,message").eq("active", true).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(1),
    ]);
    setTip(tips?.[0]?.content ?? null);
    setNotice(notices?.[0] ?? null);
  };

  const openInfoDialog = async () => { await loadInfo(); setOpenInfo(true); };

  if (!scoped.length) return null;

  // ============== BROKER VIEW ==============
  if (role === "broker" && myBroker) {
    const me = scoped[0];
    const rank = allScores.findIndex((s) => s.broker.id === myBroker.id) + 1;
    return (
      <>
        <Card
          onClick={openInfoDialog}
          className="cursor-pointer border-primary/40 bg-gradient-to-br from-primary/10 via-transparent to-amber-500/10 hover:from-primary/20 hover:to-amber-500/20 hover:scale-[1.015] hover:shadow-lg hover:shadow-amber-500/20 transition-all duration-300 max-w-3xl mx-auto"
        >
          <CardContent className="p-4 flex items-center gap-4">
            <div className="relative">
              <Avatar className="h-16 w-16 border-2 border-amber-400/60 shadow-[0_0_16px_hsl(45_90%_55%/0.35)]">
                <AvatarImage src={me.broker.avatar_url || undefined} alt={me.broker.name} />
                <AvatarFallback className="bg-primary/20 text-primary font-bold">
                  {me.broker.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                </AvatarFallback>
              </Avatar>
              <div className="absolute -bottom-1 -right-1 bg-amber-500 text-black text-[10px] font-black rounded-full h-6 min-w-6 px-1.5 flex items-center justify-center border-2 border-background">
                #{rank || "—"}
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold truncate">{me.broker.name}</p>
                <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[10px] py-0 h-4">
                  <Star className="h-2.5 w-2.5 mr-1" /> {me.points} pts
                </Badge>
              </div>
              <div className="grid grid-cols-4 gap-2 mt-2">
                <FunnelStat label="Leads" value={me.leads} tone="text-cyan-400" />
                <FunnelStat label="Análises" value={me.analises} tone="text-sky-400" />
                <FunnelStat label="Aprovados" value={me.aprovados} tone="text-emerald-400" />
                <FunnelStat label="Vendas" value={me.vendas} tone="text-yellow-400" />
              </div>
            </div>

            <div className="flex flex-col items-center gap-1 pl-2 border-l border-border/40">
              <Trophy className="h-5 w-5 text-amber-400" />
              <span className="text-[10px] text-muted-foreground uppercase">Rank</span>
              <span className="text-lg font-black text-amber-400">{rank ? `#${rank}` : "—"}</span>
              <span className="text-[9px] text-muted-foreground">de {allScores.length}</span>
            </div>
          </CardContent>
        </Card>

        <InfoDialog open={openInfo} onOpenChange={setOpenInfo} tip={tip} notice={notice} />
      </>
    );
  }

  // ============== PODIUM VIEW (admin/manager/director) ==============
  const top3 = scoped.slice(0, 3);
  // Podium visual order: 2nd, 1st, 3rd
  const order = [top3[1], top3[0], top3[2]].filter(Boolean) as Score[];

  const medalConfig = [
    { // silver (2nd)
      label: "2",
      icon: <Medal className="h-5 w-5 text-slate-300" />,
      wrap: "border-slate-400/40 bg-gradient-to-br from-slate-700/30 via-slate-800/40 to-transparent",
      color: "text-slate-200",
    },
    { // gold (1st)
      label: "1",
      icon: <Trophy className="h-6 w-6 text-amber-400" />,
      wrap: "border-amber-400/60 bg-gradient-to-br from-amber-500/25 via-amber-800/20 to-transparent shadow-[0_0_24px_hsl(45_90%_55%/0.25)]",
      color: "text-amber-300",
    },
    { // bronze (3rd)
      label: "3",
      icon: <Medal className="h-5 w-5 text-orange-400" />,
      wrap: "border-orange-500/40 bg-gradient-to-br from-orange-800/30 via-orange-900/20 to-transparent",
      color: "text-orange-300",
    },
  ];

  const scopeLabel =
    role === "admin" ? "Ranking Geral" :
    role === "director" ? "Sua Diretoria" :
    role === "manager" ? "Sua Gerência" : "Ranking";

  return (
    <Card className="border-primary/30 bg-card/60 backdrop-blur-xl">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-bold">Ranking do Game — {scopeLabel}</h2>
          </div>
          <Badge variant="outline" className="text-[10px] border-primary/30">
            <TrendingUp className="h-3 w-3 mr-1" /> {scoped.length} participantes
          </Badge>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {order.map((s, idx) => {
            // idx 0 = 2nd, 1 = 1st, 2 = 3rd
            const pos = idx === 0 ? 1 : idx === 1 ? 0 : 2; // medalConfig index
            const cfg = medalConfig[pos];
            const positionNumber = pos === 0 ? 2 : pos === 1 ? 1 : 3;
            return (
              <div
                key={s.broker.id}
                className={cn(
                  "rounded-xl border p-3 flex items-center gap-3 transition-transform",
                  cfg.wrap,
                  pos === 1 && "sm:-translate-y-2"
                )}
              >
                <div className="relative shrink-0">
                  <Avatar className={cn("h-12 w-12 border-2", pos === 1 ? "border-amber-400/70" : "border-border/50")}>
                    <AvatarImage src={s.broker.avatar_url || undefined} alt={s.broker.name} />
                    <AvatarFallback className="bg-primary/20 text-primary font-bold text-xs">
                      {s.broker.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="absolute -top-1 -left-1">{cfg.icon}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-xs font-bold truncate", cfg.color)}>{positionNumber}º · {s.broker.name}</p>
                  <p className="text-lg font-black leading-tight">{s.points} <span className="text-[10px] font-medium text-muted-foreground">pts</span></p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>V:<b className="text-yellow-400 ml-0.5">{s.vendas}</b></span>
                    <span>A:<b className="text-emerald-400 ml-0.5">{s.aprovados}</b></span>
                    <span>An:<b className="text-sky-400 ml-0.5">{s.analises}</b></span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function FunnelStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="px-2 py-1 rounded-md border border-border/40 bg-secondary/20 text-center">
      <p className="text-[9px] uppercase text-muted-foreground leading-none">{label}</p>
      <p className={cn("text-base font-black leading-tight", tone)}>{value}</p>
    </div>
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
            <Flame className="h-5 w-5 text-amber-400" /> Mensagem do dia
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center gap-2 mb-1 text-xs font-semibold text-primary">
              <Megaphone className="h-4 w-4" /> {notice?.title || "Aviso"}
            </div>
            <p className="text-sm text-foreground/90 whitespace-pre-wrap">
              {notice?.message || "Sem avisos ativos no momento."}
            </p>
          </div>
          <div className="rounded-lg border border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-transparent p-3">
            <div className="flex items-center gap-2 mb-1 text-xs font-semibold text-amber-400">
              <Lightbulb className="h-4 w-4" /> Dica de Ouro
            </div>
            <p className="text-sm text-foreground/90 whitespace-pre-wrap">
              {tip || "Nenhuma dica de ouro publicada ainda."}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
