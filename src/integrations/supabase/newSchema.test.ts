/**
 * O gravador do negócio, na parte que dá para testar sem banco.
 *
 * Três defeitos moravam aqui e todos eram silenciosos — a tela dizia
 * "Alterações salvas" e o dado saía diferente:
 *
 * 1. `status_detail` recebia o rótulo DERIVADO do desfecho como se fosse
 *    escolha do operador (alcançava 28 dos 32 negócios da homologação);
 * 2. `lost_reason` era reescrito a cada salvamento, então abrir e salvar um
 *    negócio perdido apagava o motivo da perda;
 * 3. "19. REPROVADO" encerrava o negócio pelo diálogo e não encerrava nada
 *    pelo modal, com o aviso vermelho do formulário prometendo o contrário.
 */
import { describe, expect, it } from "vitest";
import {
  dealStageCodeFor, legacyDealFields, saleBlockedReason, STAGES_REQUIRING_REVIEW,
  toNumberOrNull, type SaveLegacyDealInput,
} from "./newSchema";

const form = (patch: Partial<SaveLegacyDealInput> = {}): SaveLegacyDealInput => ({
  client: "Cliente",
  developer: "",
  project: "",
  unit: "",
  status: "PROPOSTA",
  stage: "proposal",
  deal_value: 0,
  active: true,
  created_at: "2026-08-01T00:00:00.000Z",
  ...patch,
} as SaveLegacyDealInput);

describe("toNumberOrNull", () => {
  it("le o formato brasileiro pela virgula", () => {
    expect(toNumberOrNull("1.234,56")).toBe(1234.56);
    expect(toNumberOrNull("10,5")).toBe(10.5);
  });

  it("nao come o ponto decimal de um input[type=number]", () => {
    // O bug: `replace(/\./g, "")` incondicional lia "10.5" como 105 — o
    // desconto entrava dez vezes maior e o VGV liquido saia dessa conta.
    expect(toNumberOrNull("10.5")).toBe(10.5);
    expect(toNumberOrNull(10.5)).toBe(10.5);
  });

  it("devolve nulo para vazio e para texto que nao e numero", () => {
    expect(toNumberOrNull("")).toBeNull();
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull("10%")).toBeNull();
  });
});

describe("dealStageCodeFor", () => {
  it("VENDA fecha e os motivos de perda encerram", () => {
    expect(dealStageCodeFor({ status: "VENDA", stage: "proposal" })).toBe("closed");
    for (const rotulo of ["17. DISTRATO", "18. QUEDA", "19. REPROVADO", "OFF"]) {
      expect(dealStageCodeFor({ status: rotulo, stage: "proposal" })).toBe("lost");
    }
  });

  it("qualquer outro rotulo mantem a etapa escolhida na tela", () => {
    expect(dealStageCodeFor({ status: "05. RP APROVADO", stage: "contract" })).toBe("contract");
    expect(dealStageCodeFor({ status: "PROPOSTA", stage: undefined })).toBe("incomplete");
  });

  it("o motivo de perda que JA esta gravado nao encerra: a coluna REPROVADO da CCA o grava em negocio aberto (0150)", () => {
    const reprovadoNaCca = form({
      id: "d1", stage: "under_analysis", outcome: "open",
      status: "19. REPROVADO", status_detail: "19. REPROVADO",
    });
    // Salvar sem mexer no Status 2 (mudar o telefone, preencher a aba CCA)
    // mantem a etapa e nao inventa motivo de perda.
    expect(dealStageCodeFor(reprovadoNaCca)).toBe("under_analysis");
    expect(legacyDealFields(reprovadoNaCca).lost_reason).toBeUndefined();
    // Escolher o motivo no formulario continua encerrando.
    expect(dealStageCodeFor({ ...reprovadoNaCca, status_detail: "16. PENDENTE" })).toBe("lost");
  });
});

