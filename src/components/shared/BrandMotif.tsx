import { cn } from "@/lib/utils";

/**
 * Motivo decorativo da marca: os retangulos rotacionados 45 graus do simbolo
 * Faceimob, translucidos e sobrepostos. Substitui os "blobs" genericos que
 * estavam no Login.
 *
 * Sem `mix-blend-*` de proposito: `multiply` some no fundo escuro e `screen`
 * some no claro. Opacidade baixa funciona nos dois temas com uma regra so.
 *
 * `aria-hidden` porque nao carrega informacao — quem usa leitor de tela ja tem
 * o nome do produto no <h1>.
 */
export function BrandMotif({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className="absolute -left-10 top-[8%] h-48 w-48 rotate-45 rounded-[2rem] bg-brand-mint/20" />
      <div className="absolute left-[22%] top-[2%] h-64 w-64 rotate-45 rounded-[2.5rem] bg-brand-blue-light/20" />
      <div className="absolute -bottom-16 left-[8%] h-56 w-56 rotate-45 rounded-[2rem] bg-brand-yellow/20" />
      <div className="absolute -right-16 bottom-[12%] h-72 w-72 rotate-45 rounded-[3rem] bg-brand-blue/25" />
      <div className="absolute -right-6 top-[-10%] h-40 w-40 rotate-45 rounded-[1.5rem] bg-brand-yellow/15" />
    </div>
  );
}
