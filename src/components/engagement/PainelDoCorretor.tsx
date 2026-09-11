import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Lock, NotebookPen, PhoneOutgoing } from "lucide-react";
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
import { useCurrentSeasonId, useSeasonRanking } from "@/hooks/useGameRanking";
import { num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { podiumRingClass } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { loadMuralDoDia, recadosKeys } from "@/integrations/supabase/recados";
import { MedalhaComFita } from "./MedalhaComFita";
import {
  LINHAS_DO_PAINEL,
  diarioKeys,
  loadDiarioDeHoje,
  maiorValor,
} from "./painel/diarioDeHoje";
import { abreSozinho, hojeLocal } from "./painel/vezPorDia";
import { ordenarRanking } from "./ranking";

/**
 * Painel — o quadro de abertura do Pipeline: o diário de hoje, o mural da
 * operação e os três primeiros do placar.
 *
 * Comportamento ditado pelo cliente (10/09/2026): abre SOZINHO só para o
 * corretor, e só na primeira vez do dia (`./painel/vezPorDia`). Todo mundo
 * abre pelo botão, sempre.
 *
 * Nenhum dado é contado aqui. As três colunas leem fontes que já existem:
 *   · diário    → `daily_entries` de HOJE, as MESMAS métricas e a mesma conta
 *                 do Diário e do Checkpoint (`./painel/diarioDeHoje`);
 *   · mural     → `important_notices` / `gold_tips` (migration 0011);
 *   · destaques → `visible_game_ranking`, que já recorta por papel no banco
 *                 (`can_see_game_profile`, 0060 e 0112): corretor vê a equipe,
 *                 gerente vê quem lidera, diretor vê as equipes ATIVAS que
 *                 dirige, admin e sócio veem a casa. Repetir esse recorte no
 *                 front seria uma segunda regra para divergir da primeira.
 */

/**
 * O estado do modal, com a abertura automática junto.
 *
 * Fica num hook porque o botão mora no cabeçalho da página e o diálogo mora no
 * fim dela — sem isso a tela precisaria de dois `useState` para a mesma coisa.
 */
export function usePainelDoCorretor() {
  const { role, user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const profileId = user?.id ?? null;

  useEffect(() => {
    // `loading` é obrigatório: até o perfil chegar, `role` ainda é o padrão
    // 'broker' do contexto — sem esta guarda o modal abriria na cara do admin
    // no meio do carregamento.
    if (loading) return;
    if (abreSozinho(role, profileId)) setOpen(true);
  }, [loading, role, profileId]);

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
          {/* O print tem só o título. A descrição continua no DOM em `sr-only`
              porque é ela o `aria-describedby` do diálogo: apagá-la deixaria
              quem usa leitor de tela ouvir "Painel" e mais nada. */}
          <DialogDescription className="sr-only">
            O diário de hoje, os recados da operação e os destaques do seu recorte.
          </DialogDescription>
        </DialogHeader>

        {/* O conteúdo é um filho para os hooks dele só rodarem com o modal
            ABERTO: o Radix não monta o portal enquanto fechado, e assim a carga
            do painel do Dashboard não sai a cada entrada no Pipeline. */}
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
      <Diario />
      <Mural />
      <Destaques />
    </div>
  );
}

/**
 * Caixa comum das três colunas.
 *
 * Sem ícone e sem régua sob o título: o print tem o texto âmbar e o conteúdo
 * logo abaixo. `tituloOculto` é a coluna do diário, que no print não tem
 * cabeçalho nenhum — o `sr-only` tira da tela e mantém o `h3`, que é o que dá
 * nome à região para quem navega por cabeçalhos.
 */
function Caixa({
  titulo,
  tituloOculto = false,
  children,
}: {
  titulo: string;
  tituloOculto?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-border bg-card p-4 text-card-foreground">
      <h3
        className={cn(
          "font-display text-sm font-bold text-warning",
          tituloOculto ? "sr-only" : "mb-3",
        )}
      >
        {titulo}
      </h3>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

/**
 * Coluna 1 — o diário de HOJE, as seis linhas do print.
 *
 * São métricas do DIÁRIO (`daily_entries`), não etapas do pipeline: a coluna
 * mostrava o funil de etapas (Incompleto, Lead, Proposta…), que tem outros
 * rótulos e outra conta. Os números saem da mesma leitura e da mesma soma do
 * Diário e do Checkpoint (`./painel/diarioDeHoje`) — duas fontes para o mesmo
 * número é o defeito mais caro de um painel.
 *
 * O recorte por papel é da RLS, não daqui: corretor vê a própria linha, gerente
 * e diretor as equipes que lideram, admin e sócio a casa (0109).
 */
function Diario() {
  const dia = hojeLocal();
  const diario = useQuery({
    queryKey: diarioKeys.hoje(dia),
    queryFn: () => loadDiarioDeHoje(dia),
    staleTime: 60_000,
  });

  if (diario.isPending) {
    return (
      <Caixa titulo="Diário de hoje" tituloOculto>
        <LoadingState variant="list" rows={6} label="Carregando o diário de hoje…" />
      </Caixa>
    );
  }

  if (diario.isError) {
    return (
      <Caixa titulo="Diário de hoje" tituloOculto>
        {/* Falha de leitura NÃO vira zero: zero é uma afirmação sobre o dia que
            a tela não conseguiu fazer. */}
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar o diário"
          description={describeError(diario.error, "A leitura do diário de hoje falhou.")}
        />
      </Caixa>
    );
  }

  // Os dois vazios são coisas diferentes e por isso têm frases diferentes: um
  // é o dia que ainda não começou a ser lançado, o outro é dado que existe e
  // não é meu de ler. Nenhum dos dois pode virar seis zeros.
  const resultado = diario.data;

  if (resultado.estado === "sem-lancamento") {
    return (
      <Caixa titulo="Diário de hoje" tituloOculto>
        <EmptyState
          icon={NotebookPen}
          title="Nenhum diário lançado hoje"
          description="Ninguém do seu recorte enviou o diário de hoje ainda. As seis linhas aparecem no primeiro lançamento."
        />
      </Caixa>
    );
  }

  if (resultado.estado === "sem-acesso") {
    return (
      <Caixa titulo="Diário de hoje" tituloOculto>
        <EmptyState
          icon={Lock}
          title="Diário de hoje fora do seu acesso"
          description="Já há diário lançado hoje, mas nenhuma linha dele está no seu recorte. Isto não é zero — é o que o banco não devolveu para você."
        />
      </Caixa>
    );
  }

  const linha = resultado.linha;
  const maior = maiorValor(linha);

  return (
    <Caixa titulo="Diário de hoje" tituloOculto>
      <ul className="space-y-4">
        {LINHAS_DO_PAINEL.map((item) => {
          const valor = linha[item.key];
          // Piso de 4% para valor > 0: uma ligação contra um dia de 50 dá 2%, e
          // 2% de uma barra fina é trilho vazio — a linha existiria no número e
          // sumiria no desenho. Zero continua com zero de preenchimento: pintar
          // barra cheia num dia sem movimento seria mentir para ficar igual ao
          // print.
          const pct = valor > 0 ? Math.max(4, Math.round((valor / maior) * 100)) : 0;
          return (
            <li key={item.key} className="space-y-1.5">
              <p className={cn("flex items-center gap-2 text-sm font-semibold", item.rotulo)}>
                {item.label}
                {item.key === "ligacoes" && (
                  <PhoneOutgoing className="h-4 w-4 shrink-0" aria-hidden />
                )}
              </p>
              <div className="flex items-center gap-2">
                {/* A barra é decorativa: `role="progressbar"` com mínimo igual
                    ao máximo (dia inteiro zerado) é um medidor degenerado, e o
                    rótulo com o número ao lado já diz tudo em texto. */}
                <div
                  aria-hidden
                  className={cn(
                    "h-3 min-w-0 flex-1 overflow-hidden rounded-full border border-border bg-muted",
                    // Dia lançado e ainda sem movimento: o trilho tracejado diz
                    // "vazio de propósito" onde seis trilhos lisos pareciam
                    // gráfico quebrado. O print mostra a barra de Leads cheia,
                    // mas ali o dia tinha dado — cheia com zero seria mentira.
                    maior === 0 && "border-dashed",
                  )}
                >
                  <div
                    className={cn("h-full rounded-full transition-[width]", item.barra)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {/* Um número só, e não o "0/0" do print: o diário não tem meta
                    por métrica e um denominador inventado mentiria seis vezes
                    por dia (ver `maiorValor`). */}
                <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
                  {num(valor)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {/* O dia fica no rótulo da região, não numa nota de rodapé: o print não
          tem rodapé e a informação não pode simplesmente sumir. */}
      <span className="sr-only">
        Lançamentos de {dia.split("-").reverse().join("/")} no seu recorte.
      </span>
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
 * Coluna 3 — o top 3 do recorte de quem está olhando.
 *
 * A lista chega recortada do servidor (`visible_game_ranking`). Não há `if` de
 * papel aqui de propósito: quem decide o que cada um enxerga é
 * `can_see_game_profile`, e uma segunda regra no front só teria como divergir
 * dela.
 *
 * Lê a temporada e o placar direto, e não pelo `useGameRanking`: são as MESMAS
 * duas chaves de cache (nenhuma consulta a mais), mas com o `isError` à mão. O
 * hook devolve só `loading`, e por isso falha de leitura e temporada sem ponto
 * caíam os dois na frase "ninguém pontuou" — a tela afirmando sobre o placar o
 * que não conseguiu ler.
 */
function Destaques() {
  const temporada = useCurrentSeasonId();
  const placar = useSeasonRanking(temporada.data);
  // `ordenarRanking` e não `slice` cru: a RPC ordena só por pontos, e três
  // destaques tirados de nove empatados em 0 vinham em ordem qualquer — outra a
  // cada carregamento, e com quem já foi desativado no meio.
  const top = ordenarRanking(placar.data ?? []).slice(0, 3);

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

    if (top.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          Ninguém pontuou nesta temporada ainda. Análise enviada, aprovação e venda entram no placar.
        </p>
      );
    }

    return (
      <ol className="space-y-4">
        {top.map((linha, i) => (
          <li
            key={linha.profile_id}
            className="flex items-center gap-3"
            aria-label={`${i + 1}º lugar: ${linha.full_name}, ${num(linha.points)} pontos`}
          >
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
