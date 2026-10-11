import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crown, Loader2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { listCoDiretores, salvarCoDiretor } from "@/integrations/supabase/coDiretores";
import { listPeople, type PersonRecord } from "@/integrations/supabase/newSchema";
import { moveTeamMember } from "@/integrations/supabase/people";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const [corretoresDe, setCorretoresDe] = useState<{ id: string; name: string } | null>(null);
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
            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setCorretoresDe({ id: t.id, name: t.name })}>
              <Users className="h-3.5 w-3.5" /> Corretores
            </Button>
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
      {corretoresDe && (
        <CorretoresDaEquipe equipe={corretoresDe} onClose={() => setCorretoresDe(null)} onSalvo={() => void qc.invalidateQueries()} />
      )}
    </Card>
  );
}

/**
 * Quem entra NESTA equipe. A ficha e o vínculo em massa escolhem a equipe pelo
 * gerente, e gerente com duas equipes (Victor) não tem como dizer qual — aqui a
 * equipe é explícita. Só inclui: quem sai vai para outra equipe pela mesma via.
 */
function CorretoresDaEquipe({ equipe, onClose, onSalvo }: {
  equipe: { id: string; name: string };
  onClose: () => void;
  onSalvo: () => void;
}) {
  const pessoas = useQuery({ queryKey: ["equipes", "corretores-ativos"], queryFn: listPeople });
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [gravando, setGravando] = useState(false);
  const corretores = (pessoas.data ?? []).filter((p: PersonRecord) => p.active && p.roles.includes("broker"));
  const membros = new Set(corretores.filter((p) => p.team_id === equipe.id).map((p) => p.id));

  async function aplicar() {
    setGravando(true);
    let feitos = 0;
    try {
      for (const id of marcados) {
        if (membros.has(id)) continue;
        await moveTeamMember(id, equipe.id);
        feitos++;
      }
      toast.success(`${feitos} corretor(es) agora em ${equipe.name}`, {
        description: "As vendas novas deles já saem com os diretores desta equipe.",
      });
      onSalvo();
      onClose();
    } catch (e) {
      toast.error(`Parou depois de ${feitos} corretor(es)`, { description: describeError(e, "Tente de novo.") });
      onSalvo();
    } finally {
      setGravando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Corretores da equipe {equipe.name}</DialogTitle>
          <DialogDescription>
            Marque quem passa para esta equipe. Quem já está nela aparece marcado; para tirar alguém, mova para a outra equipe.
          </DialogDescription>
        </DialogHeader>
        {pessoas.isPending && <LoadingState variant="list" rows={4} label="Carregando corretores…" />}
        {pessoas.isError && <p className="text-xs text-destructive">{describeError(pessoas.error, "Não foi possível carregar os corretores.")}</p>}
        <div className="space-y-1">
          {corretores.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50">
              <Checkbox
                checked={membros.has(p.id) || marcados.has(p.id)}
                disabled={membros.has(p.id) || gravando}
                onCheckedChange={(v) => setMarcados((atual) => {
                  const novo = new Set(atual);
                  if (v === true) novo.add(p.id); else novo.delete(p.id);
                  return novo;
                })}
              />
              <span className="flex-1 truncate">{p.name}</span>
              <span className="truncate text-xs text-muted-foreground">{membros.has(p.id) ? "nesta equipe" : p.team || "sem equipe"}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={gravando || marcados.size === 0} onClick={() => void aplicar()} className="gap-1">
            {gravando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Passar {marcados.size} para a equipe
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
