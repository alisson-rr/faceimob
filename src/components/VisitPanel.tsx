import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Loader2, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  listVisitsFor,
  scheduleVisit,
  setVisitResult,
  VISIT_RESULT_LABEL,
  type VisitRecord,
  type VisitResult,
} from "@/integrations/supabase/activities";

type Props = {
  leadId?: string;
  dealId?: string;
  brokerId?: string | null;
};

const formatWhen = (v: string) => new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Visitas do lead/negócio — o elo entre atendimento e proposta. */
export default function VisitPanel({ leadId, dealId, brokerId }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [when, setWhen] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setVisits(await listVisitsFor({ leadId, dealId }));
    } catch (e) {
      toast({
        title: "Falha ao carregar visitas",
        description: e instanceof Error ? e.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [leadId, dealId, toast]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!when) return toast({ title: "Escolha data e hora", variant: "destructive" });
    const broker = brokerId || user?.id;
    if (!broker) return toast({ title: "Sem corretor responsável", variant: "destructive" });

    setBusy("new");
    try {
      await scheduleVisit({ leadId, dealId, brokerId: broker, scheduledAt: new Date(when).toISOString() });
      setWhen("");
      await load();
      toast({ title: "Visita agendada" });
    } catch (e) {
      toast({
        title: "Não foi possível agendar",
        description: e instanceof Error ? e.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const change = async (id: string, result: VisitResult) => {
    setBusy(id);
    try {
      await setVisitResult(id, result);
      await load();
    } catch (e) {
      toast({
        title: "Não foi possível atualizar",
        description: e instanceof Error ? e.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-primary" />
        <p className="text-sm font-bold">Visitas</p>
      </div>

      <div className="flex flex-col md:flex-row gap-2">
        <Input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="h-8 text-xs md:w-56"
          aria-label="Data e hora da visita"
        />
        <Button size="sm" onClick={add} disabled={busy === "new"} className="h-8 text-xs gap-1">
          {busy === "new" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Agendar
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Carregando...
        </div>
      ) : visits.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">Nenhuma visita registrada.</p>
      ) : (
        <div className="space-y-1">
          {visits.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 rounded border border-border/50 px-2 py-1 text-[11px]">
              <span className="truncate">
                {formatWhen(v.scheduled_at)}
                <Badge variant={v.result === "completed" ? "default" : "outline"} className="ml-2 text-[9px]">
                  {VISIT_RESULT_LABEL[v.result]}
                </Badge>
              </span>
              {v.result === "scheduled" && (
                <Select value="" onValueChange={(r) => change(v.id, r as VisitResult)} disabled={busy === v.id}>
                  <SelectTrigger className="h-6 w-36 text-[10px]" aria-label="Resultado da visita">
                    <SelectValue placeholder="Registrar resultado" />
                  </SelectTrigger>
                  <SelectContent>
                    {(["completed", "no_show", "cancelled"] as VisitResult[]).map((r) => (
                      <SelectItem key={r} value={r} className="text-xs">{VISIT_RESULT_LABEL[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
