import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As regras do som de premiação que não podem regredir em silêncio: respeitar
 * o interruptor, trocar a faixa pelo som curto no `prefers-reduced-motion` (só
 * no disparo automático), nunca empilhar duas faixas sem calar o marco
 * seguinte, e cair no sintetizado quando o navegador recusa a faixa.
 */

const estado = vi.hoisted(() => ({ ligado: true, liberado: false }));
const sintetizado = vi.hoisted(() => vi.fn());

vi.mock("@/lib/engagement/audio", () => ({
  isSoundOn: () => estado.ligado,
  audioLiberado: () => estado.liberado,
  subscribeSound: () => () => {},
  playSound: sintetizado,
}));

const menosMovimento = (ativo: boolean) =>
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: ativo && consulta.includes("reduce"),
    media: consulta,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }));

/** Estado do módulo é de módulo: recarregar é o que isola um caso do outro. */
const carregar = async () => {
  vi.resetModules();
  return import("./useSomDePremiacao");
};

/** Deixa as rejeições de `play` chegarem ao `catch`. */
const esperarPromessas = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

let tocar: ReturnType<typeof vi.fn>;
let pausar: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  estado.ligado = true;
  estado.liberado = false;
  sintetizado.mockClear();
  menosMovimento(false);
  // jsdom não implementa reprodução: o que importa aqui é SE `play` foi
  // chamado, não o som.
  tocar = vi.fn(() => Promise.resolve());
  pausar = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(tocar);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pausar);
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    writable: true,
    value: 0,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("tocarPremiacao", () => {
  it("não toca com o som desligado", async () => {
    estado.ligado = false;
    const { tocarPremiacao } = await carregar();
    tocarPremiacao();
    expect(tocar).not.toHaveBeenCalled();
    expect(sintetizado).not.toHaveBeenCalled();
  });

  it("com menos movimento, o marco automático troca a faixa pelo som curto do próprio marco", async () => {
    menosMovimento(true);
    const { tocarPremiacao } = await carregar();
    tocarPremiacao({ sintetizado: "rankUp" });
    expect(tocar).not.toHaveBeenCalled();
    expect(sintetizado).toHaveBeenCalledWith("rankUp");
  });

  it("toca a faixa no clique explícito mesmo com menos movimento", async () => {
    menosMovimento(true);
    const { tocarPremiacao } = await carregar();
    tocarPremiacao({ manual: true });
    expect(tocar).toHaveBeenCalledTimes(1);
    expect(sintetizado).not.toHaveBeenCalled();
  });

  it("dois marcos no mesmo trecho tocam uma comemoração só", async () => {
    const { tocarPremiacao } = await carregar();
    tocarPremiacao();
    vi.advanceTimersByTime(3000);
    tocarPremiacao();
    expect(tocar).toHaveBeenCalledTimes(1);
  });

  it("no modo reduzido a trava também vale: dois marcos juntos não empilham dois sons curtos", async () => {
    menosMovimento(true);
    const { tocarPremiacao } = await carregar();
    tocarPremiacao();
    tocarPremiacao();
    expect(sintetizado).toHaveBeenCalledTimes(1);
  });

  /**
   * A segunda venda seguida entra quando o card da primeira sai, e o card dura
   * `TRECHO_MS`. A trava não pode depender do esmaecimento ter terminado: em
   * aba de fundo o `setInterval` dele atrasa e o marco seguinte ficava mudo.
   */
  it("passado o trecho, o marco seguinte toca de novo mesmo com o esmaecimento atrasado", async () => {
    const { tocarPremiacao, TRECHO_MS } = await carregar();
    tocarPremiacao();
    // Só o relógio anda: nenhum timer roda, como numa aba estrangulada.
    vi.setSystemTime(Date.now() + TRECHO_MS);
    tocarPremiacao();
    expect(tocar).toHaveBeenCalledTimes(2);
  });

  it("o recomeço não é calado pela rejeição atrasada do toque anterior", async () => {
    let rejeitarPrimeiro: (erro: Error) => void = () => {};
    tocar
      .mockImplementationOnce(() => new Promise((_ok, falha) => { rejeitarPrimeiro = falha; }))
      .mockImplementationOnce(() => Promise.resolve());
    const { tocarPremiacao, TRECHO_MS } = await carregar();
    tocarPremiacao();
    vi.setSystemTime(Date.now() + TRECHO_MS);
    tocarPremiacao();
    const pausasAntes = pausar.mock.calls.length;

    // O `pause` do recomeço rejeita o `play` pendente do primeiro toque.
    rejeitarPrimeiro(new DOMException("interrompido", "AbortError"));
    await esperarPromessas();

    expect(pausar.mock.calls.length).toBe(pausasAntes);
    expect(sintetizado).not.toHaveBeenCalled();
  });

  /**
   * Rede lenta: o `play` ainda está pendente quando o esmaecimento termina e
   * pausa a faixa. Pela especificação, esse `pause` rejeita o `play` com
   * AbortError — é o próprio app encerrando o trecho, não recusa do navegador.
   */
  it("o fim do trecho com play pendente não vira som curto atrasado", async () => {
    estado.liberado = true;
    let rejeitar: (erro: Error) => void = () => {};
    tocar.mockImplementationOnce(() => new Promise((_ok, falha) => { rejeitar = falha; }));
    pausar.mockImplementation(() => rejeitar(new DOMException("interrompido", "AbortError")));
    const { tocarPremiacao, TRECHO_MS } = await carregar();
    tocarPremiacao();

    vi.advanceTimersByTime(TRECHO_MS + 200);
    await esperarPromessas();

    expect(pausar).toHaveBeenCalled();
    expect(sintetizado).not.toHaveBeenCalled();
  });

  it("navegador recusou a faixa depois de um gesto na aba: toca o sintetizado", async () => {
    estado.liberado = true;
    tocar.mockImplementationOnce(() => Promise.reject(new DOMException("sem gesto", "NotAllowedError")));
    const { tocarPremiacao } = await carregar();
    tocarPremiacao({ sintetizado: "goal" });
    await esperarPromessas();
    expect(sintetizado).toHaveBeenCalledWith("goal");
  });

  it("recusa sem gesto nenhum (carregamento da página) continua muda", async () => {
    estado.liberado = false;
    tocar.mockImplementationOnce(() => Promise.reject(new DOMException("sem gesto", "NotAllowedError")));
    const { tocarPremiacao } = await carregar();
    tocarPremiacao();
    await esperarPromessas();
    expect(sintetizado).not.toHaveBeenCalled();
  });
});
