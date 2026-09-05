import { describe, expect, it } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DirectorFunnelSection, TeamCheckpointCard, type BrokerRow, type TeamAggr, type TeamRow } from "./FunnelCards";
import { buildTargetsMap, directorTargetKey, emptyAggr, targetsFrom } from "./funnel";

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
    expect(targetsFrom(map, directorTargetKey("D1"))).toEqual({ analise_enviada_pct: 11.5, aprovada_pct: 43, venda_pct: 53 });
    expect(targetsFrom(map, "T1")).toEqual({ analise_enviada_pct: 12, aprovada_pct: 45, venda_pct: 55 });
    expect(targetsFrom(map, directorTargetKey("D2"))).toEqual({ analise_enviada_pct: 10, aprovada_pct: 40, venda_pct: 50 });
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
        targetsFor={(key) => targetsFrom(map, key)}
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
        targetsFor={(key) => targetsFrom(map, key)}
        teamNameFor={(t) => t.name}
      />,
    );
    expect(text).toContain("Ver gerentes (1)");
    expect(text).not.toContain("Sem diretor");
  });
});
