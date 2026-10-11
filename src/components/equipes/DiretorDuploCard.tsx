import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { listCoDiretores, salvarCoDiretor } from "@/integrations/supabase/coDiretores";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingState } from "@/components/shared";
import { dbError, describeError } from "@/lib/supabaseError";

const SEM = "__sem__";

/**
 * Diretor 2 por equipe (0266), só para admin e sócio. A equipe com Diretor 2
 * aparece na hierarquia dos dois diretores, e venda, VGV e meta dividem 50/50.
 */
export function DiretorDuploCard({ diretores, nomeDe }: {
  diretores: { id: string; name: string }[];
  nomeDe: (id: string | null | undefined) => string | null;
}) {
  const qc = useQueryClient();
  const [salvando, setSalvando] = useState<string | null>(null);
  const equipes = useQuery({
    queryKey: ["equipes", "diretor-2"],
    queryFn: async () => {
      const [teams, co] = await Promise.all([
        supabase.from("teams").select("id,name,manager_id,director_id").eq("active", true).order("name"),
        listCoDiretores(),
      ]);
      if (teams.error) throw dbError("teams", teams.error);
      return (teams.data ?? []).map((t) => ({ ...t, co_director_id: co.get(t.id) ?? null }));
    },
  });

  async function trocar(teamId: string, nome: string, valor: string) {
    setSalvando(teamId);
    try {
      await salvarCoDiretor(teamId, valor === SEM ? null : valor);
      toast.success(valor === SEM ? `${nome}: só um diretor` : `${nome}: dividida 50/50 com ${nomeDe(valor) ?? "o Diretor 2"}`);
      await qc.invalidateQueries();
    } catch (e) {
      toast.error("Não foi possível salvar o Diretor 2", { description: describeError(e, "Tente de novo.") });
    } finally {
      setSalvando(null);
    }
  }

  return (
    <Card className="border-info/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><Crown className="h-4 w-4" /> Equipes com dois diretores</CardTitle>
        <p className="text-xs text-muted-foreground">
          Com Diretor 2, a equipe aparece na hierarquia dos dois e cada um leva meia venda, metade do VGV e metade da meta.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {equipes.isPending && <LoadingState variant="list" rows={3} label="Carregando equipes…" />}
        {equipes.isError && <p className="text-xs text-destructive">{describeError(equipes.error, "Não foi possível carregar as equipes.")}</p>}
        {(equipes.data ?? []).map((t) => (
          <div key={t.id} className="flex flex-col gap-2 rounded-md bg-muted/40 p-2 text-xs sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{t.name}</p>
              <p className="truncate text-muted-foreground">
                Gerente {nomeDe(t.manager_id) ?? "—"} · Diretor {nomeDe(t.director_id) ?? "—"}
              </p>
            </div>
            <Select
              value={t.co_director_id ?? SEM}
              disabled={salvando === t.id || !t.director_id}
              onValueChange={(v) => void trocar(t.id, t.name, v)}
            >
              <SelectTrigger className="h-8 w-full sm:w-56" aria-label={`Diretor 2 da equipe ${t.name}`}>
                <SelectValue placeholder="Sem Diretor 2" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Sem Diretor 2</SelectItem>
                {diretores.filter((d) => d.id !== t.director_id).map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
