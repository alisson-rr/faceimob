import type { ReactNode } from "react";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { WeekRange } from "@/integrations/supabase/game";
import { useAuth } from "@/contexts/AuthContext";
import { ALL_MONTHS, useVgvGoal } from "@/components/dashboard";
import { PodiumCards } from "@/components/engagement";
import { StatusBadge } from "@/components/shared";
import { brl, num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { cn } from "@/lib/utils";
import { useCurrentSeasonId, useGameRanking, useSeasonRanking } from "@/hooks/useGameRanking";

type Props = { onAbrirPainel: () => void };

/**
 * O mês da meta da faixa do corretor, no formato que `useGoal` espera.
 *
 * É o mês do RELÓGIO, e é de propósito. Antes saía de `season.period_start`,
 * e isso dava dois alvos diferentes para a mesma pessoa: numa temporada aberta
 * em agosto, o Dashboard mostrava a meta de setembro (o mês escolhido no filtro,
 * que abre no corrente) e esta faixa a de agosto. Pior, era mais uma razão para
 * o traço: `MetaVgv` (/equipes) grava sempre em `goalPeriods()`, o mês CORRENTE
 * — a faixa procurava a meta num mês em que ninguém cadastra.
 *
 * Fora da faixa do corretor devolve `ALL_MONTHS`, que é o valor com que
 * `useGoal` desliga a consulta: gerente, diretor e admin veem o pódio e não têm
 * por que pagar a leitura.
 */
export function mesDaMetaDoCorretor(soMinhaPosicao: boolean, hoje: Date = new Date()): string {
  return soMinhaPosicao ? format(hoje, "MM/yyyy") : ALL_MONTHS;
}

/**
 * O mês corrente em dias, no `AAAA-MM-DD` que `visible_game_ranking` aceita.
 *
 * A barra comparava o realizado da TEMPORADA com a meta do MÊS — dois períodos
 * diferentes na mesma fração, e um percentual que crescia sozinho a cada mês
 * que a temporada atravessava. Com este intervalo o numerador é lido no mesmo
 * mês do denominador, pela MESMA RPC que já monta o placar (0107): é filtro de
 * leitura, não um segundo jeito de contar venda.
 */
export function intervaloDoMes(hoje: Date = new Date()): WeekRange {
  return {
    from: format(startOfMonth(hoje), "yyyy-MM-dd"),
    to: format(endOfMonth(hoje), "yyyy-MM-dd"),
  };
}

/**
 * Card de game do topo do Pipeline — dois desenhos, um por quem está olhando
 * (prints do cliente, 10/09/2026).
 *
 *   · corretor            → faixa fina: anel de progresso, nome, pontos, barra
 *                           da meta de VGV do mês e "Ver mais".
 *   · gerente/diretor/admin → pódio de três cartões (prata, ouro, bronze).
 *
 * O card inteiro e o "Ver mais" abrem o MESMO Painel para qualquer perfil
 * (pedido de 11/09/2026); o recorte do que aparece lá dentro é do Painel.
 *
 * Sem cabeçalho de seção: o `SectionCard` custava mais uma faixa de título e o
 * pedido em aberto é o oposto ("o ranking está um pouco grande"). O nome da
 * região vai no `aria-label`, que é quem o leitor de tela usa para anunciá-la.
 *
 * O RECORTE DOS DADOS continua sendo do servidor (`visible_game_ranking`): esta
 * tela escolhe o que MOSTRA do que já chegou, e nunca o contrário.
 */
export default function PipelineTopRanking({ onAbrirPainel }: Props) {
  // Sem os negócios, como o `AppLayout`: eles só alimentavam `ScoreRow.leads`,
  // que ninguém lê, e custavam 287 corretores × 7.579 negócios em comparação
  // de nome a cada render do Pipeline (cada tecla da busca, cada modal).
  const { scoped, meuScore, recorte, seasonId } = useGameRanking();
  const { profile, user } = useAuth();

  const { soMinhaPosicao, escopo } = recorte;

  // As MESMAS duas chaves de cache que o `useGameRanking` já usa — nenhuma
  // consulta a mais, só o `isError` e o "há temporada?" que o hook não devolve.
  // Sem isso, falha de leitura e temporada fechada sumiam com o card inteiro.
  const temporada = useCurrentSeasonId();
  const placar = useSeasonRanking(seasonId);

  /**
   * A meta do mês da faixa do corretor — VGV, e é a única que existe de verdade.
   *
   * O rótulo já foi "Meta de Análises" (`metric = 'analyses'`) e depois "Meta de
   * Vendas" (`metric = 'sales'`): as duas colunas passam no check da 0011 e
   * NENHUMA TELA grava qualquer uma delas no escopo de perfil. O traço não era
   * falta de cadastro, era uma promessa que o produto não tinha como cumprir.
   *
   * A meta de VGV por pessoa é gravada hoje, na ficha de /equipes
   * (`components/equipes/MetaVgv.tsx`: scope 'profile', metric 'vgv', mês
   * corrente). É a que o corretor realmente tem cadastrada — e por isso é a que
   * aparece aqui.
   *
   * `useVgvGoal` é o hook de metas do Dashboard, com a mesma precedência
   * (perfil > equipes lideradas) e o mesmo prefixo de cache: não há como a
   * faixa mostrar um alvo e o painel outro.
   */
  const metaVgv = useVgvGoal(mesDaMetaDoCorretor(soMinhaPosicao));

  /**
   * O realizado do MESMO mês da meta, pela mesma RPC do placar.
   *
   * `meuScore.vendas` conta a TEMPORADA inteira; dividir isso pela meta mensal
   * dava um percentual sem significado. Aqui o recorte de dias é o mês corrente
   * (`intervaloDoMes`), e o valor é o `vgv` que `visible_game_ranking` já
   * devolve por pessoa.
   */
  const placarDoMes = useSeasonRanking(soMinhaPosicao ? seasonId : null, intervaloDoMes());
  const vgvDoMes = placarDoMes.data?.find((linha) => linha.profile_id === user?.id)?.vgv ?? 0;

  // O "Ver mais" em texto do print do pódio. É `button` e não `Link`: abre o
  // Painel aqui mesmo, em vez de levar para outra tela.
  const verMais = (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onAbrirPainel}
        className="rounded-sm px-1 text-xs text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Ver mais
      </button>
    </div>
  );

  const falhou = temporada.isError || placar.isError;

  // Carregando continua sem desenhar nada: a faixa mora acima do quadro de
  // negócios e um esqueleto piscando ali empurra o pipeline inteiro.
  if (!falhou && (temporada.isPending || (temporada.data && placar.isPending))) return null;

  const podio = scoped.slice(0, 3);

  /**
   * O que aparece quando não há pódio.
   *
   * O card inteiro sumia (`if (!scoped.length) return null`), e sumir é a única
   * resposta que serve para os três casos ao mesmo tempo: falha de leitura,
   * temporada fechada e ninguém pontuado. São coisas diferentes, e a de cima é
   * defeito — quem olha precisa saber que a tela não conseguiu ler, e não achar
   * que o jogo acabou.
   */
  const conteudo = () => {
    if (falhou) {
      return (
        <div className="space-y-2">
          <p className="px-1 py-3 text-sm text-destructive">
            Não consegui carregar o placar da temporada.{" "}
            {describeError(temporada.error ?? placar.error, "A leitura do ranking falhou.")}
          </p>
          {verMais}
        </div>
      );
    }

    if (!temporada.data) {
      return (
        <div className="space-y-2">
          <p className="px-1 py-3 text-sm text-muted-foreground">
            Nenhuma temporada aberta no momento. O placar volta quando a próxima começar.
          </p>
          {verMais}
        </div>
      );
    }

    if (soMinhaPosicao) {
      return (
        <FaixaDoCorretor
          nome={meuScore?.broker.name || profile?.name || "Você"}
          avatarUrl={meuScore?.broker.avatar_url ?? profile?.avatar_url ?? null}
          pontos={meuScore?.points ?? 0}
          noRanking={!meuScore}
          carregando={metaVgv.isLoading || placarDoMes.isLoading}
          erro={Boolean(metaVgv.error ?? placarDoMes.error)}
          realizado={vgvDoMes}
          meta={metaVgv.data?.target ?? null}
          onVerMais={onAbrirPainel}
        />
      );
    }

    return (
      <div className="space-y-2">
        {podio.length ? (
          <PodiumCards entries={podio.map((s) => ({
            id: s.broker.id,
            name: s.broker.name,
            points: s.points,
            avatarUrl: s.broker.avatar_url,
          }))} />
        ) : (
          /* Só o diretor chega aqui: o corretor sem ponto continua na lista
             (o ranking traz todo mundo com zero), então lista vazia quer
             dizer que o filtro por diretoria não achou ninguém. */
          <p className="px-1 py-3 text-sm text-muted-foreground">
            Nenhum corretor do seu recorte entrou no ranking desta temporada.
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          <StatusBadge tone="live">Game ativo</StatusBadge>
          {verMais}
        </div>
      </div>
    );
  };

  // O card inteiro abre o Painel no clique — o gesto que o cliente pediu. Para
  // teclado a entrada é o "Ver mais", que é um botão de verdade; o clique nele
  // sobe até aqui e chama o mesmo `onAbrirPainel`, que só abre (não alterna).
  return (
    <section
      aria-label={`Ranking do game — ${escopo}`}
      onClick={onAbrirPainel}
      className="gold-hairline relative mx-auto w-full cursor-pointer rounded-2xl border border-primary/30 bg-card p-4 text-card-foreground shadow-md transition-colors hover:border-primary/60"
    >
      {conteudo()}
    </section>
  );
}

/**
 * Anel de progresso com a foto dentro.
 *
 * `pathLength={100}` deixa o `strokeDasharray` ser lido em por cento direto,
 * sem conta de circunferência para alguém errar quando o raio mudar.
 *
 * O TRILHO é colorido (`stroke-gold/30`), não cinza: no print do cliente o anel
 * é um círculo inteiro mesmo com o corretor em 0 ponto e 0% da meta, e
 * `stroke-border` deixava a faixa começando o mês com um aro apagado. Quem
 * marca progresso continua sendo o arco cheio por cima — 0% não desenha arco
 * nenhum, então o trilho não afirma avanço que não houve.
 *
 * Ouro no mesmo tom da barra da meta (12/09/2026): anel e barra medem a mesma
 * fração. `gold` e não `highlight` porque é traço — 3:1 também no tema claro.
 */
function AnelDeProgresso({ pct, children }: { pct: number; children: ReactNode }) {
  return (
    <span className="relative grid h-14 w-14 shrink-0 place-items-center">
      <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden focusable="false">
        <circle cx="18" cy="18" r="16" fill="none" strokeWidth="2.5" className="stroke-gold/30" />
        {pct > 0 && (
          <circle
            cx="18" cy="18" r="16" fill="none" strokeWidth="2.5" strokeLinecap="round"
            pathLength={100} strokeDasharray={`${pct} 100`} className="stroke-gold"
          />
        )}
      </svg>
      {children}
    </span>
  );
}

/**
 * A faixa do corretor: quem ele é, quanto tem e o quanto falta para a meta.
 *
 * `meta` é a de VGV do mês (`goals`, scope 'profile', metric 'vgv') e
 * `realizado` é o VGV do MESMO mês, lido do placar — as duas pontas da fração
 * vêm do mesmo período, que era o defeito anterior.
 *
 * Quem ainda não pontuou vê o próprio nome com "0 pontos" e a barra vazia — o
 * estado do desenho do cliente. A colocação ("3º de 18") saiu: não está no
 * print, e o placar continua a um clique em "Ver mais", que abre o Painel.
 */
function FaixaDoCorretor({
  nome, avatarUrl, pontos, noRanking, carregando, erro, realizado, meta, onVerMais,
}: {
  nome: string;
  avatarUrl: string | null;
  pontos: number;
  noRanking: boolean;
  carregando: boolean;
  erro: boolean;
  /** VGV do mês corrente, em reais. */
  realizado: number;
  /** Meta de VGV do mês, em reais. `null` = não há linha em `goals`. */
  meta: number | null;
  /** Abre o Painel — o mesmo que o clique no card. */
  onVerMais: () => void;
}) {
  // Alvo e percentual saem juntos, num objeto só: sem meta cadastrada não há
  // denominador, e é isso que distingue a barra vazia da barra inexistente.
  const barra = meta && meta > 0
    ? { alvo: meta, pct: Math.min(100, Math.round((realizado / meta) * 100)) }
    : null;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 items-center gap-3 sm:w-60 sm:shrink-0">
        <AnelDeProgresso pct={barra?.pct ?? 0}>
          <Avatar className="h-10 w-10">
            <AvatarImage src={avatarUrl || undefined} alt="" />
            <AvatarFallback className="bg-primary/15 text-xs font-bold text-primary">
              {nome.split(" ").map((parte) => parte[0]).slice(0, 2).join("").toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </AnelDeProgresso>
        {/* O nome voltou a neutro: com anel, barra, marcador e percentual em
            ouro, o nome âmbar era o quinto ponto da mesma cor na faixa. */}
        <div className="min-w-0">
          <p className="truncate font-display text-base font-bold leading-tight text-foreground">{nome}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-semibold tabular-nums text-foreground">{num(pontos)} pontos</p>
            <StatusBadge tone="live">Game ativo</StatusBadge>
          </div>
        </div>
      </div>

      <div className="hidden w-px self-stretch bg-border sm:block" aria-hidden />

      <div className="min-w-0 flex-1">
        {noRanking ? (
          <p className="text-sm text-muted-foreground">
            Você ainda não está no ranking desta temporada. Cada análise enviada, aprovação e venda entra no placar.
          </p>
        ) : carregando ? (
          <p className="text-xs text-muted-foreground">Carregando a meta do mês…</p>
        ) : erro ? (
          /* Falha de leitura não pode virar "sem meta": o traço seria uma
             afirmação sobre o banco que a tela não conseguiu fazer. */
          <p className="text-xs text-destructive">Não foi possível ler a meta de VGV do mês.</p>
        ) : barra === null ? (
          /* Sem linha em `goals` não existe denominador: a barra viraria um
             medidor sem escala. O que dá para afirmar é o realizado. */
          <p className="text-xs text-muted-foreground">
            {brl(realizado)} de VGV neste mês · meta de VGV ainda não cadastrada na sua ficha
          </p>
        ) : (
          <BarraDaMeta pct={barra.pct} realizado={realizado} alvo={barra.alvo} />
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-1.5">
        {/* Sem meta cadastrada o rótulo não aparece: era exatamente aqui que
            nascia o "Meta de Vendas: —". Quem explica a ausência é a linha do
            meio, com a frase inteira. */}
        {!noRanking && !carregando && !erro && meta !== null && (
          <p className="text-xs font-semibold text-muted-foreground">Meta de VGV: {brl(meta)}</p>
        )}
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onVerMais}>
          Ver mais
        </Button>
      </div>
    </div>
  );
}

/**
 * A barra da meta com o marcador redondo do print.
 *
 * O percentual ficava solto na direita, sem relação visível com o
 * preenchimento. Aqui ele anda junto com o marcador; passando da metade troca
 * de lado para não escorregar para fora da barra.
 */
function BarraDaMeta({ pct, realizado, alvo }: { pct: number; realizado: number; alvo: number }) {
  // O marcador tem 28 px: recuar meio marcador em cada ponta deixa o 0% e o
  // 100% inteiros dentro da barra, em vez de metade cortada na borda.
  const posicao = `calc(0.875rem + (100% - 1.75rem) * ${pct} / 100)`;
  const aEsquerda = pct > 50;

  return (
    <div className="relative h-7 min-w-0 flex-1">
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Meta de VGV do mês: ${brl(realizado)} de ${brl(alvo)}`}
        className="absolute inset-x-0 top-1/2 h-4 -translate-y-1/2 overflow-hidden rounded-sm border border-border bg-muted"
      >
        {/* `gold`: âmbar vivo no escuro, ouro fundo no claro — a barra sobre a
            trilha `muted` precisa de 3:1 e o `highlight` não passa no claro. */}
        <div className="h-full rounded-sm bg-gold transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <span
        aria-hidden
        style={{ left: posicao }}
        className="glow-highlight absolute top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-gold bg-card"
      />
      {/* Caixa de largura zero ancorada no marcador: o texto transborda para o
          lado que `justify-*` mandar, sem conta de largura. O rótulo fica na
          mesma faixa vertical da barra, então leva fundo `card` próprio: sem
          ele, acima de 50% era ouro sobre o preenchimento ouro (~1:1) e, abaixo,
          ouro sobre `muted` dava 4,21:1 no claro. Ouro sobre `card` passa 4,5
          nos dois temas (par travado no theme-contrast). */}
      <span
        aria-hidden
        style={{ left: posicao }}
        className={cn(
          "absolute top-1/2 flex w-0 -translate-y-1/2",
          aEsquerda ? "justify-end" : "justify-start",
        )}
      >
        <span
          className={cn(
            "whitespace-nowrap rounded-md bg-card px-1.5 text-xs font-semibold tabular-nums text-gold",
            aEsquerda ? "mr-5" : "ml-5",
          )}
        >
          {pct}%
        </span>
      </span>
    </div>
  );
}
