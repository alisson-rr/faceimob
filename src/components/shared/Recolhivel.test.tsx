import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Recolhivel } from "./Recolhivel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function montar(aberta?: boolean) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<Recolhivel titulo="Equipe Alfa" aberta={aberta}>conteúdo</Recolhivel>);
  });
  return host;
}

describe("Recolhivel", () => {
  it("nasce recolhido, com a linha à vista", async () => {
    const host = await montar();
    expect(host.querySelector("details")?.hasAttribute("open")).toBe(false);
    expect(host.querySelector("summary")?.textContent).toContain("Equipe Alfa");
  });

  it("abre ao montar quando pedido", async () => {
    const host = await montar(true);
    expect(host.querySelector("details")?.hasAttribute("open")).toBe(true);
  });
});
