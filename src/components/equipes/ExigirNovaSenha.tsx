import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { exigirNovaSenha, listarAlvosNovaSenha } from "@/integrations/supabase/cofre";
import { dbError, describeError } from "@/lib/supabaseError";

type Equipe = { id: string; name: string; diretor: string };

async function listarEquipes(): Promise<Equipe[]> {
  const { data, error } = await supabase
    .from("teams")
    .select("id,name,director:profiles!teams_director_id_fkey(full_name)")
    .eq("active", true)
    .order("name");
  if (error) throw dbError("teams", error);
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    diretor: (t.director as { full_name?: string } | null)?.full_name ?? "Sem diretor",
  }));
}

/**
 * Notebooks roubados (16/11/2026): o admin escolhe as equipes, confere quem
 * entra e, num clique, derruba as sessões e invalida a senha dessas pessoas.
 * Elas voltam pelo link do e-mail e criam a senha nova em Configurações (0338).
 */
export function ExigirNovaSenha() {
  const { toast } = useToast();
  const [aberto, setAberto] = useState(false);
  const [equipesMarcadas, setEquipesMarcadas] = useState<Set<string>>(new Set());
  const [desmarcados, setDesmarcados] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);

  const equipes = useQuery({ queryKey: ["exigir-senha-equipes"], queryFn: listarEquipes, enabled: aberto });
  const teamIds = useMemo(() => [...equipesMarcadas].sort(), [equipesMarcadas]);
  const alvos = useQuery({
    queryKey: ["exigir-senha-alvos", teamIds],
    queryFn: () => listarAlvosNovaSenha(teamIds),
    enabled: aberto && teamIds.length > 0,
  });

  const porDiretor = useMemo(() => {
    const grupos = new Map<string, Equipe[]>();
    for (const e of equipes.data ?? []) grupos.set(e.diretor, [...(grupos.get(e.diretor) ?? []), e]);
    return [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [equipes.data]);

  const pessoas = teamIds.length ? alvos.data ?? [] : [];
  const escolhidos = pessoas.filter((p) => !desmarcados.has(p.profile_id));

  const alternar = (set: Set<string>, id: string, marcar: boolean) => {
    const novo = new Set(set);
    if (marcar) novo.add(id); else novo.delete(id);
    return novo;
  };

  const fechar = (v: boolean) => {
    setAberto(v);
    if (!v) {
      setEquipesMarcadas(new Set());
      setDesmarcados(new Set());
    }
  };

  const confirmar = async () => {
    setEnviando(true);
    try {
      const r = await exigirNovaSenha(escolhidos.map((p) => p.profile_id));
      toast(r.falhas
        ? { title: `Feito para ${r.feitos}; ${r.falhas} falharam`, description: "Repita para as que falharam.", variant: "destructive" }
        : { title: `${r.feitos} pessoas deslogadas`, description: "No próximo acesso, entram pelo link do e-mail e criam a senha nova." });
      if (!r.falhas) fechar(false);
    } catch (error) {
      toast({ title: "Não foi possível concluir", description: describeError(error, "Tente de novo."), variant: "destructive" });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setAberto(true)}>
        <KeyRound className="h-3.5 w-3.5 mr-1" /> Exigir nova senha
      </Button>
      <Dialog open={aberto} onOpenChange={fechar}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Exigir nova senha</DialogTitle>
            <DialogDescription>
              Derruba todas as sessões abertas (inclusive em aparelhos perdidos ou roubados) e desativa a senha atual.
              Cada pessoa volta pelo link enviado ao e-mail e cria uma senha nova.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2 max-h-[55vh] overflow-y-auto">
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold">1. Equipes</legend>
              {equipes.isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
              {equipes.error && <p className="text-xs text-destructive">{describeError(equipes.error, "Falha ao carregar.")}</p>}
              {porDiretor.map(([diretor, lista]) => (
                <div key={diretor} className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">{diretor}</p>
                  {lista.map((e) => (
                    <label key={e.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={equipesMarcadas.has(e.id)}
                        onCheckedChange={(v) => setEquipesMarcadas((s) => alternar(s, e.id, v === true))}
                      />
                      {e.name}
                    </label>
                  ))}
                </div>
              ))}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">2. Pessoas ({escolhidos.length})</legend>
              {teamIds.length === 0 && <p className="text-xs text-muted-foreground">Marque ao menos uma equipe.</p>}
              {alvos.isLoading && teamIds.length > 0 && <p className="text-xs text-muted-foreground">Carregando…</p>}
              {alvos.error && <p className="text-xs text-destructive">{describeError(alvos.error, "Falha ao carregar.")}</p>}
              {pessoas.map((p) => (
                <label key={p.profile_id} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={!desmarcados.has(p.profile_id)}
                    onCheckedChange={(v) => setDesmarcados((s) => alternar(s, p.profile_id, v !== true))}
                  />
                  <span>
                    {p.full_name}
                    <span className="block text-xs text-muted-foreground">{p.equipes}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => fechar(false)} disabled={enviando}>Cancelar</Button>
            <Button variant="destructive" onClick={() => void confirmar()} disabled={enviando || escolhidos.length === 0}>
              {enviando ? "Aplicando…" : `Deslogar e exigir nova senha (${escolhidos.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
