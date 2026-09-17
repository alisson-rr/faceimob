import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Colunas por faixa de tela. Classes literais de proposito: o Tailwind le o
 * arquivo como texto e nao enxerga classe montada em tempo de execucao.
 */
const COLUNAS = {
  1: "[--kpi-cols:1]",
  2: "[--kpi-cols:1] sm:[--kpi-cols:2]",
  3: "[--kpi-cols:1] sm:[--kpi-cols:2] lg:[--kpi-cols:3]",
  4: "[--kpi-cols:1] sm:[--kpi-cols:2] lg:[--kpi-cols:3] xl:[--kpi-cols:4]",
  5: "[--kpi-cols:1] sm:[--kpi-cols:2] lg:[--kpi-cols:5]",
  /** Rotulo curto e numero (contagens): ja abre em duas colunas no celular. */
  contagem: "[--kpi-cols:2] sm:[--kpi-cols:3] lg:[--kpi-cols:4]",
  /**
   * Faixa da esteira CCA: muitos cartoes estreitos, cerca de 8,5rem cada com a
   * barra lateral aberta (224 px a partir do `md`, por isso o `md` recua).
   */
  faixa: "[--kpi-cols:2] sm:[--kpi-cols:4] md:[--kpi-cols:3] lg:[--kpi-cols:5] xl:[--kpi-cols:7] 2xl:[--kpi-cols:8]",
} as const;

export type KpiGridCols = keyof typeof COLUNAS;

export interface KpiGridProps {
  /** Colunas no desktop (o celular comeca em uma) ou uma regua nomeada. */
  cols: KpiGridCols;
  /** `ul` quando os itens sao `li`. */
  as?: "div" | "ul";
  className?: string;
  children: ReactNode;
}

/**
 * Grade de indicadores do app inteiro. Todo cartao tem a mesma largura e a
 * ultima linha incompleta fica centralizada (pedido de 17/09/2026). O desenho
 * esta em `.kpi-grid`, em `index.css`.
 */
export function KpiGrid({ cols, as: Tag = "div", className, children }: KpiGridProps) {
  return <Tag className={cn("kpi-grid", COLUNAS[cols], className)}>{children}</Tag>;
}
