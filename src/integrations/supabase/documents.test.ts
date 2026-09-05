import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, remove } = vi.hoisted(() => ({ from: vi.fn(), remove: vi.fn() }));
vi.mock("./client", () => ({
  supabase: { from, storage: { from: () => ({ remove }) } },
}));

import {
  MAX_DOCUMENT_BYTES,
  canAttachNow,
  deleteDealDocument,
  missingRequiredTypes,
  resolveStoredName,
  submitBlockReason,
  updateDocumentType,
  validateDocumentFile,
  type DealDocumentRecord,
  type DocumentTypeRecord,
} from "./documents";
import { describeError } from "@/lib/supabaseError";

/** Builder mínimo do PostgREST: os filtros devolvem a própria cadeia e o
 *  `select()` do fim do delete/update resolve o resultado. É justamente o
 *  `select()` que distingue "apagou" de "RLS casou 0 linhas". */
function tabela(resultado: { data: unknown; error: unknown }) {
  const chain = {
    delete: vi.fn(() => chain),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    select: vi.fn(() => Promise.resolve(resultado)),
  };
  from.mockReturnValue(chain);
  return chain;
}

const type = (over: Partial<DocumentTypeRecord> = {}): DocumentTypeRecord => ({
  id: "t1",
  code: "rg_cpf",
  label: "RG / CPF",
  category: "identificacao",
  required_for_conversion: true,
  allows_multiple: false,
  naming_pattern: "{tipo}-{cliente}",
  sort_order: 1,
  ...over,
});

const doc = (over: Partial<DealDocumentRecord> = {}): DealDocumentRecord => ({
  id: "d1",
  deal_id: "deal-1",
  document_type_id: "t1",
  storage_path: "deal-1/1-x.pdf",
  original_name: "x.pdf",
  stored_name: "x.pdf",
  mime_type: "application/pdf",
  size_bytes: 10,
  version: 1,
  superseded_at: null,
  created_at: "2026-08-02T10:00:00Z",
  ...over,
});

const parts = { tipo: "rg_cpf", cliente: "João da Silva", negocio: "NEG-42", data: new Date(2026, 7, 2) };

describe("resolveStoredName", () => {
  it("aplica o naming_pattern e preserva a extensão", () => {
    expect(resolveStoredName("{tipo}-{cliente}", parts, "scan.PDF")).toBe("rg-cpf-joao-da-silva.pdf");
  });

  it("resolve {data} no formato ISO", () => {
    expect(resolveStoredName("{tipo}-{data}", parts, "a.jpg")).toBe("rg-cpf-2026-08-02.jpg");
  });

  it("resolve {negocio}", () => {
    expect(resolveStoredName("{tipo}-{negocio}", parts, "a.png")).toBe("rg-cpf-neg-42.png");
  });

  it("usa o padrão do banco quando o tipo não define um", () => {
    expect(resolveStoredName(null, parts, "a.pdf")).toBe("rg-cpf-joao-da-silva-2026-08-02.pdf");
  });

  it("remove placeholder desconhecido em vez de deixá-lo literal", () => {
    expect(resolveStoredName("{tipo}-{obra}-{cliente}", parts, "a.pdf")).toBe("rg-cpf-joao-da-silva.pdf");
  });

  it("aceita arquivo sem extensão", () => {
    expect(resolveStoredName("{tipo}", parts, "semponto")).toBe("rg-cpf");
  });

  it("não quebra quando o cliente é só pontuação", () => {
    const semNome = { ...parts, cliente: "***" };
    expect(resolveStoredName("{cliente}", semNome, "a.pdf")).toBe("sem-nome.pdf");
  });

  /**
   * `allows_multiple`: nenhum placeholder varia entre dois arquivos do mesmo
   * tipo, no mesmo negócio, no mesmo dia. Sem o sufixo, os dois viravam o mesmo
   * nome, a lista mostrava duas linhas idênticas e os dois "Baixar" entregavam
   * arquivos diferentes com o mesmo nome.
   */
  it("distingue anexos do tipo que aceita vários pelo nome original", () => {
    const a = resolveStoredName("{tipo}-{cliente}", parts, "Contrato Assinado.pdf", { distinguir: true });
    const b = resolveStoredName("{tipo}-{cliente}", parts, "Extrato 03.pdf", { distinguir: true });
    expect(a).toBe("rg-cpf-joao-da-silva-contrato-assinado.pdf");
    expect(b).toBe("rg-cpf-joao-da-silva-extrato-03.pdf");
    expect(a).not.toBe(b);
  });

  it("o tipo que versiona continua com o nome estável (sem sufixo)", () => {
    expect(resolveStoredName("{tipo}-{cliente}", parts, "scan.pdf")).toBe("rg-cpf-joao-da-silva.pdf");
  });
});

