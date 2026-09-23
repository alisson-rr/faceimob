import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/shared";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function ContagemPessoas({ pessoas }: { pessoas: PessoaResumo[] }) {
  const ativos = pessoas.filter((p) => p.status === "active").length;
  const inativos = pessoas.length - ativos;
  return <span className="text-xs font-normal text-muted-foreground">{ativos} {ativos === 1 ? "ativo" : "ativos"} · {inativos} {inativos === 1 ? "inativo" : "inativos"}</span>;
}

/** Suspensos e desligados continuam acessíveis, recolhidos no fim da coluna. */
export function ListaPessoas<T extends PessoaResumo>({ pessoas, children }: {
  pessoas: T[];
  children: (pessoa: T) => ReactNode;
}) {
  const inativos = pessoas.filter((p) => p.status !== "active");
  return <>
    {pessoas.filter((p) => p.status === "active").map(children)}
    {inativos.length > 0 && (
      <details className="col-span-full rounded-lg border border-border bg-muted/30 p-2">
        <summary className="cursor-pointer rounded text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Inativos ({inativos.length}) · suspensos e desligados
        </summary>
        <div className="mt-2 space-y-2">{inativos.map(children)}</div>
      </details>
    )}
  </>;
}

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
