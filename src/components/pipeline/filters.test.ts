import { describe, expect, it } from "vitest";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import {
  ALL, EMPTY_FILTERS, applyDealFilters, dealMonth, hasActiveFilter, inconsistentClosedMonths,
  monthClosePreview, pct, sortDeals, sortDealsBy,
} from "./filters";

/**
 * Trava do participante por `id` (achado F06).
 *
 * O filtro comparava NOME (`d.broker1 === brokerFilter`) e a gravação
 * reencontrava a pessoa com `people.find(p => p.name === nome)`. Com dois
 * homônimos na base — que é o caso real de uma equipe de corretores — o negócio
 * de um aparecia no filtro do outro, e o rateio de VGV caía sempre no primeiro
 * `find`. Este teste é o cenário do homônimo.
 */
const deal = (patch: Partial<LegacyDealRecord>): LegacyDealRecord => ({
  id: patch.id ?? "d1",
  client: "Cliente",
  developer: "MRV",
  project: "Solar",
  unit: "101",
  status: "PROPOSTA",
  stage: "proposal",
  stage_id: "stage-proposal",
  stage_label: "Proposta",
  stage_position: 3,
  outcome: "open",
  broker1: "",
  manager1: "",
  deal_value: 100,
  days_in_pipeline: 1,
  active: true,
  created_at: "2026-08-10T12:00:00.000Z",
  director1_id: null,
  director2_id: null,
  broker1_name: null,
  broker2_name: null,
  manager1_name: null,
  manager2_name: null,
  director1_name: null,
  director2_name: null,
  ...patch,
} as LegacyDealRecord);

const JOAO_A = "11111111-1111-1111-1111-111111111111";
const JOAO_B = "22222222-2222-2222-2222-222222222222";

