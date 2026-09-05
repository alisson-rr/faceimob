import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * O que este arquivo protege: o GATILHO da prévia tem papel e NOME ACESSÍVEL.
 *
 * Controle sem nome não é detalhe de teste — é um controle que o leitor de tela
 * anuncia como "botão" e nada mais. O nome vive num `aria-label` passado por
 * uma prop ao `SelectTrigger` do Radix, exatamente o tipo de coisa que some num
 * refactor sem quebrar nada visível.
 *
 * Ele não abre a lista: no jsdom o popover do Radix depende de APIs de ponteiro
 * que o ambiente não tem. Com a lista aberta o Radix marca `aria-hidden` em
 * tudo que está fora do popover (inclusive no gatilho), e quem cobra esse lado
 * é o e2e — `e2e/admin/configuracoes.spec.ts`.
 */
const auth = vi.hoisted(() => ({
  estado: {
    role: "admin",
    roles: ["admin"] as string[],
    isAdmin: true,
    previewRole: null as string | null,
    setPreviewRole: () => {},
  },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.estado }));

const { RoleSwitcher } = await import("./RoleSwitcher");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(ui: ReactNode) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => { root.render(<TooltipProvider>{ui}</TooltipProvider>); });
  return {
    container,
    unmount: async () => {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

beforeEach(() => {
  auth.estado = { role: "admin", roles: ["admin"], isAdmin: true, previewRole: null, setPreviewRole: () => {} };
});

describe("RoleSwitcher", () => {
  it("o gatilho é um combobox com nome acessível estável", async () => {
    const { container, unmount } = await render(<RoleSwitcher />);
    const gatilho = container.querySelector('[role="combobox"]');

    expect(gatilho, "o admin precisa ver o seletor de prévia").not.toBeNull();
    expect(gatilho?.getAttribute("aria-label")).toBe("Pré-visualizar como papel");
    await unmount();
  });

  it("a descrição do gatilho existe no DOM e diz o limite da ferramenta", async () => {
    // `aria-describedby` só resolve para elemento presente: apontar para um id
    // que não existe é o mesmo que não descrever nada.
    const { container, unmount } = await render(<RoleSwitcher />);
    const gatilho = container.querySelector('[role="combobox"]');
    const id = gatilho?.getAttribute("aria-describedby");

    expect(id, "o gatilho precisa apontar para uma descrição").toBeTruthy();
    const descricao = container.querySelector(`#${id}`);
    expect(descricao?.textContent).toMatch(/Os dados continuam sendo os seus/i);
    await unmount();
  });

  it("quem não é admin não recebe o controle — só o rótulo do próprio papel", async () => {
    // A trava real está no AuthContext; aqui se cobra que a tela não ofereça um
    // menu que o banco não sustenta.
    auth.estado = { role: "broker", roles: ["broker"], isAdmin: false, previewRole: null, setPreviewRole: () => {} };

    const { container, unmount } = await render(<RoleSwitcher />);
    expect(container.querySelector('[role="combobox"]')).toBeNull();
    expect(container.textContent).toContain("Corretor");
    await unmount();
  });

  it("em prévia, o gatilho mantém o nome e o papel previsto aparece", async () => {
    // `isAdmin` é o EFETIVO (o AuthContext troca os papéis efetivos na prévia),
    // então este é o estado em que a etiqueta "prévia" e o tooltip entram.
    auth.estado = { role: "admin", roles: ["admin"], isAdmin: false, previewRole: "cca", setPreviewRole: () => {} };

    const { container, unmount } = await render(<RoleSwitcher />);
    const gatilho = container.querySelector('[role="combobox"]');

    expect(gatilho?.getAttribute("aria-label")).toBe("Pré-visualizar como papel");
    expect(container.textContent).toContain("Ver como CCA");
    expect(container.textContent).toContain("prévia");
    await unmount();
  });
});
