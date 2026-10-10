import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, Play } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/shared";
import { describeError } from "@/lib/supabaseError";
import { anuncioPorId, artesDoAnuncio, ROTULO_FORMATO, type Anuncio } from "@/integrations/supabase/anuncios";

/**
 * Arte (1:1) e copy do anúncio (0265). Recebe o anúncio pronto (tela de
 * Campanhas) ou só o id (card do lead), e então busca no banco.
 */
export function AnuncioDialog({ adId, anuncio, titulo, onClose }: {
  adId?: string | null;
  anuncio?: Anuncio | null;
  titulo?: string | null;
  onClose: () => void;
}) {
  const busca = useQuery({
    queryKey: ["anuncio", adId],
    queryFn: () => anuncioPorId(adId ?? ""),
    enabled: !anuncio && Boolean(adId),
  });
  const a = anuncio ?? busca.data ?? null;
  const artes = a ? artesDoAnuncio(a) : [];
  const [atual, setAtual] = useState(0);
  const arte = artes[Math.min(atual, artes.length - 1)];

  async function copiar() {
    if (!a?.copy) return;
    try {
      await navigator.clipboard.writeText(a.copy);
      toast.success("Copy copiada");
    } catch {
      toast.error("Não consegui copiar: selecione o texto e copie à mão.");
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {a?.campanha_nome ?? a?.nome ?? titulo ?? "Anúncio"}
            {a && <Badge variant="outline">{ROTULO_FORMATO[a.formato]}</Badge>}
          </DialogTitle>
          <DialogDescription>{a?.nome && a.nome !== a.campanha_nome ? a.nome : "Arte e copy do anúncio"}</DialogDescription>
        </DialogHeader>

        {!anuncio && busca.isPending && <LoadingState variant="list" rows={2} label="Carregando o anúncio…" />}
        {!anuncio && busca.isError && (
          <p className="text-sm text-destructive">{describeError(busca.error, "Não consegui carregar o anúncio.")}</p>
        )}
        {!anuncio && !busca.isPending && !busca.isError && !a && (
          <p className="text-sm text-muted-foreground">
            A arte deste anúncio ainda não foi sincronizada com a Meta. Ela chega em até 1 hora.
          </p>
        )}

        {a && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="relative aspect-square overflow-hidden rounded-lg bg-black">
                {arte
                  ? <img src={arte} alt={`Arte do anúncio ${a.nome ?? ""}`} className="h-full w-full object-contain" />
                  : <p className="flex h-full items-center justify-center p-4 text-center text-xs text-white/70">Arte indisponível</p>}
                {a.formato === "video" && arte && (
                  <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
                    <span className="rounded-full bg-black/60 p-3"><Play className="h-6 w-6 text-white" /></span>
                  </span>
                )}
              </div>
              {artes.length > 1 && (
                <div className="flex gap-1 overflow-x-auto" role="list" aria-label="Artes do carrossel">
                  {artes.map((url, i) => (
                    <button
                      key={url} type="button" onClick={() => setAtual(i)} aria-label={`Arte ${i + 1}`} aria-pressed={i === atual}
                      className={`h-14 w-14 shrink-0 overflow-hidden rounded border ${i === atual ? "border-primary" : "border-border"}`}
                    >
                      <img src={url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {a.titulo && <p className="text-sm font-semibold">{a.titulo}</p>}
              <p className="whitespace-pre-line text-sm">{a.copy ?? "Anúncio sem texto."}</p>
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                {a.copy && (
                  <Button size="sm" className="gap-1" onClick={() => void copiar()}>
                    <Copy className="h-3.5 w-3.5" /> Copiar copy
                  </Button>
                )}
                {a.preview_url && (
                  <Button size="sm" variant="outline" className="gap-1" asChild>
                    <a href={a.preview_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" /> {a.formato === "video" ? "Ver o vídeo" : "Ver anúncio"}
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
