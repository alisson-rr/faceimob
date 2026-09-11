import { useState } from "react";
import { AlertTriangle, Pencil, Target } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState, LoadingState, SectionCard, StatusBadge } from "@/components/shared";
import { GlobalGoalCard } from "@/components/equipes/GlobalGoalCard";
import { num } from "@/lib/format";
import { ALL_MONTHS, GOAL_SCOPE_LABEL, type GoalScope } from "./data";

/**
 * Editar a meta sem sair do Dashboard.
 *
 * Antes o único caminho era ler a frase do estado vazio, navegar até Equipes e
 * acertar o mês na mão — e o card só oferecia isso quando a meta NÃO existia:
 * corrigir uma meta já cadastrada não tinha caminho nenhum na tela. Pedido do
 * cliente em 05/09/2026 ("colocar lugar para editar meta").
 *
 * O formulário é o MESMO de /equipes, montado aqui dentro. Um segundo
 * formulário de meta global seria uma segunda regra de gravação para o mesmo
 * `goals` — e a primeira já ensinou o que acontece quando período de escrita e
 * de leitura divergem: a meta salva não volta.
 */
function EditarMetaGlobal({
  mes,
  rotulo = "Editar meta",
  size = "sm",
}: {
  mes: string | null;
  /** "Cadastrar meta" quando ainda nao ha linha: o verbo tem que ser honesto. */
  rotulo?: string;
  size?: "sm" | "default";
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {/* No cabecalho do card o botao e compacto (h-8, como os demais dali);
            no estado vazio ele e a acao principal e usa a altura padrao. */}
        <Button variant="outline" size={size} className={size === "sm" ? "h-8 gap-1.5" : "gap-1.5"}>
          <Pencil className="h-3.5 w-3.5" aria-hidden /> {rotulo}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Meta da empresa</DialogTitle>
          <DialogDescription>
            É a meta que este painel compara com o realizado. Confira o mês antes de salvar.
          </DialogDescription>
        </DialogHeader>
        {/* `mesInicial`: o mês escolhido no filtro do Dashboard. Sem ele o
            formulário abriria no mês do relógio e gravaria no mês errado quem
            estivesse conferindo outro período. */}
        <GlobalGoalCard mesInicial={mes ?? undefined} />
      </DialogContent>
    </Dialog>
  );
}

export interface GoalCardProps {
  month: string;
  vendas: number;
  /** `null` = nao ha linha em `goals` para o periodo. */
  goal: number | null | undefined;
  /** De quem e a meta que esta embaixo do realizado — o rotulo diz. */
  scope: GoalScope;
  /** `goals_write` so aceita admin e diretor; para os demais o card so avisa. */
  canManage: boolean;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}

/** Meta batida, no ritmo (>=60%) ou abaixo — o rotulo escrito acompanha a cor. */
const reading = (pct: number) =>
  pct >= 100
    ? { tone: "success" as const, label: "Meta batida", bar: "bg-success" }
    : pct >= 60
      ? { tone: "warning" as const, label: "No ritmo", bar: "bg-warning" }
      : { tone: "danger" as const, label: "Abaixo da meta", bar: "bg-destructive" };

/** "sua meta" → "Sua meta", para abrir frase e `aria-label`. */
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "01/2026" → "2026-01", o formato do `<input type="month">` de /equipes.
 *  Fica local para o arquivo continuar so com componentes no fast-refresh; o
 *  teste cobra o `href` que sai daqui. */
const mesParaCadastro = (month: string): string => {
  const match = /^(\d{2})\/(\d{4})$/.exec(month);
  return match ? `${match[2]}-${match[1]}` : "";
};

const SEM_META: Record<GoalScope, string> = {
  profile: "A sua meta de vendas deste mês ainda não foi cadastrada.",
  team: "A meta de vendas da sua equipe neste mês ainda não foi cadastrada.",
  global: "A meta de vendas da empresa neste mês ainda não foi cadastrada.",
};

/**
 * Meta de vendas do mes no escopo de quem esta olhando (`goals`, metric
 * 'sales'): a do proprio perfil, a da equipe que lidera ou a da empresa.
 *
 * O escopo aparece escrito porque o numerador e o realizado do usuario — ler
 * "3 de 14" com a meta da empresa embaixo das vendas de um corretor nao era
 * numero de ninguem. Sem a linha cadastrada a tela nao mostra "—": um travessao
 * seco deixa quem olha sem saber se e defeito ou falta de cadastro.
 */