describe("saleBlockedReason", () => {
  const etapas = [{ id: "s-closed", code: "closed" }, { id: "s-prop", code: "proposal" }];
  const liberado = () => true;
  const negado = () => false;

  it("diz o MOTIVO de quem nao pode registrar venda, antes de gravar", () => {
    // O defeito medido: corretor e gerente preenchiam ~40 campos e recebiam
    // 42501 do gatilho no fim, com mensagem tecnica.
    expect(saleBlockedReason(form({ status: "VENDA" }), etapas, negado))
      .toMatch(/Registrar venda é do administrador/);
    // Pode entrar na etapa, mas a conferencia documental nao esta aprovada:
    // a 0028 exige no UPDATE e a 0108 passou a exigir tambem no INSERT.
    expect(saleBlockedReason(form({ status: "VENDA" }), etapas, liberado))
      .toMatch(/documentação aprovada pelo gerente/);
    expect(
      saleBlockedReason(
        form({ status: "VENDA", document_review_status: "approved" }),
        etapas,
        liberado,
      ),
    ).toBeNull();
  });

  it("nao inventa recusa fora da venda, nem quando a etapa ja e a mesma", () => {
    expect(saleBlockedReason(form({ status: "PROPOSTA" }), etapas, negado)).toBeNull();
    // Negocio que JA esta em "Fechado": regravar o mesmo `stage_id` nao e
    // escrita para o gatilho, entao editar o telefone do cliente continua
    // passando para quem edita o negocio.
    expect(saleBlockedReason(
      form({ status: "VENDA", stage_id: "s-closed" }), etapas, negado,
    )).toBeNull();
    // Sem o catalogo de etapas carregado a tela nao afirma nada.
    expect(saleBlockedReason(form({ status: "VENDA" }), [], negado)).toBeNull();
  });

  it("recusa NASCER na faixa do CCA, e so de quem nao e administrador", () => {
    const funil = [...etapas, { id: "s-analise", code: "under_analysis" }];
    // O defeito medido: a matriz da a casa de "Em analise" a gerente, diretor e
    // CCA porque eles MOVEM o negocio para la ao aprovar a conferencia (0101),
    // entao o formulario de CRIACAO oferecia a etapa — e a 0111 §1.c recusava o
    // INSERT com P0001 no fim de ~40 campos.
    expect(saleBlockedReason(form({ stage: "under_analysis" }), funil, liberado))
      .toMatch(/Negócio novo começa no funil/);
    // Administrador e socio passam: a 0111 §1.c os isenta (migrar negocio que
    // veio de fora e a mesma correcao manual que a 0110 ja lhes deu).
    expect(saleBlockedReason(
      form({ stage: "under_analysis" }), funil, liberado, { isAdmin: true },
    )).toBeNull();
    // Conferencia aprovada: a etapa abre para todos.
    expect(saleBlockedReason(
      form({ stage: "under_analysis", document_review_status: "approved" }), funil, liberado,
    )).toBeNull();
    // EDITAR um negocio que ja existe nao passa por aqui: quem cobra a
    // MOVIMENTACAO e `blockedMoveReason` (pipeline/guards.ts), e regravar a
    // mesma etapa nem escrita e para o gatilho.
    expect(saleBlockedReason(form({ id: "d1", stage: "under_analysis" }), funil, liberado))
      .toBeNull();
  });

  it("a lista de etapas que exigem conferencia e a do banco, e uma so", () => {
    // Espelho de `deal_stage_document_block` (migration 0111:96-99). Ela vivia
    // em tres formulacoes que discordavam — aqui (so 'closed'), em
    // `pipeline/guards.ts` (as quatro) e no banco. Divergir de novo devolve ao
    // operador a recusa que so aparece no fim do formulario.
    expect([...STAGES_REQUIRING_REVIEW])
      .toEqual(["under_analysis", "approved", "contract", "closed"]);
  });
});

