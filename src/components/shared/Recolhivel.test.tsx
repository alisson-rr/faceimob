import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Recolhivel } from "./Recolhivel";

describe("Recolhivel", () => {
  it("nasce recolhido: a lista só aparece depois do clique na linha", () => {
    const { container } = render(<Recolhivel titulo="Equipe Alfa">conteúdo</Recolhivel>);
    const detalhes = container.querySelector("details");
    expect(detalhes?.hasAttribute("open")).toBe(false);
    expect(screen.getByText("Equipe Alfa")).toBeTruthy();
  });

  it("abre ao montar quando pedido", () => {
    const { container } = render(<Recolhivel titulo="Equipe Alfa" aberta>conteúdo</Recolhivel>);
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(true);
  });
});
