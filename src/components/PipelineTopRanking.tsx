import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronDown, Flame, Lightbulb, Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SectionCard } from "@/components/shared";
import { cn } from "@/lib/utils";
import { num } from "@/lib/format";
import type { PipelineDeal } from "@/types/crm";
import { useGameRanking } from "@/hooks/useGameRanking";

type Props = { deals: PipelineDeal[] };

/**
 * O que este papel vê no card — a regra sozinha, para o teste alcançar.
 *
 * Falha FECHADO: papel desconhecido cai no recorte mais estreito (só a própria
 * posição). Errar para o lado estreito esconde informação de quem talvez
 * pudesse vê-la; errar para o largo publica o placar da empresa para quem não
 * deveria — e papel novo no enum é exatamente o caso em que ninguém lembra de
 * voltar aqui.
 */
export function recorteDoRanking(role: string): { soMinhaPosicao: boolean; escopo: string } {
  if (role === "admin") return { soMinhaPosicao: false, escopo: "Empresa" };
  if (role === "director") return { soMinhaPosicao: false, escopo: "Sua diretoria" };
  if (role === "manager") return { soMinhaPosicao: false, escopo: "Sua equipe" };
  return { soMinhaPosicao: true, escopo: "Sua posição" };
}

/**
 * Ranking do game no Pipeline — três recortes, um por quem está olhando.
 *
 * Decisão do dono em 05/09/2026:
 *   · corretor  → só a posição DELE. Ele já vê o pódio completo em Gamificação;
 *                 aqui, no meio do trabalho, o que interessa é onde ele está.
 *   · gerente e diretor → top 3 da equipe/diretoria que lideram.
 *   · admin e sócio     → top 3 da empresa.
 *
 * O RECORTE DOS DADOS continua sendo do servidor (`visible_game_ranking`): esta
 * tela escolhe o que MOSTRA do que já chegou, e nunca o contrário. Um sócio com
 * poderes de administrador entra pelo ramo de admin, porque carrega os dois
 * papéis; sócio que só acompanha cai no recorte estreito, que é o certo para
 * quem só lê.
 *
 * Enxugado no mesmo passo (pedido de 05/09: "um pouco poluído", "ranking está
 * grande"): o card perdeu o gradiente e o badge de contagem — a contagem agora
 * vive no botão que expande a lista, onde ela serve para alguma coisa.
 */