export function GoalCard({ month, vendas, goal, scope, canManage, isLoading, error, onRetry }: GoalCardProps) {
  const periodo = month === ALL_MONTHS ? null : month;
  const escopo = GOAL_SCOPE_LABEL[scope];

  const body = () => {
    if (isLoading) return <LoadingState variant="block" label="Carregando a meta do mês…" />;

    if (error) {
      return (
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar a meta"
          description={error}
          action={
            <Button variant="outline" onClick={onRetry}>
              Tentar de novo
            </Button>
          }
        />
      );
    }

    if (!periodo) {
      return (
        <EmptyState
          icon={Target}
          title="A meta é mensal"
          description="Escolha um mês no filtro do topo para comparar o realizado com a meta cadastrada."
        />
      );
    }

    if (goal === null || goal === undefined || goal <= 0) {
      // So a meta GLOBAL tem tela: o cartao "Meta global do mês" em /equipes
      // grava `scope='global'`. Meta de perfil e de equipe com metric 'sales'
      // nenhuma tela escreve hoje — o `GoalRow` de Equipes grava VGV —, entao
      // mandar o usuario para la seria prometer uma acao que o destino nao tem.
      //
      // "Nenhuma tela cadastra" so pode ser dito a quem realmente nao tem tela:
      // `goals_write` aceita admin E diretor, e /equipes renderiza o
      // `GlobalGoalCard` para os dois. Afirmar ausencia de tela a quem grava a
      // meta global e mentira — o que falta para ele e a linha DESTE escopo.
      //
      // O MES continua escrito na frase, nao so no link: quem nao pode gravar
      // le a frase para pedir a meta a quem grava, e ele precisa dizer QUAL mes.
      // (O `GlobalGoalCard` ja le o `?mes=` da URL, entao o link tambem acerta o
      // mes; a frase e para a pessoa, nao para o formulario.)
      const temTela = scope === "global";
      // Quem pode gravar a meta da empresa cadastra AQUI. Antes esta tela dizia
      // "cadastre em Equipes" enquanto o botao "Editar meta" abria o formulario
      // no proprio cartao, dois passos acima: duas ofertas, destinos diferentes,
      // e a que estava escrita mandava embora. O pedido do cliente ("colocar
      // lugar para editar meta") era justamente nao ter achado o lugar.
      const cadastraAqui = temTela && canManage;
      const ondeCadastrar = `em Equipes, no cartão "Meta global do mês", escolhendo ${periodo} no campo Mês`;
      const saida = temTela
        ? canManage
          ? "Cadastre agora, sem sair do Dashboard."
          : `Peça a um administrador ou diretor para cadastrar ${ondeCadastrar}.`
        : canManage
          ? `Nenhuma tela cadastra a meta deste escopo ainda — ela é lançada direto no banco. A meta da empresa você cadastra ${ondeCadastrar}.`
          : "Nenhuma tela cadastra esta meta ainda: ela é lançada direto no banco pelo administrador. Enquanto isso o card mostra só o realizado do mês.";

      return (
        <EmptyState
          icon={Target}
          title={`Sem meta cadastrada para ${periodo}`}
          description={`${SEM_META[scope]} ${saida}`}
          action={
            cadastraAqui ? (
              <EditarMetaGlobal mes={mesParaCadastro(periodo)} rotulo="Cadastrar meta" size="default" />
            ) : canManage ? (
              // Escopo de perfil ou de equipe: nao ha formulario para ELE. O link
              // leva a meta da EMPRESA, que a frase acima ja nomeia, com o mes em
              // `yyyy-MM` — a forma do <input type=month> que /equipes le do `?mes=`.
              <Button variant="outline" asChild>
                <Link to={`/equipes?mes=${mesParaCadastro(periodo)}`}>Cadastrar em Equipes</Link>
              </Button>
            ) : undefined
          }
        />
      );
    }

    const pct = Math.round((vendas / goal) * 100);
    const status = reading(pct);
    const faltam = Math.max(0, goal - vendas);

    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-eyebrow">Atingimento</p>
            <p className="font-display text-5xl font-bold leading-none tracking-tight tabular-nums text-foreground">
              {num(pct)}
              <span className="ml-1 text-2xl text-muted-foreground">%</span>
            </p>
          </div>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </div>

        <div>
          <div
            className="h-3 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.min(100, pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${capitalize(escopo)} de vendas de ${periodo}: ${vendas} de ${goal}`}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-500 ease-premium ${status.bar}`}
              style={{ width: `${Math.min(100, Math.max(pct, pct > 0 ? 3 : 0))}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              <strong className="font-semibold text-foreground">{num(vendas)}</strong> de {num(goal)} vendas
            </span>
            <span className="tabular-nums">
              {faltam === 0 ? "Meta cumprida" : `Faltam ${num(faltam)} para bater a meta`}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <SectionCard
      title="Meta do mês"
      description={
        periodo
          ? `Vendas realizadas × ${escopo} de ${periodo}`
          : `Vendas realizadas × ${escopo} cadastrada`
      }
      icon={Target}
      // Só o escopo GLOBAL tem formulário. Oferecer "Editar meta" no card de
      // perfil ou de equipe abriria um formulário que grava a meta da EMPRESA —
      // o pior tipo de botão: o que funciona e faz outra coisa.
      actions={canManage && scope === "global"
        ? <EditarMetaGlobal mes={periodo ? mesParaCadastro(periodo) : null} />
        : undefined}
    >
      {body()}
    </SectionCard>
  );
}
