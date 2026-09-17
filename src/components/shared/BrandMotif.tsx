import { cn } from "@/lib/utils";

/**
 * Marca d'agua: o simbolo Faceimob de verdade (V menta e azul-claro, quadrado
 * azul na juncao, chevron amarelo), grande e preso ao canto superior direito,
 * com uma parte para fora — mostra o bastante para o cliente reconhecer o logo,
 * sem ser o logo inteiro (pedido de 17/09/2026; antes eram losangos soltos que,
 * cortados no cabecalho de 64 px, nao lembravam a marca).
 *
 * Geometria copiada de `src/assets/logo-faceimob-symbol.png` (1062x974); o
 * `viewBox` recorta so a area colorida. Os PNG do simbolo nao servem aqui: tem
 * contorno BRANCO opaco, que vira mancha no tema escuro.
 *
 * O tamanho segue o container (`cqh`/`cqw`): cabe no cabecalho, no estado
 * vazio e no painel do Login com a mesma regra, sem passar de 60% da largura.
 * A opacidade padrao e de marca d'agua; quem usa pode trocar via `className`.
 *
 * Sem `mix-blend-*` de proposito: `multiply` some no fundo escuro e `screen`
 * some no claro. `aria-hidden` porque nao carrega informacao.
 */
export function BrandMotif({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden opacity-15 [container-type:size]", className)}
    >
      <svg
        viewBox="235 284 590 504"
        focusable="false"
        className="absolute right-0 top-0 aspect-[590/504] h-[min(115cqh,60cqw)] w-auto -translate-y-[10%] translate-x-[18%]"
      >
        <polygon className="fill-brand-yellow" points="370,628 420,578 529,688 640,578 691,628 529,788" />
        <polygon className="fill-brand-mint" points="235,392 343,285 529,468 420,578" />
        <polygon className="fill-brand-blue-light" points="529,468 713,285 825,395 640,578" />
        <polygon className="fill-brand-blue" points="529,468 640,578 529,688 420,578" />
      </svg>
    </div>
  );
}
