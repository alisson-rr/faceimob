import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Canal } from "../_shared/metaInsights.ts";
import {
  aplicarAvaliacoes, type LinhaInsight, montarPedidoIA, periodoDaAnalise, prepararAnuncios, validarSaidaIA,
} from "./nota.ts";

/**
 * A nota por anúncio (F2.1), da conta ao que a tela mostra.
 *
 * O sistema antigo errava de três jeitos, e cada caso aqui trava um deles:
 * anúncio com R$ 2 gastos julgado "cortar", média que misturava clique com
 * lead, e anúncio sem nota sumindo da lista. Mais: a IA não inventa id nem
 * nota, e falha aparece como falha, com a última análise boa e a data.
 *
 * O teste da tela mora aqui (e não em src/) porque a verificação da frente é
 * `npx vitest run supabase/functions/meta-ad-scores`. Arquivo `.ts`: a tela é
 * montada com `createElement`.
 */

const acao = (action_type: string, value: number) => ({ action_type, value: String(value) });
const LEAD = "onsite_conversion.lead_grouped";
const CONVERSA = "onsite_conversion.messaging_conversation_started_7d";

const linha = (ad_id: string, campanha: string, spend: number, actions: ReturnType<typeof acao>[] = [], extra: Partial<LinhaInsight> = {}): LinhaInsight => ({
  ad_id, ad_name: `Anúncio ${ad_id}`, campaign_id: campanha, campaign_name: `Campanha ${campanha}`,
  spend: spend.toFixed(2), impressions: "1000", inline_link_clicks: "10", actions, ...extra,
});

const CANAIS = new Map<string, Canal>([["cf", "formulario"], ["cw", "whatsapp"], ["co", "outro"]]);

describe("prepararAnuncios", () => {
  it("amostra pequena nunca vai para a IA: 'manter', sem nota, fora da mensagem", () => {
    // Formulário: gasto do canal ÷ resultados do canal = (300 + 100 + 300) / 5 = R$ 140,
    // então o mínimo para julgar é max(50, 2 × 140) = R$ 280.
    // WhatsApp sem nenhum resultado: sem média, o mínimo é o piso de R$ 50.
    const prep = prepararAnuncios([
      linha("bom", "cf", 300, [acao(LEAD, 5)]),
      linha("pouco", "cf", 100),
      linha("muito", "cf", 300),
      linha("w-pouco", "cw", 40),
      linha("w-muito", "cw", 60),
    ], CANAIS);

    for (const id of ["pouco", "w-pouco"]) {
      const a = prep.anuncios.find((x) => x.ad_id === id)!;
      expect(a).toMatchObject({ balde: "manter", nota: null, amostra_pequena: true });
      expect(a.motivo).toMatch(/^Amostra pequena/);
    }
    expect(prep.paraIA.map((a) => a.ad_id)).toEqual(["bom", "muito", "w-muito"]);

    const mensagem = montarPedidoIA({ inicio: "2026-09-01", fim: "2026-09-07", dias: 7 }, prep);
    expect(mensagem).toContain('"muito"');
    expect(mensagem).not.toContain('"pouco"');
    expect(mensagem).not.toContain('"w-pouco"');
  });

  it("médias por canal, sem misturar clique com lead nem canal com canal", () => {
    const prep = prepararAnuncios([
      // A linha de WhatsApp traz um lead de formulário: não conta, o resultado dela é a conversa.
      linha("w1", "cw", 200, [acao(CONVERSA, 10), acao(LEAD, 7)], { impressions: "2000", inline_link_clicks: "40" }),
      linha("f1", "cf", 300, [acao(LEAD, 3)], { impressions: "1000", inline_link_clicks: "5" }),
      linha("o1", "co", 500, [acao(LEAD, 2)]),
      linha("x1", "desconhecida", 400, [acao(LEAD, 2)]),
    ], CANAIS);

    expect(prep.medias.whatsapp).toEqual({ custo_por_resultado: 20, ctr: 0.02 });
    expect(prep.medias.formulario).toEqual({ custo_por_resultado: 100, ctr: 0.005 });
    expect(prep.medias.outro).toBeUndefined();

    const w1 = prep.anuncios.find((a) => a.ad_id === "w1")!;
    expect(w1).toMatchObject({ resultados: 10, custo_por_resultado: 20, clicks: 40, ctr: 0.02 });

    // Sem resultado para contar, nenhuma nota: aparecem, mas não vão para a IA.
    expect(prep.anuncios.find((a) => a.ad_id === "o1")).toMatchObject({ balde: "nao_analisado", canal: "outro" });
    expect(prep.anuncios.find((a) => a.ad_id === "x1")).toMatchObject({ balde: "nao_analisado", canal: null });
    expect(prep.anuncios.find((a) => a.ad_id === "x1")!.motivo).toMatch(/não sincronizada/);
    expect(prep.paraIA.map((a) => a.ad_id).sort()).toEqual(["f1", "w1"]);
  });

  it("além dos 40 de maior gasto: continuam na lista, sem nota, com o motivo fixo", () => {
    const linhas = Array.from({ length: 45 }, (_, i) => linha(`a${i}`, "cf", 1000 - i, [acao(LEAD, 2)]));
    const prep = prepararAnuncios(linhas, CANAIS);

    expect(prep.anuncios).toHaveLength(45);
    expect(prep.paraIA).toHaveLength(40);
    const fora = prep.anuncios.filter((a) => !prep.paraIA.includes(a));
    expect(fora.map((a) => a.ad_id)).toEqual(["a40", "a41", "a42", "a43", "a44"]);
    for (const a of fora) {
      expect(a).toMatchObject({ nota: null, balde: "nao_analisado", motivo: "fora dos 40 de maior gasto nesta análise" });
    }
  });
});

