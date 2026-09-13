import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Gravação de atividade e visita que a RLS recusa volta sem erro e sem linha.
 * Sem esta trava, quem vê mas não pode alterar (sócio, CCA) recebia o toast de
 * sucesso e nada mudava. A fronteira mockada é o cliente do Supabase.
 */
const resposta = vi.hoisted(() => ({ data: [] as { id: string }[] | null, error: null as unknown }));

vi.mock("./client", () => {
  const cadeia = {
    update: () => cadeia,
    eq: () => cadeia,
    select: () => Promise.resolve(resposta),
  };
  return { supabase: { from: () => cadeia } };
});

import { setTaskStatus, setVisitResult } from "./activities";

beforeEach(() => {
  resposta.data = [];
  resposta.error = null;
});

describe("gravação de atividade e visita", () => {
  it("concluir atividade sem linha atualizada é erro, não sucesso", async () => {
    await expect(setTaskStatus("t1", "done")).rejects.toThrow();
  });

  it("registrar resultado de visita sem linha atualizada é erro", async () => {
    await expect(setVisitResult("v1", "completed")).rejects.toThrow();
  });

  it("com a linha devolvida, grava sem erro", async () => {
    resposta.data = [{ id: "t1" }];
    await expect(setTaskStatus("t1", "done")).resolves.toBeUndefined();
    await expect(setVisitResult("t1", "no_show")).resolves.toBeUndefined();
  });
});
