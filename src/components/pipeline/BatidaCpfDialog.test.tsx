import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NegocioDoCpf } from "@/integrations/supabase/batidaCpf";
import { BatidaCpfDialog } from "./BatidaCpfDialog";

/** Popup da batida de CPF (0205): ativo, OFF/QUEDA e distrato. */
let root: Root | null = null;
afterEach(() => { root?.unmount(); root = null; document.body.innerHTML = ""; });

const negocio = (extra: Partial<NegocioDoCpf>): NegocioDoCpf => ({
  deal_id: "d1", codigo: "NEG-1", cliente: "Maria", situacao: "ativo", status2: "06. ENVIO DE RP",
  corretor: "Ana", gerente: "Bruno", ultimo_comentario: null, ultimo_comentario_em: null,
  diretor: null, corretor_inativo: false, pode_resgatar: false, ...extra,
});

async function montar(n: NegocioDoCpf, onAssumir = vi.fn()) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  root.render(<BatidaCpfDialog negocio={n} enviando={false} erro={null} onAssumir={onAssumir} onClose={vi.fn()} />);
  await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).not.toBeNull());
  return document.body.textContent ?? "";
}

const botao = (texto: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent === texto);

describe("BatidaCpfDialog", () => {
  it("ativo: corretor, gerente, último comentário e o fifty com o gerente", async () => {
    const texto = await montar(negocio({ ultimo_comentario: "Aguardando assinatura", ultimo_comentario_em: "2026-10-03T14:30:00Z" }));
    expect(texto).toContain("Ana");
    expect(texto).toContain("Bruno");
    expect(texto).toContain("Aguardando assinatura");
    expect(texto).toContain("fifty");
    expect(botao("Sim, retomar negociação")).toBeUndefined();
  });

  it("OFF/QUEDA: pergunta se quer retomar e retoma sem exigir comentário", async () => {
    const onAssumir = vi.fn();
    const texto = await montar(negocio({ situacao: "encerrado", status2: "18. QUEDA", pode_resgatar: true }), onAssumir);
    expect(texto).toContain("Quer retomar a negociação?");
    botao("Sim, retomar negociação")?.click();
    expect(onAssumir).toHaveBeenCalledWith("");
  });

  it("corretor desligado: mostra o diretor e oferece o resgate sem voltar para PROPOSTA", async () => {
    const texto = await montar(negocio({ corretor_inativo: true, pode_resgatar: true, diretor: "Carla" }));
    expect(texto).toContain("Carla");
    expect(texto).toContain("desligado ou suspenso");
    expect(texto).toContain("continua no status em que está");
    expect(botao("Sim, retomar negociação")).toBeDefined();
  });

  it("distrato: avisa que já foi contabilizado e não oferece retomar", async () => {
    const texto = await montar(negocio({ situacao: "distrato", status2: "20. DISTRATO" }));
    expect(texto).toContain("já foi contabilizado em mês anterior");
    expect(botao("Sim, retomar negociação")).toBeUndefined();
  });
});
