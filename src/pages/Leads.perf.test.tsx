import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LeadRecord } from "@/integrations/supabase/leads";

/**
 * Custo do cronômetro da trava e do realtime sobre a página de Leads.
 *
 * A página é a real (relógio, `actions`, `permissions`) e a lista passa pelo
 * TanStack Query de verdade: é o `replaceEqualDeep` dele que decide quais leads
 * mantêm a referência depois de uma recarga. `dateTime` roda duas vezes por
 * render de linha e vira o contador; o `LeadsTable` embrulhado conta quantas
 * vezes a página redesenha a tabela.
 */
const estado = vi.hoisted(() => ({ dateTime: 0, tabela: 0, leads: [] as LeadRecord[] }));

vi.mock("@/lib/format", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/format")>();
  return {
    ...real,
    dateTime: (...args: Parameters<typeof real.dateTime>) => {
      estado.dateTime += 1;
      return real.dateTime(...args);
    },
  };
});
const auth = { user: { id: "eu" }, roles: ["broker"], previewRole: null, isAdmin: false, can: () => false, profile: { name: "Eu" } };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/components/LeadDetailModal", () => ({ default: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { channel: () => channel, removeChannel: () => Promise.resolve() } };
});
vi.mock("@/integrations/supabase/leads", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/integrations/supabase/leads")>();
  return {
    ...real,
    // Cópia por JSON: cada recarga chega com objetos novos, como da rede.
    listLeads: () => Promise.resolve(JSON.parse(JSON.stringify(estado.leads))),
    listLeadSources: () => Promise.resolve([]),
    listDistributionGroups: () => Promise.resolve([]),
    getAutomationSettings: () => Promise.resolve(null),
    listWhatsappTemplates: () => Promise.resolve([]),
  };
});
vi.mock("@/components/leads", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/leads")>();
  return {
    ...real,
    LeadsTable: (props: Parameters<typeof real.LeadsTable>[0]) => {
      estado.tabela += 1;
      return <real.LeadsTable {...props} />;
    },
  };
});

import Leads from "./Leads";
import { leadKeys } from "@/components/leads/data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = new Date("2026-09-13T12:00:00Z").getTime();

// `raw_payload` do tamanho medido na homologação (~380 caracteres nos 1.000
// leads mais recentes): a comparação por conteúdo paga por ele.
const payload = (i: number) => ({
  leadgen_id: `9${String(i).padStart(15, "0")}`, platform: "fb", created_time: "2026-09-13T10:00:00+0000",
  campaign_name: "Campanha Lançamento Setembro", adset_name: "Público Semelhante 1%", ad_name: "Vídeo fachada",
  form_name: "Formulário Apartamento 2 quartos",
  fields: { full_name: `Cliente ${i}`, email: `c${i}@x.test`, interesse: "Apartamento 2 quartos", renda: "5 a 10 mil" },
});

const lead = (i: number, patch: Partial<LeadRecord> = {}): LeadRecord => ({
  id: `l${i}`, full_name: `Cliente ${i}`, phone: "5511988770001", phone_raw: null, email: `c${i}@x.test`, document: null,
  source_id: null, distribution_group_id: null, form_id: null, external_id: null,
  campaign_id: null, campaign_name: "Campanha", adset_id: null, adset_name: null, ad_id: null,
  ad_name: null, utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null,
  utm_term: null, landing_page: null, raw_payload: payload(i),
  status: "in_progress", funnel_stage: "new", assigned_to: "eu", assigned_at: null,
  attend_deadline: null, first_contact_at: null, last_activity_at: null, next_action_at: null,
  sdr_qualified_at: null, converted_at: null, converted_deal_id: null, lost_reason: null,
  lost_at: null, notes: null, roulette_misses: 0, created_at: "2026-09-13T10:00:00Z", updated_at: "2026-09-13T10:00:00Z",
  name: `Cliente ${i}`, whatsapp: "", source: "Meta", broker_name: "Corretor",
  form_name: null, form_answers: payload(i).fields, tracking: payload(i),
  stage_changed_at: "2026-09-13T10:00:00Z",
  ...patch,
});