export default function PipelineTopRanking({ deals }: Props) {
  const dealsForHook = deals.map((d) => ({
    broker1_name: d.broker1,
    broker2_name: d.broker2,
    stage: d.stage,
    active: d.active,
  }));
  const { role, scoped, meuScore, minhaPosicao } = useGameRanking(dealsForHook);
  const [openInfo, setOpenInfo] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  const [tip, setTip] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string | null; message: string } | null>(null);

  const loadInfo = async () => {
    const [{ data: tips }, { data: notices }] = await Promise.all([
      supabase.from("gold_tips").select("body").eq("active", true).order("created_at", { ascending: false }).limit(1),
      supabase.from("important_notices").select("title,body").eq("active", true).order("created_at", { ascending: false }).limit(1),
    ]);
    setTip(tips?.[0]?.body ?? null);
    setNotice(notices?.[0] ? { title: notices[0].title, message: notices[0].body } : null);
  };

  const openInfoDialog = async () => { await loadInfo(); setOpenInfo(true); };

  if (!scoped.length) return null;

  const { soMinhaPosicao, escopo } = recorteDoRanking(role);

  return (
    <>
      <SectionCard
        title={`Ranking do game — ${escopo}`}
        icon={Flame}
        className="mx-auto max-w-4xl"
      >
        {soMinhaPosicao ? (
          <MinhaPosicao
            posicao={minhaPosicao}
            total={scoped.length}
            pontos={meuScore?.points ?? 0}
            detalhe={meuScore ? `${meuScore.vendas}V · ${meuScore.aprovados}A · ${meuScore.analises}An` : null}
            onDetalhes={() => void openInfoDialog()}
          />
        ) : (
          <div className="space-y-2">
            {/* Lista, e não o pódio de pedestais.
                Medido a 1440x900: o pódio ocupava ~350 px — a primeira dobra
                inteira do Pipeline, empurrando o quadro de negócios (que é o
                trabalho) para baixo da linha d'água. Pedido do cliente em
                05/09: "o ranking está um pouco grande". O pódio continua na
                tela de Gamificação, que é onde ele é o assunto.

                Top 3 e resto usam a MESMA linha: dois renderizadores para a
                mesma informação divergem na primeira mudança de layout. */}
            <ol className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
              {(verTodos ? scoped : scoped.slice(0, 3)).map((s, i) => (
                <li key={s.broker.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span
                    className={cn(
                      "w-7 shrink-0 text-right font-semibold tabular-nums",
                      i === 0 ? "text-gold" : i === 1 ? "text-silver" : i === 2 ? "text-bronze" : "text-muted-foreground",
                    )}
                  >
                    {i + 1}º
                  </span>
                  <span className="min-w-0 flex-1 truncate">{s.broker.name}</span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                    {s.vendas}V · {s.aprovados}A · {s.analises}An
                  </span>
                  <span className="w-16 shrink-0 text-right font-semibold tabular-nums">{num(s.points)}</span>
                </li>
              ))}
            </ol>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => void openInfoDialog()}
                className="rounded-full px-1 text-xs text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Mensagem do dia
              </button>

              {scoped.length > 3 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  aria-expanded={verTodos}
                  onClick={() => setVerTodos((v) => !v)}
                >
                  {verTodos ? "Mostrar só o top 3" : `Ver todos (${num(scoped.length)})`}
                  <ChevronDown className={cn("ml-1 h-3.5 w-3.5 transition-transform", verTodos && "rotate-180")} aria-hidden />
                </Button>
              )}
            </div>
          </div>
        )}
      </SectionCard>
      <InfoDialog open={openInfo} onOpenChange={setOpenInfo} tip={tip} notice={notice} />
    </>
  );
}

/**
 * A linha do corretor.
 *
 * Uma métrica grande (a colocação) e o resto pequeno — a hierarquia que faltava
 * quando o card trazia quatro números do mesmo tamanho.
 *
 * `posicao` nula significa que a pessoa não está no ranking da temporada. Isso
 * NÃO é "0º lugar": é conta sem pontuação ainda, e escrever um número aqui
 * inventaria uma colocação que o placar não tem.
 */
function MinhaPosicao({
  posicao, total, pontos, detalhe, onDetalhes,
}: {
  posicao: number | null;
  total: number;
  pontos: number;
  detalhe: string | null;
  onDetalhes: () => void;
}) {
  if (posicao === null) {
    return (
      <button
        type="button"
        onClick={onDetalhes}
        className="w-full rounded-xl border border-border/60 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Você ainda não pontuou nesta temporada. Cada análise enviada, aprovação e venda entra no placar.
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onDetalhes}
      aria-label={`Sua posição: ${posicao} de ${total}, ${pontos} pontos. Abrir mensagem do dia.`}
      className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/60 px-4 py-3 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="font-display text-4xl font-bold leading-none tabular-nums text-foreground">
        {posicao}
        <span className="ml-0.5 align-top text-lg text-muted-foreground">º</span>
      </span>
      <span className="text-xs text-muted-foreground">de {num(total)} no ranking</span>
      <span className="ml-auto text-right">
        <span className="block text-sm font-semibold tabular-nums text-foreground">{num(pontos)} pts</span>
        {detalhe && <span className="block text-xs text-muted-foreground">{detalhe}</span>}
      </span>
    </button>
  );
}

function InfoDialog({
  open, onOpenChange, tip, notice,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  tip: string | null; notice: { title: string | null; message: string } | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-warning" /> Mensagem do dia
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border border-border p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-primary">
              <Megaphone className="h-4 w-4" /> {notice?.title || "Aviso"}
            </div>
            <p className="whitespace-pre-wrap text-sm text-foreground">
              {notice?.message || "Sem avisos ativos no momento."}
            </p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-warning">
              <Lightbulb className="h-4 w-4" /> Dica de ouro
            </div>
            <p className="whitespace-pre-wrap text-sm text-foreground">
              {tip || "Nenhuma dica de ouro publicada ainda."}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
