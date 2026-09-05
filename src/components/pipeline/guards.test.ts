/**
 * As travas do banco espelhadas na tela.
 *
 * Cada caso aqui corresponde a um `raise exception` que existe em migration e
 * que a tela oferecia assim mesmo: mês fechado (`deals_guard_closed_month`),
 * `can_exit_stage`/`can_enter_stage` e a conferência documental do `0028`.
 * Se o espelho divergir do banco, o usuário volta a ver botão que erra.
 */
import { describe, expect, it } from "vitest";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import {
  blockedMoveReason, dealLock, dealRangeError, dealRequiredError, exitableStages,
  findDuplicateDeal, projectPlaceholder,
} from "./guards";
import type { PipelineStage } from "./stages";

const negocio = (patch: Partial<LegacyDealRecord> = {}): LegacyDealRecord => ({
  id: "d1",
  client: "Cliente",
  developer: "",
  project: "",
  unit: "",
  status: "PROPOSTA",
  stage: "proposal",
  stage_id: "s-proposal",
  stage_label: "Proposta",
  stage_position: 2,
  outcome: "open",
  status_detail: null,
  lost_reason: null,
  broker1_share: null,
  broker2_share: null,
  broker3_share: null,
  director1_id: null,
  director2_id: null,
  broker1_name: null,
  broker2_name: null,
  manager1_name: null,
  manager2_name: null,
  director1_name: null,
  director2_name: null,
  month_base: "08/2026",
  deal_value: 100,
  days_in_pipeline: 1,
  active: true,
  created_at: "2026-08-01T00:00:00.000Z",
  document_review_status: "draft",
  ...patch,
} as LegacyDealRecord);

const etapa = (code: string, label: string, id = `s-${code}`): PipelineStage =>
  ({ id, code, label, position: 5 });

describe("dealLock", () => {
  const aberto = { canWrite: true, isAdmin: false, closedMonths: [] as string[] };

  it("linha livre quando o perfil escreve, o negocio esta ativo e o mes aberto", () => {
    expect(dealLock(negocio(), aberto)).toEqual({ locked: false, reason: "", monthClosed: false });
  });

  it("perfil somente leitura trava com o motivo no nome acessivel", () => {
    const lock = dealLock(negocio(), { ...aberto, canWrite: false });
    expect(lock.locked).toBe(true);
    expect(lock.reason).toContain("somente leitura");
  });

  it("negocio encerrado trava mesmo com o mes aberto", () => {
    expect(dealLock(negocio({ active: false }), aberto).locked).toBe(true);
  });

  it("mes fechado trava o corretor e diz QUAL mes", () => {
    const lock = dealLock(negocio(), { ...aberto, closedMonths: ["08/2026"] });
    expect(lock).toEqual({ locked: true, reason: " — mês 08/2026 fechado", monthClosed: true });
  });

  it("o admin continua editando mes fechado, mas a tela sinaliza", () => {
    // `deals_guard_closed_month` sai em `is_admin()`: negar aqui seria a tela
    // recusando o que o banco aceita. O `monthClosed` acende o cadeado.
    const lock = dealLock(negocio(), { canWrite: true, isAdmin: true, closedMonths: ["08/2026"] });
    expect(lock).toEqual({ locked: false, reason: "", monthClosed: true });
  });

  it("cai no mes de criacao quando o negocio nao tem mes-base", () => {
    const lock = dealLock(
      negocio({ month_base: undefined }),
      { ...aberto, closedMonths: ["08/2026"] },
    );
    expect(lock.monthClosed).toBe(true);
  });
});

describe("blockedMoveReason", () => {
  const tudoLiberado = {
    isAdmin: false,
    canEnterStage: () => true,
    canExitStage: () => true,
    closedMonths: [] as string[],
  };

  it("deixa passar a movimentacao que o banco aceitaria", () => {
    expect(blockedMoveReason(negocio(), etapa("visit_scheduled", "Visita Agendada"), tudoLiberado))
      .toBeNull();
  });

  it("recusa quando o perfil nao pode SAIR da etapa atual", () => {
    // O caso medido: corretor e gerente com can_exit=false em "Aprovado".
    const motivo = blockedMoveReason(
      negocio({ stage_label: "Aprovado" }),
      etapa("contract", "Contrato"),
      { ...tudoLiberado, canExitStage: () => false },
    );
    expect(motivo).toContain("tirar um negócio");
    expect(motivo).toContain("Aprovado");
  });

  it("a saida e checada ANTES da entrada — e a mensagem diz qual das duas", () => {
    const motivo = blockedMoveReason(negocio(), etapa("approved", "Aprovado"), {
      ...tudoLiberado, canEnterStage: () => false,
    });
    expect(motivo).toContain("mover negócios para");
  });

  it("recusa negocio de mes fechado para quem nao e admin", () => {
    const motivo = blockedMoveReason(negocio(), etapa("visit_scheduled", "Visita"), {
      ...tudoLiberado, closedMonths: ["08/2026"],
    });
    expect(motivo).toContain("08/2026");
    expect(blockedMoveReason(negocio(), etapa("visit_scheduled", "Visita"), {
      ...tudoLiberado, isAdmin: true, closedMonths: ["08/2026"],
    })).toBeNull();
  });

  it("recusa 'Contrato' e 'Fechado' sem a conferencia documental aprovada", () => {
    // `deals_guard_stage` (0028) estoura P0001; sem este espelho o erro chegava
    // sem nenhum aviso previo.
    for (const code of ["approved", "contract", "closed"]) {
      expect(blockedMoveReason(negocio(), etapa(code, code), tudoLiberado))
        .toContain("documentação aprovada");
    }
    expect(
      blockedMoveReason(
        negocio({ document_review_status: "approved" }),
        etapa("closed", "Fechado"),
        tudoLiberado,
      ),
    ).toBeNull();
  });

  it("nao barra 'Em analise': ela tem caminho proprio (envia para conferencia)", () => {
    expect(blockedMoveReason(negocio(), etapa("under_analysis", "Em análise"), tudoLiberado))
      .toBeNull();
  });
});