describe("Leads com 1.000 linhas e 1 lead em trava", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); });

  it("mede renders de linha por segundo, em 30 s e com lead novo chegando pelo realtime", async () => {
    const leads = Array.from({ length: 1000 }, (_, i) => lead(i));
    // Trava de 70 s: passa pelo último minuto durante a medição.
    leads[0] = lead(0, { status: "assigned", attend_deadline: new Date(T0 + 70_000).toISOString() });
    estado.leads = leads;

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
    let commitMs = 0;
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    // A consulta sai no efeito, o TanStack avisa a tela num `setTimeout(0)` e a
    // tabela entra em lotes, um por `setTimeout(0)`: cada passada resolve uma
    // etapa, sem avançar o relógio dos cronômetros. Devolve as linhas na tela
    // depois de cada passada.
    const assentar = async () => {
      const naTela: number[] = [];
      for (let i = 0; i < 20; i += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        naTela.push(container.querySelectorAll("table.leads-table tbody tr").length);
      }
      return naTela;
    };
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <Profiler id="leads" onRender={(_id, _fase, dur) => { commitMs += dur; }}>
              <Leads />
            </Profiler>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    // Só as passadas em que a tabela mudou de tamanho.
    const lotes = (await assentar()).filter((n, i, todas) => n > 0 && n !== todas[i - 1]);
    expect(container.querySelector("table.leads-table"), "a tabela perdeu `leads-table`, gancho da regra de pintura em index.css").not.toBeNull();
    const linhas = () => estado.dateTime / 2;
    const zerar = () => { estado.dateTime = 0; estado.tabela = 0; commitMs = 0; };
    // Primeira abertura em lotes: 100 linhas na hora, a lista inteira no fim.
    expect(lotes[0], JSON.stringify(lotes)).toBe(100);
    expect(lotes[lotes.length - 1], JSON.stringify(lotes)).toBe(1000);
    // O contador é específico: a montagem desenha cada uma das 1.000 linhas uma vez só.
    expect(linhas(), container.textContent?.slice(0, 300)).toBe(1000);
    zerar();

    // 1) Primeiros 5 s.
    for (let s = 0; s < 5; s += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    }
    const porSegundo = { linhas: linhas() / 5, tabela: estado.tabela / 5, msRender: +(commitMs / 5).toFixed(1) };
    expect(container.textContent).toContain("01:05");

    // 2) Até 30 s (inclui o relógio lento da página).
    for (let s = 5; s < 30; s += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    }
    const em30s = { linhas: linhas(), tabela: estado.tabela, msRender: +commitMs.toFixed(1) };
    // Mesmos segundos e vermelho no último minuto.
    expect(container.textContent).toContain("00:40");
    expect(container.innerHTML).toContain("text-destructive");

    // 3) Realtime: chega um lead novo no topo (`created_at desc`), o mais antigo
    // sai pelo teto de 1.000 e outro muda. Todos os demais trocam de posição.
    zerar();
    const recarga = [lead(1000, { name: "Lead novo" }), ...leads.slice(0, 999)];
    recarga[501] = { ...recarga[501], broker_name: "Outro corretor" };
    estado.leads = recarga;
    await act(async () => { void queryClient.invalidateQueries({ queryKey: leadKeys.records }); });
    await assentar();
    const realtime = { linhas: linhas(), msRender: +commitMs.toFixed(1) };
    expect(container.textContent).toContain("Lead novo");
    expect(container.textContent).toContain("Outro corretor");

    // Antes da primeira correção: 1.000 linhas/s e 30.000 em 30 s. Antes desta:
    // 1.000 linhas por lead novo (o TanStack só reaproveita lead na mesma posição).
    const medido = JSON.stringify({ porSegundo, em30s, realtime });
    if (process.env.PERF_LOG) console.info(medido);
    expect(porSegundo.linhas, medido).toBe(0);
    expect(porSegundo.tabela, medido).toBe(0);
    expect(em30s.linhas, medido).toBe(0);
    // Só o lead novo e o que mudou.
    expect(realtime.linhas, medido).toBe(2);
    await act(async () => { root.unmount(); });
    container.remove();
    queryClient.clear();
  }, 180_000);
});

/**
 * O ganho de pintura das duas listas vem de uma regra de `index.css` que depende
 * de classes postas em outros arquivos: sem esta trava, tirar a regra ou trocar
 * o wrapper do AppLayout passa por vitest, typecheck e lint, e o tique da trava
 * e o hover do menu voltam a repintar as 1.000 linhas. As classes nos
 * componentes são conferidas nos testes que os montam (aqui e no do funil).
 */
describe("regra de pintura das listas de leads", () => {
  const src = resolve(__dirname, "..");

  it("o fade-in do AppLayout solta o transform no fim nas duas listas", () => {
    expect(
      readFileSync(resolve(src, "components/layout/AppLayout.tsx"), "utf8"),
      "o wrapper do AppLayout não usa mais `animate-fade-in`: confira se a nova animação deixa transform preso (fill-mode both/forwards) e leve a regra de index.css junto",
    ).toContain('className="animate-fade-in"');

    const css = readFileSync(resolve(src, "index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const regras = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map(([, seletor, corpo]) => ({ seletor: seletor.trim().replace(/\s+/g, " "), corpo }));
    const base = regras.find((regra) => regra.seletor === ".animate-fade-in");
    expect(base, ".animate-fade-in sumiu do index.css").toBeDefined();
    // Se a regra base passar a soltar o transform para todas as telas, a exceção pode sair.
    if (!/\b(both|forwards)\b/.test(base!.corpo)) return;

    const excecao = regras.find((regra) =>
      regra.seletor.startsWith(".animate-fade-in:has(") && /animation-fill-mode:\s*backwards/.test(regra.corpo));
    expect(excecao, "sumiu a regra `.animate-fade-in:has(...) { animation-fill-mode: backwards }`").toBeDefined();
    expect(excecao!.seletor).toContain(".leads-table");
    expect(excecao!.seletor).toContain(".lead-funnel");
  });
});
