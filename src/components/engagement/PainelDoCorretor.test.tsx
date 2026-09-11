import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * A abertura automática do Painel — o pedido de 11/09/2026, ao pé da letra:
 * abre para o corretor TODA VEZ que ele carrega o Pipeline.
 *
 * Existia uma trava de "uma vez por dia" que ninguém pediu. O primeiro caso é
 * esse defeito escrito como assert: a segunda carga no mesmo dia abre de novo.
 */
const auth = vi.hoisted(() => ({ estado: { role: "broker", loading: false } }));

vi.mock("@/contexts/AuthContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/AuthContext")>()),
  useAuth: () => auth.estado,
}));

const { usePainelDoCorretor } = await import("./PainelDoCorretor");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const aberto = { atual: false };
let raiz: Root | null = null;

function Sonda() {
  aberto.atual = usePainelDoCorretor().open;
  return null;
}

function carregarPagina(): Root {
  const nova = createRoot(document.createElement("div"));
  act(() => nova.render(<Sonda />));
  raiz = nova;
  return nova;
}

afterEach(() => {
  const atual = raiz;
  if (atual) act(() => atual.unmount());
  raiz = null;
  aberto.atual = false;
});

describe("usePainelDoCorretor", () => {
  it("abre para o corretor a cada carga da página, não só na primeira do dia", () => {
    auth.estado = { role: "broker", loading: false };
    const primeira = carregarPagina();
    expect(aberto.atual).toBe(true);

    act(() => primeira.unmount());
    aberto.atual = false;
    carregarPagina();
    expect(aberto.atual).toBe(true);
  });

  it.each(["manager", "director", "admin", "partner"])("não abre sozinho para %s", (role) => {
    auth.estado = { role, loading: false };
    carregarPagina();
    expect(aberto.atual).toBe(false);
  });

  it("espera o perfil: o 'broker' provisório do carregamento não abre o modal para o admin", () => {
    auth.estado = { role: "broker", loading: true };
    const tela = carregarPagina();
    expect(aberto.atual).toBe(false);

    auth.estado = { role: "admin", loading: false };
    act(() => tela.render(<Sonda />));
    expect(aberto.atual).toBe(false);
  });
});
