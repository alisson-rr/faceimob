import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CampaignResult } from "./CampaignPerformancePanel";

/**
 * O formulário de campanha, nos três pontos em que ele deixava o operador sem
 * saída ou sem resposta — e a Meta no painel: o botão de sincronizar só para
 * quem pode, a falha que aparece como falha, os campos travados da campanha
 * sincronizada e o alcance que não se soma.
 *
 * Renderiza com `react-dom` puro e espera com `vi.waitFor`, como
 * `MetaAdsSetup.test.tsx` — não há testing-library no projeto. Os Selects do
 * Radix não são exercitados: eles montam o conteúdo em portal só quando abertos
 * e o jsdom não tem os eventos de ponteiro que o Radix escuta. O que se prova
 * aqui é o que não depende deles. A camada de dados da Meta tem teste próprio
 * (`analytics.test.ts`); aqui ela devolve o que cada caso monta.
 */
const toast = vi.hoisted(() => vi.fn());
const m = vi.hoisted(() => ({
  pode: true,
  contas: [] as unknown[],
  metricas: [] as unknown[],
  canais: [] as unknown[],
  sincronizar: vi.fn(),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAdmin: true,
    roles: ["admin"],
    previewRole: null,
    can: (codigo: string) => m.pode && codigo === "marketing.meta_manage",
  }),
}));
// O painel importa a camada de dados só para escrever; nenhum caso aqui salva,
// e o cliente real tentaria falar com a rede na importação.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() }, functions: { invoke: vi.fn() } },
}));
vi.mock("@/integrations/supabase/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/supabase/analytics")>()),
  fetchMetaSyncStatus: () => Promise.resolve(m.contas),
  fetchMetaMetricas: () => Promise.resolve(m.metricas),
  fetchMetaPorCanal: () => Promise.resolve(m.canais),
  sincronizarMeta: m.sincronizar,
}));

import CampaignPerformancePanel from "./CampaignPerformancePanel";
import { periodoMeta } from "@/integrations/supabase/analytics";

const campanha: CampaignResult = {
  id: "c1",
  externalId: "ext-1",
  name: "Lançamento Zona Sul",
  platform: "meta",
  developerId: null,
  rawStatus: "ACTIVE",
  spend: 1000,
  dailyBudget: 200,
  lifetimeBudget: 6000,
  startsOn: "2026-09-01",
  endsOn: "2026-09-30",
  leadSourceId: null,
  syncedAt: null,
  spendPeriodStart: null,
  spendPeriodEnd: null,
  metaAccountId: null,
  metaChannel: null,
  metaBudgetLevel: null,
  metaEffectiveStatus: null,
  spendSource: null,
  developerSuggestedId: null,
  leads: 10,
  conversions: 2,
  sales: 1,
  revenue: 500000,
};

/** Adotada pela sincronização: nome, gasto, verba e status vêm da Meta. */
const sincronizada: CampaignResult = {
  ...campanha,
  id: "c2",
  externalId: "120200000001",
  name: "HORIZONTE | JARDINS | FORMULARIO",
  lifetimeBudget: null,
  metaAccountId: "conta-1",
  metaChannel: "formulario",
  metaBudgetLevel: "campaign",
  metaEffectiveStatus: "ACTIVE",
  spendSource: "meta_api",
  syncedAt: "2026-09-11T09:00:00.000Z",
  spendPeriodStart: "2026-08-01",
  spendPeriodEnd: "2026-09-11",
};

const conta = (extra: Record<string, unknown> = {}) => ({
  id: "conta-1",
  act_id: "act_111",
  name: "Conta A",
  enabled: true,
  last_sync_ok_at: "2026-09-10T09:00:00.000Z",
  last_sync_attempt_at: "2026-09-10T09:00:00.000Z",
  last_sync_error: null,
  ultima: { status: "ok", error: null, started_at: "2026-09-10T09:00:00.000Z", finished_at: "2026-09-10T09:01:00.000Z" },
  ...extra,
});

const metrica = (extra: Record<string, unknown> = {}) => ({
  campaign_id: "c2",
  external_id: "120200000001",
  name: "HORIZONTE | JARDINS | FORMULARIO",
  account_id: "conta-1",
  channel: "formulario",
  spend: 1234.5,
  impressions: 50000,
  reach: null,
  clicks: 900,
  link_clicks: 600,
  ctr: 0.012,
  cpc: 2.06,
  cpm: 24.69,
  leads_form: 10,
  conversations: 0,
  lp_leads: 0,
  resultados: 10,
  custo_por_resultado: 123.45,
  dias: 7,
  cobertura_desde: "2026-08-01",
  ...extra,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  // O jsdom não implementa `scrollIntoView`, e é ele que leva a vista até o
  // campo — sem o duplo, o clique em Copiar derrubaria o caso.
  Element.prototype.scrollIntoView = vi.fn();
});

