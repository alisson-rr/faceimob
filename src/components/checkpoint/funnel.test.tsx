import { describe, expect, it } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DirectorFunnelSection, TeamCheckpointCard, type BrokerRow, type TeamAggr, type TeamRow } from "./FunnelCards";
import { format, parseISO, startOfWeek } from "date-fns";
import {
  addEntry, buildTargetsMap, DEFAULT_TARGETS, directorTargetKey, emptyAggr,
  lancamentoKey, missingDays, monthRange, targetsForKey,
} from "./funnel";
import { fromDailyEntry } from "@/lib/dailyFunnel";
import { IDEAL_STAGES } from "@/lib/metrics";

// Sem @testing-library no projeto, o render é o do react-dom mesmo; a flag é o
// que faz `act` aceitar o jsdom como ambiente de teste.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ZERADO: TeamAggr = emptyAggr();
const META = { analise_enviada_pct: 10, aprovada_pct: 40, venda_pct: 50 };

async function render(ui: ReactNode) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  const text = container.textContent ?? "";
  await act(async () => { root.unmount(); });
  container.remove();
  return text;
}

describe("TeamCheckpointCard", () => {
  it("semana sem lançamento não é gargalo nem 'no ritmo'", async () => {
    const text = await render(<TeamCheckpointCard aggr={ZERADO} targets={META} name="Equipe Paulista" />);
    expect(text).toContain("Sem lançamentos nesta semana");
    expect(text).not.toContain("Gargalo");
    expect(text).not.toContain("No ritmo");
    expect(text).not.toContain("faltam");
  });

  it("lançamento sem lead também fica neutro", async () => {
    const text = await render(<TeamCheckpointCard aggr={{ ...ZERADO, lancamentos: 2, ligacoes: 5 }} targets={META} name="Equipe Sul" />);
    expect(text).toContain("Sem leads nesta semana");
    expect(text).not.toContain("Gargalo");
  });

  it("com base, o estágio abaixo da meta vira gargalo", async () => {
    const aggr: TeamAggr = { ...ZERADO, lancamentos: 1, leads: 20, enviadas: 1, aprovadas: 1, vendas: 1 };
    const text = await render(<TeamCheckpointCard aggr={aggr} targets={META} name="Equipe Paulista" />);
    expect(text).toContain("Gargalo: Análise Enviada");
    expect(text).toContain("faltam 5.0pp para meta 10%");
  });

  it("estágio sem base (0/0) não é gargalo: com leads e nenhuma análise, o gargalo é a análise, não a venda", async () => {
    const aggr: TeamAggr = { ...ZERADO, lancamentos: 1, leads: 20 };
    const text = await render(<TeamCheckpointCard aggr={aggr} targets={META} name="Equipe Paulista" />);
    expect(text).toContain("Gargalo: Análise Enviada");
    expect(text).toContain("faltam 10.0pp para meta 10%");
    expect(text).not.toContain("Gargalo: Venda");
  });

  it("visitas agendadas e feitas aparecem como chip, fora do funil", async () => {
    // Coletadas no Diário desde a 0009 e invisíveis no Checkpoint até aqui: o
    // SELECT da tela nem as pedia.
    const aggr: TeamAggr = { ...ZERADO, lancamentos: 1, leads: 20, visitas_agendadas: 7, visitas_feitas: 4 };
    const text = await render(<TeamCheckpointCard aggr={aggr} targets={META} name="Equipe Paulista" />);
    expect(text).toContain("Visitas agendadas");
    expect(text).toContain("7");
    expect(text).toContain("Visitas feitas");
    expect(text).toContain("4");
    // Visita não tem meta em `funnel_targets`: entrar no funil inventaria uma.
    expect(text).not.toContain("Gargalo: Visitas");
  });

  it("equipe desativada continua no quadro, marcada", async () => {
    const aggr: TeamAggr = { ...ZERADO, lancamentos: 1, leads: 20, enviadas: 4 };
    const text = await render(
      <TeamCheckpointCard aggr={aggr} targets={META} name="Equipe Sul" inactive />,
    );
    expect(text).toContain("desativada");
    // E o número lançado continua aparecendo — sumir com ele é o defeito.
    expect(text).toContain("20");
  });

  it("o gargalo é o primeiro estágio abaixo da meta, não o de maior distância", async () => {
    // Análise a 5% (meta 10) e venda a 0% de 1 aprovada (meta 50): a venda está
    // mais longe, mas o que trava o funil é a análise.
    const aggr: TeamAggr = { ...ZERADO, lancamentos: 1, leads: 20, enviadas: 1, aprovadas: 1, vendas: 0 };
    const text = await render(<TeamCheckpointCard aggr={aggr} targets={META} name="Equipe Paulista" />);
    expect(text).toContain("Gargalo: Análise Enviada");
  });
});

