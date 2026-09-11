import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As quatro regras do som de premiação que não podem regredir em silêncio:
 * respeitar o interruptor, respeitar `prefers-reduced-motion` no disparo
 * automático (e só nele), e nunca empilhar dois áudios.
 */

const estado = vi.hoisted(() => ({ ligado: true }));

vi.mock("@/lib/engagement/audio", () => ({
  isSoundOn: () => estado.ligado,
  subscribeSound: () => () => {},
  playSound: vi.fn(),
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

let tocar: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  estado.ligado = true;
  menosMovimento(false);
  // jsdom não implementa reprodução: o que importa aqui é SE `play` foi
  // chamado, não o som.
  tocar = vi.fn(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(tocar);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
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
  });

  it("não dispara sozinho quando a pessoa pediu menos movimento", async () => {
    menosMovimento(true);
    const { tocarPremiacao } = await carregar();
    tocarPremiacao();
    expect(tocar).not.toHaveBeenCalled();
  });

  it("toca no clique explícito mesmo com menos movimento", async () => {
    menosMovimento(true);
    const { tocarPremiacao } = await carregar();
    tocarPremiacao({ manual: true });
    expect(tocar).toHaveBeenCalledTimes(1);
  });

  it("dois marcos ao mesmo tempo tocam um áudio só", async () => {
    const { tocarPremiacao } = await carregar();
    tocarPremiacao();
    tocarPremiacao();
    expect(tocar).toHaveBeenCalledTimes(1);
  });
});
