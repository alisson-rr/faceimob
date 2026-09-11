import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

import { DAILY_FIELDS, fromDailyEntry } from "@/lib/dailyFunnel";
import { LINHAS_DO_PAINEL, loadDiarioDeHoje, maiorValor, somaDiaria } from "./diarioDeHoje";

/**
 * A coluna da esquerda do Painel mostra as métricas do DIÁRIO, e o defeito que
 * ela existe para não repetir é o mesmo dos outros: duas contas para o mesmo
 * número. Os testes abaixo travam as duas pontas — a lista de linhas continua
 * saindo do catálogo, e a soma continua sendo a de `fromDailyEntry`.
 */

const entrada = (valores: Partial<Record<string, number>>) => ({
  profile_id: "p1",
  leads: 0,
  calls: 0,
  doc_collections: 0,
  visits_scheduled: 0,
  visits_done: 0,
  analyses_sent: 0,
  analyses_approved: 0,
  sales: 0,
  ...valores,
});

describe("LINHAS_DO_PAINEL", () => {
  it("são seis, na ordem do print", () => {
    expect(LINHAS_DO_PAINEL.map((linha) => linha.label)).toEqual([
      "Leads",
      "Ligações",
      "Coleta de Documentos",
      "Análise Enviada",
      "Análise Aprovada",
      "Vendas",
    ]);
  });

  it("toda chave existe no catálogo do diário", () => {
    // Se `DAILY_FIELDS` renomear uma métrica, a linha aqui não pode virar um
    // zero silencioso na tela do cliente.
    const catalogo = DAILY_FIELDS.map((campo) => campo.key);
    LINHAS_DO_PAINEL.forEach((linha) => expect(catalogo).toContain(linha.key));
  });

  it("pinta como o print: Leads em vermelho, Vendas em verde, o meio neutro", () => {
    // A paleta é DAQUI e não de `DAILY_FIELDS[].color`: aquela pinta a grade de
    // oito colunas do Diário (`pages/DailyReport.tsx`), que o print não mexeu.
    const porChave = Object.fromEntries(LINHAS_DO_PAINEL.map((l) => [l.key, l] as const));
    expect(porChave.leads.barra).toBe("bg-destructive");
    expect(porChave.vendas.rotulo).toBe("text-success");
    expect(porChave.vendas.barra).toBe("bg-success");
    ["ligacoes", "coleta_docs", "analises", "aprovados"].forEach((key) => {
      expect(porChave[key].rotulo).toBe("text-foreground");
      expect(porChave[key].barra).toBe("bg-muted-foreground");
    });
  });

  it("nenhuma cor é hex cravado — só classe do design system", () => {
    // Tema claro e escuro saem do token; um `#RRGGBB` aqui ficaria preso a um
    // dos dois.
    LINHAS_DO_PAINEL.forEach((linha) => {
      expect(linha.rotulo).toMatch(/^text-[a-z-]+$/);
      expect(linha.barra).toMatch(/^bg-[a-z-]+$/);
    });
  });
});

describe("somaDiaria", () => {
  it("traduz os nomes das colunas do banco e soma as linhas", () => {
    const total = somaDiaria([
      entrada({ leads: 3, calls: 10, analyses_sent: 2, sales: 1 }),
      entrada({ leads: 2, doc_collections: 4, analyses_approved: 1 }),
    ]);
    expect(total.leads).toBe(5);
    expect(total.ligacoes).toBe(10);
    expect(total.coleta_docs).toBe(4);
    expect(total.analises).toBe(2);
    expect(total.aprovados).toBe(1);
    expect(total.vendas).toBe(1);
  });

  it("dia sem lançamento é zero, não buraco", () => {
    const total = somaDiaria([]);
    LINHAS_DO_PAINEL.forEach((linha) => expect(total[linha.key]).toBe(0));
  });

  it("uma linha só bate com `fromDailyEntry` — a mesma conta do Diário", () => {
    const linha = entrada({ leads: 7, analyses_sent: 3 });
    expect(somaDiaria([linha])).toEqual(fromDailyEntry(linha));
  });
});

