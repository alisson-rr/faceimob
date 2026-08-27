/**
 * O cruzamento entre o catálogo de Status 2 (rótulo que a tabela oferece) e a
 * semântica de `@/lib/dealStatus` (o que o rótulo faz com o negócio).
 *
 * É aqui que "19. REPROVADO" se perdeu: ele está no catálogo, está na lista de
 * motivos do diálogo de perda, e mesmo assim o Select da tabela gravava direto.
 * Este arquivo trava as duas contagens para o dia em que alguém acrescentar um
 * rótulo novo sem dizer o que ele significa.
 */
import { describe, expect, it } from "vitest";
import { LOSS_REASONS, isLossStatus, normalizeStatus } from "@/lib/dealStatus";
import { FACEIMOB_STATUSES } from "./statuses";

const rotulos = FACEIMOB_STATUSES.map((s) => s.label);

describe("catalogo de Status 2 × semantica do negocio", () => {
  it("exatamente tres rotulos do catalogo encerram o negocio", () => {
    expect(rotulos.filter(isLossStatus)).toEqual([
      "17. DISTRATO",
      "18. QUEDA",
      "19. REPROVADO",
    ]);
  });

  it('"OFF" e motivo de perda mas nao e opcao do Select da tabela', () => {
    // O quarto motivo do diálogo só chega pelo próprio diálogo — pela tabela
    // existem três caminhos de entrada para a perda, não quatro.
    expect(LOSS_REASONS).toContain("OFF");
    expect(rotulos).not.toContain("OFF");
  });

  it("dos 32 rotulos, so tres viram Status1 do relatorio", () => {
    // O resto devolve `null` de propósito: eles descrevem a esteira, não o
    // desfecho. "19. REPROVADO" continua fora — encerrar não é contar perda.
    const mapeados = rotulos.filter((label) => normalizeStatus(label) !== null);
    expect(mapeados).toEqual(["PROPOSTA", "17. DISTRATO", "18. QUEDA"]);
    expect(rotulos).toHaveLength(32);
  });
});