describe("buildTargetsMap", () => {
  it("chaveia a diretoria por dir:<id>, a mais recente vence e o resto cai no global", () => {
    const map = buildTargetsMap([
      { scope: "director", team_id: null, director_id: "D1", lead_to_analysis_pct: 11.5, analysis_to_approval_pct: 43, approval_to_sale_pct: 53 },
      { scope: "director", team_id: null, director_id: "D1", lead_to_analysis_pct: 9, analysis_to_approval_pct: 9, approval_to_sale_pct: 9 },
      { scope: "team", team_id: "T1", director_id: null, lead_to_analysis_pct: 12, analysis_to_approval_pct: 45, approval_to_sale_pct: 55 },
      { scope: "global", team_id: null, director_id: null, lead_to_analysis_pct: 10, analysis_to_approval_pct: 40, approval_to_sale_pct: 50 },
    ]);
    expect(targetsForKey(map, directorTargetKey("D1"))).toEqual({ analise_enviada_pct: 11.5, aprovada_pct: 43, venda_pct: 53 });
    expect(targetsForKey(map, "T1")).toEqual({ analise_enviada_pct: 12, aprovada_pct: 45, venda_pct: 55 });
    expect(targetsForKey(map, directorTargetKey("D2"))).toEqual({ analise_enviada_pct: 10, aprovada_pct: 40, venda_pct: 50 });
  });
});

describe("DirectorFunnelSection", () => {
  const teams: TeamRow[] = [
    { id: "T1", name: "Equipe Paulista", display_name: null, manager_id: "M1", director_id: "D1", active: true },
    { id: "T2", name: "Equipe Sul", display_name: null, manager_id: "M2", director_id: "D1", active: true },
    { id: "T3", name: "Equipe Centro", display_name: null, manager_id: null, director_id: null, active: true },
  ];
  // Só a diretora está na lista de pessoas: gerente fora de `team_members` não
  // pode mudar o agrupamento, que sai de `teams.director_id`.
  const brokers: BrokerRow[] = [{ id: "D1", name: "Daniela Diretora", manager_id: null, director_id: null, user_id: "D1" }];
  const map = buildTargetsMap([
    { scope: "team", team_id: "T1", director_id: null, lead_to_analysis_pct: 12, analysis_to_approval_pct: 45, approval_to_sale_pct: 55 },
    { scope: "director", team_id: null, director_id: "D1", lead_to_analysis_pct: 11.5, analysis_to_approval_pct: 43, approval_to_sale_pct: 53 },
    { scope: "global", team_id: null, director_id: null, lead_to_analysis_pct: 10, analysis_to_approval_pct: 40, approval_to_sale_pct: 50 },
  ]);

  it("agrupa pela diretoria da equipe e mostra a meta da diretoria, não a da primeira equipe", async () => {
    const text = await render(
      <DirectorFunnelSection
        brokers={brokers}
        teams={teams}
        aggregate={() => ZERADO}
        targetsFor={(key) => targetsForKey(map, key)}
        teamNameFor={(t) => t.name}
      />,
    );
    expect(text).toContain("Diretor: Daniela Diretora");
    expect(text).toContain("Ver gerentes (2)");
    expect(text).toContain("m11.5%");
    expect(text).not.toContain("m12%");
    // Equipe sem diretor cai em grupo próprio, com a meta global.
    expect(text).toContain("Diretor: Sem diretor");
    expect(text).toContain("Ver gerentes (1)");
    expect(text).toContain("m10%");
    expect(text).toContain("Sem lançamentos nesta semana");
  });

  it("um filtro de equipe reduz o grupo ao que foi filtrado", async () => {
    const text = await render(
      <DirectorFunnelSection
        brokers={brokers}
        teams={teams.filter((t) => t.id === "T2")}
        aggregate={() => ZERADO}
        targetsFor={(key) => targetsForKey(map, key)}
        teamNameFor={(t) => t.name}
      />,
    );
    expect(text).toContain("Ver gerentes (1)");
    expect(text).not.toContain("Sem diretor");
  });
});

/**
 * Mês acumulado e pendências: as duas réguas que vieram da RPC pública quando o
 * checkpoint virou tela logada. Se divergirem do banco, o mesmo dia aparece
 * cobrado num lado e quitado no outro.
 */
