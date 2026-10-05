import type { CSSProperties, ReactNode } from "react";
import { Flame, TrendingDown } from "lucide-react";
import { SeloDoAviso } from "@/components/ui/selo-do-aviso";
import { toast } from "@/components/ui/sonner";

/**
 * Avisos com cara própria (05/10/2026: "popups sem graça e pouco motivador").
 * Lead chegando é ouro: selo de fogo, faixa dourada e uma frase que puxa o
 * atendimento. Negócio caindo (OFF, distrato, queda, reprovado) sai em
 * vermelho, com um ânimo para o próximo.
 */
const DOURADO = { "--toast-accent": "var(--gold)" } as CSSProperties;

type OpcoesDoLead = {
  descricao?: ReactNode;
  frase?: string;
  acao?: { label: string; onClick: () => void };
};

const comFrase = (descricao: ReactNode, frase: string) => (
  <>
    {descricao}
    <span className="mt-1 block text-xs font-semibold text-gold">{frase}</span>
  </>
);

export function avisarLead(titulo: string, { descricao, frase = "Corre que esse lead é ouro! ⚡", acao }: OpcoesDoLead = {}) {
  return toast(titulo, {
    icon: <SeloDoAviso tom="gold"><Flame /></SeloDoAviso>,
    description: comFrase(descricao, frase),
    style: DOURADO,
    ...(acao ? { action: acao } : {}),
  });
}

export function avisarQueda(titulo: string, descricao?: ReactNode) {
  return toast.error(titulo, {
    icon: <SeloDoAviso tom="destructive"><TrendingDown /></SeloDoAviso>,
    description: (
      <>
        {descricao}
        <span className="mt-1 block text-xs font-semibold text-destructive">Bola pra frente: o próximo fecha! 💪</span>
      </>
    ),
  });
}
