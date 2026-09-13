import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./client", () => ({ supabase: { rpc } }));

import { existingLeadPhones, PHONE_CHECK_CHUNK } from "./leads";

// Corpo em bloco: o vitest chama o RETORNO do beforeEach como limpeza, e
// `mockReset()` devolve o próprio mock — ele seria chamado sem argumentos.
beforeEach(() => {
  rpc.mockReset();
});

describe("existingLeadPhones — conferência de repetidos em lotes (0141)", () => {
  it("nunca manda mais que o teto da RPC e junta o que cada lote achou", async () => {
    // A 0141 recusa lista maior que 1.000; a planilha aceita 5.000 linhas.
    const telefones = Array.from({ length: 2 * PHONE_CHECK_CHUNK + 1 }, (_, i) => `(11) 9${String(i).padStart(8, "0")}`);
    rpc.mockImplementation((_fn: string, args: { p_phones: string[] }) =>
      Promise.resolve({ data: [{ phone_digits: args.p_phones[0], lead_count: 1 }], error: null }),
    );

    const achados = await existingLeadPhones(telefones);

    expect(rpc).toHaveBeenCalledTimes(3);
    for (const [fn, args] of rpc.mock.calls) {
      expect(fn).toBe("existing_lead_phones");
      expect(args.p_phones.length).toBeLessThanOrEqual(PHONE_CHECK_CHUNK);
    }
    expect(achados).toEqual(new Set(["11900000000", "11900001000", "11900002000"]));
  });

  it("repetido e vazio saem antes de gastar chamada", async () => {
    expect(await existingLeadPhones(["", "  "])).toEqual(new Set());
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({ data: [], error: null });
    await existingLeadPhones(["11 99999-0000", "11999990000"]);
    expect(rpc).toHaveBeenCalledWith("existing_lead_phones", { p_phones: ["11999990000"] });
  });

  it("erro de um lote interrompe a conferência em vez de devolver meia lista", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "No máximo 1.000 telefones" } });
    await expect(existingLeadPhones(["11999990000"])).rejects.toThrow();
  });
});