describe("monthRange", () => {
  const segunda = (iso: string) => startOfWeek(parseISO(iso), { weekStartsOn: 1 });

  it("na semana corrente o mês é o de HOJE, não o do início da semana", () => {
    // O defeito que a 0071 corrigiu: em 02/09 (semana de 31/08) o acumulado
    // vinha rotulado agosto e o que foi lançado em 01 e 02/09 sumia.
    const r = monthRange(segunda("2026-09-02"), parseISO("2026-09-02"));
    expect(format(r.start, "yyyy-MM-dd")).toBe("2026-09-01");
    expect(format(r.end, "yyyy-MM-dd")).toBe("2026-09-02");
  });

  it("semana passada traz o mês dela, fechado no último dia", () => {
    const r = monthRange(segunda("2026-08-10"), parseISO("2026-09-02"));
    expect(format(r.start, "yyyy-MM-dd")).toBe("2026-08-01");
    expect(format(r.end, "yyyy-MM-dd")).toBe("2026-08-31");
  });

  it("semana futura fica com intervalo vazio — mês futuro não soma nada", () => {
    const r = monthRange(segunda("2026-10-05"), parseISO("2026-09-02"));
    expect(r.end < r.start).toBe(true);
  });
});

describe("missingDays", () => {
  const semana = startOfWeek(parseISO("2026-09-07"), { weekStartsOn: 1 }); // 07/09, segunda
  const sexta = parseISO("2026-09-11");

  it("cobra o dia útil sem lançamento e ignora quem lançou", () => {
    const lancado = new Set([lancamentoKey("t1", "2026-09-07"), lancamentoKey("t2", "2026-09-08")]);
    const r = missingDays(semana, sexta, ["t1", "t2"], lancado);
    expect(r).toEqual([
      { date: "2026-09-07", teamIds: ["t2"] },
      { date: "2026-09-08", teamIds: ["t1"] },
      { date: "2026-09-09", teamIds: ["t1", "t2"] },
      { date: "2026-09-10", teamIds: ["t1", "t2"] },
    ]);
  });

  it("HOJE não é pendência — ainda está aberto para preencher", () => {
    const r = missingDays(semana, parseISO("2026-09-08"), ["t1"], new Set());
    expect(r.map((d) => d.date)).toEqual(["2026-09-07"]);
  });

  it("sábado e domingo ficam de fora", () => {
    // Semana inteira no passado: só os 5 dias úteis podem ser cobrados.
    const r = missingDays(semana, parseISO("2026-09-21"), ["t1"], new Set());
    expect(r.map((d) => d.date)).toEqual([
      "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
    ]);
  });
});

describe("a régua e a tradução do diário, fonte única", () => {
  it("sem meta cadastrada a régua é o funil ideal, não um 10/40/50 digitado", () => {
    // Eram dois lugares: literal aqui e derivado em `@/lib/dailyFunnel`. Mudar
    // o funil ideal do produto tem de mover o Checkpoint junto.
    const pct = (key: string) => IDEAL_STAGES.find((s) => s.key === key)?.stagePct;
    expect(DEFAULT_TARGETS).toEqual({
      analise_enviada_pct: pct("analises"),
      aprovada_pct: pct("aprovados"),
      venda_pct: pct("vendas"),
    });
  });

  it("addEntry soma exatamente o que `fromDailyEntry` traduz", () => {
    // A tradução coluna → tela estava escrita três vezes, com vocabulários
    // diferentes. Se alguém reescrever uma delas, este assert cai.
    const linha = {
      leads: 9, calls: 8, doc_collections: 7, visits_scheduled: 6,
      visits_done: 5, analyses_sent: 4, analyses_approved: 3, sales: 2,
    };
    const esperado = fromDailyEntry(linha);
    const acc = addEntry(emptyAggr(), linha);
    expect(acc.leads).toBe(esperado.leads);
    expect(acc.ligacoes).toBe(esperado.ligacoes);
    expect(acc.coleta_docs).toBe(esperado.coleta_docs);
    expect(acc.visitas_agendadas).toBe(esperado.visitas_agendadas);
    expect(acc.visitas_feitas).toBe(esperado.visitas_realizadas);
    expect(acc.enviadas).toBe(esperado.analises);
    expect(acc.aprovadas).toBe(esperado.aprovados);
    expect(acc.vendas).toBe(esperado.vendas);
  });

  it("coluna nula não vira NaN no acumulado", () => {
    const acc = addEntry(emptyAggr(), { leads: 3, calls: null, sales: undefined });
    expect(acc).toEqual({ ...emptyAggr(), leads: 3 });
  });
});
