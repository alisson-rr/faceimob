import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { respostasDoSdr } from "@/integrations/supabase/sdrAgenteResumo";

/** Nota da IA: alta (70+) verde, média (40–69) amarela, baixa vermelha — a mesma da aba Conversas. */
const corDaNota = (score: number) =>
  score >= 70 ? "text-emerald-500" : score >= 40 ? "text-amber-500" : "text-red-500";

/**
 * O que o SDR IA apurou do lead (0261): respostas configuradas no agente, nota
 * e resumo da conversa mais recente. Some quando o robô não conversou com ele.
 */
export function RespostasDoSdrIa({ leadId }: { leadId: string }) {
  const consulta = useQuery({
    queryKey: ["sdr", "respostas-do-lead", leadId],
    queryFn: () => respostasDoSdr(leadId),
    staleTime: 30_000,
  });
  if (consulta.isError) {
    return <p className="text-xs text-muted-foreground">Não foi possível carregar as respostas do SDR IA.</p>;
  }
  const dados = consulta.data;
  if (!dados) return null;
  return (
    <section className="space-y-2 rounded-xl border border-border bg-muted/30 p-3" aria-labelledby={`sdr-ia-${leadId}`}>
      <h3 id={`sdr-ia-${leadId}`} className="flex items-center gap-2 text-sm font-semibold">
        <Bot className="h-4 w-4" aria-hidden /> Respostas do SDR IA
        {dados.agente && <span className="text-xs font-normal text-muted-foreground">· {dados.agente}</span>}
        {dados.score !== null && <span className={`ml-auto text-xs font-bold ${corDaNota(dados.score)}`}>nota {dados.score}</span>}
      </h3>
      {dados.respostas.length > 0 && (
        <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          {dados.respostas.map(([campo, valor]) => (
            <div key={campo} className="contents">
              <dt className="text-muted-foreground">{campo}</dt>
              <dd className="font-medium">{valor}</dd>
            </div>
          ))}
        </dl>
      )}
      {dados.resumo && <p className="text-xs text-muted-foreground">{dados.resumo}</p>}
    </section>
  );
}