async function montar(
  linhas: CampaignResult[] = [campanha],
  developers: { id: string; name: string; active: boolean }[] = [],
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root.render(
    <QueryClientProvider client={client}>
      <CampaignPerformancePanel
        rows={linhas}
        developers={developers}
        leadSources={[]}
        loading={false}
        onReload={vi.fn()}
      />
    </QueryClientProvider>,
  );
  const el = container;
  await vi.waitFor(() => expect(el.querySelector("table")).not.toBeNull());
  return el;
}

const porRotulo = (el: HTMLElement, rotulo: string) => {
  const label = Array.from(el.querySelectorAll("label")).find((l) => l.textContent?.trim() === rotulo);
  expect(label, `sem rótulo visível "${rotulo}"`).toBeDefined();
  const alvo = el.querySelector<HTMLElement>(`#${label!.getAttribute("for")}`);
  expect(alvo, `o rótulo "${rotulo}" não aponta para nenhum campo`).not.toBeNull();
  return alvo!;
};

const botaoPorTexto = (el: HTMLElement, texto: string) =>
  Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.trim() === texto);

const acionar = (el: HTMLElement, rotulo: string) => {
  const botao = el.querySelector<HTMLButtonElement>(`button[aria-label="${rotulo}"]`) ?? botaoPorTexto(el, rotulo);
  expect(botao, `sem botão "${rotulo}"`).toBeTruthy();
  botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

const digitar = (campo: HTMLElement, valor: string) => {
  const input = campo as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, valor);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const linhaDa = (el: HTMLElement, nome: string) => {
  const linha = Array.from(el.querySelectorAll("tbody tr")).find((tr) => tr.textContent?.includes(nome));
  expect(linha, `sem linha da campanha "${nome}"`).toBeDefined();
  return linha!;
};

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
  m.pode = true;
  m.contas = [];
  m.metricas = [];
  m.canais = [];
  vi.clearAllMocks();
});

describe("CampaignPerformancePanel", () => {
  /**
   * Todo campo com rótulo VISÍVEL. Os dois `<input type=date>` renderizam
   * "dd/mm/aaaa" e nada mais: com `aria-label` sozinho eram duas caixas
   * idênticas, e os três campos de dinheiro perdiam o placeholder assim que
   * carregavam valor — três números sem dizer qual é gasto, qual é teto diário
   * e qual é verba contratada.
   */
  it("cada campo do formulário tem rótulo visível ligado ao controle", async () => {
    const el = await montar();

    for (const rotulo of [
      "ID externo da campanha",
      "Nome da campanha",
      "Plataforma da campanha",
      "Construtora da campanha",
      "Origem de lead da campanha",
      "Status da campanha",
      "Total investido (R$)",
      "Orçamento diário (R$)",
      "Verba total (R$)",
      "Início da veiculação",
      "Fim da veiculação",
    ]) {
      expect(porRotulo(el, rotulo)).toBeTruthy();
    }
  });

  /**
   * Desistir da cópia. O Cancelar só aparecia com `editing` preenchido, e
   * copiar deixa `editing` nulo: quem clicasse em Copiar na linha errada ficava
   * com onze campos preenchidos pela máquina e nenhuma saída — e a campanha
   * seguinte nasceria com a verba e o período de outra.
   */
  it("o rascunho de cópia tem saída e o Cancelar o limpa", async () => {
    const el = await montar();

    acionar(el, `Copiar ${campanha.name}`);
    await vi.waitFor(() => expect(el.textContent).toContain("Cópia de campanha (rascunho)"));
    expect((porRotulo(el, "Verba total (R$)") as HTMLInputElement).value).toBe("6000");

    acionar(el, "Cancelar");

    await vi.waitFor(() => expect(el.textContent).toContain("Cadastrar campanha"));
    expect(el.textContent).not.toContain("Cópia de campanha (rascunho)");
    expect((porRotulo(el, "ID externo da campanha") as HTMLInputElement).value).toBe("");
    expect((porRotulo(el, "Verba total (R$)") as HTMLInputElement).value).toBe("");
  });

  /**
   * A recusa aponta o campo. Antes ela era só um toast que some, com o foco
   * parado no botão Salvar: num formulário de onze campos, quem não enxerga a
   * tela inteira não descobria qual deles recusou.
   */
  it("a recusa marca o campo, mostra a frase ligada a ele e leva o foco", async () => {
    const el = await montar();

    digitar(porRotulo(el, "ID externo da campanha"), "nova-1");
    digitar(porRotulo(el, "Nome da campanha"), "Nova");
    digitar(porRotulo(el, "Início da veiculação"), "2026-09-01");
    digitar(porRotulo(el, "Fim da veiculação"), "2026-08-01");
    acionar(el, "Salvar");

    const fim = porRotulo(el, "Fim da veiculação");
    await vi.waitFor(() => expect(fim.getAttribute("aria-invalid")).toBe("true"));
    expect(document.activeElement).toBe(fim);
    // A frase fica NA TELA, ligada ao campo — o toast anuncia e some.
    const erro = el.querySelector(`#${fim.getAttribute("aria-describedby")}`);
    expect(erro?.textContent).toMatch(/fim da veiculação não pode ser antes do início/i);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Campanha não salva" }));
  });
});