describe("filtro de negócios por id", () => {
  const homonimos = [
    deal({ id: "a", broker1: "João Silva", broker1_id: JOAO_A }),
    deal({ id: "b", broker1: "João Silva", broker1_id: JOAO_B }),
  ];

  it("separa dois corretores homônimos", () => {
    const resultado = applyDealFilters(homonimos, { ...EMPTY_FILTERS, brokerId: JOAO_A });
    expect(resultado.map((row) => row.id)).toEqual(["a"]);
  });

  it("acha o corretor em qualquer slot, não só no 1", () => {
    const rateado = deal({ id: "c", broker1_id: JOAO_A, broker3_id: JOAO_B });
    const resultado = applyDealFilters([...homonimos, rateado], { ...EMPTY_FILTERS, brokerId: JOAO_B });
    expect(resultado.map((row) => row.id).sort()).toEqual(["b", "c"]);
  });

  it("renomear o perfil não tira o negócio do filtro", () => {
    // O nome exibido mudou; o vínculo é o id, então o filtro continua achando.
    const renomeado = [deal({ id: "a", broker1: "João da Silva Neto", broker1_id: JOAO_A })];
    expect(applyDealFilters(renomeado, { ...EMPTY_FILTERS, brokerId: JOAO_A })).toHaveLength(1);
  });

  it("gerente também filtra por id", () => {
    const linhas = [
      deal({ id: "a", manager1: "Ana", manager1_id: JOAO_A }),
      deal({ id: "b", manager1: "Ana", manager1_id: JOAO_B }),
    ];
    expect(applyDealFilters(linhas, { ...EMPTY_FILTERS, managerId: JOAO_B }).map((r) => r.id)).toEqual(["b"]);
  });

  it("construtora filtra por id — renomear a construtora não esvazia o filtro", () => {
    const linhas = [
      deal({ id: "a", developer: "MRV", developer_id: "dev-1" }),
      deal({ id: "b", developer: "MRV Engenharia", developer_id: "dev-2" }),
    ];
    expect(applyDealFilters(linhas, { ...EMPTY_FILTERS, developerId: "dev-1" }).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("demais filtros", () => {
  it("CPF casa com e sem pontuação", () => {
    const linhas = [deal({ id: "a", cpf: "123.456.789-00" })];
    expect(applyDealFilters(linhas, { ...EMPTY_FILTERS, cpf: "12345678900" })).toHaveLength(1);
    expect(applyDealFilters(linhas, { ...EMPTY_FILTERS, cpf: "999" })).toHaveLength(0);
  });

  it("o CPF do 2º cliente filtra de verdade", () => {
    // Os quatro campos de 2º cliente/CPF existiam na tela e não filtravam nada.
    const linhas = [deal({ id: "a", cpf2: "98765432100", client2: "Maria" })];
    expect(applyDealFilters(linhas, { ...EMPTY_FILTERS, cpf2: "987" })).toHaveLength(1);
    expect(applyDealFilters(linhas, { ...EMPTY_FILTERS, client2: "maria" })).toHaveLength(1);
  });

  it("mês-base manda sobre a data de criação", () => {
    expect(dealMonth(deal({ month_base: "07/2026" }))).toBe("07/2026");
    expect(dealMonth(deal({ month_base: undefined }))).toBe("08/2026");
  });

  it("busca livre alcança cliente, empreendimento e corretor", () => {
    const linhas = [deal({ id: "a", broker1: "Rafael Nogueira" })];
    for (const termo of ["rafael", "SOLAR", "clien"]) {
      expect(applyDealFilters(linhas, { ...EMPTY_FILTERS, search: termo }), termo).toHaveLength(1);
    }
    expect(applyDealFilters(linhas, { ...EMPTY_FILTERS, search: "inexistente" })).toHaveLength(0);
  });

  it("sem filtro nenhum, nada é escondido", () => {
    const linhas = [deal({ id: "a" }), deal({ id: "b" })];
    expect(applyDealFilters(linhas, EMPTY_FILTERS)).toHaveLength(2);
    expect(hasActiveFilter(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilter({ ...EMPTY_FILTERS, month: "07/2026" })).toBe(true);
    expect(hasActiveFilter({ ...EMPTY_FILTERS, stage: ALL })).toBe(false);
  });
});

describe("ordenação", () => {
  it("agrupa por construtora e depois pela ordem do catálogo de status", () => {
    const linhas = [
      deal({ id: "a", developer: "Tenda", status: "17. DISTRATO" }),
      deal({ id: "b", developer: "Cyrela", status: "09. APROV. TOTAL" }),
      deal({ id: "c", developer: "Cyrela", status: "PROPOSTA" }),
    ];
    expect(sortDeals(linhas).map((row) => row.id)).toEqual(["c", "b", "a"]);
  });

  it("não muda o array recebido", () => {
    const linhas = [deal({ id: "a", developer: "Z" }), deal({ id: "b", developer: "A" })];
    sortDeals(linhas);
    expect(linhas.map((row) => row.id)).toEqual(["a", "b"]);
  });
});

/**
 * A conta que o diálogo de fechar mês mostra ANTES de um ato irreversível.
 *
 * Ela tem de bater com o `where` da RPC `close_month_and_season`
 * (`update deals ... where outcome = 'open'`). O predicado antigo era
 * `deal.active` (= `outcome not in (lost, cancelled)`), que inclui a VENDA: o
 * negócio ganho era prometido como "migra" e contado de novo como "congela".
 * O caso medido em 08/2026 tinha 18 abertos + 7 vendidos + 1 perdido — o
 * diálogo dizia 25 e a RPC movia 18.
 */
describe("monthClosePreview", () => {
  const mes = "08/2026";
  const doMes = [
    ...Array.from({ length: 18 }, (_, i) => deal({ id: `open-${i}`, month_base: mes, outcome: "open" })),
    ...Array.from({ length: 7 }, (_, i) => deal({
      id: `won-${i}`, month_base: mes, outcome: "won", active: true, deal_value: 1000,
    })),
    deal({ id: "lost-0", month_base: mes, outcome: "lost", active: false }),
  ];

  it("conta como migrante só o que a RPC move: outcome aberto", () => {
    const previsao = monthClosePreview(doMes, mes);
    expect(previsao.migram, "a venda NÃO migra").toBe(18);
  });

  it("as duas linhas particionam o mês — nenhum negócio contado duas vezes", () => {
    const previsao = monthClosePreview(doMes, mes);
    expect(previsao.migram + previsao.congelam).toBe(previsao.total);
    expect(previsao.total).toBe(26);
    expect(previsao.congelam, "7 vendas + 1 perda ficam congeladas").toBe(8);
  });

  it("soma o VGV só das vendas do período", () => {
    expect(monthClosePreview(doMes, mes).vgvVendido).toBe(7000);
  });

  it("ignora negócio de outro mês", () => {
    const outro = deal({ id: "x", month_base: "09/2026", outcome: "open" });
    expect(monthClosePreview([...doMes, outro], mes).total).toBe(26);
    expect(monthClosePreview([...doMes, outro], "09/2026")).toEqual({
      total: 1, migram: 1, congelam: 0, vgvVendido: 0,
    });
  });
});

/**
 * Ordenação por coluna.
 *
 * A ordem da tabela era fixa (construtora, depois catálogo de Status 2): não
 * havia como responder "maiores VGV" nem "parados há mais tempo" sem exportar
 * o CSV. O caso do mês é o que quebra sozinho: comparado como texto,
 * "12/2025" vem DEPOIS de "01/2026".
 */
describe("sortDealsBy", () => {
  const lista = [
    deal({ id: "a", client: "Carlos", developer: "Zeta", deal_value: 300, days_in_pipeline: 5, month_base: "01/2026" }),
    deal({ id: "b", client: "Ana", developer: "Alfa", deal_value: 1000, days_in_pipeline: 1, month_base: "12/2025" }),
    deal({ id: "c", client: "Bruno", developer: "Meta", deal_value: 20, days_in_pipeline: 90, month_base: "08/2026" }),
  ];

  it("ordena por VGV crescente e decrescente", () => {
    expect(sortDealsBy(lista, "vgv", true).map((row) => row.id)).toEqual(["c", "a", "b"]);
    expect(sortDealsBy(lista, "vgv", false).map((row) => row.id)).toEqual(["b", "a", "c"]);
  });

  it("ordena por dias no pipeline", () => {
    expect(sortDealsBy(lista, "days", false).map((row) => row.id)).toEqual(["c", "a", "b"]);
  });

  it("ordena por cliente em pt-BR", () => {
    expect(sortDealsBy(lista, "client", true).map((row) => row.client)).toEqual(["Ana", "Bruno", "Carlos"]);
  });

  it("mês ordena por ano+mês, não pelo texto MM/AAAA", () => {
    expect(sortDealsBy(lista, "month", true).map((row) => row.month_base)).toEqual([
      "12/2025", "01/2026", "08/2026",
    ]);
  });

  it("`padrao` é a ordem de sempre e não altera a lista recebida", () => {
    const original = [...lista];
    expect(sortDealsBy(lista, "padrao", true).map((row) => row.id)).toEqual(
      sortDeals(lista).map((row) => row.id),
    );
    expect(lista).toEqual(original);
  });
});

/**
 * Mês fechado que ainda tem proposta aberta.
 *
 * `close_month_and_season` migra todo `outcome='open'` ANTES de congelar, então
 * esse estado só nasce de escrita fora da RPC. Medido na homologação: 06/2026.
 */
describe("inconsistentClosedMonths", () => {
  it("aponta o mês fechado com proposta aberta", () => {
    const deals = [
      deal({ id: "a", month_base: "06/2026", outcome: "open" }),
      deal({ id: "b", month_base: "06/2026", outcome: "won" }),
      deal({ id: "c", month_base: "05/2026", outcome: "won" }),
    ];
    expect(inconsistentClosedMonths(deals, ["05/2026", "06/2026"]))
      .toEqual([{ month: "06/2026", abertos: 1 }]);
  });

  it("mês fechado sem proposta aberta não é incoerente", () => {
    const deals = [deal({ id: "a", month_base: "05/2026", outcome: "lost" })];
    expect(inconsistentClosedMonths(deals, ["05/2026"])).toEqual([]);
  });

  it("proposta aberta em mês ABERTO é o normal, não incoerência", () => {
    const deals = [deal({ id: "a", month_base: "08/2026", outcome: "open" })];
    expect(inconsistentClosedMonths(deals, ["05/2026"])).toEqual([]);
  });
});

/**
 * O percentual do rateio, agora numa função só.
 *
 * Eram quatro cópias do mesmo `toLocaleString` — e duas já divergiam: 50%
 * aparecia "50%" no cartão e "50,0%" no painel de indicadores, no número que
 * define comissão. Estes casos prendem o formato acordado.
 */
describe("pct · percentual do rateio", () => {
  it("50 não ganha casa decimal", () => {
    expect(pct(50)).toBe("50%");
  });

  it("o terço da migration 0058 sai com vírgula, não com ponto", () => {
    expect(pct(33.333)).toBe("33,3%");
  });

  it("sem rateio devolve travessão, não 0%", () => {
    expect(pct(null)).toBe("—");
    expect(pct(undefined)).toBe("—");
    expect(pct(Number.NaN)).toBe("—");
  });

  it("quem precisa de mais casas pede", () => {
    expect(pct(33.333, { casas: 2 })).toBe("33,33%");
  });
});