describe("exitableStages", () => {
  const linhas = [
    { stage_id: "s-approved", role: "broker", can_exit: false },
    { stage_id: "s-approved", role: "cca", can_exit: true },
    { stage_id: "s-proposal", role: "broker", can_exit: true },
  ];

  it("junta a permissao de todos os papeis do usuario (papel e N:N)", () => {
    expect([...exitableStages(linhas, ["broker"])]).toEqual(["s-proposal"]);
    expect([...exitableStages(linhas, ["broker", "cca"])].sort())
      .toEqual(["s-approved", "s-proposal"]);
  });

  it("linha ausente e negacao: a matriz e esparsa", () => {
    // `broker` simplesmente nao tem linha para "Contrato" nem para "Fechado".
    expect(exitableStages(linhas, ["broker"]).has("s-contract")).toBe(false);
    expect(exitableStages([], ["broker"]).size).toBe(0);
  });
});

describe("findDuplicateDeal", () => {
  const base = [
    negocio({ id: "d1", client: "Ana Souza", unit: "101", project: "Torre Azul" }),
    negocio({ id: "d2", client: "Ana Souza", unit: "202", project: "Torre Azul" }),
    negocio({ id: "d3", client: "Bruno Lima", unit: "101", project: "Torre Azul", active: false }),
  ];

  it("acha o cadastro repetido do mesmo cliente na mesma unidade", () => {
    const achado = findDuplicateDeal(base, { client: " ana souza ", unit: "101", project: "Torre Azul" });
    expect(achado?.id).toBe("d1");
  });

  it("nao atrapalha o cliente que compra duas unidades", () => {
    expect(findDuplicateDeal(base, { client: "Ana Souza", unit: "303", project: "Torre Azul" }))
      .toBeNull();
    expect(findDuplicateDeal(base, { client: "Ana Souza", unit: "101", project: "Torre Verde" }))
      .toBeNull();
  });

  it("nao vale na edicao — o negocio esbarraria nele mesmo", () => {
    expect(findDuplicateDeal(base, { id: "d1", client: "Ana Souza", unit: "101", project: "Torre Azul" }))
      .toBeNull();
  });

  it("recadastrar depois de uma queda continua permitido", () => {
    // O negocio encerrado nao bloqueia: voltar a vender para o mesmo cliente na
    // mesma unidade e caso real.
    expect(findDuplicateDeal(base, { client: "Bruno Lima", unit: "101", project: "Torre Azul" }))
      .toBeNull();
  });

  it("sem unidade nao ha do que desconfiar", () => {
    expect(findDuplicateDeal(base, { client: "Ana Souza", unit: "", project: "Torre Azul" }))
      .toBeNull();
  });
});

/**
 * A faixa numerica que os CHECKs da 0006 cobram.
 *
 * `min`/`max` de `input[type=number]` nao travam nada sem `<form>`: o valor
 * entrava no state, ia ao banco e voltava 23514 — que a tela traduz para "Um
 * dos campos esta fora do valor permitido", sem dizer qual, num formulario de
 * ~40 campos.
 */
