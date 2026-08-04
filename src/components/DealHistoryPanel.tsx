import { useCallback, useEffect, useState } from "react";
import { Loader2, History } from "lucide-react";
import { listDealHistory, type HistoryEntry } from "@/integrations/supabase/analytics";
import { listPeople, type PersonRecord } from "@/integrations/supabase/newSchema";

const KIND_LABEL: Record<string, string> = {
  stage: "Mudou de etapa",
  status: "Mudou de status",
  value: "Alterou o valor",
  document: "Documento",
  participant: "Participantes",
  created: "Negócio criado",
};

const formatWhen = (v: string) => new Date(v).toLocaleString("pt-BR");

/**
 * Trilha de auditoria do negócio.
 *
 * `deal_history` é log imutável escrito por `deals_log_changes` (SECURITY
 * DEFINER) e nenhuma tela lia. É o "histórico de alterações" que o CCA pediu:
 * quem mudou o quê e quando, incluindo troca de etapa e de documento.
 */
export default function DealHistoryPanel({ dealId }: { dealId: string }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, persons] = await Promise.all([listDealHistory(dealId), listPeople()]);
      setEntries(rows);
      setPeople(persons);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar o histórico");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { void load(); }, [load]);

  const actorName = (id: string | null) =>
    id ? people.find((p) => p.id === id)?.name ?? "—" : "sistema";

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Carregando histórico...
      </div>
    );
  }
  if (error) return <p className="text-xs text-destructive">{error}</p>;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <p className="text-sm font-bold">Histórico de alterações</p>
      </div>
      {entries.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">Nenhuma alteração registrada.</p>
      ) : (
        <div className="space-y-1">
          {entries.map((e) => (
            <div key={e.id} className="rounded border border-border/40 px-2 py-1 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{KIND_LABEL[e.kind] ?? e.kind}</span>
                <span className="text-muted-foreground">{formatWhen(e.created_at)}</span>
              </div>
              <div className="text-muted-foreground">
                {e.from_value || e.to_value ? (
                  <>
                    {e.from_value ?? "—"} → <span className="text-foreground">{e.to_value ?? "—"}</span>
                    {" · "}
                  </>
                ) : null}
                por {actorName(e.actor_id)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
