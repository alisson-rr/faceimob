import { describe, expect, it } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { CcaBoard } from "./CcaBoard";
import type { CcaDeal, CcaStage } from "./ccaData";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * O cartão da esteira abre o negócio — e ONDE o alvo do clique mora.
 *
 * Pedido do cliente em 10/09/2026: clicar no cartão do CCA abre o MESMO
 * `DealDetailModal` do Pipeline. O que este teste fixa é o desenho que faz isso
 * conviver com "Enviar à construtora" e "Mover para…" no mesmo cartão: o corpo
 * clicável é IRMÃO dos dois controles, nunca o pai deles.
 *
 * Se algum dia alguém envolver o cartão inteiro no `role="button"`, duas coisas
 * quebram de uma vez — todo clique em "Mover para…" passa a abrir o modal por
 * borbulhamento, e o leitor de tela deixa de anunciar os dois controles, porque
 * descendente de botão é presentacional na especificação ARIA (a mesma regra
 * `nested-interactive` que o `DealCard` já respeita).
 */
const STAGE: CcaStage = {
  id: "s1", name: "Em análise", color: "#0ea5e9", position: 1, status: "under_review",
};

const DEAL: CcaDeal = {
  caseId: "c1",
  dealId: "d1",
  client: "Cliente Teste",
  developer: "Construtora Alfa",
  project: "Residencial Aurora",
  broker: "Ana Corretora",
  value: 100_000,
  stageId: "s1",
  notes: "",
  status: "under_review",
};

async function renderBoard(canAct: boolean) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const abertos: string[] = [];

  await act(async () => {
    root.render(
      <CcaBoard
        stages={[STAGE]}
        deals={[DEAL]}
        canAct={canAct}
        onOpen={(deal) => abertos.push(deal.dealId)}
        onMove={() => undefined}
        onSubmitToDeveloper={() => undefined}
      /> as ReactNode,
    );
  });

  const corpo = container.querySelector<HTMLElement>('[aria-label^="Abrir o negócio de Cliente Teste"]');
  const mover = container.querySelector<HTMLElement>('[aria-label="Mover Cliente Teste para outro estágio"]');
  const enviar = [...container.querySelectorAll("button")]
    .find((botao) => botao.textContent?.includes("Enviar à construtora")) ?? null;

  const resultado = {
    temCorpo: Boolean(corpo),
    ehFocavel: corpo?.getAttribute("tabindex") === "0",
    // Dentro do `role="button"` o conteúdo vira presentacional: se o nome
    // acessível não repetir o cartão, corretor e VGV somem do leitor de tela.
    nomeAcessivel: corpo?.getAttribute("aria-label") ?? "",
    // A pergunta que importa: o controle está DENTRO do alvo de clique?
    moverDentroDoCorpo: Boolean(mover && corpo?.contains(mover)),
    enviarDentroDoCorpo: Boolean(enviar && corpo?.contains(enviar)),
    temMover: Boolean(mover),
    abertos,
    clicar: async () => { await act(async () => { corpo?.click(); }); },
    teclar: async (key: string) => {
      await act(async () => {
        corpo?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
    },
    encerrar: async () => {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
  return resultado;
}

describe("CcaBoard · o cartão abre o negócio", () => {
  it("chama onOpen com o dealId no clique e no Enter", async () => {
    const board = await renderBoard(true);
    expect(board.temCorpo, "o cartão precisa de um alvo de clique nomeado").toBe(true);
    expect(board.ehFocavel, "sem tabindex o teclado não alcança o cartão").toBe(true);

    await board.clicar();
    await board.teclar("Enter");
    await board.teclar(" ");
    // `dealId`, não `caseId`: o editor carrega o NEGÓCIO, não o caso da esteira.
    expect(board.abertos).toEqual(["d1", "d1", "d1"]);

    await board.encerrar();
  });

  it("leva o conteúdo do cartão para o nome acessível, que o ARIA apaga", async () => {
    const board = await renderBoard(true);
    expect(board.nomeAcessivel).toContain("Construtora Alfa");
    expect(board.nomeAcessivel).toContain("Residencial Aurora");
    expect(board.nomeAcessivel).toContain("Ana Corretora");
    expect(board.nomeAcessivel, "o VGV é o número que define comissão").toMatch(/100\.000/);
    await board.encerrar();
  });

  it("não engole os controles: mover e enviar ficam FORA do alvo de clique", async () => {
    const board = await renderBoard(true);
    expect(board.temMover, "com permissão o Select de mover existe").toBe(true);
    expect(board.moverDentroDoCorpo, '"Mover para…" dentro do alvo abriria o modal a cada uso').toBe(false);
    expect(board.enviarDentroDoCorpo, '"Enviar à construtora" dentro do alvo faria o mesmo').toBe(false);
    await board.encerrar();
  });

  it("abre o negócio mesmo sem permissão de decidir o caso — abrir é leitura", async () => {
    const board = await renderBoard(false);
    expect(board.temMover, "sem cca.review o cartão não oferece mover").toBe(false);
    await board.clicar();
    expect(board.abertos).toEqual(["d1"]);
    await board.encerrar();
  });
});
