import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { CcaBoard } from "./CcaBoard";
import type { CcaDeal, CcaSendCount, CcaStage } from "./ccaData";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * O cartão da esteira abre o negócio — e ONDE o alvo do clique mora.
 *
 * Pedido do cliente em 10/09/2026: clicar no cartão do CCA abre o MESMO
 * `DealDetailModal` do Pipeline. O que este teste fixa é o desenho que faz isso
 * conviver com "Mover para…" no mesmo cartão: o corpo clicável é IRMÃO do
 * controle, nunca o pai dele.
 *
 * Se algum dia alguém envolver o cartão inteiro no `role="button"`, duas coisas
 * quebram de uma vez — todo clique em "Mover para…" passa a abrir o modal por
 * borbulhamento, e o leitor de tela deixa de anunciar o controle, porque
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

async function renderBoard(canAct: boolean, sendCounts?: Map<string, CcaSendCount>) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const abertos: string[] = [];

  await act(async () => {
    root.render(
      <CcaBoard
        stages={[STAGE]}
        deals={[DEAL]}
        canAct={canAct}
        sendCounts={sendCounts}
        onOpen={(deal) => abertos.push(deal.dealId)}
        onMove={() => undefined}
      /> as ReactNode,
    );
  });

  const corpo = container.querySelector<HTMLElement>('[aria-label^="Abrir o negócio de Cliente Teste"]');
  const mover = container.querySelector<HTMLElement>('[aria-label="Mover Cliente Teste para outro estágio"]');
  const enviar = [...container.querySelectorAll("button")]
    .some((botao) => botao.textContent?.includes("Enviar à construtora"));

  const resultado = {
    temCorpo: Boolean(corpo),
    ehFocavel: corpo?.getAttribute("tabindex") === "0",
    // Dentro do `role="button"` o conteúdo vira presentacional: se o nome
    // acessível não repetir o cartão, corretor e VGV somem do leitor de tela.
    nomeAcessivel: corpo?.getAttribute("aria-label") ?? "",
    // A pergunta que importa: o controle está DENTRO do alvo de clique?
    moverDentroDoCorpo: Boolean(mover && corpo?.contains(mover)),
    temEnviar: enviar,
    temMover: Boolean(mover),
    texto: container.textContent ?? "",
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

  it("não engole o controle: mover fica FORA do alvo de clique", async () => {
    const board = await renderBoard(true);
    expect(board.temMover, "com permissão o Select de mover existe").toBe(true);
    expect(board.moverDentroDoCorpo, '"Mover para…" dentro do alvo abriria o modal a cada uso').toBe(false);
    await board.encerrar();
  });

  it("não oferece enviar à construtora: o envio é do gerente (17/09/2026)", async () => {
    const board = await renderBoard(true);
    expect(board.temEnviar, "o cartão voltou a ter o botão de envio").toBe(false);
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

/**
 * Quantas vezes o cliente foi enviado por esteira (0150), ao lado do nome.
 * Selo com zero é ruído; e, dentro do alvo de clique, o texto do selo é
 * presentacional — a contagem precisa estar no nome acessível do cartão.
 */
describe("CcaBoard · envios por esteira", () => {
  it("mostra só o selo com envio e leva a contagem ao nome acessível", async () => {
    const board = await renderBoard(true, new Map([["d1", { agil: 2, virar: 0 }]]));
    expect(board.texto).toContain("Ágil 2");
    expect(board.texto, "selo de Virar com zero envio").not.toContain("Virar");
    expect(board.nomeAcessivel).toContain("Enviado 2 vezes pela Esteira Ágil.");
    await board.encerrar();
  });

  it("sem contagem o cartão não fala de envio", async () => {
    const board = await renderBoard(true);
    expect(board.texto).not.toContain("Ágil");
    expect(board.nomeAcessivel).not.toContain("Enviado");
    await board.encerrar();
  });
});

/**
 * A lista de "Mover para…" só é montada quando o menu abre — fechado, o
 * `SelectContent` do Radix montava os itens de todos os cartões da esteira. O
 * que este teste fixa é que a economia não custou o gesto: abrir pelo teclado
 * mostra os OUTROS estágios e escolher um chama `onMove` com ele.
 */
describe("CcaBoard · mover para outro estágio", () => {
  it("monta a lista só ao abrir e move para o estágio escolhido", async () => {
    // O jsdom não tem o que o posicionamento do Radix usa.
    const semResize = !("ResizeObserver" in globalThis);
    if (semResize) {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    }
    const semScroll = !Element.prototype.scrollIntoView;
    if (semScroll) Element.prototype.scrollIntoView = () => undefined;

    const outro: CcaStage = { ...STAGE, id: "s2", name: "Aprovado", position: 2, status: "approved" };
    const movidos: string[] = [];
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CcaBoard
          stages={[STAGE, outro]}
          deals={[DEAL]}
          canAct
          onOpen={() => undefined}
          onMove={(_caso, stage) => movidos.push(stage.id)}
        /> as ReactNode,
      );
    });

    expect(document.querySelectorAll('[role="option"]'), "fechado, a lista não existe").toHaveLength(0);

    const mover = container.querySelector<HTMLElement>('[aria-label="Mover Cliente Teste para outro estágio"]');
    await act(async () => {
      mover?.focus();
      mover?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    const opcoes = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    // O estágio atual do caso não é destino.
    expect(opcoes.map((opcao) => opcao.textContent)).toEqual(["Aprovado"]);

    await act(async () => {
      opcoes[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(movidos).toEqual(["s2"]);

    await act(async () => { root.unmount(); });
    container.remove();
    if (semResize) delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    if (semScroll) delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
});

/**
 * Kanban colorido (pedido de 18/09/2026, no desenho do CV CRM): o cabeçalho é
 * sólido na cor da coluna e diz quanto a coluna soma, e cada cartão repete a
 * cor na borda esquerda. A quantidade não pode sumir para o leitor de tela —
 * ela saiu do selo e foi para a linha do total.
 */
describe("CcaBoard · kanban colorido", () => {
  it("cabeçalho na cor da coluna com total e quantidade; cartões com a mesma cor", async () => {
    const outro: CcaDeal = { ...DEAL, caseId: "c2", dealId: "d2", client: "Outro Cliente", value: 338_000 };
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CcaBoard
          stages={[STAGE]}
          deals={[DEAL, outro]}
          canAct={false}
          onOpen={() => undefined}
          onMove={() => undefined}
        /> as ReactNode,
      );
    });

    const cabecalho = container.querySelector("h2")?.parentElement;
    expect(container.querySelector("h2")?.textContent).toBe("Em análise");
    // #0ea5e9: fundo da coluna, e texto preto (dá mais contraste que o branco).
    expect(cabecalho?.style.backgroundColor).toBe("rgb(14, 165, 233)");
    expect(cabecalho?.style.color).toBe("rgb(0, 0, 0)");
    // 100.000 + 338.000. O substantivo é só do leitor de tela.
    expect(cabecalho?.textContent).toMatch(/R\$\s438\.000 · 2 casos$/);

    const cartoes = [...container.querySelectorAll<HTMLElement>("article")];
    expect(cartoes).toHaveLength(2);
    // O jsdom devolve a borda como foi escrita (e o fundo em rgb()).
    expect(cartoes.map((cartao) => cartao.style.borderLeftColor)).toEqual(["#0ea5e9", "#0ea5e9"]);

    // Indicador do topo: a cor vai na faixa, o número fica na cor do texto.
    expect(container.querySelector<HTMLElement>("span.h-1")?.style.backgroundColor).toBe("rgb(14, 165, 233)");

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("coluna com chave antiga pinta com o hex do tom", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CcaBoard
          stages={[{ ...STAGE, color: "success" }]}
          deals={[]}
          canAct={false}
          onOpen={() => undefined}
          onMove={() => undefined}
        /> as ReactNode,
      );
    });
    const cabecalho = container.querySelector("h2")?.parentElement;
    // TONE_HEX.success = #16A34A.
    expect(cabecalho?.style.backgroundColor).toBe("rgb(22, 163, 74)");
    expect(cabecalho?.textContent).toMatch(/R\$\s0 · 0 casos$/);
    await act(async () => { root.unmount(); });
    container.remove();
  });
});

/**
 * Faixa de indicadores recolhível (pedido de 17/09/2026). O botão fica no
 * lugar e anuncia o estado; a escolha fica no navegador, e sem ela a faixa abre
 * na tela larga e fecha abaixo de 640 px — no celular ela empurrava o quadro
 * ~970 px para baixo.
 */
describe("CcaBoard · recolher indicadores", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar() {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CcaBoard
          stages={[STAGE]}
          deals={[DEAL]}
          canAct={false}
          onOpen={() => undefined}
          onMove={() => undefined}
        /> as ReactNode,
      );
    });
    const botao = () => container.querySelector<HTMLButtonElement>("button[aria-controls]");
    const faixa = () => document.getElementById(botao()?.getAttribute("aria-controls") ?? "");
    return {
      botao,
      aberta: () => botao()?.getAttribute("aria-expanded") === "true" && faixa()?.hidden === false,
      fechada: () => botao()?.getAttribute("aria-expanded") === "false" && faixa()?.hidden === true,
      clicar: async () => { await act(async () => { botao()?.click(); }); },
      encerrar: async () => {
        await act(async () => { root.unmount(); });
        container.remove();
      },
    };
  }

  const largura = (px: number) => vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: px >= Number(/min-width:\s*(\d+)px/.exec(consulta)?.[1] ?? Infinity),
  }));

  it("abre na tela larga e fecha abaixo de 640 px", async () => {
    largura(1280);
    const larga = await montar();
    expect(larga.aberta(), "a 1280 px a faixa abre").toBe(true);
    await larga.encerrar();

    largura(375);
    const celular = await montar();
    expect(celular.fechada(), "a 375 px a faixa começa fechada").toBe(true);
    expect(celular.botao()?.textContent).toContain("Mostrar indicadores");
    await celular.encerrar();
  });

  it("recolhe e expande, anuncia o estado e lembra a escolha", async () => {
    largura(1280);
    const board = await montar();
    expect(board.botao()?.textContent).toContain("Recolher indicadores");

    await board.clicar();
    expect(board.fechada(), "recolher esconde a faixa e diz aria-expanded=false").toBe(true);
    expect(board.botao()?.textContent).toContain("Mostrar indicadores");
    await board.encerrar();

    // Recarregar a tela na mesma largura respeita a escolha, não o padrão.
    const depois = await montar();
    expect(depois.fechada(), "a escolha não ficou no navegador").toBe(true);
    await depois.clicar();
    expect(depois.aberta()).toBe(true);
    expect(localStorage.getItem("faceimob-cca-indicadores")).toBe("aberto");
    await depois.encerrar();
  });

  it("sem storage a tela funciona e o botão continua alternando", async () => {
    largura(1280);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("bloqueado"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("bloqueado"); });
    const board = await montar();
    expect(board.aberta()).toBe(true);
    await board.clicar();
    expect(board.fechada()).toBe(true);
    await board.encerrar();
  });
});
