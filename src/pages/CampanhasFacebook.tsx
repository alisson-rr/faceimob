import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, Loader2, Megaphone, Play, RefreshCw, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingState, PageHeader } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { describeError } from "@/lib/supabaseError";
import { AnuncioDialog } from "@/components/anuncios/AnuncioDialog";
import { artesDoAnuncio, atualizarAnuncios, listAnunciosAtivos, ROTULO_FORMATO, type Anuncio } from "@/integrations/supabase/anuncios";

const CHAVE = ["anuncios", "ativos"] as const;

/** Busca sem acento e sem caixa, no nome da campanha, do anúncio e na copy. */
const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Campanhas do Facebook (0265): os anúncios ativos da conta, com arte e copy,
 * para o corretor replicar nas conversas. A lista se mantém sozinha — a
 * sincronização de hora em hora inclui o anúncio novo e tira o desligado.
 */
export default function CampanhasFacebook() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<Anuncio | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const lista = useQuery({ queryKey: CHAVE, queryFn: listAnunciosAtivos });

  const visiveis = useMemo(() => {
    const termo = normalizar(busca.trim());
    const todos = lista.data ?? [];
    if (!termo) return todos;
    return todos.filter((a) => normalizar(`${a.campanha_nome ?? ""} ${a.nome ?? ""} ${a.copy ?? ""}`).includes(termo));
  }, [lista.data, busca]);

  async function atualizar() {
    setAtualizando(true);
    try {
      await atualizarAnuncios();
      await qc.invalidateQueries({ queryKey: CHAVE });
      toast.success("Anúncios atualizados com a Meta");
    } catch (e) {
      toast.error("Não foi possível atualizar", { description: describeError(e, "Tente de novo em instantes.") });
    } finally {
      setAtualizando(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Campanhas do Facebook"
        icon={Megaphone}
        description="Anúncios ativos, prontos para você replicar nas conversas."
        actions={
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{lista.data?.length ?? 0} anúncios ativos</span>
            {can("marketing.meta_manage") && (
              <Button size="sm" variant="outline" className="gap-1" disabled={atualizando} onClick={() => void atualizar()}>
                {atualizando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Atualizar
              </Button>
            )}
          </div>
        }
      />

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar campanha ou texto do anúncio" className="pl-9" aria-label="Buscar campanha" />
      </div>

      {lista.isPending && <LoadingState variant="list" rows={4} label="Carregando anúncios…" />}
      {lista.isError && <p className="text-sm text-destructive">{describeError(lista.error, "Não foi possível carregar os anúncios.")}</p>}
      {!lista.isPending && !lista.isError && visiveis.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {busca ? "Nenhum anúncio com essa busca." : "Nenhum anúncio ativo sincronizado ainda. A lista se atualiza de hora em hora."}
        </p>
      )}

      {visiveis.length > 0 && (
        <Card className="divide-y divide-border/60 overflow-hidden">
          {visiveis.map((a) => {
            const capa = artesDoAnuncio(a)[0];
            return (
              <button
                key={a.ad_id} type="button" onClick={() => setAberto(a)}
                className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/40"
              >
                <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
                  {capa && <img src={capa} alt="" loading="lazy" className="h-full w-full object-cover" />}
                  {a.formato === "video" && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/30" aria-hidden>
                      <Play className="h-5 w-5 text-white" />
                    </span>
                  )}
                  {a.formato === "carrossel" && a.imagens.length > 1 && (
                    <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 text-xs text-white">{a.imagens.length}</span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">{a.campanha_nome ?? a.nome ?? "Anúncio"}</span>
                    <Badge variant="outline">{ROTULO_FORMATO[a.formato]}</Badge>
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">{a.copy ?? a.nome ?? ""}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            );
          })}
        </Card>
      )}

      {aberto && <AnuncioDialog anuncio={aberto} onClose={() => setAberto(null)} />}
    </div>
  );
}
