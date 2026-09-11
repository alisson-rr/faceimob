import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntegrationRecord } from "@/integrations/supabase/integrations";

/**
 * O card da Marketing API em /admin/meta-ads.
 *
 * O que não pode voltar: botão que o banco recusa habilitado para quem não tem
 * `settings.integrations`; lista de contas na tela quando a edge diz que não há
 * token (409); e o que se marcou não ser o que vai para a gravação. A edge e a
 * tabela são simuladas; mesmo recorte de `MetaAdsSetup.test.tsx` (`react-dom`
 * puro, `vi.waitFor` no lugar de `act`).
 */
const m = vi.hoisted(() => ({
  invoke: vi.fn(),
  listIntegrations: vi.fn(),
  contas: [] as unknown[],
  podeGravar: true,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: m.invoke },
    from: () => ({ select: () => ({ order: () => Promise.resolve({ data: m.contas, error: null }) }) }),
  },
}));
vi.mock("@/integrations/supabase/integrations", () => ({ listIntegrations: m.listIntegrations }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ can: (codigo: string) => m.podeGravar && codigo === "settings.integrations" }),
}));

import { MetaAdsAccountsCard } from "./MetaAdsAccountsCard";

const TOKEN_NO_COFRE: IntegrationRecord = {
  id: "id-mkt",
  provider: "meta",
  label: "marketing_access_token",
  active: true,
  has_secret: true,
  config: null,
  updated_at: "2026-09-10T12:00:00.000Z",
};

const contaSalva = (extra: Record<string, unknown> = {}) => ({
  id: "c1",
  act_id: "act_111",
  name: "Conta A",
  currency: "BRL",
  enabled: true,
  balance_state: "rodando",
  account_checked_at: null,
  last_sync_attempt_at: null,
  last_sync_ok_at: null,
  last_sync_error: null,
  ...extra,
});

const TESTE_OK = {
  data: {
    ok: true,
    usuario: { id: "900", name: "Sistema FACEIMOB" },
    contas: [
      { act_id: "act_111", name: "Conta A", currency: "BRL", timezone_name: "America/Sao_Paulo", account_status: 1 },
      { act_id: "act_222", name: "Conta B", currency: "BRL", timezone_name: "America/Sao_Paulo", account_status: 1 },
    ],
  },
  error: null,
};

/** `functions.invoke` transforma não-2xx em erro e zera `data`: o corpo fica em `error.context`. */
const recusa = (status: number, error: string) => ({
  data: null,
  error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: new Response(JSON.stringify({ error }), { status }),
  }),
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function montar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root.render(
    <QueryClientProvider client={client}>
      <MetaAdsAccountsCard />
    </QueryClientProvider>,
  );
  const el = container;
  await vi.waitFor(() => {
    expect(el.textContent).toContain("Contas salvas");
    expect(el.textContent).not.toContain("Carregando contas salvas");
  });
  return el;
}

const botao = (el: HTMLElement, rotulo: string) =>
  Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.trim() === rotulo);
const caixa = (el: HTMLElement, act: string) =>
  el.querySelector<HTMLButtonElement>(`[role="checkbox"][id$="-${act}"]`);

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
  m.contas = [];
  m.podeGravar = true;
  vi.clearAllMocks();
});

describe("MetaAdsAccountsCard", () => {
  it("sem settings.integrations: Testar e Salvar desligados, e a falha aparece com a data", async () => {
    m.podeGravar = false;
    m.contas = [
      contaSalva({
        balance_state: "sem_saldo",
        last_sync_ok_at: "2026-09-09T09:00:00.000Z",
        last_sync_attempt_at: "2026-09-10T09:00:00.000Z",
        last_sync_error: "Token de acesso expirado ou inválido",
      }),
    ];
    const el = await montar();

    expect(botao(el, "Salvar contas")?.disabled).toBe(true);
    expect(botao(el, "Testar conexão")?.disabled).toBe(true);
    expect(el.textContent).toContain('Sem a permissão "Gerenciar integrações"');
    // Falha da Meta aparece como falha, com a data e a última sincronização boa.
    expect(el.textContent).toMatch(/A última sincronização falhou em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}: Token de acesso expirado/);
    expect(el.textContent).toMatch(/Última sincronização boa: \d{2}\/\d{2}\/\d{4}/);
    expect(el.textContent).toContain("Sem saldo");
    expect(m.invoke).not.toHaveBeenCalled();
  });

  it("409 da edge: mostra token não cadastrado e nenhuma conta", async () => {
    // O cofre pode listar o slot e a edge não achar token (linha inativa): quem manda é a edge.
    m.listIntegrations.mockResolvedValue([TOKEN_NO_COFRE]);
    m.invoke.mockResolvedValue(recusa(409, "Token da Marketing API não cadastrado."));
    const el = await montar();
    expect(el.textContent).not.toContain("Token não cadastrado");

    botao(el, "Testar conexão")!.click();

    await vi.waitFor(() => expect(el.textContent).toContain("Token não cadastrado"));
    expect(m.invoke).toHaveBeenCalledWith("meta-ads-connect", { body: { action: "testar" } });
    expect(el.textContent).toContain("Meta — token da Marketing API");
    expect(el.querySelectorAll('[role="checkbox"]')).toHaveLength(0);
    expect(botao(el, "Salvar contas")?.disabled).toBe(true);
  });

  it("cofre sem o token: avisa antes do teste e diz onde cadastrar", async () => {
    m.listIntegrations.mockResolvedValue([]);
    const el = await montar();

    await vi.waitFor(() => expect(el.textContent).toContain("Token não cadastrado"));
    expect(el.textContent).toContain("Credenciais da Meta no cofre");
    // Não trava o teste: a edge também lê o secret de ambiente e responde 409 se não houver nenhum.
    expect(botao(el, "Testar conexão")?.disabled).toBe(false);
    expect(botao(el, "Salvar contas")?.disabled).toBe(true);
  });

  it("as contas marcadas vão no corpo de salvar, e a já ligada começa marcada", async () => {
    m.listIntegrations.mockResolvedValue([TOKEN_NO_COFRE]);
    m.contas = [contaSalva()];
    m.invoke
      .mockResolvedValueOnce(TESTE_OK)
      .mockResolvedValueOnce({ data: { ok: true, salvas: 1 }, error: null });
    const el = await montar();

    botao(el, "Testar conexão")!.click();

    await vi.waitFor(() => expect(caixa(el, "act_222")).not.toBeNull());
    expect(el.textContent).toContain("Sistema FACEIMOB");
    expect(caixa(el, "act_111")!.getAttribute("aria-checked")).toBe("true");
    expect(caixa(el, "act_222")!.getAttribute("aria-checked")).toBe("false");

    caixa(el, "act_222")!.click();
    caixa(el, "act_111")!.click();
    await vi.waitFor(() => {
      expect(caixa(el, "act_111")!.getAttribute("aria-checked")).toBe("false");
      expect(caixa(el, "act_222")!.getAttribute("aria-checked")).toBe("true");
    });

    botao(el, "Salvar contas")!.click();

    await vi.waitFor(() => expect(m.invoke).toHaveBeenCalledTimes(2));
    expect(m.invoke).toHaveBeenLastCalledWith("meta-ads-connect", {
      body: { action: "salvar", act_ids: ["act_222"] },
    });
  });
});
