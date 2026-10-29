import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./client", () => ({ supabase: { rpc } }));
import { dealParticipantNames } from "./documents";

describe("nomes dos autores por negócio", () => {
  beforeEach(() => vi.resetAllMocks());

  it("consulta somente o negócio e preserva nomes de participantes e CCA", async () => {
    rpc.mockResolvedValue({ data: [
      { profile_id: "broker", full_name: "Corretor" },
      { profile_id: "cca", full_name: "Colega CCA" },
      { profile_id: "sem-nome", full_name: null },
    ], error: null });
    expect(await dealParticipantNames("deal-1")).toEqual({ broker: "Corretor", cca: "Colega CCA" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("deal_actor_names", { p_deal_id: "deal-1" });
  });

  it("retorna vazio sem autores e propaga falhas da RPC", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await dealParticipantNames("deal-1")).toEqual({});
    rpc.mockResolvedValueOnce({ data: null, error: { message: "denied", code: "42501" } });
    await expect(dealParticipantNames("deal-1")).rejects.toThrow();
  });
});
