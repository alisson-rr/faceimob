import { describe, expect, it, vi } from "vitest";
import { createDealStatus } from "./dealStatuses";

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
