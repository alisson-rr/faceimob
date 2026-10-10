import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChevronDown, ListOrdered } from "lucide-react";
import { StatusBadge } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { describeError } from "@/lib/supabaseError";

// RPC da 0198, ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;

export type LinhaDaFila = {
  group_id: string;
  group_name: string;
  profile_id: string;
  full_name: string;
  posicao: number | null;
  /** `com_lead` (0220): tem lead da roleta esperando "Atender" — sai da vez até atender. */
  situacao: "na_fila" | "aguardando" | "bloqueado" | "com_lead";
  checked_in_at: string;
  abre_as: string;
  last_turn_at: string | null;
  atrasados: number;
};

const SITUACAO = {
  na_fila: { tone: "success", texto: "na fila" },
  aguardando: { tone: "info", texto: "aguardando" },
  bloqueado: { tone: "danger", texto: "bloqueado" },
  com_lead: { tone: "warning", texto: "com lead para atender" },
} as const;

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** Hora em que a pessoa voltou à fila hoje, depois do check-in; `null` se ainda não recebeu. */
const voltou = (l: Pick<LinhaDaFila, "checked_in_at" | "last_turn_at">) =>
  l.last_turn_at && new Date(l.last_turn_at) > new Date(l.checked_in_at) ? l.last_turn_at : null;

/** Agrupa as linhas por grupo, mantendo a ordem que o banco já devolve. */
function porGrupo(linhas: LinhaDaFila[]) {
  const grupos = new Map<string, { nome: string; linhas: LinhaDaFila[] }>();
  for (const l of linhas) {
    const g = grupos.get(l.group_id) ?? { nome: l.group_name, linhas: [] };
    g.linhas.push(l);
    grupos.set(l.group_id, g);
  }
  return [...grupos.entries()].map(([id, g]) => ({ id, ...g }));
}

/**
 * Fila em formação (pedido de 03/10/2026): o admin vê, antes da entrega, quem
 * já bateu ponto e em que ordem vai receber — a ordem do motor da roleta — e
 * por que alguém não recebe (distribuição do turno ainda fechada, ou leads
 * atrasados). Atualiza com o check-in e cada entrega.
 */
export function FilaEmFormacao() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const fila = useQuery({
    queryKey: ["checkin", "fila-em-formacao"],
    queryFn: async (): Promise<LinhaDaFila[]> => {
      const { data, error } = await untyped.rpc("fila_em_formacao");
      if (error) throw error;
      return (data ?? []) as LinhaDaFila[];
    },
    enabled: Boolean(user?.id),
    // A distribuição abre no horário do turno sem mudar nenhuma tabela.
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!user?.id) return;
    const recarregar = () => { void queryClient.invalidateQueries({ queryKey: ["checkin", "fila-em-formacao"] }); };
    const canal = supabase
      .channel("fila-em-formacao")
      .on("postgres_changes", { event: "*", schema: "public", table: "checkins" }, recarregar)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_assignments" }, recarregar)
      .subscribe();
    return () => { void supabase.removeChannel(canal); };
  }, [user?.id, queryClient]);

  if (!user?.id) return null;

  const grupos = porGrupo(fila.data ?? []);
  const presentes = (fila.data ?? []).filter((l) => l.situacao !== "bloqueado").length;

  return (
    <details className="group rounded-2xl border border-primary/35 bg-card p-4">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
        <ListOrdered className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="font-display text-sm font-bold">Fila em formação</h2>
        <span className="text-xs text-muted-foreground">
          {fila.isPending ? "consultando…" : `${presentes} corretor(es) em check-in hoje`}
        </span>
        <ChevronDown className="ml-auto h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>

      <div className="mt-3 space-y-3">
        {fila.isError && (
          <p role="alert" className="text-xs text-destructive">
            {describeError(fila.error, "Não consegui ler a fila agora; tente de novo em instantes.")}
          </p>
        )}
        {!fila.isPending && !fila.isError && grupos.length === 0 && (
          <p className="text-xs text-muted-foreground">Ninguém em check-in nos grupos de distribuição ainda.</p>
        )}
        {grupos.map((g) => (
          <section key={g.id} aria-label={`Fila ${g.nome}`}>
            <p className="mb-1 text-xs font-semibold">{g.nome}</p>
            <ol className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {g.linhas.map((l) => {
                const s = SITUACAO[l.situacao];
                const volta = voltou(l);
                return (
                  <li key={l.profile_id} className="flex items-center gap-2 rounded bg-secondary/40 px-2 py-1 text-xs">
                    <span className="w-7 text-center font-bold tabular-nums">{l.posicao ? `${l.posicao}º` : "—"}</span>
                    <span className="min-w-0 flex-1 truncate">{l.full_name}</span>
                    <StatusBadge tone={s.tone} className="px-1.5 py-0 text-xs">
                      {l.situacao === "aguardando" ? `abre ${l.abre_as}` : l.situacao === "bloqueado" ? `${l.atrasados} atrasado(s)` : s.texto}
                    </StatusBadge>
                    {/* A fila anda pela hora em que cada um ENTROU nela por último:
                        o check-in, ou a volta depois de atender/perder o prazo
                        (0263). Mostrar só o check-in fazia parecer que alguém
                        de 09:28 passou na frente de quem entrou 09:04. */}
                    {volta
                      ? <span className="text-muted-foreground tabular-nums" title={`Check-in ${hora(l.checked_in_at)}; voltou à fila depois de receber`}>voltou {hora(volta)}</span>
                      : <span className="text-muted-foreground tabular-nums" title="Hora do check-in">{hora(l.checked_in_at)}</span>}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
        <p className="text-xs text-muted-foreground">
          Ordem de chegada: quem faz check-in entra no fim e quem recebe vai para o fim. "Abre HH:MM" = bateu ponto e entra na fila quando a
          distribuição do turno abrir; bloqueado = leads atrasados acima do limite.
        </p>
      </div>
    </details>
  );
}