describe("CampaignPerformancePanel · Meta", () => {
  // A trava real é o has_permission da edge; a tela não oferece o que seria recusado.
  it("sem marketing.meta_manage, o Sincronizar agora não aparece — e a situação da conta continua visível", async () => {
    m.pode = false;
    m.contas = [conta()];
    const el = await montar();

    await vi.waitFor(() => expect(el.textContent).toContain("Última sincronização boa"));
    expect(botaoPorTexto(el, "Sincronizar agora")).toBeUndefined();
  });

  it("com a permissão, Sincronizar agora dispara a sincronização manual", async () => {
    m.contas = [conta()];
    m.sincronizar.mockResolvedValue({ ok: true, contas: [{ account_id: "conta-1", status: "ok" }] });
    const el = await montar();

    await vi.waitFor(() => expect(botaoPorTexto(el, "Sincronizar agora")?.disabled).toBe(false));
    botaoPorTexto(el, "Sincronizar agora")!.click();

    await vi.waitFor(() => expect(m.sincronizar).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Campanhas sincronizadas com a Meta", variant: "success" })),
    );
  });

  /**
   * Lição 1: o sistema antigo gravava número inventado quando a Meta falhava.
   * Aqui a falha aparece com a data e o motivo, e os números continuam os da
   * última sincronização boa — nem somem, nem viram zero.
   */
  it("última execução 'falhou': motivo, data e última boa na tela, e os números da Meta continuam", async () => {
    m.contas = [
      conta({
        last_sync_attempt_at: "2026-09-11T09:00:00.000Z",
        last_sync_error: "Token de acesso expirado",
        ultima: {
          status: "falhou",
          error: "Token de acesso expirado",
          started_at: "2026-09-11T09:00:00.000Z",
          finished_at: "2026-09-11T09:00:05.000Z",
        },
      }),
    ];
    m.canais = [{ channel: "formulario", spend: 1234.5, resultados: 10, custo_por_resultado: 123.45, campanhas: 1 }];
    m.metricas = [metrica()];
    const el = await montar([sincronizada]);

    await vi.waitFor(() =>
      expect(el.textContent).toMatch(/A última sincronização falhou em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}: Token de acesso expirado/),
    );
    expect(el.textContent).toMatch(/Os números abaixo são da última sincronização boa, em \d{2}\/\d{2}\/\d{4}/);
    await vi.waitFor(() => expect(el.textContent).toMatch(/R\$\s1\.234,50/));
    // Resultado e custo por resultado segundo a Meta continuam na linha.
    const linha = linhaDa(el, sincronizada.name);
    expect(linha.textContent).toMatch(/R\$\s123,45/);
  });

  /** Lição 7: o gatilho da 0115 recusa esses campos no banco; a tela trava os mesmos. */
  it("campanha sincronizada: ID, nome, plataforma, status, verba e investido travados com a frase; o vínculo continua editável", async () => {
    m.contas = [conta()];
    const el = await montar([sincronizada]);

    acionar(el, `Editar ${sincronizada.name}`);
    await vi.waitFor(() => expect(el.textContent).toContain("Corrigir campanha"));

    for (const rotulo of [
      "ID externo da campanha",
      "Nome da campanha",
      "Plataforma da campanha",
      "Status da campanha",
      "Total investido (R$)",
      "Orçamento diário (R$)",
      "Verba total (R$)",
    ]) {
      expect((porRotulo(el, rotulo) as HTMLInputElement).disabled, `${rotulo} devia estar travado`).toBe(true);
    }
    for (const rotulo of ["Construtora da campanha", "Origem de lead da campanha", "Início da veiculação", "Fim da veiculação"]) {
      expect((porRotulo(el, rotulo) as HTMLInputElement).disabled, `${rotulo} devia continuar editável`).toBe(false);
    }
    const frase = el.querySelector(`#${porRotulo(el, "Status da campanha").getAttribute("aria-describedby")}`);
    expect(frase?.textContent).toMatch(/vêm da Meta/);
  });

  it("na campanha sincronizada o Pausar local dá lugar às ações na Meta; na cadastrada à mão ele continua", async () => {
    m.contas = [conta()];
    const el = await montar([sincronizada, campanha]);

    await vi.waitFor(() =>
      expect(el.querySelector(`button[aria-label="Pausar ${sincronizada.name} na Meta"]`)).not.toBeNull(),
    );
    expect(el.querySelector(`button[aria-label="Pausar ${sincronizada.name} no CRM"]`)).toBeNull();
    expect(el.querySelector(`button[aria-label="Pausar ${campanha.name} no CRM"]`)).not.toBeNull();
  });

  /** A Meta conta pessoa única por período: somar o alcance dos dias inventa número. */
  it("alcance é '—' com a explicação quando o período tem mais de um dia", async () => {
    m.contas = [conta()];
    m.metricas = [metrica({ reach: null })];
    const el = await montar([sincronizada]);

    const abrir = await vi.waitFor(() => {
      const b = botaoPorTexto(el, "CTR, CPC, CPM e alcance");
      expect(b, "sem o botão que abre os números da Meta").toBeTruthy();
      return b!;
    });
    expect(abrir.getAttribute("aria-expanded")).toBe("false");
    abrir.click();

    const detalhe = el.querySelector<HTMLElement>(`#${abrir.getAttribute("aria-controls")}`)!;
    await vi.waitFor(() => expect(detalhe.hidden).toBe(false));
    const alcance = Array.from(detalhe.querySelectorAll("dt")).find((dt) => dt.textContent === "Alcance");
    expect(alcance?.nextElementSibling?.textContent).toBe("—");
    expect(detalhe.textContent).toMatch(/Alcance só no período de um dia/);
    expect(detalhe.textContent).toContain("CTR (link)");
  });

  it("o card por canal mostra Misto e Outro, e o total é a soma dos canais", async () => {
    m.contas = [conta()];
    m.canais = [
      { channel: "formulario", spend: 100, resultados: 4, custo_por_resultado: 25, campanhas: 1 },
      { channel: "misto", spend: 50, resultados: 2, custo_por_resultado: 25, campanhas: 1 },
      { channel: "outro", spend: 25, resultados: 0, custo_por_resultado: null, campanhas: 1 },
    ];
    const el = await montar([sincronizada]);

    await vi.waitFor(() => expect(el.textContent).toContain("Investido segundo a Meta no período"));
    expect(el.textContent).toContain("Misto");
    expect(el.textContent).toContain("Outro");
    expect(el.textContent).toMatch(/Investido segundo a Meta no período:\s*R\$\s175,00/);
  });

  it("período que começa antes da primeira sincronização é avisado como incompleto", async () => {
    m.contas = [conta()];
    // A cobertura começa ontem; o padrão (7 dias até ontem) começa antes dela.
    m.metricas = [metrica({ cobertura_desde: periodoMeta("ontem").from })];
    m.canais = [{ channel: "formulario", spend: 100, resultados: 4, custo_por_resultado: 25, campanhas: 1 }];
    const el = await montar([sincronizada]);

    await vi.waitFor(() => expect(el.textContent).toMatch(/completos só desde \d{2}\/\d{2}\/\d{4}/));
  });

  it("construtora sugerida pelo nome aparece com o Vincular", async () => {
    m.contas = [conta()];
    const el = await montar(
      [{ ...sincronizada, developerSuggestedId: "d1" }],
      [{ id: "d1", name: "Horizonte", active: true }],
    );

    await vi.waitFor(() => expect(el.textContent).toContain("Sugerido pelo nome: Horizonte"));
    expect(el.querySelector(`button[aria-label="Vincular ${sincronizada.name} a Horizonte"]`)).not.toBeNull();
  });
});
