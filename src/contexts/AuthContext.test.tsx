import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";

/**
 * Dois comportamentos deste contexto mentiam para a tela, e os dois são
 * invisíveis num teste de renderização comum:
 *
 *   1. SAIR fingia ter saído. `supabase.auth.signOut()` zerava `user`/`session`
 *      ANTES de olhar o erro. No `@supabase/auth-js` 2.110 o `_signOut` devolve
 *      o erro sem chamar `_removeSession()` sempre que a revogação falha por
 *      algo que não seja 401/403/404 — queda de rede e 5xx, exatamente o
 *      cenário do ramo de erro. A sessão continuava no storage, com
 *      `autoRefreshToken` renovando o token, enquanto a tela ia para /login.
 *
 *   2. FALHA DE LEITURA virava "conta sem papel". `applySession` zera `roles`
 *      no `catch` (falha fechada, que é o certo para autorização), e sem papel
 *      nenhum o pós-login manda para /settings — a tela então afirmava "nenhum
 *      papel atribuído ainda", que é um fato do cadastro, não o erro que houve.
 *
 * O que este arquivo NÃO testa: o `_signOut` do auth-js. Ele é mockado; o que
 * está sob teste é a decisão que ESTE arquivo toma diante do retorno dele.
 */
const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  getCurrentProfile: vi.fn(),
  listRolePermissions: vi.fn(),
  listStagePermissions: vi.fn(),
  /** Callback do `onAuthStateChange`, para emitir eventos do GoTrue à mão. */
  emitir: null as null | ((evento: string, sessao: Session | null) => void),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signOut: mocks.signOut,
      getSession: mocks.getSession,
      onAuthStateChange: (cb: (evento: string, sessao: Session | null) => void) => {
        mocks.emitir = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  },
}));
vi.mock("@/integrations/supabase/newSchema", () => ({ getCurrentProfile: mocks.getCurrentProfile }));
vi.mock("@/integrations/supabase/permissions", () => ({
  listRolePermissions: mocks.listRolePermissions,
  listStagePermissions: mocks.listStagePermissions,
}));

const { AuthProvider, useAuth } = await import("./AuthContext");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSAO = {
  user: { id: "u-1", email: "corretor@faceimob.test", user_metadata: {} },
} as unknown as Session;

let ctx: ReturnType<typeof useAuth> | null = null;

function Sonda() {
  ctx = useAuth();
  return null;
}

async function montar(children: ReactNode = <Sonda />) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => { root.render(<AuthProvider>{children}</AuthProvider>); });
  return async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.emitir = null;
  ctx = null;
  mocks.getSession.mockResolvedValue({ data: { session: SESSAO } });
  mocks.getCurrentProfile.mockResolvedValue({
    profile: { full_name: "Corretor", email: "corretor@faceimob.test", phone: null, avatar_url: null },
    role: "broker",
    roles: ["broker"],
  });
  mocks.listRolePermissions.mockResolvedValue([]);
  mocks.listStagePermissions.mockResolvedValue([]);
  // O contexto registra a falha antes de decidir; sem isto o relatório do
  // vitest fica ilegível.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => { vi.restoreAllMocks(); });

describe("signOut", () => {
  it("mantém a sessão e AVISA quando a revogação falha", async () => {
    const desmontar = await montar();
    mocks.signOut.mockResolvedValue({ error: { message: "Failed to fetch" } });

    await act(async () => { await ctx!.signOut(); });

    // O ponto: nada de `user: null` aqui. O auth-js não removeu a sessão, então
    // limpar o estado do React mandaria a tela para /login sobre uma sessão
    // viva — que voltaria sozinha na próxima leitura da storage.
    expect(ctx!.user, "a sessão não caiu no servidor, então não pode cair na tela").not.toBeNull();
    expect(ctx!.session).not.toBeNull();
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(mocks.toast.mock.calls[0][0]).toMatchObject({ variant: "destructive" });
    // E a frase não pode afirmar que saímos deste aparelho.
    expect(String(mocks.toast.mock.calls[0][0].title)).not.toMatch(/saímos|sa[ií]mos/i);

    await desmontar();
  });

  it("no sucesso não avisa nada e quem derruba o estado é o SIGNED_OUT", async () => {
    const desmontar = await montar();
    mocks.signOut.mockResolvedValue({ error: null });

    await act(async () => { await ctx!.signOut(); });
    expect(mocks.toast).not.toHaveBeenCalled();

    // `applySession(null)` roda pelo evento do GoTrue — é ele que zera também
    // perfil, papéis e matriz, não as duas linhas que existiam aqui.
    await act(async () => { mocks.emitir?.("SIGNED_OUT", null); });
    expect(ctx!.user).toBeNull();
    expect(ctx!.session).toBeNull();
    expect(ctx!.profile).toBeNull();
    expect(ctx!.roles).toEqual([]);
    expect(ctx!.perfilFalhou, "sem sessão não há falha de leitura para relatar").toBe(false);

    await desmontar();
  });
});

describe("perfilFalhou", () => {
  it("distingue leitura que falhou de conta sem papel", async () => {
    mocks.getCurrentProfile.mockRejectedValue(new Error("PGRST301"));
    const desmontar = await montar();

    // Falha fechada continua valendo: `can()` tem de negar tudo.
    expect(ctx!.roles).toEqual([]);
    expect(ctx!.can("menu.dashboard")).toBe(false);
    // E a tela precisa saber POR QUE está vazio.
    expect(ctx!.perfilFalhou).toBe(true);
    // O nome ainda aparece: vem do metadata da sessão, não da leitura que caiu.
    expect(ctx!.profile?.email).toBe("corretor@faceimob.test");

    await desmontar();
  });

  it("volta a false quando a leitura seguinte dá certo", async () => {
    mocks.getCurrentProfile.mockRejectedValueOnce(new Error("PGRST301"));
    const desmontar = await montar();
    expect(ctx!.perfilFalhou).toBe(true);

    // Mesmo usuário, nova leitura (TOKEN_REFRESHED): o sinal não pode ficar
    // preso, senão a tela acusa erro que já passou.
    await act(async () => { mocks.emitir?.("TOKEN_REFRESHED", SESSAO); });
    expect(ctx!.perfilFalhou).toBe(false);
    expect(ctx!.roles).toEqual(["broker"]);

    await desmontar();
  });
});
