import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import AdminDevelopers from "./AdminDevelopers";

/**
 * E-mail da construtora externa opcional (17/09/2026, 0154).
 *
 * O banco deixou de exigir (`developers_external_needs_email` saiu); a tela
 * tinha a MESMA trava em três lugares — cadastro, ficha e o interruptor de
 * fluxo. Se uma delas sobrar, o cadastro continua impossível pela tela.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// O jsdom não implementa o que o Select do Radix chama ao abrir a lista.
const proto = Element.prototype as unknown as Record<string, unknown>;
proto.scrollIntoView ??= () => undefined;
proto.hasPointerCapture ??= () => false;
proto.releasePointerCapture ??= () => undefined;

const h = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  avisos: [] as { title?: string; description?: string; variant?: string }[],
  construtoras: [] as Record<string, unknown>[],
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: (aviso: { title?: string; description?: string; variant?: string }) => { h.avisos.push(aviso); },
}));

vi.mock("@/integrations/supabase/client", () => {
  // Builder mínimo do PostgREST: cada filtro devolve a cadeia, e ela é
  // "aguardável" como a do supabase-js.
  const cadeia = (resultado: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) c[m] = () => c;
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve(resultado()).then(ok);
    return c;
  };
  return {
    supabase: {
      from: (tabela: string) => ({
        select: () => cadeia(() => ({
          data: tabela === "developers" ? h.construtoras : [],
          error: null,
        })),
        insert: (linha: unknown) => { h.insert(linha); return cadeia(() => ({ data: null, error: null })); },
        update: (patch: unknown) => { h.update(patch); return cadeia(() => ({ data: [{ id: "d1" }], error: null })); },
      }),
    },
  };
});

const construtora = (patch: Record<string, unknown> = {}) => ({
  id: "d1", name: "Construtora X", flow: "internal", submission_email: null,
  contact_name: null, contact_phone: null, notes: null, active: true, color: null,
  ...patch,
});

let root: Root;
let container: HTMLDivElement;

async function montar() {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => { root.render(<AdminDevelopers />); });
}

const botao = (rotulo: RegExp) => [...document.body.querySelectorAll("button")]
  .find((b) => rotulo.test((b.getAttribute("aria-label") ?? b.textContent ?? "").trim()));

/** Digita num input controlado pelo React (o setter nativo dispara o onChange). */
const digitar = async (input: HTMLInputElement, valor: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const erros = () => h.avisos.filter((a) => a.variant === "destructive");

beforeEach(() => {
  h.insert.mockReset();
  h.update.mockReset();
  h.avisos.length = 0;
  h.construtoras = [construtora()];
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("AdminDevelopers — construtora externa sem e-mail", () => {
  it("cadastro: fluxo externo sem e-mail é gravado com e-mail nulo", async () => {
    await montar();
    await digitar(document.getElementById("dev-nome") as HTMLInputElement, "Nova Externa");

    const gatilho = document.getElementById("dev-fluxo") as HTMLElement;
    await act(async () => {
      gatilho.focus();
      gatilho.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    const externo = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((o) => /Fluxo externo/.test(o.textContent ?? ""));
    await act(async () => { externo?.click(); });

    await act(async () => { botao(/^Adicionar$/)?.click(); });

    expect(erros()).toEqual([]);
    expect(h.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Nova Externa", flow: "external", submission_email: null }),
    );
  });

  it("interruptor: interna sem e-mail vira externa, e o aviso diz que nada sai pelo sistema", async () => {
    await montar();
    await act(async () => { botao(/^CCA interno de Construtora X$/)?.click(); });

    expect(erros()).toEqual([]);
    expect(h.update).toHaveBeenCalledWith({ flow: "external" });
    expect(h.avisos.at(-1)?.description).toMatch(/sem e-mail/i);
  });

  it("lista: externa sem e-mail diz que o envio é manual; com e-mail, não", async () => {
    h.construtoras = [
      construtora({ id: "sem", name: "Externa Sem", flow: "external", submission_email: null }),
      construtora({ id: "com", name: "Externa Com", flow: "external", submission_email: "credito@x.test" }),
    ];
    await montar();

    const linha = (nome: string) => [...document.body.querySelectorAll("tr")]
      .find((tr) => tr.textContent?.includes(nome))?.textContent ?? "";
    expect(linha("Externa Sem")).toContain("sem e-mail · envio manual");
    expect(linha("Externa Com")).not.toContain("envio manual");
  });

  it("ficha: apagar o e-mail de uma externa salva", async () => {
    h.construtoras = [construtora({ flow: "external", submission_email: "credito@x.test" })];
    await montar();
    await act(async () => { botao(/^Editar Construtora X$/)?.click(); });

    await digitar(document.getElementById("edit-email") as HTMLInputElement, "");
    await act(async () => { botao(/^Salvar$/)?.click(); });

    expect(erros()).toEqual([]);
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ flow: "external", submission_email: null }),
    );
  });
});
