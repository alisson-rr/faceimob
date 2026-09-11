import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A aba Alertas de /marketing.
 *
 * O que não pode voltar: formulário de limites habilitado para quem o banco
 * recusa (`marketing.meta_manage`); conta nunca lida aparecendo como se tivesse
 * estado; e os limites digitados chegando à RPC com outro nome ou formato. A
 * tabela e a RPC são simuladas; mesmo recorte de `MetaAdsAccountsCard.test.tsx`
 * (`react-dom` puro, `vi.waitFor` no lugar de `act`).
 */
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  contas: [] as unknown[],
  alertas: [] as unknown[],
  pode: true,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (linhas: () => unknown[]) => {
    const q = {
      select: () => q,
      order: () => q,
      or: () => q,
      limit: () => q,
      then: (ok: (r: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: linhas(), error: null }).then(ok),
    };
    return q;
  };
  return {
    supabase: {
      rpc: m.rpc,
      from: (tabela: string) => consulta(() => (tabela === "meta_alerts" ? m.alertas : m.contas)),
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ can: (codigo: string) => m.pode && codigo === "marketing.meta_manage" }),
}));

import { MetaAlertsPanel } from "./MetaAlertsPanel";

const conta = (extra: Record<string, unknown> = {}) => ({
  id: "c1",
  act_id: "act_111",
  name: "Conta A",
  enabled: true,
  balance_state: "rodando",
  account_checked_at: "2026-09-11T09:00:00.000Z",
  last_sync_attempt_at: null,
  last_sync_ok_at: "2026-09-11T09:00:00.000Z",
  last_sync_error: null,
  cpl_limite: null,
  gasto_sem_lead_limite: 50,
  gasto_sem_lead_dias: 3,
  verba_mensal: null,
  verba_aviso_pct: 85,
  saldo_baixo_limite: 100,
  ...extra,
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
      <MetaAlertsPanel />
    </QueryClientProvider>,
  );
  const el = container;
  await vi.waitFor(() => {
    expect(el.textContent).not.toContain("Carregando");
    expect(el.querySelector("form")).not.toBeNull();
  });
  return el;
}

const campo = (el: HTMLElement, rotulo: string) => {
  const label = Array.from(el.querySelectorAll("label")).find((l) => l.textContent === rotulo);
  return label ? (document.getElementById(label.htmlFor) as HTMLInputElement | null) : null;
};
const botao = (el: HTMLElement, texto: string) =>
  Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.trim() === texto);

/** React só enxerga o valor novo pelo setter nativo seguido do evento `input`. */
function digitar(input: HTMLInputElement, valor: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, valor);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
  m.contas = [];
  m.alertas = [];
  m.pode = true;
  vi.clearAllMocks();
});

describe("MetaAlertsPanel", () => {
  it("sem marketing.meta_manage: todos os campos e o salvar desligados, e o aviso diz por quê", async () => {
    m.pode = false;
    m.contas = [conta()];
    const el = await montar();

    const campos = Array.from(el.querySelectorAll("form input"));
    expect(campos).toHaveLength(6);
    expect(campos.every((i) => (i as HTMLInputElement).disabled)).toBe(true);
    expect(botao(el, "Salvar limites")?.disabled).toBe(true);
    expect(el.textContent).toContain('Sem a permissão "Gerenciar campanhas na Meta"');
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("conta nunca lida mostra 'ainda não verificado', sem data inventada", async () => {
    m.contas = [conta({ balance_state: "desconhecido", account_checked_at: null, last_sync_ok_at: null })];
    const el = await montar();

    expect(el.textContent).toContain("Ainda não verificado");
    expect(el.textContent).toContain("A conta ainda não foi lida na Meta");
    expect(el.textContent).not.toContain("Estado verificado em");
  });

  it("falha da sincronização aparece com a data e a última boa", async () => {
    m.contas = [
      conta({
        balance_state: "sem_saldo",
        last_sync_attempt_at: "2026-09-11T09:00:00.000Z",
        last_sync_ok_at: "2026-09-10T09:00:00.000Z",
        last_sync_error: "Token de acesso expirado",
      }),
    ];
    const el = await montar();

    expect(el.textContent).toContain("Sem saldo");
    expect(el.textContent).toMatch(/A última sincronização falhou em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}: Token de acesso expirado/);
    expect(el.textContent).toMatch(/última sincronização boa, em \d{2}\/\d{2}\/\d{4}/);
  });

  it("salvar manda os limites convertidos, com os nomes da RPC", async () => {
    m.contas = [conta()];
    m.rpc.mockResolvedValue({ data: null, error: null });
    const el = await montar();

    digitar(campo(el, "Custo por resultado (segundo a Meta) acima do limite (R$)")!, "45,50");
    digitar(campo(el, "Verba do mês (R$)")!, "R$ 3.000,00");
    digitar(campo(el, "Saldo baixo: abaixo de (R$)")!, "");
    await vi.waitFor(() =>
      expect(campo(el, "Custo por resultado (segundo a Meta) acima do limite (R$)")!.value).toBe("45,50"),
    );
    botao(el, "Salvar limites")!.click();

    await vi.waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    expect(m.rpc).toHaveBeenCalledWith("meta_account_thresholds_set", {
      p_account_id: "c1",
      p_cpl_limite: 45.5,
      p_gasto_sem_lead_limite: 50,
      p_gasto_sem_lead_dias: 3,
      p_verba_mensal: 3000,
      p_verba_aviso_pct: 85,
      p_saldo_baixo_limite: null,
    });
  });

  it("janela fora de 1 a 30 não chega ao banco", async () => {
    m.contas = [conta()];
    const el = await montar();

    digitar(campo(el, "Gasto sem lead: janela (dias)")!, "45");
    await vi.waitFor(() => expect(campo(el, "Gasto sem lead: janela (dias)")!.value).toBe("45"));
    botao(el, "Salvar limites")!.click();

    const { toast } = await import("sonner");
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("separa alertas abertos dos resolvidos, com o nome da conta", async () => {
    m.contas = [conta()];
    m.alertas = [
      {
        id: "a1",
        account_id: "c1",
        mensagem: "Custo por resultado (segundo a Meta) acima do limite: R$ 150,00 em Campanha X nos últimos 7 dias.",
        opened_at: "2026-09-11T09:05:00.000Z",
        resolved_at: null,
      },
      {
        id: "a2",
        account_id: "c1",
        mensagem: "Gasto sem lead: R$ 60,00 em Campanha Y nos últimos 3 dias.",
        opened_at: "2026-09-09T09:05:00.000Z",
        resolved_at: "2026-09-10T09:05:00.000Z",
      },
    ];
    const el = await montar();

    const secoes = Array.from(el.querySelectorAll("section"));
    const abertos = secoes.find((s) => s.querySelector("h2")?.textContent === "Alertas abertos");
    const resolvidos = secoes.find((s) => s.querySelector("h2")?.textContent?.startsWith("Resolvidos"));
    expect(abertos?.textContent).toContain("Custo por resultado (segundo a Meta) acima do limite");
    expect(abertos?.textContent).toContain("Conta A · aberto em");
    expect(abertos?.textContent).not.toContain("Gasto sem lead: R$ 60,00");
    expect(resolvidos?.textContent).toContain("Gasto sem lead: R$ 60,00");
    expect(resolvidos?.textContent).toMatch(/resolvido em \d{2}\/\d{2}\/\d{4}/);
  });
});
