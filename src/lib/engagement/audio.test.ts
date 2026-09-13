import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A regra "som de aviso cede a vez" do `audio.ts`.
 *
 * O harness não tem saída de som: o que se prova é o que o módulo pede ao
 * AudioContext — quantas notas cada toque cria e o que acontece com o canal dos
 * avisos. O contexto é um dublê com relógio controlado, porque a regra corre no
 * relógio do áudio, não no do sistema.
 */

let agora = 0;
let notas = 0;

const parametro = () => ({
  value: 1,
  setValueAtTime: vi.fn(),
  exponentialRampToValueAtTime: vi.fn(),
  cancelScheduledValues: vi.fn(),
  setTargetAtTime: vi.fn(),
});

let ganhos: ReturnType<typeof parametro>[] = [];

class ContextoFalso {
  destination = {};
  get currentTime() {
    return agora;
  }
  resume() {
    return Promise.resolve();
  }
  createGain() {
    const gain = parametro();
    ganhos.push(gain);
    return { gain, connect: vi.fn(), disconnect: vi.fn() };
  }
  createOscillator() {
    notas += 1;
    return {
      type: "sine",
      frequency: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };
  }
}

/** Contexto e janela são estado de módulo: recarregar é o que isola um caso do outro. */
const carregar = async () => {
  vi.resetModules();
  agora = 10;
  notas = 0;
  ganhos = [];
  localStorage.clear();
  vi.stubGlobal("AudioContext", ContextoFalso);
  return import("./audio");
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("som de aviso cede a vez", () => {
  it("rajada de avisos toca uma vez, mesmo espaçada dentro da janela", async () => {
    const { playSound } = await carregar();
    playSound("error");
    playSound("success");
    agora += 1;
    playSound("error");
    // Só as duas notas do primeiro erro.
    expect(notas).toBe(2);
  });

  it("aviso logo depois de uma comemoração fica mudo", async () => {
    const { playSound } = await carregar();
    playSound("checkin");
    agora += 0.5;
    playSound("success");
    expect(notas).toBe(1);
  });

  it("passada a janela, o aviso volta a tocar", async () => {
    const { playSound } = await carregar();
    playSound("success");
    agora += 5;
    playSound("success");
    expect(notas).toBe(4);
  });

  it("comemoração que chega com o aviso soando toca e abafa o aviso, e o aviso seguinte reabre o canal", async () => {
    const { playSound } = await carregar();
    playSound("success");
    agora += 0.1;
    playSound("leadNew");
    expect(notas).toBe(4);
    // O primeiro ganho criado é o volume geral; o segundo, o canal dos avisos.
    const canalDosAvisos = ganhos[1];
    expect(canalDosAvisos.setTargetAtTime).toHaveBeenCalledWith(0, agora, expect.any(Number));
    // Sem reabrir, o canal fica zerado e todo aviso sai mudo até recarregar a página.
    agora += 5;
    playSound("error");
    expect(notas).toBe(6);
    expect(canalDosAvisos.setValueAtTime).toHaveBeenCalledWith(1, agora);
  });

  it("a prévia de sons toca mesmo dentro da janela", async () => {
    const { playSound } = await carregar();
    playSound("success", { manual: true });
    playSound("success", { manual: true });
    expect(notas).toBe(4);
  });

  it("com o som desligado, aviso não toca", async () => {
    const { playSound, setSoundOn } = await carregar();
    setSoundOn(false);
    playSound("error");
    expect(notas).toBe(0);
  });
});

/**
 * O interruptor entre abas. O navegador só entrega o evento `storage` às OUTRAS
 * abas; aqui a "outra aba" é gravar a chave e disparar o evento na mão.
 */
describe("interruptor de som entre abas", () => {
  const outraAbaGrava = (chave: string, valor: string) => {
    localStorage.setItem(chave, valor);
    window.dispatchEvent(new StorageEvent("storage", { key: chave, newValue: valor }));
  };

  it("outra aba desligou: esta passa a ficar muda e avisa o botão do header", async () => {
    const { isSoundOn, playSound, subscribeSound } = await carregar();
    const botao = vi.fn();
    subscribeSound(botao);

    outraAbaGrava("faceimob-sound", "off");

    expect(isSoundOn()).toBe(false);
    expect(botao).toHaveBeenCalledTimes(1);
    playSound("leadNew");
    expect(notas).toBe(0);
  });

  it("outra aba religou: volta a tocar", async () => {
    const { isSoundOn, setSoundOn } = await carregar();
    setSoundOn(false);

    outraAbaGrava("faceimob-sound", "on");

    expect(isSoundOn()).toBe(true);
  });

  it("chave de outro assunto não mexe no som nem acorda os assinantes", async () => {
    const { isSoundOn, subscribeSound } = await carregar();
    const botao = vi.fn();
    subscribeSound(botao);

    outraAbaGrava("faceimob-theme", "off");

    expect(isSoundOn()).toBe(true);
    expect(botao).not.toHaveBeenCalled();
  });
});
