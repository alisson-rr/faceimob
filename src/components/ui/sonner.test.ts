import { describe, expect, it, vi, beforeEach } from "vitest";
import { Toaster, toast } from "./sonner";
import { toast as avisar } from "@/hooks/use-toast";

/**
 * A trava dos avisos do app (decisão de 12/09/2026): todo aviso no meio da
 * tela, maior, com botão de fechar, e som em sucesso e erro.
 *
 * Posição e som vivem neste wrapper. Voltar ao `toast` e ao `Toaster` crus do
 * sonner não quebraria nada visível num teste de tela — os avisos voltariam ao
 * canto, mudos, e o cliente é quem descobriria. Daí este teste.
 *
 * Fronteiras mockadas: o sonner (o que se cobra é o que sai daqui para dentro
 * dele) e o áudio (o que se cobra é QUAL som é pedido; se ele sai ou cede a vez
 * é regra do `audio.ts`, com teste próprio).
 */
const nativo = vi.hoisted(() => ({
  base: vi.fn(() => 1),
  success: vi.fn(() => 2),
  error: vi.fn(() => 3),
  warning: vi.fn(() => 4),
}));
const tocar = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: Object.assign(nativo.base, {
    success: nativo.success,
    error: nativo.error,
    warning: nativo.warning,
  }),
}));
vi.mock("@/lib/engagement/audio", () => ({ playSound: tocar }));

/** Opções que chegaram ao sonner numa chamada de um dos mocks. */
const opcoesDe = (chamada: unknown[] | undefined) => (chamada?.[1] ?? {}) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("posição e tamanho", () => {
  it("todo aviso sem posição própria sai no meio da tela", () => {
    const { props } = Toaster({});
    expect(props.position).toBe("top-center");
    // "top-center" é o topo; é a classe da lista que desce até o meio vertical.
    expect(props.className).toContain("top-[calc(50%");
  });

  it("o wrapper não força posição em tipo nenhum: erro vai para onde o Toaster manda", () => {
    toast.success("Origem cadastrada");
    toast.error("Não foi possível salvar");
    expect(opcoesDe(nativo.success.mock.calls[0]).position).toBeUndefined();
    expect(opcoesDe(nativo.error.mock.calls[0]).position).toBeUndefined();
  });

  it("tem botão de fechar e não encurta o tempo de leitura", () => {
    const { props } = Toaster({});
    // Aviso no meio pode cobrir o campo que a pessoa corrige: fechar tem de ser fácil.
    expect(props.closeButton).toBe(true);
    // 4 s é o padrão do sonner; destaque central que some antes disso é pior que o canto.
    expect(props.duration).toBeGreaterThanOrEqual(4000);
  });

  it("o que o App ou o chamador passarem continua vencendo", () => {
    expect(Toaster({ position: "bottom-right" }).props.position).toBe("bottom-right");
    const opcoes = { duration: 12000, description: "42 leads", position: "bottom-left" } as const;
    toast.success("Importação concluída", opcoes);
    expect(nativo.success).toHaveBeenCalledWith("Importação concluída", opcoes);
  });
});

describe("som", () => {
  it("sucesso e erro pedem o próprio som", () => {
    toast.success("Origem cadastrada");
    toast.error("Não foi possível salvar");
    expect(tocar.mock.calls).toEqual([["success"], ["error"]]);
    expect(nativo.success).toHaveBeenCalledTimes(1);
    expect(nativo.error).toHaveBeenCalledTimes(1);
  });

  it("aviso e neutro ficam mudos, inclusive o neutro do use-toast", () => {
    toast("Lead em atendimento");
    toast.warning("Lista criada sem roleta");
    avisar({ title: "Nada a revogar" });
    expect(tocar).not.toHaveBeenCalled();
    expect(nativo.base).toHaveBeenCalledTimes(2);
    expect(nativo.warning).toHaveBeenCalledTimes(1);
  });

  it("variant do use-toast chega ao mesmo som", () => {
    avisar({ title: "Não foi possível atender", variant: "destructive" });
    avisar({ title: "Colaborador cadastrado", variant: "success" });
    expect(tocar.mock.calls).toEqual([["error"], ["success"]]);
  });
});
