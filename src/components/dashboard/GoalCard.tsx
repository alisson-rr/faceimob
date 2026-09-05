import { AlertTriangle, Target } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, SectionCard, StatusBadge } from "@/components/shared";
import { num } from "@/lib/format";
import { ALL_MONTHS, GOAL_SCOPE_LABEL, type GoalScope } from "./data";

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
      // O MES vai escrito na frase, nao so no link: o `GlobalGoalCard` de
      // /equipes abre no mes do RELOGIO e ainda nao le o `?mes=` da URL (a
      // leitura esta pendente com o dono daquele arquivo), entao quem clicava
      // aqui olhando 01/2026 caia no formulario de 09/2026 e gravava a meta no
      // mes errado sem perceber. Enquanto o outro lado nao le o parametro, quem
      // avisa qual mes escolher e o texto — a tela nao pode mandar cadastrar sem
      // dizer onde.
      const temTela = scope === "global";
      const ondeCadastrar = `em Equipes, no cartão "Meta global do mês", escolhendo ${periodo} no campo Mês`;
      const saida = temTela
        ? canManage
          ? `Cadastre ${ondeCadastrar}.`
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
            canManage ? (
              <Button variant="outline" asChild>
                {/* `mes` em `yyyy-MM`, a forma do <input type=month> de /equipes.
                    O parametro ja viaja, mas o destino ainda NAO o le: enquanto
                    `GlobalGoalCard` nao chamar `useSearchParams`, quem diz o mes
                    ao usuario e a frase acima. Ver `pendencias`. */}
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
    >
      {body()}
    </SectionCard>
  );
}
