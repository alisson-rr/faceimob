import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Gestor de tráfego IA e a fila de aprovação.
 *
 * O que não pode voltar: aprovar sem confirmação (é dinheiro real); o 409
 * 'aprendizado' virar erro genérico ou o reenvio sair sem
 * `confirma_aprendizado`; a decisão sair por outro caminho que não o executor
 * único (`meta-campaign-action` com {action_id, decisao}); falha do gestor
 * aparecer como sucesso; e botão de decidir ligado sem a permissão. Banco e
 * edges simulados; mesmo recorte de `MetaCampaignActions.test.tsx`.
 */
const m = vi.hoisted(() => ({
  invoke: vi.fn(),
  pode: true,
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  contas: [] as unknown[],
  ultima: null as unknown,
  boa: null as unknown,
  fila: [] as unknown[],
  filtros: [] as Record<string, unknown>[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const filtros: Record<string, unknown> = { tabela };
    const q: Record<string, unknown> = {};
    for (const f of ["select", "order", "limit"]) q[f] = () => q;
    q.eq = (coluna: string, valor: unknown) => {
      filtros[coluna] = valor;
      return q;
    };
    q.gt = (coluna: string, valor: unknown) => {
      filtros[`${coluna}>`] = valor;
      return q;
    };
    q.then = (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => {
      let data: unknown[] = m.contas;
      if (tabela === "meta_actions") data = m.fila;
      if (tabela === "meta_ai_runs") {
        const linha = filtros.status === "ok" ? m.boa : m.ultima;
        data = linha ? [linha] : [];
      }
      if (tabela !== "meta_ad_accounts") m.filtros.push({ ...filtros });
      return Promise.resolve({ data, error: null }).then(ok, falha);
    };
    return q;
  };
  return { supabase: { functions: { invoke: m.invoke }, from: consulta } };
});
vi.mock("sonner", () => ({ toast: m.toast }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ can: (codigo: string) => m.pode && codigo === "marketing.meta_manage" }),
}));

import { MetaTrafficManager } from "./MetaTrafficManager";

const CONTA = { id: "conta-1", name: "Conta A", act_id: "act_111" };

const BOA = {
  id: "run-bom",
  trigger: "cron",
  finished_at: "2026-09-11T10:00:40.000Z",
  result: {
    nota: 62,
    resumo: "Formulário caro nos últimos 7 dias; WhatsApp estável.",
    alertas: [{ severidade: "alta", texto: "Custo por resultado 80% acima dos 7 dias anteriores." }],
    acoes: [{
      action_id: "p1", acao: "verba", campaign_external_id: "120001", campaign_name: "CAMPANHA A",
      verba_nova: 150, motivo: "Custo por resultado 30% abaixo do canal.",
    }],
    periodo: { inicio: "2026-09-04", fim: "2026-09-10", dias: 7 },
    dados_ate: "2026-09-11T09:02:00.000Z",
    descartadas: 1,
  },
};

const FALHOU = {
  id: "run-falhou",
  status: "falhou",
  error: "Chave da OpenAI ausente: cadastre-a em Admin → Integrações (OpenAI — chave de API). Nenhuma análise foi feita.",
  started_at: "2026-09-11T11:59:00.000Z",
  finished_at: "2026-09-11T12:00:00.000Z",
};

const PROPOSTA = {
  id: "p1",
  campaign_name: "CAMPANHA A",
  campaign_external_id: "120001",
  acao: "verba",
  verba_anterior: 100,
  verba_nova: 150,
  variacao: 0.5,
  motivo: "Custo por resultado 30% abaixo do canal.",
  expires_at: "2026-09-12T10:00:40.000Z",
};

const feito = (status: string) => ({ data: { ok: true, action_id: "p1", status }, error: null });

/** `functions.invoke` transforma não-2xx em erro e zera `data`: o corpo fica em `error.context`. */
const recusa = (status: number, corpo: unknown) => ({
  data: null,
  error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: new Response(JSON.stringify(corpo), { status }),
  }),
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function montar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  root.render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MetaTrafficManager />
    </QueryClientProvider>,
  );
  return container;
}

