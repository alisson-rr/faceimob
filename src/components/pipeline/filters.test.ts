import { describe, expect, it } from "vitest";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { ALL, EMPTY_FILTERS, applyDealFilters, dealMonth, hasActiveFilter, sortDeals } from "./filters";

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
