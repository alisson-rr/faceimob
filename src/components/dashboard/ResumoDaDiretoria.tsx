import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Building2 } from "lucide-react";
import { SectionCard } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { displayMonthToIso } from "@/integrations/supabase/newSchema";
import { brl, num } from "@/lib/format";
import { currentMonthBase } from "@/lib/dealStatus";
import { describeError } from "@/lib/supabaseError";
import { ALL_MONTHS } from "./data";

// RPC da 0202, ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;

type Linha = {
  director_id: string;
  director_name: string;
  team_id: string;
  team_name: string;
  manager_name: string | null;
  vendas: number;
  vgv: number;
  total_vendas: number;
  total_vgv: number;
};

/** Agrupa as equipes por diretoria, na ordem que o banco devolve. */
function porDiretoria(linhas: Linha[]) {
  const mapa = new Map<string, { nome: string; vendas: number; vgv: number; equipes: Linha[] }>();
  for (const l of linhas) {
    const d = mapa.get(l.director_id) ?? { nome: l.director_name, vendas: l.total_vendas, vgv: Number(l.total_vgv), equipes: [] };
    d.equipes.push(l);
    mapa.set(l.director_id, d);
  }
  return [...mapa.entries()].map(([id, d]) => ({ id, ...d }));
}

/**
 * A diretoria do gerente no Dashboard (pedido de 03/10/2026): vendas e VGV do
 * mês da diretoria inteira e de cada equipe dela. A RLS só entrega ao gerente a
 * própria equipe; os números vêm agregados da RPC `resumo_da_diretoria`.
 */
export function ResumoDaDiretoria({ month }: { month: string }) {
  const { roles } = useAuth();
  const lidera = roles.includes("manager") || roles.includes("director");
  const mes = month === ALL_MONTHS ? currentMonthBase() : month;

  const consulta = useQuery({
    queryKey: ["dashboard", "resumo-da-diretoria", mes],
    queryFn: async (): Promise<Linha[]> => {
      const { data, error } = await untyped.rpc("resumo_da_diretoria", { p_mes: displayMonthToIso(mes) });
      if (error) throw error;
      return (data ?? []) as Linha[];
    },
    enabled: lidera,
    staleTime: 60_000,
  });

  if (!lidera) return null;
  if (consulta.isError) {
    return (
      <SectionCard title="Sua diretoria" icon={Building2} description={`Vendas do mês ${mes}`}>
        <p className="text-sm text-destructive">{describeError(consulta.error, "Não consegui carregar os números da diretoria.")}</p>
      </SectionCard>
    );
  }
  const diretorias = porDiretoria(consulta.data ?? []);
  if (consulta.isPending || diretorias.length === 0) return null;

  return (
    <>
      {diretorias.map((d) => (
        <SectionCard
          key={d.id}
          title={`Diretoria · ${d.nome}`}
          icon={Building2}
          description={`Vendas do mês-base ${mes} de todas as equipes da diretoria`}
        >
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-success/40 bg-success/5 px-3 py-2">
              <p className="text-eyebrow">Vendas da diretoria</p>
              <p className="text-2xl font-bold tabular-nums">{num(d.vendas)}</p>
            </div>
            <div className="rounded-xl border border-border px-3 py-2">
              <p className="text-eyebrow">VGV da diretoria</p>
              <p className="text-2xl font-bold tabular-nums">{brl(d.vgv, { cents: true })}</p>
            </div>
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {d.equipes.map((e) => (
              <li key={e.team_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {e.team_name}
                  {e.manager_name && <span className="text-muted-foreground"> · {e.manager_name}</span>}
                </span>
                <span className="tabular-nums">{num(e.vendas)} venda(s)</span>
                <span className="w-32 text-right tabular-nums text-muted-foreground">{brl(Number(e.vgv), { cents: true })}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ))}
    </>
  );
}