const botao = (raiz: ParentNode, rotulo: string) =>
  Array.from(raiz.querySelectorAll("button")).find((b) => b.textContent?.trim() === rotulo);
const dialogo = () => document.body.querySelector<HTMLElement>('[role="alertdialog"]');

function clicar(b: HTMLButtonElement | undefined) {
  expect(b, "botão não encontrado").toBeTruthy();
  b!.click();
}

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
  m.pode = true;
  m.contas = [];
  m.ultima = null;
  m.boa = null;
  m.fila = [];
  m.filtros = [];
  vi.clearAllMocks();
});

describe("MetaTrafficManager", () => {
  it("mostra nota, resumo, alertas e ações da última análise boa; a falha mais recente aparece com a data", async () => {
    m.contas = [CONTA];
    m.ultima = FALHOU;
    m.boa = BOA;
    m.fila = [PROPOSTA];
    const el = montar();

    await vi.waitFor(() => expect(el.textContent).toContain("Formulário caro nos últimos 7 dias"));
    await vi.waitFor(() => expect(el.textContent).toContain("na fila de aprovação"));
    expect(el.textContent).toMatch(
      /A última análise falhou em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}: Chave da OpenAI ausente/,
    );
    expect(el.textContent).toMatch(/Abaixo, a última análise boa, de \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    expect(el.textContent).toMatch(/Nota da conta\s*62\s*\/100/);
    expect(el.textContent).toContain("Custo por resultado 80% acima dos 7 dias anteriores.");
    expect(el.textContent).toMatch(/Mudar a verba diária para R\$\s150,00/);
    expect(el.textContent).toContain("1 sugestão da IA ficou de fora");
    expect(el.textContent).toMatch(/números da Meta de 04\/09\/2026 a 10\/09\/2026, da sincronização de/);
    // A fila mostra de quanto para quanto, o motivo e a validade.
    expect(el.textContent).toMatch(/Mudar a verba diária de R\$\s100,00 para R\$\s150,00 \(\+50%\)/);
    expect(el.textContent).toMatch(/Vale até \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    // Leu o gestor da conta certa e só as propostas ainda válidas.
    expect(m.filtros).toContainEqual({ tabela: "meta_ai_runs", kind: "gestor", account_id: "conta-1" });
    expect(m.filtros).toContainEqual(expect.objectContaining({ tabela: "meta_actions", status: "proposta", "expires_at>": expect.any(String) }));
  });

  it("Aprovar exige confirmação; o 409 'aprendizado' abre o aviso e reenvia com confirma_aprendizado = true", async () => {
    m.contas = [CONTA];
    m.fila = [PROPOSTA];
    m.invoke
      .mockResolvedValueOnce(recusa(409, { code: "aprendizado", action_id: "p1", variacao: 0.5, verba_atual: 100, verba_nova: 150 }))
      .mockResolvedValueOnce(feito("executada"));
    const el = montar();
    await vi.waitFor(() => expect(botao(el, "Aprovar")).toBeTruthy());

    clicar(botao(el, "Aprovar"));
    await vi.waitFor(() => expect(dialogo()?.textContent).toContain("Aprovar e executar na Meta?"));
    expect(m.invoke).not.toHaveBeenCalled();
    clicar(botao(dialogo()!, "Cancelar"));
    await vi.waitFor(() => expect(dialogo()).toBeNull());
    expect(m.invoke).not.toHaveBeenCalled();

    clicar(botao(el, "Aprovar"));
    await vi.waitFor(() => expect(dialogo()).not.toBeNull());
    clicar(botao(dialogo()!, "Aprovar e executar"));

    await vi.waitFor(() => expect(dialogo()?.textContent).toContain("fase de aprendizado"));
    expect(dialogo()!.textContent).toContain("+50%");
    expect(m.invoke).toHaveBeenNthCalledWith(1, "meta-campaign-action", { body: { action_id: "p1", decisao: "aprovar" } });
    expect(m.toast.error).not.toHaveBeenCalled();

    clicar(botao(dialogo()!, "Aprovar mesmo assim"));
    await vi.waitFor(() => expect(m.toast.success).toHaveBeenCalledWith("Proposta aprovada", expect.anything()));
    expect(m.invoke).toHaveBeenCalledTimes(2);
    expect(m.invoke).toHaveBeenLastCalledWith("meta-campaign-action", {
      body: { action_id: "p1", decisao: "aprovar", confirma_aprendizado: true },
    });
  });

  it("Recusar vai pelo mesmo executor, e falha da Meta na aprovação aparece como falha", async () => {
    m.contas = [CONTA];
    m.fila = [PROPOSTA];
    m.invoke
      .mockResolvedValueOnce(feito("recusada"))
      .mockResolvedValueOnce(recusa(502, { ok: false, action_id: "p1", status: "falhou", error: "Token sem permissão para anúncios: …" }));
    const el = montar();
    await vi.waitFor(() => expect(botao(el, "Recusar")).toBeTruthy());

    clicar(botao(el, "Recusar"));
    await vi.waitFor(() => expect(m.toast.success).toHaveBeenCalledWith("Proposta recusada", expect.anything()));
    expect(m.invoke).toHaveBeenCalledWith("meta-campaign-action", { body: { action_id: "p1", decisao: "recusar" } });

    clicar(botao(el, "Aprovar"));
    await vi.waitFor(() => expect(dialogo()).not.toBeNull());
    clicar(botao(dialogo()!, "Aprovar e executar"));
    await vi.waitFor(() => expect(m.toast.error).toHaveBeenCalledTimes(1));
    expect(m.toast.error).toHaveBeenCalledWith("Não foi possível aprovar a proposta", {
      description: expect.stringContaining("Token sem permissão para anúncios"),
    });
    expect(m.toast.success).toHaveBeenCalledTimes(1);
  });

  it("Rodar agora manda a conta; a execução que falhou vira aviso com a frase", async () => {
    m.contas = [CONTA];
    m.invoke.mockResolvedValue({
      data: {
        ok: false,
        runs: [{
          account_id: "conta-1", run_id: "r9", status: "falhou", reused: false, propostas: 0, descartadas: 0,
          erro: "Sem entrega registrada na Meta de 04/09/2026 a 10/09/2026 (última sincronização boa: nunca).",
        }],
      },
      error: null,
    });
    const el = montar();
    await vi.waitFor(() => expect(el.textContent).toContain("O gestor ainda não rodou nesta conta"));

    clicar(botao(el, "Rodar agora"));
    await vi.waitFor(() => expect(m.toast.error).toHaveBeenCalled());
    expect(m.invoke).toHaveBeenCalledWith("meta-traffic-manager", { body: { account_id: "conta-1" } });
    expect(m.toast.error).toHaveBeenCalledWith("Não foi possível rodar o gestor de tráfego", {
      description: expect.stringContaining("Sem entrega registrada na Meta"),
    });
    expect(m.toast.success).not.toHaveBeenCalled();
  });

  it("sem 'Gerenciar campanhas na Meta': Rodar agora, Aprovar e Recusar desligados, e tudo continua visível", async () => {
    m.pode = false;
    m.contas = [CONTA];
    m.boa = BOA;
    m.fila = [PROPOSTA];
    const el = montar();

    await vi.waitFor(() => expect(el.textContent).toContain("Formulário caro nos últimos 7 dias"));
    await vi.waitFor(() => expect(botao(el, "Aprovar")).toBeTruthy());
    expect(botao(el, "Rodar agora")?.disabled).toBe(true);
    expect(botao(el, "Aprovar")?.disabled).toBe(true);
    expect(botao(el, "Recusar")?.disabled).toBe(true);
    expect(el.textContent).toContain('Sem a permissão "Gerenciar campanhas na Meta"');
    expect(m.invoke).not.toHaveBeenCalled();
  });
});
