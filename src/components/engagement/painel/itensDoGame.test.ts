import { describe, expect, it } from "vitest";
import type { RankingRow, ScoringRule } from "@/integrations/supabase/game";
import { itensDoGame } from "./itensDoGame";

/**
 * A coluna da esquerda do Painel: os itens do GAME, no recorte de quem olha.
 *
 * O que estes casos travam é o pedido de 11/09/2026: o recorte é o da
 * temporada (o placar), não o do dia — e o corretor vê os PRÓPRIOS itens, não a
 * soma da equipe que o servidor devolve para ele.
 */

const linha = (profile_id: string, breakdown: Record<string, number>, active = true): RankingRow => ({
  season_id: "s1",
  profile_id,
  full_name: profile_id,
  avatar_url: null,
  active,
  points: Object.values(breakdown).reduce((soma, pontos) => soma + pontos, 0),
  sales: 0,
  vgv: 0,
  breakdown,
  team_id: null,
  team_name: null,
  manager_id: null,
  manager_name: null,
  director_id: null,
  director_name: null,
});

const regra = (event_code: string, label: string, points: number): ScoringRule => ({
  id: event_code,
  season_id: null,
  event_code,
  label,
  points,
  active: true,
});

// Fora de ordem de propósito: quem ordena é `itensDoGame`, não o banco.
const REGRAS = [
  regra("venda", "Venda", 600),
  regra("distrato", "Distrato", -600),
  regra("aprovado", "Análise aprovada", 250),
  regra("incompleto_com_doc", "Incompleto com documento", 10),
  regra("esteira", "Envio para esteira ágil", 140),
];

const EQUIPE = [
  linha("ana", { esteira: 280, venda: 600 }),
  linha("bia", { incompleto_com_doc: 20, aprovado: 250 }),
];

describe("itensDoGame", () => {
  it("o corretor vê os PRÓPRIOS itens, não a soma da equipe que o servidor devolve", () => {
    const { total, itens } = itensDoGame(EQUIPE, REGRAS, { soMinhaPosicao: true, meuId: "ana" });
    expect(total).toBe(880);
    expect(itens.find((item) => item.code === "esteira")?.points).toBe(280);
    expect(itens.find((item) => item.code === "aprovado")?.points).toBe(0);
  });

  it("gerente, diretor e admin veem a soma do recorte inteiro", () => {
    const { total, itens } = itensDoGame(EQUIPE, REGRAS, { soMinhaPosicao: false, meuId: "gerente" });
    expect(total).toBe(1150);
    expect(itens.find((item) => item.code === "aprovado")?.points).toBe(250);
  });

  it("quem foi desativado sai da soma, como sai da lista dos Destaques", () => {
    const comInativo = [...EQUIPE, linha("caio", { venda: 600 }, false)];
    expect(itensDoGame(comInativo, REGRAS, { soMinhaPosicao: false, meuId: null }).total).toBe(1150);
  });

  it("lista toda regra vigente, mesmo zerada — o item existe antes de alguém pontuar", () => {
    const { itens } = itensDoGame([], REGRAS, { soMinhaPosicao: false, meuId: null });
    expect(itens).toHaveLength(5);
    expect(itens.every((item) => item.points === 0)).toBe(true);
  });

  it("ordem do funil: do item que vale menos ao que vale mais, distrato por último", () => {
    const { itens } = itensDoGame([], REGRAS, { soMinhaPosicao: false, meuId: null });
    expect(itens.map((item) => item.code)).toEqual([
      "incompleto_com_doc",
      "esteira",
      "aprovado",
      "venda",
      "distrato",
    ]);
  });

  it("ponto de regra desligada continua na lista e os itens fecham com o total", () => {
    const { total, itens } = itensDoGame([linha("ana", { venda: 600, bonus_antigo: 50 })], REGRAS, {
      soMinhaPosicao: true,
      meuId: "ana",
    });
    expect(itens.find((item) => item.code === "bonus_antigo")).toEqual({
      code: "bonus_antigo",
      label: "bonus_antigo",
      points: 50,
    });
    expect(total).toBe(650);
    expect(total).toBe(itens.reduce((soma, item) => soma + item.points, 0));
  });

  it("distrato desconta do total", () => {
    const { total } = itensDoGame([linha("ana", { venda: 600, distrato: -600 })], REGRAS, {
      soMinhaPosicao: true,
      meuId: "ana",
    });
    expect(total).toBe(0);
  });

  it("corretor fora do ranking vê zeros, e não a pontuação da equipe", () => {
    expect(itensDoGame(EQUIPE, REGRAS, { soMinhaPosicao: true, meuId: "ninguem" }).total).toBe(0);
  });
});
