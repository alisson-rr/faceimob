import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SectionCard } from "./SectionCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(props: { recolhivel?: boolean; abertoInicial?: boolean }) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(<SectionCard title="Meta global do mês" {...props}><p>corpo</p></SectionCard>);
  });
  const corpo = () => container.querySelector("p")!.parentElement!;
  const botao = () => container.querySelector<HTMLButtonElement>("h2 button");
  const cleanup = () => { act(() => root.unmount()); container.remove(); };
  return { container, corpo, botao, cleanup };
}

// Pedido de 29/09/2026: as metas do topo de Equipes viram linhas recolhidas.
describe("SectionCard recolhível", () => {
  it("nasce fechado, abre pelo botão dentro do título e fecha de novo", async () => {
    const { corpo, botao, container, cleanup } = await render({ recolhivel: true });
    expect(corpo().hidden).toBe(true);
    // O botão fica DENTRO do <h2>: o título segue na navegação por cabeçalhos.
    expect(container.querySelector("h2")!.textContent).toBe("Meta global do mês");
    expect(botao()!.getAttribute("aria-expanded")).toBe("false");
    expect(botao()!.getAttribute("aria-controls")).toBe(corpo().id);

    await act(async () => botao()!.click());
    expect(corpo().hidden).toBe(false);
    expect(botao()!.getAttribute("aria-expanded")).toBe("true");

    await act(async () => botao()!.click());
    expect(corpo().hidden).toBe(true);
    cleanup();
  });

  it("abre de saída quando a pessoa chegou para preencher", async () => {
    const { corpo, botao, cleanup } = await render({ recolhivel: true, abertoInicial: true });
    expect(corpo().hidden).toBe(false);
    expect(botao()!.getAttribute("aria-expanded")).toBe("true");
    cleanup();
  });

  it("sem recolhível continua como antes: sem botão, corpo sempre visível", async () => {
    const { corpo, botao, cleanup } = await render({});
    expect(botao()).toBeNull();
    expect(corpo().hidden).toBe(false);
    cleanup();
  });
});
