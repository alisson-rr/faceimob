import { describe, expect, it, vi } from "vitest";
import {
  createDealStatus, EMPTY_STATUS_CATALOG, mudarConstrutoraDoNegocio, reativarNegocio, statusMoveBlock,
} from "./dealStatuses";

/**
 * Status 2 criado pela tela sem o número na frente do nome exibido.
 *
 * O cadastro mandava o texto digitado também como nome, e o gatilho da 0149 só
 * tira o prefixo quando o nome chega vazio: "22. AGUARDANDO VISTORIA" aparecia
 * com o número em todo Select, tabela e planilha.
 */
const insert = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("./client", () => ({
  supabase: {
    rpc: async (nome: string, args: unknown) => {
      rpc(nome, args);
      return { error: null };
    },
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

describe("reativação e troca de construtora (0277)", () => {
  it("reativar manda o motivo sem espaços sobrando", async () => {
    rpc.mockClear();
    await reativarNegocio("d1", "  Cliente voltou a negociar  ");
    expect(rpc).toHaveBeenCalledWith("reativar_negocio", { p_deal_id: "d1", p_motivo: "Cliente voltou a negociar" });
  });

  it("mudar a construtora manda construtora, empreendimento e comentário", async () => {
    rpc.mockClear();
    await mudarConstrutoraDoNegocio({
      dealId: "d1", developerId: "dev2", project: " Residencial Novo ", comentario: " Cliente preferiu outra obra ",
    });
    expect(rpc).toHaveBeenCalledWith("mudar_construtora_do_negocio", {
      p_deal_id: "d1", p_developer_id: "dev2", p_project: "Residencial Novo",
      p_comentario: "Cliente preferiu outra obra", p_project_id: null,
    });
  });
});
