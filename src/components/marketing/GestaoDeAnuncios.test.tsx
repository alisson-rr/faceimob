import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Painel de gestão de anúncios: cores pedidas pelo cliente (amarelo = CPL
 * acima do limite, vermelho = gastou sem lead), pausadas escondidas por
 * padrão e o vazio que manda conectar a Meta. Dados simulados na fronteira.
 */
const m = vi.hoisted(() => ({
  campanhas: [] as unknown[],
  metricas: [] as unknown[],
  contas: [] as unknown[],
}));

vi.mock("@/integrations/supabase/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/supabase/analytics")>()),
  listAdCampaigns: async () => m.campanhas,
  fetchMetaMetricas: async () => m.metricas,
}));
vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  for (const f of ["select", "eq"]) q[f] = () => q;
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: m.contas, error: null }).then(ok);
  return { supabase: { from: () => q } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ can: () => false }) }));

import { GestaoDeAnuncios } from "./GestaoDeAnuncios";

const montados: Root[] = [];
afterEach(() => {
  montados.splice(0).forEach((r) => r.unmount());
  document.body.innerHTML = "";
});

async function montar() {
  const el = document.body.appendChild(document.createElement("div"));
  const root = createRoot(el);
  montados.push(root);
  root.render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><GestaoDeAnuncios podeConectar /></MemoryRouter>
    </QueryClientProvider>,
  );
  await vi.waitFor(() => expect(el.textContent).toMatch(/Gestão de anúncios|Não consegui/));
  return el;
}

const campanha = (id: string, status = "ACTIVE") => ({
  id, external_id: id, name: `[FORM] ${id}`, status, daily_budget: 50, meta_account_id: "acc",
  meta_channel: "formulario", meta_budget_level: "campaign",
});
const metrica = (id: string, spend: number, resultados: number) =>
  ({ campaign_id: id, channel: "formulario", spend, resultados, ctr: 0.0342 });

describe("GestaoDeAnuncios", () => {
  it("pinta CPL alto de amarelo e sem lead de vermelho; pausada só com o filtro", async () => {
    m.campanhas = [campanha("BOA"), campanha("CARA"), campanha("ZERADA"), campanha("PAUSADA", "PAUSED")];
    m.metricas = [metrica("BOA", 36, 4), metrica("CARA", 43, 1), metrica("ZERADA", 30, 0)];
    m.contas = [{ id: "acc", prepay_available: 3614.38, cpl_limite: 12, last_sync_ok_at: null }];
    const el = await montar();

    const linha = (nome: string) => [...el.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(nome));
    expect(linha("BOA")?.querySelector("td")?.className).toContain("border-l-success");
    expect(linha("CARA")?.querySelector("td")?.className).toContain("border-l-warning");
    expect(linha("ZERADA")?.querySelector("td")?.className).toContain("border-l-destructive");
    expect(linha("PAUSADA")).toBeUndefined();
    expect(el.textContent).toContain("3 de 4");
    expect(el.textContent).toContain("Saldo da conta Meta Ads");
    // CPL geral em destaque: 109 investidos ÷ 5 resultados, acima do limite de 12.
    expect(el.textContent).toMatch(/CPL R\$ · .*R\$\s21,80/);
    expect(el.textContent).toContain("Simulador de budget diário");
  });

  it("sem campanha sincronizada, manda conectar a Meta", async () => {
    m.campanhas = [];
    m.metricas = [];
    m.contas = [];
    const el = await montar();
    expect(el.textContent).toContain("Nenhuma campanha sincronizada da Meta");
    expect(el.querySelector('a[href="/admin/meta-ads"]')).not.toBeNull();
  });
});
