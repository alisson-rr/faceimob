/**
 * Qual etapa fica CINZA no Select "Etapa (Status 1)" do negócio — e por quê.
 *
 * Dois achados, um arquivo, porque é UMA conta só:
 *
 * 1. O Select inteiro era habilitado quando o perfil podia SAIR da etapa atual,
 *    e as etapas que a matriz `stage_permissions` NEGA ao papel continuavam
 *    selecionáveis — a recusa só aparecia no salvamento, como 42501.
 * 2. A matriz DÁ a casa de "Em análise" a gerente, diretor e CCA (0101), então
 *    o formulário oferecia essa etapa num negócio NOVO — e a 0111 §1.c recusa o
 *    INSERT com P0001 para quem não é administrador, no fim de um formulário de
 *    ~40 campos. As duas fontes estão certas: a matriz descreve quem MOVE, o
 *    gatilho descreve quem NASCE. O que faltava era a tela distinguir as duas
 *    coisas — e é `form.id` que as separa.
 *
 * Cada caso abaixo é "papel + etapa + criar/editar → habilitada ou não, e com
 * qual motivo". Se o espelho divergir do banco, o operador volta a preencher o
 * formulário inteiro para receber a recusa no fim.
 */
import { describe, expect, it, vi } from "vitest";
import type { SaveLegacyDealInput } from "@/integrations/supabase/newSchema";
import type { PipelineStage } from "./stages";
import { APOS_CONFERENCIA, blockedStageEntries, SEM_PERMISSAO } from "./DealForm";

// `DealForm` puxa o cliente do Supabase pela cadeia de imports (contexto, dados
// e ações do negócio). Nenhum caso daqui vai ao servidor: o cliente é inerte.
// O `vi.mock` sobe acima dos imports na transformação do vitest.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const etapa = (code: string, position: number): PipelineStage => ({
  id: `id-${code}`, code, label: code.toUpperCase(), position,
});

/** Três etapas bastam para a matriz: a atual, uma liberada e uma negada. */
const ETAPAS = [etapa("lead", 1), etapa("proposal", 2), etapa("approved", 3)];

/** O funil inteiro, para os casos da conferência documental. */
const FUNIL = [
  etapa("lead", 1), etapa("proposal", 2), etapa("under_analysis", 3),
  etapa("approved", 4), etapa("contract", 5), etapa("closed", 6),
];

type FormDaEtapa = Pick<SaveLegacyDealInput, "id" | "stage" | "stage_id" | "document_review_status">;

/** Negócio NOVO na primeira etapa: é assim que `emptyDeal` abre o modal. */
const novo = (patch: Partial<FormDaEtapa> = {}): FormDaEtapa =>
  ({ stage: "lead", ...patch } as FormDaEtapa);

/** O mesmo negócio já gravado — a fronteira é o `id`. */
const existente = (patch: Partial<FormDaEtapa> = {}): FormDaEtapa =>
  ({ id: "d1", stage: "lead", stage_id: "id-lead", ...patch } as FormDaEtapa);

/** A metade "entrar" da matriz de um papel: só os códigos listados passam. */
const liberadas = (...codes: string[]) =>
  (stageId: string) => codes.some((code) => `id-${code}` === stageId);

const corretor = { canEnterStage: liberadas("proposal"), isAdmin: false };

describe("etapas bloqueadas pela matriz", () => {
  it("fica cinza exatamente o que a matriz nega", () => {
    // Corretor em "lead", com "proposal" liberada: "approved" é a única negada.
    expect(blockedStageEntries(ETAPAS, novo(), corretor))
      .toEqual(new Map([["approved", SEM_PERMISSAO]]));
  });

  it("a etapa já escolhida nunca fica cinza, mesmo negada pela matriz", () => {
    // O gerente está EM "approved" e a matriz não o deixa entrar nela: o item
    // continua selecionável porque escolher o que já está escolhido não grava
    // etapa nova — e o sufixo iria parar dentro do gatilho do Select.
    const bloqueadas = blockedStageEntries(
      ETAPAS,
      existente({ stage: "approved", stage_id: "id-approved", document_review_status: "approved" }),
      corretor,
    );
    expect(bloqueadas.has("approved")).toBe(false);
    expect(bloqueadas).toEqual(new Map([["lead", SEM_PERMISSAO]]));
  });

  it("perfil sem nenhuma etapa liberada só enxerga a atual", () => {
    expect(blockedStageEntries(ETAPAS, novo(), { canEnterStage: () => false, isAdmin: false }))
      .toEqual(new Map([["proposal", SEM_PERMISSAO], ["approved", SEM_PERMISSAO]]));
  });

  it("lista vazia não bloqueia nada — catálogo ainda carregando", () => {
    expect(blockedStageEntries([], novo(), corretor).size).toBe(0);
  });
});

describe("etapas bloqueadas pela conferência documental na CRIAÇÃO", () => {
  // Gerente: a matriz (0101) lhe dá "Em análise" porque é para lá que ele leva o
  // negócio ao APROVAR a conferência.
  const gerente = { canEnterStage: liberadas("proposal", "under_analysis"), isAdmin: false };

  it("negócio NOVO não nasce em análise — a etapa aparece, cinza, com o motivo", () => {
    const bloqueadas = blockedStageEntries(FUNIL, novo(), gerente);
    expect(bloqueadas.get("under_analysis")).toBe(APOS_CONFERENCIA);
    // E não "sem permissão": a matriz libera a casa, quem recusa é o gatilho do
    // nascimento. O motivo errado mandaria pedir uma permissão que ele já tem.
    expect(bloqueadas.get("approved")).toBe(SEM_PERMISSAO);
  });

  it("EDITAR um negócio que já existe não muda nada: a etapa volta a ser dele", () => {
    // A mesma pessoa, a mesma matriz — só o `id` muda. Mover para a análise é o
    // fluxo normal do gerente, e o gatilho só cobra a conferência no INSERT.
    expect(blockedStageEntries(FUNIL, existente(), gerente).has("under_analysis")).toBe(false);
  });

  it("com a conferência aprovada, a faixa do CCA abre até na criação", () => {
    const cca = {
      canEnterStage: liberadas("under_analysis", "approved", "contract"),
      isAdmin: false,
    };
    expect(blockedStageEntries(FUNIL, novo({ document_review_status: "approved" }), cca).get("under_analysis"))
      .toBeUndefined();
    // Sem a aprovação, as três casas do CCA ficam cinza pelo mesmo motivo.
    const semConferencia = blockedStageEntries(FUNIL, novo(), cca);
    expect(semConferencia.get("under_analysis")).toBe(APOS_CONFERENCIA);
    expect(semConferencia.get("approved")).toBe(APOS_CONFERENCIA);
    expect(semConferencia.get("contract")).toBe(APOS_CONFERENCIA);
  });

  it("admin e sócio criam onde quiserem — menos vendido", () => {
    // `canEnterStage` do contexto já responde `true` para os dois (a 0099 trata
    // 'partner' como 'admin'), e a 0111 §1.c isenta o administrador da faixa do
    // CCA. "Fechado" NÃO é isento: a §1.b recusa nascer com `outcome = 'won'`
    // para todo mundo — registrar venda passa pelo funil.
    const admin = { canEnterStage: () => true, isAdmin: true };
    expect(blockedStageEntries(FUNIL, novo(), admin))
      .toEqual(new Map([["closed", APOS_CONFERENCIA]]));
    expect(blockedStageEntries(FUNIL, novo({ document_review_status: "approved" }), admin).size)
      .toBe(0);
  });
});
