import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Podium } from "./Podium";

// Sem @testing-library no projeto, o render é o do react-dom mesmo; a flag é o
// que faz `act` aceitar o jsdom como ambiente de teste.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Podium", () => {
  it("escreve os pontos com separador de milhar, igual à tabela ao lado", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <Podium
          entries={[
            { id: "a", name: "Ana Lima", points: 2440 },
            { id: "b", name: "Bruno Reis", points: 1230 },
          ]}
        />,
      );
    });

    // Ordem visual do pódio: 2º à esquerda, 1º ao centro.
    const [second, first] = Array.from(container.querySelectorAll("li"));
    expect(first.textContent).toContain("2.440");
    expect(first.textContent).not.toContain("2440");
    expect(first.getAttribute("aria-label")).toBe("1º lugar: Ana Lima, 2.440 pontos");
    expect(second.getAttribute("aria-label")).toBe("2º lugar: Bruno Reis, 1.230 pontos");

    await act(async () => {
      root.unmount();
    });
  });

  it("escreve a colocação congelada, não a posição na lista", async () => {
    // Temporada fechada vista por corretor: `buildFrozenScores` filtra quem o
    // escopo de hoje não identifica, então o primeiro degrau pode ser o 5º
    // colocado da casa. Numerar pelo índice coroava como 1º quem a tabela ao
    // lado numerava "#5" — a mesma tela dizendo duas coisas sobre a mesma
    // pessoa.
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <Podium
          entries={[
            { id: "a", name: "Ana Lima", points: 90, place: 5 },
            { id: "b", name: "Bruno Reis", points: 40, place: 9 },
          ]}
        />,
      );
    });

    const [second, first] = Array.from(container.querySelectorAll("li"));
    expect(first.getAttribute("aria-label")).toBe("5º lugar: Ana Lima, 90 pontos");
    expect(second.getAttribute("aria-label")).toBe("9º lugar: Bruno Reis, 40 pontos");
    expect(first.textContent).toContain("5º");
    expect(first.textContent).not.toContain("1º");

    await act(async () => {
      root.unmount();
    });
  });
});
