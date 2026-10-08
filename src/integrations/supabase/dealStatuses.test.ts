import { describe, expect, it, vi } from "vitest";
import { createDealStatus, EMPTY_STATUS_CATALOG, statusMoveBlock } from "./dealStatuses";

/**
 * Status 2 criado pela tela sem o número na frente do nome exibido.
 *
 * O cadastro mandava o texto digitado também como nome, e o gatilho da 0149 só
 * tira o prefixo quando o nome chega vazio: "22. AGUARDANDO VISTORIA" aparecia
 * com o número em todo Select, tabela e planilha.
 */
const insert = vi.hoisted(() => vi.fn());

vi.mock("./client", () => ({
  supabase: {
    from: () => ({
      insert: (row: unknown) => {
        insert(row);
        return { select: async () => ({ data: [{ id: "novo" }], error: null }) };
      },
    }),
  },
}));

describe("createDealStatus", () => {
  it("manda o nome vazio para o gatilho derivar sem o número; o texto gravado vai como digitado", async () => {
    await createDealStatus({ value: "22. AGUARDANDO VISTORIA", group_id: "g-LEGADO", position: 1, tone: "info" });

    expect(insert).toHaveBeenCalledWith({
      value: "22. AGUARDANDO VISTORIA", group_id: "g-LEGADO", position: 1, tone: "info", label: "",
    });
  });
});

describe("statusMoveBlock · análise externa", () => {
  it("libera aprovação total ou condicionada para gerente e diretor", () => {
    for (const role of ["manager", "director"]) {
      expect(statusMoveBlock(
        EMPTY_STATUS_CATALOG,
        "ANÁLISE EXTERNA",
        role === "manager" ? "09. APROV. TOTAL" : "10. APROV. COND.",
        { isAdmin: false, roles: [role] },
      )).toBeNull();
    }
  });

  it("não abre a mesma transição para corretor", () => {
    expect(statusMoveBlock(
      EMPTY_STATUS_CATALOG,
      "ANÁLISE EXTERNA",
      "09. APROV. TOTAL",
      { isAdmin: false, roles: ["broker"] },
    )).not.toBeNull();
  });
});

describe("statusMoveBlock · contrato com pendência", () => {
  it("libera VIROU NEGÓCIO COM PENDÊNCIAS para EM CONTRATO à operação", () => {
    for (const role of ["broker", "manager", "director", "cca"]) {
      expect(statusMoveBlock(
        EMPTY_STATUS_CATALOG,
        "VIROU NEGÓCIO COM PENDÊNCIAS",
        "04. EM CONTRATO",
        { isAdmin: false, roles: [role] },
      )).toBeNull();
    }
  });
});