/**
 * O que trava o botão "Enviar ao gerente" — e escreve a frase ao lado dele.
 *
 * Estava sem teste nenhum, apesar de o comentário em `DealDocumentUpload`
 * afirmar que estava coberta aqui. A ordem importa: é a MESMA em que o banco
 * recusa, então a frase mostrada é sempre a da primeira recusa que aconteceria.
 */
describe("submitBlockReason", () => {
  const obrigatorio = type({ id: "t1" });
  const completo = { types: [obrigatorio], documents: [doc()], hasDeveloper: true, managerCount: 1 };

  it("libera o envio quando construtora, gerente e obrigatórios estão de pé", () => {
    expect(submitBlockReason(completo)).toBeNull();
  });

  it("catálogo inteiro desligado não vira 'dossiê pronto'", () => {
    // `missingRequiredTypes` devolve [] com catálogo vazio: sem este ramo a tela
    // dizia "pronto para o gerente conferir" sobre um negócio sem um anexo.
    expect(submitBlockReason({ ...completo, types: [], documents: [] })).toContain("religar o catálogo");
  });

  it("sem construtora manda consertar na aba Detalhes", () => {
    expect(submitBlockReason({ ...completo, hasDeveloper: false })).toContain("construtora");
  });

  it("sem gerente no rateio explica quem confere", () => {
    expect(submitBlockReason({ ...completo, managerCount: 0 })).toContain("gerente");
  });

  it("conta quantos obrigatórios faltam", () => {
    const outro = type({ id: "t2", code: "residencia" });
    expect(submitBlockReason({ ...completo, types: [obrigatorio, outro], documents: [] }))
      .toContain("2 tipo(s)");
  });

  it("a construtora vem antes do obrigatório: é a ordem em que o banco recusa", () => {
    expect(submitBlockReason({ ...completo, hasDeveloper: false, documents: [] }))
      .toContain("construtora");
  });

  /**
   * Mês fechado trava os DOIS botões. `review_deal_documents` aprova e chama
   * `submit_deal_for_analysis` na mesma transação, que move o negócio para "Em
   * análise" — e `deals_guard_closed_month` recusa a gravação inteira. Sem esta
   * regra o gerente clicava "Aprovar e enviar ao CCA" e recebia a mensagem crua
   * do gatilho em toast, depois de a tela ter prometido a ação.
   */
  it("mês fechado trava antes de tudo e diz qual é o mês", () => {
    const frase = submitBlockReason({ ...completo, closedMonth: "2026-08" });
    expect(frase).toContain("2026-08");
    expect(frase).toContain("reabrir o período");
  });

  it("mês aberto não inventa bloqueio", () => {
    expect(submitBlockReason({ ...completo, closedMonth: null })).toBeNull();
  });

  /**
   * A terceira razão do `useDealWriteLock`: a consulta de `closed_months`
   * pendente ou COM ERRO. A trava fecha do mesmo jeito — gravar sem essa
   * resposta é prometer o que o gatilho pode recusar — mas a frase não pode
   * afirmar que o mês está fechado, porque ninguém confirmou.
   */
  it("mês não confirmado bloqueia sem afirmar que está fechado", () => {
    const frase = submitBlockReason({ ...completo, unconfirmedMonth: "2026-08" });
    expect(frase).toContain("2026-08");
    expect(frase).toContain("Não consegui confirmar");
    expect(frase).not.toContain("reabrir o período");
  });

  it("mês fechado ganha do não confirmado: a recusa certa vem primeiro", () => {
    expect(submitBlockReason({ ...completo, closedMonth: "2026-08", unconfirmedMonth: "2026-08" }))
      .toContain("reabrir o período");
  });
});

describe("canAttachNow", () => {
  const base = { isAdmin: false, hasCcaReview: false };

  it("o corretor anexa enquanto o dossiê é dele", () => {
    expect(canAttachNow({ ...base, status: "draft" })).toBe(true);
    expect(canAttachNow({ ...base, status: "returned" })).toBe(true);
  });

  it("some depois do envio ao gerente: o dossiê vira prova", () => {
    expect(canAttachNow({ ...base, status: "pending" })).toBe(false);
    expect(canAttachNow({ ...base, status: "approved" })).toBe(false);
  });

  it("o CCA continua juntando documento com o dossiê já aprovado", () => {
    expect(canAttachNow({ ...base, hasCcaReview: true, status: "approved" })).toBe(true);
    expect(canAttachNow({ ...base, isAdmin: true, status: "pending" })).toBe(true);
  });
});

