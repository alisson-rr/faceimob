import { describe, expect, it, vi, beforeEach } from "vitest";
import { toast } from "./sonner";
import { toast as avisar } from "@/hooks/use-toast";

/**
 * A trava do "cadastrado com sucesso no meio da tela".
 *
 * O sonner 1.7 não deixa fixar posição por TIPO de aviso: o `toastOptions` do
 * Toaster não tem `position`, só a chamada tem. O centro existe porque este
 * wrapper troca `toast.success` — uma volta ao `success` nativo devolveria
 * tudo ao canto inferior direito sem quebrar nada visível, e o cliente é quem
 * descobriria. Daí este teste.
 *
 * A fronteira mockada é o próprio sonner: o que se cobra aqui é o que sai
 * daqui para dentro dele.
 */
const nativo = vi.hoisted(() => ({
  base: vi.fn(() => 1),
  success: vi.fn(() => 2),
  error: vi.fn(() => 3),
}));

vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: Object.assign(nativo.base, { success: nativo.success, error: nativo.error }),
}));

/** Opções que chegaram ao sonner na chamada `n` de um dos mocks. */
const opcoesDe = (chamada: unknown[] | undefined) => (chamada?.[1] ?? {}) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("aviso de sucesso", () => {
  it("sai no meio da tela", () => {
    toast.success("Origem cadastrada");
    expect(nativo.success).toHaveBeenCalledTimes(1);
    expect(opcoesDe(nativo.success.mock.calls[0]).position).toBe("top-center");
  });

  it("não encurta o tempo de leitura", () => {
    toast.success("Origem cadastrada");
    // 4 s é o padrão do sonner; destaque central que some antes disso é pior
    // que o canto.
    expect(opcoesDe(nativo.success.mock.calls[0]).duration).toBeGreaterThanOrEqual(4000);
  });

  it("respeita o que o chamador pediu", () => {
    toast.success("Importação concluída", { duration: 12000, description: "42 leads" });
    const opcoes = opcoesDe(nativo.success.mock.calls[0]);
    expect(opcoes.duration).toBe(12000);
    expect(opcoes.description).toBe("42 leads");
  });

  it("chega ao centro também pelo variant do use-toast", () => {
    avisar({ title: "Colaborador cadastrado", variant: "success" });
    expect(opcoesDe(nativo.success.mock.calls[0]).position).toBe("top-center");
  });
});

describe("os outros avisos ficam onde estavam", () => {
  it("erro não ganha posição", () => {
    toast.error("Não foi possível salvar");
    expect(nativo.error).toHaveBeenCalledTimes(1);
    expect(opcoesDe(nativo.error.mock.calls[0]).position).toBeUndefined();
  });

  it("aviso neutro do use-toast não ganha posição", () => {
    avisar({ title: "Lead em atendimento" });
    expect(nativo.base).toHaveBeenCalledTimes(1);
    expect(nativo.success).not.toHaveBeenCalled();
    expect(opcoesDe(nativo.base.mock.calls[0]).position).toBeUndefined();
  });
});
