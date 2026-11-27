import { describe, expect, it } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { sessaoContinuaValida } from "./sessaoNoServidor";

const sessao = {} as Session;
const auth = (atual: Session | null, renovada: Session | null | Error) => ({
  getSession: async () => ({ data: { session: atual } }),
  refreshSession: async () => {
    if (renovada instanceof Error) throw renovada;
    return { data: { session: renovada } };
  },
});

describe("sessaoContinuaValida", () => {
  it("vale quando há sessão", async () => {
    expect(await sessaoContinuaValida(auth(sessao, null))).toBe(true);
  });
  it("vale quando a renovação devolve sessão", async () => {
    expect(await sessaoContinuaValida(auth(null, sessao))).toBe(true);
  });
  it("expira quando não há sessão nem renovação", async () => {
    expect(await sessaoContinuaValida(auth(null, null))).toBe(false);
    expect(await sessaoContinuaValida(auth(null, new Error("rede")))).toBe(false);
  });
});