describe("validarSaidaIA", () => {
  const ids = new Set(["1", "2", "3", "4", "5"]);

  it("descarta id inventado e balde fora do enum, limita a nota e corta o motivo", () => {
    const longo = "x".repeat(300);
    const v = validarSaidaIA({
      anuncios: [
        { ad_id: "1", nota: 12, balde: "escalar", motivo: "Custo 40% abaixo da média" },
        { ad_id: "2", nota: -3, balde: "Cortar", motivo: longo },
        { ad_id: "3", nota: 5, balde: "pausar", motivo: "balde que não existe" },
        { ad_id: "999", nota: 8, balde: "manter", motivo: "id inventado" },
        { ad_id: "4", nota: "7", balde: "manter", motivo: "nota em texto" },
        { ad_id: "1", nota: 1, balde: "cortar", motivo: "repetido" },
      ],
    }, ids);

    expect(v.map((a) => a.ad_id)).toEqual(["1", "2"]);
    expect(v[0]).toMatchObject({ nota: 10, balde: "escalar" });
    expect(v[1]).toMatchObject({ nota: 0, balde: "cortar" });
    expect(v[1].motivo).toHaveLength(160);
  });

  it("saída sem a lista ou sem nenhuma avaliação válida é falha, não nota vazia", () => {
    expect(() => validarSaidaIA("não é JSON", ids)).toThrow(/lista/);
    expect(() => validarSaidaIA({ anuncios: "x" }, ids)).toThrow(/lista/);
    expect(() => validarSaidaIA({ anuncios: [{ ad_id: "999", nota: 5, balde: "manter", motivo: "m" }] }, ids))
      .toThrow(/nenhuma avaliação válida/);
    expect(validarSaidaIA({ anuncios: [] }, new Set())).toEqual([]);
  });

  it("quem a IA deixou sem avaliação segue 'não analisado', com o motivo", () => {
    const prep = prepararAnuncios([linha("a", "cf", 300, [acao(LEAD, 3)]), linha("b", "cf", 200, [acao(LEAD, 1)])], CANAIS);
    const final = aplicarAvaliacoes(prep.anuncios, validarSaidaIA({
      anuncios: [{ ad_id: "a", nota: 8.26, balde: "escalar", motivo: "Metade do custo médio" }],
    }, new Set(prep.paraIA.map((x) => x.ad_id))));

    expect(final.find((x) => x.ad_id === "a")).toMatchObject({ nota: 8.3, balde: "escalar", motivo: "Metade do custo médio" });
    expect(final.find((x) => x.ad_id === "b")).toMatchObject({ nota: null, balde: "nao_analisado" });
    expect(final.find((x) => x.ad_id === "b")!.motivo).toMatch(/IA não devolveu/);
  });
});

describe("periodoDaAnalise", () => {
  it("usa o dia no fuso da conta e deixa hoje de fora", () => {
    // 02:00 UTC de 11/09 ainda é 10/09 em São Paulo: o último dia é 09/09, não 10/09.
    expect(periodoDaAnalise(7, new Date("2026-09-11T02:00:00Z"), "America/Sao_Paulo"))
      .toEqual({ inicio: "2026-09-03", fim: "2026-09-09", dias: 7 });
  });
});

// ---------------------------------------------------------------------------
// A tela (MetaAdScores), com o banco e a edge simulados
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  invoke: vi.fn(),
  toastError: vi.fn(),
  podeAnalisar: true,
  contas: [] as unknown[],
  ultima: null as unknown,
  boa: null as unknown,
  filtros: [] as Record<string, unknown>[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const filtros: Record<string, unknown> = {};
    const q = {
      select: () => q,
      eq: (coluna: string, valor: unknown) => {
        filtros[coluna] = valor;
        return q;
      },
      order: () => q,
      limit: () => q,
      then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => {
        if (tabela === "meta_ad_accounts") return Promise.resolve({ data: m.contas, error: null }).then(ok, falha);
        m.filtros.push({ ...filtros });
        const linha = filtros.status === "ok" ? m.boa : m.ultima;
        return Promise.resolve({ data: linha ? [linha] : [], error: null }).then(ok, falha);
      },
    };
    return q;
  };
  return { supabase: { functions: { invoke: m.invoke }, from: consulta } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: m.toastError } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ can: (codigo: string) => m.podeAnalisar && codigo === "marketing.meta_manage" }),
}));

