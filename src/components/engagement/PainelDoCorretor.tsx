import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, LoadingState } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { recorteDoRanking, useCurrentSeasonId, useSeasonRanking } from "@/hooks/useGameRanking";
import { gameKeys, listEffectiveScoringRules } from "@/integrations/supabase/game";
import { loadMuralDoDia, recadosKeys } from "@/integrations/supabase/recados";
import { num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { podiumRingClass } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { MedalhaComFita } from "./MedalhaComFita";
import { itensDoGame } from "./painel/itensDoGame";
import { ordenarRanking } from "./ranking";

/**
 * Painel — o quadro do game no Pipeline: os itens que pontuaram, os recados da
 * operação e o placar.
 *
 * Comportamento ditado pelo cliente (11/09/2026):
 *   · abre SOZINHO para o corretor TODA VEZ que ele carrega o Pipeline — não
 *     "uma vez por dia", que nunca foi pedido;
 *   · qualquer perfil abre pelo card de game do topo ou pelo "Ver mais" dele;
 *   · o recorte é o do GAME (a temporada aberta), não o do dia.
 *
 * O que cada um vê sai de `recorteDoRanking`:
 *   · corretor → os itens dele e o top 3 da equipe;
 *   · gerente, diretor, admin e sócio → a soma do recorte e o ranking inteiro
 *     dele (a equipe, a diretoria, a casa).
 * QUAIS pessoas chegam é decisão do banco (`can_see_game_profile`, 0060/0112);
 * o front só escolhe quanto da lista mostrar.
 */

/**
 * O estado do modal, com a abertura automática junto.
 *
 * Decide uma vez por montagem da página: é o "toda vez que carregar" do
 * cliente, e não a cada re-render ou troca de papel.
 */
export function usePainelDoCorretor() {
  const { role, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const decidiu = useRef(false);

  useEffect(() => {
    // `loading` é obrigatório: até o perfil chegar, `role` ainda é o padrão
    // "broker" do contexto — sem esta guarda o modal abriria na cara do admin
    // no meio do carregamento.
    if (loading || decidiu.current) return;
    decidiu.current = true;
    // `role` é o papel EFETIVO (`primaryRole`), nunca "roles inclui broker":
    // toda conta nova ganha `broker` e nunca perde, e o `includes` abriria o
    // modal também para admin, gerente e diretor.
    if (role === "broker") setOpen(true);
  }, [loading, role]);

  return { open, setOpen, abrir: () => setOpen(true) };
}

export interface PainelDoCorretorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function PainelDoCorretor({ open, onOpenChange }: PainelDoCorretorProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Um X só: o `DialogContent` do shadcn já desenha o dele (ui/dialog.tsx).
          O "Fechar" do rodapé é o do print e não repete o ícone. */}
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Painel</DialogTitle>
          {/* O print tem só o título. A descrição fica no DOM em `sr-only`
              porque é ela o `aria-describedby` do diálogo. */}
          <DialogDescription className="sr-only">
            Os itens do game que pontuaram na temporada, os recados da operação e o
            placar do seu recorte.
          </DialogDescription>
        </DialogHeader>

        {/* O conteúdo é um filho para os hooks dele só rodarem com o modal
            ABERTO: o Radix não monta o portal enquanto fechado. */}
        <Colunas />

        <DialogFooter className="sm:justify-center">
          <DialogClose asChild>
            <Button variant="outline">Fechar</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Colunas() {
  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto lg:grid-cols-3 lg:overflow-hidden">
      <Pontuacao />
      <Mural />
      <Destaques />
    </div>
  );
}

/** Caixa comum das três colunas: título âmbar e o conteúdo logo abaixo, como no print. */
function Caixa({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-border bg-card p-4 text-card-foreground">
      <h3 className="mb-3 font-display text-sm font-bold text-warning">{titulo}</h3>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

/**
 * Coluna 1 — os itens do game que contaram ponto na temporada aberta.
 *
 * É a mesma pontuação do placar (`visible_game_ranking.breakdown`) aberta por
 * regra, com o rótulo e a ordem das regras vigentes da temporada: se o admin
 * criar ou renomear uma regra, ela aparece aqui sem código.
 */
function Pontuacao() {
  const { roles, isAdmin, user } = useAuth();
  const { soMinhaPosicao, escopo } = recorteDoRanking(roles, isAdmin);
  const temporada = useCurrentSeasonId();
  const placar = useSeasonRanking(temporada.data);
  // Mesma chave e mesma leitura da tela de Gamificação: cache compartilhado.
  const regras = useQuery({
    queryKey: gameKeys.rules(temporada.data ?? null),
    queryFn: () => listEffectiveScoringRules(temporada.data ?? null),
    enabled: Boolean(temporada.data),
    staleTime: 30_000,
  });
  const titulo = soMinhaPosicao ? "Sua pontuação" : `Pontuação · ${escopo}`;

  if (temporada.isError || placar.isError || regras.isError) {
    return (
      <Caixa titulo={titulo}>
        {/* Falha de leitura NÃO vira zero: zero é uma afirmação sobre o placar
            que a tela não conseguiu fazer. */}
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar a pontuação"
          description={describeError(
            temporada.error ?? placar.error ?? regras.error,
            "A leitura do game falhou.",
          )}
        />
      </Caixa>
    );
  }

  if (temporada.isPending || (temporada.data && (placar.isPending || regras.isPending))) {
    return (
      <Caixa titulo={titulo}>
        <LoadingState variant="list" rows={5} label="Carregando a pontuação…" />
      </Caixa>
    );
  }

  if (!temporada.data) {
    return (
      <Caixa titulo={titulo}>
        <p className="text-sm text-muted-foreground">
          Nenhuma temporada aberta no momento. A pontuação volta quando a próxima começar.
        </p>
      </Caixa>
    );
  }

  const { total, itens } = itensDoGame(placar.data ?? [], regras.data ?? [], {
    soMinhaPosicao,
    meuId: user?.id ?? null,
  });
  const maior = Math.max(0, ...itens.map((item) => item.points));

  return (
    <Caixa titulo={titulo}>
      <p className="mb-4 font-display text-2xl font-bold tabular-nums text-gold">{num(total)} pts</p>
      <ul className="space-y-4">
        {itens.map((item) => {
          // Piso de 4% para valor > 0: um item pequeno ao lado de uma venda
          // some no trilho. Zero e negativo (distrato) ficam sem preenchimento
          // — o número ao lado diz o resto.
          const pct = item.points > 0 ? Math.max(4, Math.round((item.points / maior) * 100)) : 0;
          return (
            <li key={item.code} className="space-y-1.5">
              <p className="text-sm font-semibold text-foreground">{item.label}</p>
              <div className="flex items-center gap-2">
                <div
                  aria-hidden
                  className="h-3 min-w-0 flex-1 overflow-hidden rounded-full border border-border bg-muted"
                >
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width]",
                      item.code === "venda" ? "bg-success" : "bg-primary",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span
                  className={cn(
                    "w-16 shrink-0 text-right text-sm font-semibold tabular-nums",
                    item.points < 0 ? "text-destructive" : "text-foreground",
                  )}
                >
                  {num(item.points)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Caixa>
  );
}

/** Coluna 2 — recados e Dica de Ouro, como a operação escreveu. */
function Mural() {
  const mural = useQuery({
    queryKey: recadosKeys.mural,
    queryFn: loadMuralDoDia,
    staleTime: 5 * 60_000,
  });

  if (mural.isPending) {
    return (
      <Caixa titulo="Recados Faceimob">
        <LoadingState variant="list" rows={3} label="Carregando os recados…" />
      </Caixa>
    );
  }

  if (mural.isError) {
    return (
      <Caixa titulo="Recados Faceimob">
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar os recados"
          description={describeError(mural.error, "A leitura do mural falhou.")}
        />
      </Caixa>
    );
  }

  const { recados, dicas } = mural.data;

  return (
    <Caixa titulo="Recados Faceimob">
      <div className="space-y-4">
        {recados.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum recado publicado no momento.</p>
        )}

        {recados.map((recado) => (
          <article key={recado.id}>
            <h4
              className={cn(
                "text-sm font-bold",
                recado.severity === "critical"
                  ? "text-destructive"
                  : recado.severity === "warning"
                    ? "text-warning"
                    : "text-foreground",
              )}
            >
              {recado.title}
            </h4>
            {/* Texto puro com as quebras que a operação digitou. Recado NÃO é
                HTML: interpretar o corpo aqui abriria XSS num campo que
                gerente e diretor escrevem. */}
            <p className="whitespace-pre-wrap text-sm text-foreground">{recado.body}</p>
          </article>
        ))}

        {dicas.length > 0 && (
          <div className="space-y-3 pt-2">
            {/* Sublinhado e sem ícone, como no print — é o segundo título da
                coluna e precisa se distinguir do corpo do recado. */}
            <h4 className="font-display text-sm font-bold text-warning underline underline-offset-4">
              Dica de Ouro
            </h4>
            {dicas.map((dica) => (
              <p key={dica.id} className="whitespace-pre-wrap text-sm text-foreground">
                {dica.body}
              </p>
            ))}
          </div>
        )}
      </div>
    </Caixa>
  );
}

const iniciais = (nome: string) =>
  nome.split(" ").map((parte) => parte[0]).slice(0, 2).join("").toUpperCase();

/**
 * Coluna 3 — o placar do recorte de quem está olhando.
 *
 * Corretor vê o top 3 da equipe; gerente, diretor, admin e sócio veem o ranking
 * INTEIRO do recorte ("toda a pontuação dos corretores dele"). As pessoas
 * chegam recortadas do servidor (`visible_game_ranking`); aqui só se decide
 * quantas mostrar.
 *
 * Lê a temporada e o placar direto, e não pelo `useGameRanking`: são as MESMAS
 * duas chaves de cache, mas com o `isError` à mão — sem ele, falha de leitura e
 * temporada sem ponto caíam na mesma frase.
 */
function Destaques() {
  const { roles, isAdmin } = useAuth();
  const { soMinhaPosicao } = recorteDoRanking(roles, isAdmin);
  const temporada = useCurrentSeasonId();
  const placar = useSeasonRanking(temporada.data);
  // `ordenarRanking` e não a ordem crua: a RPC ordena só por pontos, e empates
  // em 0 vinham em ordem qualquer, com quem já foi desativado no meio.
  const ordenado = ordenarRanking(placar.data ?? []);
  const lista = soMinhaPosicao ? ordenado.slice(0, 3) : ordenado;

  const corpo = () => {
    if (temporada.isError || placar.isError) {
      return (
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar os destaques"
          description={describeError(
            temporada.error ?? placar.error,
            "A leitura do placar da temporada falhou.",
          )}
        />
      );
    }

    if (temporada.isPending || (temporada.data && placar.isPending)) {
      return <LoadingState variant="list" rows={3} label="Carregando os destaques…" />;
    }

    // Sem temporada aberta o jogo está parado (`award_game_points` devolve null
    // em silêncio): não é "ninguém pontuou", é que não há placar.
    if (!temporada.data) {
      return (
        <p className="text-sm text-muted-foreground">
          Nenhuma temporada aberta no momento. O placar volta quando a próxima começar.
        </p>
      );
    }

    if (lista.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          Ninguém do seu recorte entrou no placar desta temporada ainda.
        </p>
      );
    }

    return (
      <ol className="space-y-4">
        {lista.map((linha, i) => (
          <li
            key={linha.profile_id}
            className="flex items-center gap-3"
            aria-label={`${i + 1}º lugar: ${linha.full_name}, ${num(linha.points)} pontos`}
          >
            {/* Do 4º em diante o disco é neutro — `MedalhaComFita` já trata. */}
            <MedalhaComFita lugar={i + 1} />
            <Avatar
              className={cn(
                "h-10 w-10 shrink-0 ring-2 ring-offset-2 ring-offset-card",
                podiumRingClass(i),
              )}
            >
              <AvatarImage src={linha.avatar_url || undefined} alt="" />
              <AvatarFallback className="bg-primary/15 text-xs font-bold text-primary">
                {iniciais(linha.full_name)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
              {linha.full_name}
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
              {num(linha.points)} pts
            </span>
          </li>
        ))}
      </ol>
    );
  };

  return <Caixa titulo="Destaques">{corpo()}</Caixa>;
}