describe("missingRequiredTypes", () => {
  const obrigatorio = type({ id: "t1" });
  const opcional = type({ id: "t2", code: "ctps", required_for_conversion: false });

  it("aponta o obrigatório sem documento", () => {
    expect(missingRequiredTypes([obrigatorio, opcional], []).map((t) => t.id)).toEqual(["t1"]);
  });

  it("considera atendido quando há documento vigente", () => {
    expect(missingRequiredTypes([obrigatorio], [doc()])).toEqual([]);
  });

  it("ignora documento substituído — versão antiga não vale como entregue", () => {
    const antigo = doc({ superseded_at: "2026-08-02T11:00:00Z" });
    expect(missingRequiredTypes([obrigatorio], [antigo]).map((t) => t.id)).toEqual(["t1"]);
  });

  it("não cobra tipo opcional", () => {
    expect(missingRequiredTypes([opcional], [])).toEqual([]);
  });
});

describe("validateDocumentFile", () => {
  const arquivo = (name: string, size = 1024) => ({ name, size });

  it("aceita os formatos do dossiê", () => {
    for (const nome of ["rg.pdf", "foto.JPG", "renda.xlsx", "contrato.docx"]) {
      expect(validateDocumentFile(arquivo(nome))).toBeNull();
    }
  });

  it("recusa extensão fora da lista dizendo qual é", () => {
    expect(validateDocumentFile(arquivo("instalador.exe"))).toContain(".exe");
  });

  it("recusa arquivo sem extensão", () => {
    expect(validateDocumentFile(arquivo("semponto"))).toContain("sem extensão");
  });

  it("recusa arquivo vazio — anexo de 0 byte é engano, não documento", () => {
    expect(validateDocumentFile(arquivo("rg.pdf", 0))).toContain("vazio");
  });

  it("recusa acima do teto e diz o limite em MB", () => {
    expect(validateDocumentFile(arquivo("scan.pdf", MAX_DOCUMENT_BYTES + 1))).toContain("25 MB");
  });

  it("aceita exatamente o teto", () => {
    expect(validateDocumentFile(arquivo("scan.pdf", MAX_DOCUMENT_BYTES))).toBeNull();
  });
});

/**
 * As duas recusas próprias do módulo — as que o banco devolve como 204 de zero
 * linhas, sem erro. O `select()` já transformava isso em exceção, mas a frase
 * escrita para o operador morria no caminho: `describeError` devolve o
 * `fallback` quando o erro não tem `code`, e `new Error` não tem. O toast
 * mostrava "O documento continua no dossiê" para recusa de RLS e para queda de
 * rede — a mesma tela para causas diferentes.
 */
describe("recusa do banco chega em pt-BR na tela", () => {
  beforeEach(() => {
    from.mockReset();
    remove.mockReset().mockResolvedValue({ error: null });
  });

  it("exclusão barrada explica o motivo em vez do fallback genérico", async () => {
    tabela({ data: [], error: null });

    const erro = await deleteDealDocument({ id: "d1", deal_id: "deal-1", storage_path: "deal-1/x.pdf" })
      .then(() => null, (e: unknown) => e);

    expect(describeError(erro, "O documento continua no dossiê.")).toContain(
      "conferência do gerente",
    );
    // Recusou a linha: mexer no bucket depois disso apagaria o arquivo de um
    // registro que continua existindo.
    expect(remove).not.toHaveBeenCalled();
  });

  it("exclusão confirmada tira o arquivo do bucket", async () => {
    tabela({ data: [{ id: "d1" }], error: null });

    await deleteDealDocument({ id: "d1", deal_id: "deal-1", storage_path: "deal-1/x.pdf" });

    expect(remove).toHaveBeenCalledWith(["deal-1/x.pdf"]);
  });

  /**
   * Caminho fora do padrão `<deal_id>/…` — os 75 documentos da homologação
   * estão em `demo-showcase/…` e `seed/deals/…`, e o anexo promovido do lead
   * mora sob `<lead_id>/…`. A policy do bucket só os autoriza pelo ramo que
   * exige a LINHA em `deal_documents`: com a linha já apagada nada casa, o
   * `remove` volta recusado e o documento do cliente fica no bucket para sempre.
   */
  it("documento fora do padrão de caminho sai do bucket antes da linha", async () => {
    const ordem: string[] = [];
    remove.mockImplementation(async () => { ordem.push("bucket"); return { error: null }; });
    const chain = {
      delete: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      select: vi.fn(async () => { ordem.push("linha"); return { data: [{ id: "d1" }], error: null }; }),
    };
    from.mockReturnValue(chain);

    await deleteDealDocument({ id: "d1", deal_id: "deal-1", storage_path: "seed/deals/12/x.pdf" });

    expect(ordem).toEqual(["bucket", "linha"]);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("catálogo recusado nomeia a permissão que falta", async () => {
    tabela({ data: [], error: null });

    const erro = await updateDocumentType("t1", { active: false })
      .then(() => null, (e: unknown) => e);

    expect(describeError(erro, "O catálogo continua como estava.")).toContain("cca.review");
  });
});