describe("maiorValor", () => {
  it("é o maior número das seis linhas", () => {
    expect(maiorValor(somaDiaria([entrada({ leads: 4, calls: 9 })]))).toBe(9);
  });

  it("dia zerado devolve 0 — barra vazia, não divisão por zero", () => {
    expect(maiorValor(somaDiaria([]))).toBe(0);
  });

  it("ignora visitas, que não estão no print", () => {
    // `DAILY_FIELDS` tem oito métricas; a barra se mede pelas SEIS mostradas.
    expect(maiorValor(somaDiaria([entrada({ leads: 2, visits_scheduled: 50 })]))).toBe(2);
  });
});

type Resposta = { data: unknown[] | null; error: { code?: string; message?: string } | null };

/**
 * O PostgREST das duas leituras do diário, no mínimo que o código usa:
 * `from('daily_reports').select().eq()` e `from('daily_entries').select().in()`.
 */
const responde = (relatorios: Resposta, entradas: Resposta = { data: [], error: null }) => {
  from.mockImplementation((tabela: string) => ({
    select: () =>
      tabela === "daily_reports"
        ? { eq: () => Promise.resolve(relatorios) }
        : { in: () => Promise.resolve(entradas) },
  }));
};

beforeEach(() => from.mockReset());

/**
 * O defeito que estes testes travam: `zeroDailyRow()` para todo vazio.
 *
 * Seis zeros diziam "a equipe não trabalhou hoje" tanto quando ninguém tinha
 * lançado quanto quando a RLS não devolveu linha nenhuma para quem olha —
 * `daily_reports_select` (0109) entrega o cabeçalho ao membro da equipe,
 * `daily_entries_select` entrega ao corretor só a própria linha, e relatório
 * visível com zero linhas é exatamente o corte da policy. Número errado é pior
 * do que número ausente.
 */
describe("loadDiarioDeHoje", () => {
  it("sem relatório do dia: ninguém lançou — e não é zero", async () => {
    responde({ data: [], error: null });

    expect(await loadDiarioDeHoje("2026-09-10")).toEqual({ estado: "sem-lancamento" });
  });

  it("relatório visível sem nenhuma linha visível: é recorte, não zero", async () => {
    responde({ data: [{ id: "r1" }], error: null }, { data: [], error: null });

    expect(await loadDiarioDeHoje("2026-09-10")).toEqual({ estado: "sem-acesso" });
  });

  it("com linha, soma no vocabulário da tela", async () => {
    responde(
      { data: [{ id: "r1" }], error: null },
      { data: [entrada({ leads: 3, calls: 8 }), entrada({ leads: 2, sales: 1 })], error: null },
    );

    const resultado = await loadDiarioDeHoje("2026-09-10");

    expect(resultado.estado).toBe("ok");
    if (resultado.estado !== "ok") return;
    expect(resultado.linha.leads).toBe(5);
    expect(resultado.linha.ligacoes).toBe(8);
    expect(resultado.linha.vendas).toBe(1);
  });

  it("dia lançado inteiro em zero continua sendo `ok` — zero medido é um número", async () => {
    // O corretor que abriu o diário e ainda não moveu nada VÊ as seis linhas em
    // zero. Só o que não foi lançado, ou não é dele de ler, vira frase.
    responde({ data: [{ id: "r1" }], error: null }, { data: [entrada({})], error: null });

    expect(await loadDiarioDeHoje("2026-09-10")).toEqual({
      estado: "ok",
      linha: somaDiaria([entrada({})]),
    });
  });

  it("erro do banco sobe com o nome da tabela, em vez de virar zero", async () => {
    responde({ data: null, error: { code: "42501", message: "denied" } });

    await expect(loadDiarioDeHoje("2026-09-10")).rejects.toThrow(/daily_reports/);
  });
});
