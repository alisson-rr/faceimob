import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pausar, ativar e mudar verba na Meta a partir da linha da campanha.
 *
 * O que não pode voltar: mexer em dinheiro real sem confirmação na tela; o
 * aviso da fase de aprendizado (409 do servidor) virar erro genérico, ou o
 * reenvio sair sem `confirma_aprendizado`; "Mudar verba" ligado numa campanha
 * de verba total, que o banco recusa; e falha da Meta aparecer como feito. A
 * edge é simulada; mesmo recorte de `MetaAdsAccountsCard.test.tsx` (`react-dom`
 * puro, `vi.waitFor` no lugar de `act`). O diálogo do Radix vai para um portal
 * no `document.body`, por isso é procurado lá.
 */
const m = vi.hoisted(() => ({
  invoke: vi.fn(),
  pode: true,
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  acoes: [] as unknown[],
  nomes: [] as unknown[],
}));

/** Consulta encadeável do supabase-js: qualquer filtro devolve a própria consulta, e o `await` entrega a tabela. */
function consulta(resultado: unknown) {
  const q: Record<string, unknown> = {};
  for (const f of ["select", "neq", "order", "limit", "in"]) q[f] = () => q;
  q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) => Promise.resolve(resultado).then(ok, falha);
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: m.invoke },
    from: (tabela: string) =>
      consulta({ data: tabela === "meta_actions" ? m.acoes : m.nomes, error: null }),
  },
}));
vi.mock("sonner", () => ({ toast: m.toast }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ can: (codigo: string) => m.pode && codigo === "marketing.meta_manage" }),
}));

import { MetaActionsLog } from "./MetaActionsLog";
import { MetaCampaignActions } from "./MetaCampaignActions";

type Campanha = Parameters<typeof MetaCampaignActions>[0]["campaign"];

const campanha = (extra: Partial<Campanha> = {}): Campanha => ({
  id: "camp-1",
  name: "CONSTRUTORA X | RESIDENCIAL Y | FORMULARIO",
  status: "ACTIVE",
  dailyBudget: 100,
  metaAccountId: "conta-1",
  metaBudgetLevel: "campaign",
  ...extra,
});

const feito = (status: string) => ({ data: { ok: true, action_id: "acao-1", status }, error: null });

/** `functions.invoke` transforma não-2xx em erro e zera `data`: o corpo fica em `error.context`. */
const recusa = (status: number, corpo: unknown) => ({
  data: null,
  error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: new Response(JSON.stringify(corpo), { status }),
  }),
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let onDone = vi.fn();

async function montar(c: Campanha = campanha()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onDone = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root.render(
    <QueryClientProvider client={client}>
      {/* Marca o commit: quando ela aparece, o que o componente devolveu (inclusive nada) já está na tela. */}
      <span data-pronto="" />
      <MetaCampaignActions campaign={c} onDone={onDone} />
    </QueryClientProvider>,
  );
  const el = container;
  await vi.waitFor(() => expect(el.querySelector("[data-pronto]")).not.toBeNull());
  return el;
}

function desmontar() {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
}

const botao = (raiz: ParentNode, rotulo: string) =>
  Array.from(raiz.querySelectorAll("button")).find((b) => b.textContent?.trim() === rotulo);
const dialogo = () => document.body.querySelector<HTMLElement>('[role="alertdialog"]');

function clicar(b: HTMLButtonElement | undefined) {
  expect(b, "botão não encontrado").toBeTruthy();
  b!.click();
}

const digitar = (campo: HTMLInputElement, valor: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
};

afterEach(() => {
  desmontar();
  m.pode = true;
  m.acoes = [];
  m.nomes = [];
  vi.clearAllMocks();
});

describe("MetaActionsLog", () => {
  const acao = (extra: Record<string, unknown>) => ({
    id: "a1",
    created_at: "2026-09-11T12:00:00.000Z",
    decided_at: "2026-09-11T12:00:00.000Z",
    executed_at: "2026-09-11T12:00:05.000Z",
    campaign_name: "CAMPANHA A",
    campaign_external_id: "120000001",
    origem: "manual",
    acao: "verba",
    verba_anterior: 100,
    verba_nova: 150,
    status: "executada",
    requested_by: "u1",
    decided_by: "u1",
    motivo: null,
    resultado: null,
    erro: null,
    ...extra,
  });

  it("mostra quem, quando, de quanto para quanto, e a falha da Meta como falha", async () => {
    m.acoes = [
      // O "antes" lido na Meta na execução (120) vale mais que o do banco (100).
      acao({ resultado: { antes: { verba_diaria: 120, nivel: "campaign" }, depois: { verba_diaria: 150 } } }),
      acao({
        id: "a2",
        campaign_name: "CAMPANHA B",
        origem: "ia",
        acao: "pausar",
        verba_anterior: null,
        verba_nova: null,
        status: "falhou",
        requested_by: null,
        decided_by: "u2",
        motivo: "Custo por resultado 2x a média da conta",
        erro: "Token sem permissão para anúncios: …",
      }),
    ];
    // u2 fora da view de nomes: a linha continua, sem inventar quem foi.
    m.nomes = [{ id: "u1", full_name: "Ana Marketing" }];

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MetaActionsLog />
      </QueryClientProvider>,
    );
    const el = container;
    await vi.waitFor(() => expect(el.textContent).toContain("CAMPANHA B"));

    expect(el.textContent).toMatch(/Verba diária de R\$\s120,00 para R\$\s150,00/);
    expect(el.textContent).toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} · por Ana Marketing/);
    expect(el.textContent).toContain("Feito na Meta");
    expect(el.textContent).toContain("proposta do gestor IA · aprovada por pessoa sem nome visível");
    expect(el.textContent).toContain("Motivo do gestor IA: Custo por resultado 2x a média da conta");
    expect(el.textContent).toContain("Falhou");
    expect(el.textContent).toContain("Token sem permissão para anúncios");
  });
});

