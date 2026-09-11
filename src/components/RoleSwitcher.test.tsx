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
/**
 * O seletor lê `realRole`/`realRoles`/`realIsAdmin` — o que vale para quem está
 * logado, não o efetivo. É o que o mantém na tela durante a prévia: com o
 * efetivo, `isAdmin` viraria falso ao pré-visualizar corretor, o controle
 * sumiria e o admin ficaria sem caminho de volta.
 *
 * Por isso os dois convivem no mock: `isAdmin` (efetivo) e `realIsAdmin`
 * (real). Onde eles divergem está exatamente a armadilha que estes casos
 * cobram.
 */
const auth = vi.hoisted(() => ({
  estado: {
    realRole: "admin",
    realRoles: ["admin"] as string[],
    realIsAdmin: true,
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
  auth.estado = { realRole: "admin", realRoles: ["admin"], realIsAdmin: true, isAdmin: true, previewRole: null, setPreviewRole: () => {} };
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
    auth.estado = { realRole: "broker", realRoles: ["broker"], realIsAdmin: false, isAdmin: false, previewRole: null, setPreviewRole: () => {} };

    const { container, unmount } = await render(<RoleSwitcher />);
    expect(container.querySelector('[role="combobox"]')).toBeNull();
    expect(container.textContent).toContain("Corretor");
    await unmount();
  });

  it("o sócio recebe o controle — administrador e sócio têm o mesmo nível", async () => {
    // Decisão do cliente em 10/09/2026. `setPreviewRole` no AuthContext já
    // autoriza o sócio; sem esta regra a tela escondia o que o contexto liberava.
    auth.estado = { realRole: "partner", realRoles: ["partner"], realIsAdmin: true, isAdmin: true, previewRole: null, setPreviewRole: () => {} };

    const { container, unmount } = await render(<RoleSwitcher />);
    expect(container.querySelector('[role="combobox"]')).not.toBeNull();
    expect(container.textContent).toContain("Sócio (você)");
    await unmount();
  });

  it("em prévia, o gatilho mantém o nome e o papel previsto aparece", async () => {
    // `isAdmin: false` com `realIsAdmin: true` é a prévia de corretor/CCA: o
    // gate do seletor tem de olhar o REAL, senão o controle some e quem está
    // conferindo fica trancado na prévia.
    auth.estado = { realRole: "admin", realRoles: ["admin"], realIsAdmin: true, isAdmin: false, previewRole: "cca", setPreviewRole: () => {} };

    const { container, unmount } = await render(<RoleSwitcher />);
    const gatilho = container.querySelector('[role="combobox"]');

    expect(gatilho, "o seletor tem de sobreviver à prévia").not.toBeNull();
    expect(gatilho?.getAttribute("aria-label")).toBe("Pré-visualizar como papel");
    expect(container.textContent).toContain("Ver como CCA");
    expect(container.textContent).toContain("prévia");
    await unmount();
  });

  it("o selo de prévia aparece mesmo quando o papel previsto continua podendo tudo", async () => {
    // O caso que o `&& !isAdmin` apagava: em "Ver como Sócio" o isAdmin EFETIVO
    // continua verdadeiro (sócio tem o poder do administrador desde 10/09/2026),
    // e o selo sumia justamente na prévia mais fácil de confundir com a tela
    // real. O aviso não depende do papel escolhido, e sim de haver prévia.
    auth.estado = { realRole: "admin", realRoles: ["admin"], realIsAdmin: true, isAdmin: true, previewRole: "partner", setPreviewRole: () => {} };

    const { container, unmount } = await render(<RoleSwitcher />);
    expect(container.textContent).toContain("Ver como Sócio");
    expect(container.textContent).toContain("prévia");
    await unmount();
  });
});