import { MetaAdScores } from "@/components/marketing/MetaAdScores";

const anuncio = (ad_id: string, balde: string, extra: Record<string, unknown> = {}) => ({
  ad_id, ad_name: `Anúncio ${ad_id}`, campaign_external_id: "c1", campaign_name: "Casa Nova | FORMULARIO",
  canal: "formulario", spend: 250, impressions: 1000, clicks: 12, ctr: 0.012, resultados: 5, custo_por_resultado: 50,
  nota: 8, balde, motivo: `Motivo de ${ad_id}`, amostra_pequena: false, status: "ACTIVE", ...extra,
});

const BOA = {
  id: "run-bom",
  finished_at: "2026-09-10T12:00:00.000Z",
  result: {
    periodo: { inicio: "2026-09-03", fim: "2026-09-09", dias: 7 },
    medias: { formulario: { custo_por_resultado: 62.5, ctr: 0.011 } },
    anuncios: [
      anuncio("escala", "escalar"),
      anuncio("corta", "cortar", { nota: 2, status: "PAUSED" }),
      anuncio("fora", "nao_analisado", { nota: null, motivo: "fora dos 40 de maior gasto nesta análise" }),
    ],
  },
};

const FALHOU = {
  id: "run-falhou",
  status: "falhou",
  error: "Token de acesso expirado ou inválido",
  started_at: "2026-09-11T11:59:00.000Z",
  finished_at: "2026-09-11T12:00:00.000Z",
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function montar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root.render(createElement(QueryClientProvider, { client }, createElement(MetaAdScores)));
  const el = container;
  await vi.waitFor(() => expect(el.querySelector('[aria-busy="true"]')).toBeNull());
  return el;
}

const botao = (el: HTMLElement, rotulo: string) =>
  Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.trim() === rotulo);

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
  m.contas = [];
  m.ultima = null;
  m.boa = null;
  m.filtros = [];
  m.podeAnalisar = true;
  vi.clearAllMocks();
});

describe("MetaAdScores (tela)", () => {
  it("falha da Meta: mostra a falha com a data e, abaixo, a última análise boa com a data", async () => {
    m.contas = [{ id: "c1", name: "Conta A", act_id: "act_111" }];
    m.ultima = FALHOU;
    m.boa = BOA;
    const el = await montar();

    await vi.waitFor(() => expect(el.textContent).toContain("Anúncio escala"));
    expect(el.textContent).toMatch(
      /A última análise falhou em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}: Token de acesso expirado ou inválido/,
    );
    expect(el.textContent).toMatch(/Abaixo, a última análise boa, de \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    expect(el.textContent).toContain("nota 8/10");
    expect(el.textContent).toContain("pausado");
    // Quem ficou sem nota aparece, com o motivo.
    expect(el.textContent).toContain("Não analisados");
    expect(el.textContent).toContain("fora dos 40 de maior gasto nesta análise");
    // A leitura foi da conta, do tipo e do período certos.
    expect(m.filtros).toContainEqual({ kind: "nota_anuncios", account_id: "c1", "params->>dias": "7" });
  });

  it("Analisar manda a conta e o período; a recusa da edge vira aviso de falha", async () => {
    m.contas = [{ id: "c1", name: "Conta A", act_id: "act_111" }];
    m.invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
        context: new Response(JSON.stringify({ ok: false, run_id: "r2", error: "A Meta não respondeu em 30 s." }), { status: 502 }),
      }),
    });
    const el = await montar();
    await vi.waitFor(() => expect(el.textContent).toContain("Ainda não há análise de 7 dias"));

    botao(el, "30 dias")!.click();
    await vi.waitFor(() => expect(el.textContent).toContain("Ainda não há análise de 30 dias"));
    botao(el, "Analisar")!.click();

    await vi.waitFor(() => expect(m.toastError).toHaveBeenCalled());
    expect(m.invoke).toHaveBeenCalledWith("meta-ad-scores", { body: { account_id: "c1", dias: 30 } });
    expect(m.toastError).toHaveBeenCalledWith("Não foi possível rodar a análise", { description: "A Meta não respondeu em 30 s." });
  });

  it("sem 'Gerenciar campanhas na Meta': Analisar desligado, e a análise continua visível", async () => {
    m.podeAnalisar = false;
    m.contas = [{ id: "c1", name: "Conta A", act_id: "act_111" }];
    m.boa = BOA;
    const el = await montar();

    await vi.waitFor(() => expect(el.textContent).toContain("Anúncio escala"));
    expect(botao(el, "Analisar")?.disabled).toBe(true);
    expect(el.textContent).toContain('Sem a permissão "Gerenciar campanhas na Meta"');
    expect(m.invoke).not.toHaveBeenCalled();
  });
});