describe("MetaCampaignActions", () => {
  it("sem conta da Meta ou sem marketing.meta_manage, não mostra nada", async () => {
    let el = await montar(campanha({ metaAccountId: null }));
    expect(el.querySelectorAll("button")).toHaveLength(0);
    desmontar();

    m.pode = false;
    el = await montar();
    expect(el.querySelectorAll("button")).toHaveLength(0);
  });

  it("nenhuma chamada sem confirmar; confirmada, manda a ação e avisa quem montou", async () => {
    m.invoke.mockResolvedValue(feito("executada"));
    const el = await montar();
    // Campanha ativa: a ação oposta é pausar.
    expect(botao(el, "Ativar")).toBeUndefined();

    clicar(botao(el, "Pausar"));
    await vi.waitFor(() => expect(dialogo()?.textContent).toContain("na Meta?"));
    expect(m.invoke).not.toHaveBeenCalled();

    clicar(botao(dialogo()!, "Cancelar"));
    await vi.waitFor(() => expect(dialogo()).toBeNull());
    expect(m.invoke).not.toHaveBeenCalled();

    clicar(botao(el, "Pausar"));
    await vi.waitFor(() => expect(dialogo()).not.toBeNull());
    clicar(botao(dialogo()!, "Pausar na Meta"));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(m.invoke).toHaveBeenCalledTimes(1);
    expect(m.invoke).toHaveBeenCalledWith("meta-campaign-action", {
      body: { campaign_id: "camp-1", acao: "pausar" },
    });
    expect(m.toast.success).toHaveBeenCalledWith("Campanha pausada na Meta", expect.anything());
  });

  it("409 de aprendizado: mostra o aviso da fase de aprendizado e reenvia com confirma_aprendizado = true", async () => {
    m.invoke
      .mockResolvedValueOnce(recusa(409, { code: "aprendizado", variacao: 0.5, verba_atual: 100, verba_nova: 150 }))
      .mockResolvedValueOnce(feito("executada"));
    const el = await montar();

    clicar(botao(el, "Mudar verba"));
    await vi.waitFor(() => expect(dialogo()?.querySelector("input")).not.toBeNull());
    expect(botao(dialogo()!, "Mudar verba na Meta")?.disabled).toBe(true);
    digitar(dialogo()!.querySelector("input")!, "150");
    await vi.waitFor(() => expect(botao(dialogo()!, "Mudar verba na Meta")?.disabled).toBe(false));
    clicar(botao(dialogo()!, "Mudar verba na Meta"));

    await vi.waitFor(() => expect(dialogo()?.textContent).toContain("fase de aprendizado"));
    expect(dialogo()!.textContent).toContain("+50%");
    expect(m.invoke).toHaveBeenNthCalledWith(1, "meta-campaign-action", {
      body: { campaign_id: "camp-1", acao: "verba", verba_diaria: 150 },
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(m.toast.error).not.toHaveBeenCalled();

    clicar(botao(dialogo()!, "Subir mesmo assim"));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(m.invoke).toHaveBeenCalledTimes(2);
    expect(m.invoke).toHaveBeenLastCalledWith("meta-campaign-action", {
      body: { campaign_id: "camp-1", acao: "verba", verba_diaria: 150, confirma_aprendizado: true },
    });
  });

  it("verba total: Mudar verba desligado, com a frase de onde mudar", async () => {
    const el = await montar(campanha({ metaBudgetLevel: "lifetime" }));
    const verba = botao(el, "Mudar verba");
    expect(verba?.disabled).toBe(true);
    expect(el.textContent).toContain("Verba total: mude no Gerenciador de Anúncios.");
    // A frase é o nome do porquê para quem usa leitor de tela.
    expect(document.getElementById(verba!.getAttribute("aria-describedby") ?? "")?.textContent).toContain("Verba total");
    expect(botao(el, "Pausar")?.disabled).toBe(false);
  });

  it("falha da Meta (502) aparece como falha, com o motivo, e não conta como feito", async () => {
    m.invoke.mockResolvedValue(
      recusa(502, { ok: false, action_id: "acao-1", status: "falhou", error: "Token sem permissão para anúncios: …" }),
    );
    const el = await montar(campanha({ status: "PAUSED" }));
    expect(botao(el, "Pausar")).toBeUndefined();

    clicar(botao(el, "Ativar"));
    await vi.waitFor(() => expect(dialogo()).not.toBeNull());
    clicar(botao(dialogo()!, "Ativar na Meta"));

    await vi.waitFor(() => expect(m.toast.error).toHaveBeenCalledTimes(1));
    expect(m.toast.error).toHaveBeenCalledWith("A ação não foi concluída", {
      description: expect.stringContaining("Token sem permissão para anúncios"),
    });
    expect(m.toast.success).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