describe("legacyDealFields · status_detail", () => {
  it("grava o rotulo escolhido no negocio novo", () => {
    expect(legacyDealFields(form({ status: "05. RP APROVADO" })).status_detail)
      .toBe("05. RP APROVADO");
  });

  it("NAO regrava o rotulo derivado de um negocio que ninguem tocou", () => {
    // `status_detail: null` + `status` igual ao derivado = a tela so exibiu o
    // que deduziu de `outcome`. Persistir isso e inventar escolha do operador.
    const campos = legacyDealFields(form({
      id: "d1", status_detail: null, outcome: "open", status: "PROPOSTA",
    }));
    expect(campos.status_detail).toBeNull();
  });

  it("grava quando o operador troca o rotulo derivado por outro", () => {
    const campos = legacyDealFields(form({
      id: "d1", status_detail: null, outcome: "open", status: "16. PENDENTE",
    }));
    expect(campos.status_detail).toBe("16. PENDENTE");
  });

  it("negocio ganho sem status_detail continua sem status_detail", () => {
    const campos = legacyDealFields(form({
      id: "d1", status_detail: null, outcome: "won", status: "VENDA",
    }));
    expect(campos.status_detail).toBeNull();
  });
});

describe("legacyDealFields · Status 1", () => {
  it("manda o Status 1 do formulário", () => {
    expect(legacyDealFields(form({ id: "d1", status_group_id: "g-venda" })).status_group_id).toBe("g-venda");
  });

  it("sem Status 1 no formulário a chave não vai: o banco deriva do Status 2", () => {
    // `undefined` é descartado pelo supabase-js. Mandar `null` apagaria o grupo
    // e, sendo diferente da derivação, cairia na trava de troca manual (42501).
    expect(legacyDealFields(form({})).status_group_id).toBeUndefined();
    expect(legacyDealFields(form({ id: "d1", status_group_id: null })).status_group_id).toBeUndefined();
  });
});

describe("legacyDealFields · lost_reason", () => {
  it("nao toca no motivo quando o status nao e de perda", () => {
    // Chave ausente: o supabase-js descarta `undefined`, entao o UPDATE nem
    // menciona a coluna. Antes ela virava null e o motivo sumia.
    const campos = legacyDealFields(form({
      id: "d1", status: "16. PENDENTE", lost_reason: "18. QUEDA — cliente desistiu",
    }));
    expect(campos.lost_reason).toBeUndefined();
    expect("lost_reason" in JSON.parse(JSON.stringify(campos))).toBe(false);
  });

  it("grava o motivo quando o status escolhido encerra o negocio", () => {
    expect(legacyDealFields(form({ status: "19. REPROVADO" })).lost_reason).toBe("19. REPROVADO");
    expect(legacyDealFields(form({ status: "17. DISTRATO" })).lost_reason).toBe("17. DISTRATO");
  });

  it("preserva a observacao do dialogo de perda ao resalvar o mesmo motivo", () => {
    // O dialogo concatena "18. QUEDA — cliente desistiu". Regravar o rotulo
    // puro por cima apagaria a observacao sem ninguem pedir.
    const campos = legacyDealFields(form({
      id: "d1", status: "18. QUEDA", lost_reason: "18. QUEDA — cliente desistiu",
    }));
    expect(campos.lost_reason).toBeUndefined();
  });

  it("troca o motivo quando o operador escolhe outro rotulo de perda", () => {
    const campos = legacyDealFields(form({
      id: "d1", status: "17. DISTRATO", lost_reason: "18. QUEDA — cliente desistiu",
    }));
    expect(campos.lost_reason).toBe("17. DISTRATO");
  });
});

describe("legacyDealFields · numeros e mes", () => {
  it("converte o mes-base para o primeiro dia do mes", () => {
    expect(legacyDealFields(form({ month_base: "08/2026" })).month_base).toBe("2026-08-01");
  });

  it("desconto de campo numerico entra igual, sem virar dez vezes maior", () => {
    expect(legacyDealFields(form({ perc_desconto: "10.5" })).discount_pct).toBe(10.5);
    expect(legacyDealFields(form({ perc_desconto: "" })).discount_pct).toBe(0);
  });

  it("VGV bruto manda; o liquido e do banco", () => {
    const campos = legacyDealFields(form({ vgv_bruto: 500000, deal_value: 1 }));
    expect(campos.vgv_gross).toBe(500000);
    expect(campos).not.toHaveProperty("vgv_net");
  });
});
