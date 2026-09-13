import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

/**
 * O que este arquivo protege:
 *  - categoria sem linha em `push_preferences` aparece no padrão do contrato
 *    (ligada, exceto "Outros avisos");
 *  - o interruptor só muda depois de o banco confirmar;
 *  - falha ao ler preferências não vira interruptor no padrão (seria mentira
 *    para quem já tinha desligado algo).
 */
const api = vi.hoisted(() => ({
  listMyPushPreferences: vi.fn(),
  sendTestPush: vi.fn(),
  setPushPreference: vi.fn(),
  deleteAllMyPushSubscriptions: vi.fn(),
  getPushPublicKey: vi.fn(),
  pushCategory: vi.fn(),
  registerPushSubscription: vi.fn(),
  unregisterPushSubscription: vi.fn(),
}));
const aparelho = vi.hoisted(() => ({
  getPushStatus: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
  confirmPushSubscription: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/push", () => api);
vi.mock("@/lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/push")>()),
  ...aparelho,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ toast }));

const { default: PushSettings } = await import("./PushSettings");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function montar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter><PushSettings /></MemoryRouter>);
  });
  await act(async () => {});
}

const interruptor = (categoria: string) => document.getElementById(`push-${categoria}`);
const botao = (texto: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(texto));

beforeEach(() => {
  vi.clearAllMocks();
  aparelho.getPushStatus.mockResolvedValue("off");
  api.listMyPushPreferences.mockResolvedValue([]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PushSettings", () => {
  it("sem preferência gravada mostra o padrão e só troca depois de o banco confirmar", async () => {
    await montar();
    expect(container.textContent).toContain("Desligado neste aparelho.");
    expect(interruptor("lead_recebido")?.getAttribute("aria-checked")).toBe("true");
    expect(interruptor("outros")?.getAttribute("aria-checked")).toBe("false");

    api.setPushPreference.mockRejectedValueOnce(new Error("rede"));
    await act(async () => { interruptor("outros")?.click(); });
    await act(async () => {});
    expect(interruptor("outros")?.getAttribute("aria-checked")).toBe("false");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));

    api.setPushPreference.mockResolvedValueOnce(undefined);
    await act(async () => { interruptor("outros")?.click(); });
    await act(async () => {});
    expect(api.setPushPreference).toHaveBeenLastCalledWith("u1", "outros", true);
    expect(interruptor("outros")?.getAttribute("aria-checked")).toBe("true");
  });

  it("ativar mostra o estado novo e libera o teste", async () => {
    aparelho.enablePush.mockResolvedValue("on");
    api.sendTestPush.mockResolvedValue(undefined);
    await montar();
    expect(botao("Enviar teste")).toBeUndefined();

    await act(async () => { botao("Ativar neste aparelho")?.click(); });
    await act(async () => {});
    expect(container.textContent).toContain("Ligado neste aparelho.");

    await act(async () => { botao("Enviar teste")?.click(); });
    expect(api.sendTestPush).toHaveBeenCalled();
  });

  it("assinatura local sem registro confirmado no servidor não diz 'ligado' nem oferece teste", async () => {
    aparelho.getPushStatus.mockResolvedValue("on");
    aparelho.confirmPushSubscription.mockRejectedValue(new Error("rede"));
    aparelho.enablePush.mockResolvedValue("on");
    await montar();
    expect(container.textContent).not.toContain("Ligado neste aparelho.");
    expect(container.textContent).toContain("não está registrado no servidor");
    expect(botao("Enviar teste")).toBeUndefined();

    await act(async () => { botao("Registrar de novo")?.click(); });
    await act(async () => {});
    expect(aparelho.enablePush).toHaveBeenCalled();
    expect(container.textContent).toContain("Ligado neste aparelho.");
    expect(botao("Enviar teste")).toBeDefined();
  });

  it("falha ao ler as preferências não desenha interruptor no padrão", async () => {
    api.listMyPushPreferences.mockRejectedValue(new Error("rede"));
    await montar();
    expect(interruptor("lead_recebido")).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Não foi possível carregar");
  });
});