describe("dealRangeError", () => {
  const base = { vgv_bruto: 400000, perc_desconto: "10", deal_value: 400000 };

  it("aprova o negocio dentro da faixa", () => {
    expect(dealRangeError(base)).toBeNull();
    expect(dealRangeError({ ...base, perc_desconto: "" })).toBeNull();
    expect(dealRangeError({ ...base, perc_desconto: "0" })).toBeNull();
    expect(dealRangeError({ ...base, perc_desconto: "100" })).toBeNull();
    expect(dealRangeError({ ...base, vgv_bruto: 0 })).toBeNull();
  });

  it("nomeia o VGV negativo, que hoje volta como 23514 sem campo", () => {
    expect(dealRangeError({ ...base, vgv_bruto: -5 })).toMatch(/VGV bruto/i);
  });

  it("nomeia o desconto fora de 0 a 100", () => {
    expect(dealRangeError({ ...base, perc_desconto: "150" })).toMatch(/desconto/i);
    expect(dealRangeError({ ...base, perc_desconto: "-1" })).toMatch(/desconto/i);
  });

  it("le a virgula brasileira, como o gravador", () => {
    // `toNumberOrNull` e a MESMA funcao que grava: se aqui lesse diferente, a
    // tela aprovaria um valor e mandaria outro.
    expect(dealRangeError({ ...base, perc_desconto: "10,5" })).toBeNull();
    expect(dealRangeError({ ...base, perc_desconto: "100,5" })).toMatch(/desconto/i);
  });

  it("cai no deal_value quando o VGV bruto nao foi preenchido, como legacyDealFields", () => {
    expect(dealRangeError({ perc_desconto: "0", deal_value: -1, vgv_bruto: undefined }))
      .toMatch(/VGV bruto/i);
  });
});

/**
 * Construtora: o asterisco passou a valer. Empreendimento: nunca foi cobrado.
 *
 * "Construtora *" tinha o rótulo e nada o cobrava — `deals.developer_id` aceita
 * nulo no banco. O negócio salvava, o cartão passava a mostrar "Sem
 * construtora" e a conferência documental, que escolhe os documentos PELA
 * construtora, ficava sem como pedir nada.
 *
 * O empreendimento fica de fora de propósito: o Select não tem digitação livre,
 * construtora sem nenhum empreendimento cadastrado é caso real, e a outra porta
 * do mesmo registro (`ConvertLeadDialog`) já converte com `project_id: null`.
 */
describe("dealRequiredError", () => {
  it("recusa negócio sem construtora", () => {
    expect(dealRequiredError({ developer: "", developer_id: null }))
      .toMatch(/construtora/i);
  });

  it("aceita quando a construtora está escolhida", () => {
    expect(dealRequiredError({ developer: "MRV", developer_id: "d1" })).toBeNull();
  });

  // O beco sem saída: construtora sem nenhum empreendimento no catálogo. O
  // Select fica vazio e desabilitado, o placeholder anuncia "Esta construtora
  // não tem empreendimento cadastrado" e não há digitação livre — cobrar o
  // campo aqui recusava o "Criar negócio" por algo que a tela não oferece.
  it("aceita criação sem empreendimento", () => {
    expect(dealRequiredError({ developer: "MRV", developer_id: "d1" })).toBeNull();
  });

  it("negócio antigo com nome e sem id continua editável", () => {
    // Registro importado guarda o texto e não o id; cobrar o `_id` aqui
    // trancaria a edição de negócio que já está no banco.
    expect(dealRequiredError({ developer: "MRV", developer_id: null })).toBeNull();
  });

  // A regra é do registro que NASCE: cobrada em toda gravação, ela trancava a
  // edição de negócio importado ou semeado sem construtora — o corretor não
  // conseguia nem corrigir o CPF.
  it("negócio já gravado não é bloqueado por campo que ele nunca teve", () => {
    expect(dealRequiredError({ id: "d1", developer: "", developer_id: null })).toBeNull();
  });
});

/**
 * O placeholder do empreendimento tem TRÊS estados.
 *
 * Negócio novo abre sem construtora, o Select fica desabilitado e o campo
 * anunciava "Sem empreendimentos": o operador lê que o catálogo está vazio e
 * troca de construtora por causa de um campo que ainda nem alimentou.
 */
describe("projectPlaceholder · os três estados do campo", () => {
  it("sem construtora, diz de que depende — não diz que falta cadastro", () => {
    expect(projectPlaceholder({ developer: "", error: null, count: 0 }))
      .toBe("Depende da construtora");
  });

  // A recusa do campo obrigatório e este placeholder ficam visíveis JUNTOS no
  // negócio novo sem construtora. Enquanto os dois começavam por "Escolha a
  // construtora", a tela dava a mesma ordem duas vezes com finais diferentes.
  it("não repete o começo da recusa do campo obrigatório", () => {
    const recusa = dealRequiredError({ developer: "", developer_id: null }) ?? "";
    const placeholder = projectPlaceholder({ developer: "", error: null, count: 0 });
    expect(recusa).not.toBe("");
    expect(placeholder.toLowerCase().startsWith(recusa.slice(0, 20).toLowerCase())).toBe(false);
  });

  it("falha de carga não vira 'sem empreendimento'", () => {
    expect(projectPlaceholder({ developer: "MRV", error: "Não consegui ler", count: 0 }))
      .toBe("Não carregou");
  });

  it("construtora sem empreendimento diz de quem é o problema", () => {
    expect(projectPlaceholder({ developer: "MRV", error: null, count: 0 }))
      .toBe("Esta construtora não tem empreendimento cadastrado");
  });

  it("com catálogo, é só escolher", () => {
    expect(projectPlaceholder({ developer: "MRV", error: null, count: 3 })).toBe("Escolher");
  });
});
