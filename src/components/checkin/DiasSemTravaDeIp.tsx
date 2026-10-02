import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CalendarCheck } from "lucide-react";
import { SectionCard } from "@/components/shared";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentWorkDate } from "@/integrations/supabase/checkin";
import { cn } from "@/lib/utils";
import { dbError, describeError } from "@/lib/supabaseError";

// Tabela da 0191, ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;
const CHAVE = ["checkin", "dias-sem-ip"] as const;
const DIAS_NA_TELA = 14;

/** Os próximos `quantos` dias a partir da data da operação (AAAA-MM-DD), sem fuso do navegador. */
function proximosDias(inicio: string, quantos = DIAS_NA_TELA): string[] {
  const base = new Date(`${inicio}T12:00:00Z`);
  return Array.from({ length: quantos }, (_, i) => {
    const dia = new Date(base);
    dia.setUTCDate(base.getUTCDate() + i);
    return dia.toISOString().slice(0, 10);
  });
}

const semana = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" });
const diaMes = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

async function carregar(): Promise<{ hoje: string; marcados: Set<string> }> {
  const hoje = await getCurrentWorkDate();
  const { data, error } = await untyped.from("checkin_dias_sem_ip").select("dia").gte("dia", hoje);
  if (error) throw dbError("checkin_dias_sem_ip", error);
  return { hoje, marcados: new Set((data ?? []).map((row: { dia: string }) => row.dia)) };
}

/**
 * Dias em que o check-in não exige o IP da imobiliária (0191). Pedido de
 * 02/10/2026: "liberar a trava hoje, sábado e domingo". Turno e atrasados
 * continuam valendo; só a checagem de IP é suspensa no dia marcado.
 */
export function DiasSemTravaDeIp({ podeEditar }: { podeEditar: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: CHAVE, queryFn: carregar });
  const alternar = useMutation({
    mutationFn: async ({ dia, liberar }: { dia: string; liberar: boolean }) => {
      const { error } = liberar
        ? await untyped.from("checkin_dias_sem_ip").insert({ dia })
        : await untyped.from("checkin_dias_sem_ip").delete().eq("dia", dia);
      if (error) throw dbError("checkin_dias_sem_ip", error);
    },
    onSuccess: (_, { liberar }) => {
      toast.success(liberar ? "Dia liberado: check-in de qualquer IP" : "Trava de IP de volta neste dia", { duration: 2500 });
    },
    onError: (err) => toast.error("Não consegui salvar o dia", { description: describeError(err, "Tente de novo.") }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: CHAVE }),
  });

  return (
    <SectionCard
      title="Dias sem trava de IP"
      icon={CalendarCheck}
      description="Marque os dias em que o check-in vale de qualquer lugar (feriado, plantão, fim de semana). Turno e atrasados continuam valendo."
      contentClassName="space-y-2"
    >
      {query.error ? (
        <p className="text-sm text-destructive">{describeError(query.error, "Não consegui carregar os dias.")}</p>
      ) : !query.data ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {proximosDias(query.data.hoje).map((dia) => {
            const liberado = query.data.marcados.has(dia);
            const data = new Date(`${dia}T12:00:00Z`);
            return (
              <button
                key={dia}
                type="button"
                aria-pressed={liberado}
                disabled={!podeEditar || alternar.isPending}
                onClick={() => alternar.mutate({ dia, liberar: !liberado })}
                className={cn(
                  "min-w-[4.5rem] rounded-xl border px-3 py-2 text-center text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  liberado
                    ? "border-success/60 bg-success/15 font-semibold text-success"
                    : "border-border bg-card hover:bg-muted",
                )}
              >
                <span className="block text-xs capitalize">{dia === query.data.hoje ? "hoje" : semana.format(data).replace(".", "")}</span>
                <span className="block tabular-nums">{diaMes.format(data)}</span>
              </button>
            );
          })}
        </div>
      )}
      {!podeEditar && <p className="text-xs text-muted-foreground">Só administrador e sócio marcam os dias.</p>}
    </SectionCard>
  );
}
