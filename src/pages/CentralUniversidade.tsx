import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Eye, FileDown, GraduationCap, PlayCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import {
  carregarUniversidade, concluirAula, playerDaAula, registrarVisualizacao, segundosDaDuracao, type AulaDaUniversidade,
} from "@/integrations/supabase/central";
import { describeError } from "@/lib/supabaseError";
import { cn } from "@/lib/utils";

/** Sem a duração da aula, o botão de concluir libera depois deste tempo assistindo. */
const ESPERA_PADRAO_SEG = 60;

/**
 * Universidade Faceimob dentro do CRM (04/10/2026, etapa 1 de trazer a
 * administração do site): as mesmas aulas, o mesmo progresso e o mesmo XP do
 * site (+50 por aula inédita, nível a cada 100). Concluir: o vídeo em arquivo
 * conclui sozinho aos 90%; YouTube/Vimeo liberam o botão depois de 90% da
 * duração cadastrada assistida com a aula aberta.
 */
export default function CentralUniversidade() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const [aberta, setAberta] = useState<AulaDaUniversidade | null>(null);

  const universidade = useQuery({
    queryKey: ["central", "universidade", userId],
    queryFn: () => carregarUniversidade(userId),
    enabled: Boolean(userId),
  });

  const conclusao = useMutation({
    mutationFn: (aulaId: string) => concluirAula(aulaId),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ["central", "universidade", userId] });
      void queryClient.invalidateQueries({ queryKey: ["central", "progresso", userId] });
      toast({
        title: r.primeira ? "Aula concluída! +50 XP" : "Aula já concluída",
        description: `Nível ${r.nivel} · ${r.experiencia} XP. Faltam ${100 - (r.experiencia % 100)} XP para o próximo nível.`,
      });
      setAberta(null);
    },
    onError: (e) => toast({ variant: "destructive", title: describeError(e, "Não consegui concluir a aula.") }),
  });

  const abrir = (aula: AulaDaUniversidade) => {
    setAberta(aula);
    registrarVisualizacao(aula.id).catch(() => undefined);
  };

  const dados = universidade.data;
  const total = dados?.secoes.reduce((n, s) => n + s.aulas.length, 0) ?? 0;
  const feitas = dados?.secoes.reduce((n, s) => n + s.aulas.filter((a) => a.concluida).length, 0) ?? 0;

  return (
    <div className="space-y-6">
      <Link to="/central" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Central do Corretor
      </Link>
      <PageHeader
        icon={GraduationCap}
        eyebrow="Central do Corretor"
        title="Universidade Faceimob"
        description="Aulas de Meta Ads, atendimento e fechamento. Cada aula inédita concluída vale +50 XP."
      />

      {universidade.isError ? (
        <p role="alert" className="text-sm text-destructive">{describeError(universidade.error, "Não consegui carregar as aulas.")}</p>
      ) : universidade.isPending ? (
        <LoadingState variant="block" rows={3} label="Carregando as aulas…" />
      ) : !dados || total === 0 ? (
        <EmptyState icon={GraduationCap} title="Nenhuma aula publicada" description="As aulas são cadastradas no painel do site, em Universidade." />
      ) : (
        <>
          <Card className="flex flex-wrap items-center gap-6 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Seu nível</p>
              <p className="font-display text-3xl font-bold text-gold">{dados.nivel}</p>
            </div>
            <div className="min-w-[200px] flex-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">{dados.experiencia} XP <Sparkles className="h-3 w-3" aria-hidden /></span>
                <span>{feitas} de {total} aulas</span>
              </div>
              <div
                role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={dados.experiencia % 100}
                aria-label="XP para o próximo nível" className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full rounded-full bg-gold" style={{ width: `${dados.experiencia % 100}%` }} />
              </div>
            </div>
          </Card>

          {dados.secoes.map((secao) => (
            <section key={secao.id} className="space-y-3">
              <div>
                <h2 className="font-display text-lg font-semibold">{secao.title}</h2>
                {secao.description && <p className="text-sm text-muted-foreground">{secao.description}</p>}
              </div>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {secao.aulas.map((aula) => (
                  <li key={aula.id}>
                    <button
                      type="button" onClick={() => abrir(aula)}
                      className="block w-full rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Card className={cn("overflow-hidden transition-colors hover:border-primary/60", aula.concluida && "border-success/40")}>
                        <span className="relative block aspect-video bg-muted">
                          {aula.cover_url
                            ? <img src={aula.cover_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                            : <span className="flex h-full items-center justify-center text-muted-foreground"><PlayCircle className="h-10 w-10" aria-hidden /></span>}
                          {aula.concluida && (
                            <span className="absolute right-2 top-2"><StatusBadge tone="success" icon={CheckCircle2}>Concluída</StatusBadge></span>
                          )}
                        </span>
                        <span className="block p-3">
                          <span className="block font-semibold">{aula.title}</span>
                          <span className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                            {aula.duration_label && <span>{aula.duration_label}</span>}
                            <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" aria-hidden /> {aula.views_count}</span>
                          </span>
                        </span>
                      </Card>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      <Dialog open={Boolean(aberta)} onOpenChange={(o) => { if (!o) setAberta(null); }}>
        <DialogContent className="max-w-3xl">
          {aberta && (
            <Aula
              aula={aberta}
              concluindo={conclusao.isPending}
              onConcluir={() => conclusao.mutate(aberta.id)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Aula({ aula, concluindo, onConcluir }: { aula: AulaDaUniversidade; concluindo: boolean; onConcluir: () => void }) {
  const player = playerDaAula(aula.video_url);
  const duracao = segundosDaDuracao(aula.duration_label);
  const espera = Math.round((duracao ?? ESPERA_PADRAO_SEG / 0.9) * 0.9);
  const [aberto, setAberto] = useState(0);
  const [concluiuSozinho, setConcluiuSozinho] = useState(false);

  // YouTube e Vimeo não contam o tempo daqui: conta o tempo com a aula aberta.
  useEffect(() => {
    if (aula.concluida || player?.tipo !== "iframe") return;
    const t = setInterval(() => setAberto((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [aula.concluida, player?.tipo]);

  const liberado = aula.concluida || aberto >= espera;
  const faltam = Math.max(0, espera - aberto);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{aula.title}</DialogTitle>
        {aula.description && <DialogDescription>{aula.description}</DialogDescription>}
      </DialogHeader>
      {player ? (
        player.tipo === "iframe" ? (
          <iframe
            title={aula.title} src={player.src} className="aspect-video w-full rounded-xl border-0"
            allow="autoplay; fullscreen; picture-in-picture" allowFullScreen
          />
        ) : (
          <video
            src={player.src} controls className="aspect-video w-full rounded-xl bg-black"
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (!aula.concluida && !concluiuSozinho && v.duration && v.currentTime / v.duration >= 0.9) {
                setConcluiuSozinho(true);
                onConcluir();
              }
            }}
          />
        )
      ) : (
        <p className="text-sm text-muted-foreground">Esta aula ainda não tem vídeo.</p>
      )}

      {aula.materials.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Materiais</p>
          <ul className="flex flex-wrap gap-2">
            {aula.materials.map((m) => (
              <li key={m.url}>
                <a href={m.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:border-primary/60">
                  <FileDown className="h-3.5 w-3.5" aria-hidden /> {m.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {!liberado && player?.tipo === "iframe" && (
          <span className="text-xs text-muted-foreground">
            Assista à aula: o botão libera em {Math.floor(faltam / 60)}:{String(faltam % 60).padStart(2, "0")}
          </span>
        )}
        <Button onClick={onConcluir} disabled={!liberado || concluindo || aula.concluida}>
          <CheckCircle2 className="h-4 w-4" />
          {aula.concluida ? "Aula concluída" : concluindo ? "Concluindo…" : "Concluí a aula"}
        </Button>
      </div>
    </>
  );
}
