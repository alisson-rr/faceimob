import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/shared";
import { cn } from "@/lib/utils";

/** Duas letras do nome, para quando não há foto. */
export const iniciais = (n: string) =>
  n.split(" ").filter(Boolean).slice(0, 2).map(s => s[0]).join("").toUpperCase();

const ROTULO_STATUS: Record<string, string> = {
  suspended: "Suspenso",
  terminated: "Desligado",
};

export type PessoaResumo = {
  id: string;
  name: string;
  /** `profiles.status` cru — `active` não separa suspenso de desligado. */
  status: string;
  avatar_url?: string | null;
};

type Tom = "info" | "success" | "warning" | "neutral";

const TONS: Record<Tom, { caixa: string; foto: string }> = {
  info: { caixa: "bg-info/5", foto: "bg-info/20 text-info" },
  success: { caixa: "bg-success/5", foto: "bg-success/20 text-success" },
  warning: { caixa: "bg-warning/5", foto: "bg-warning/20 text-warning" },
  neutral: { caixa: "bg-secondary/20", foto: "bg-secondary" },
};

/**
 * Uma pessoa na lista: FOTO e NOME, e nada mais.
 *
 * Pedido do cliente em 10/09/2026 — "deixar só o nome e a foto no front". O que
 * o cartão mostrava antes (e-mail de acesso, papéis extras, superior, metas de
 * VGV, contagem de subordinados) foi para dentro da ficha, que abre no clique.
 *
 * A ÚNICA exceção é o selo de situação, e ela é deliberada: o selo já
 * só aparece para quem NÃO está ativo. Esconder "Desligado" numa tela cujo
 * objetivo declarado é desligar corretor faria o administrador desligar duas
 * vezes a mesma pessoa sem nunca ver o resultado. Para o cartão comum — pessoa
 * ativa — o que aparece continua sendo só nome e foto.
 */
export function PessoaCard({ pessoa, tom = "neutral", onAbrir }: {
  pessoa: PessoaResumo;
  tom?: Tom;
  /** Ausente = a pessoa não é editável por quem está olhando; o cartão não vira botão. */
  onAbrir?: () => void;
}) {
  const estilo = TONS[tom];
  const rotulo = ROTULO_STATUS[pessoa.status];
  const conteudo = (
    <>
      <Avatar className={cn("h-8 w-8", estilo.foto)}>
        {pessoa.avatar_url && <AvatarImage src={pessoa.avatar_url} alt="" />}
        <AvatarFallback className={cn("text-xs font-bold", estilo.foto)}>
          {iniciais(pessoa.name)}
        </AvatarFallback>
      </Avatar>
      <p className="min-w-0 flex-1 truncate text-xs font-medium">{pessoa.name}</p>
      {rotulo && (
        <StatusBadge tone={pessoa.status === "terminated" ? "danger" : "warning"} className="shrink-0">
          {rotulo}
        </StatusBadge>
      )}
    </>
  );

  const caixa = cn("flex w-full items-center gap-2 rounded-lg border border-border/30 p-2 text-left", estilo.caixa);

  if (!onAbrir) return <div className={caixa}>{conteudo}</div>;

  return (
    // `<button>` de verdade: teclado, foco e papel vêm de graça. O nome
    // acessível repete o texto visível ("Abrir perfil de Ana"), como exige o
    // critério de rótulo no nome.
    <button
      type="button"
      onClick={onAbrir}
      aria-label={`Abrir perfil de ${pessoa.name}`}
      className={cn(caixa, "transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
    >
      {conteudo}
    </button>
  );
}
