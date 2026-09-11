import { describe, expect, it } from "vitest";
import { AVISO_ACEITE, codigoDoErroMeta, descreverFalhaMeta, explicarErroMeta } from "./metaErros.ts";

/**
 * O que a Meta recusou, em português.
 *
 * O teste que importa aqui não é "traduz 131047" — é o contrário: **código
 * desconhecido não pode ganhar explicação inventada**. Uma tradução plausível
 * para um código novo manda a operação para o lado errado com ar de certeza,
 * que é pior do que mostrar o JSON feio da Meta.
 */
describe("explicarErroMeta", () => {
  it("traduz a janela de 24 h, que é a recusa mais comum do remarketing", () => {
    const erro = explicarErroMeta({ error: { code: 131047, message: "(#131047) Re-engagement message" } });
    expect(erro?.titulo).toBe("Janela de 24 horas fechada");
    expect(erro?.proximo_passo).toMatch(/template aprovado/i);
    // Repetir o mesmo texto livre não muda nada: o que precisa mudar é a mensagem.
    expect(erro?.vale_repetir).toBe(false);
  });

  it("separa o que adianta repetir do que não adianta", () => {
    // Limite de ritmo passa sozinho; regra de janela e template, não.
    expect(explicarErroMeta({ error: { code: 80007 } })?.vale_repetir).toBe(true);
    expect(explicarErroMeta({ error: { code: 4 } })?.vale_repetir).toBe(true);
    expect(explicarErroMeta({ error: { code: 132001 } })?.vale_repetir).toBe(false);
    expect(explicarErroMeta({ error: { code: 190 } })?.vale_repetir).toBe(false);
  });

  it("código desconhecido devolve null em vez de inventar explicação", () => {
    expect(explicarErroMeta({ error: { code: 999999, message: "algo novo" } })).toBeNull();
    expect(explicarErroMeta({})).toBeNull();
    expect(explicarErroMeta(null)).toBeNull();
    expect(explicarErroMeta("não é objeto")).toBeNull();
  });
});

describe("codigoDoErroMeta", () => {
  it("acha o código nos três lugares em que a Meta o esconde", () => {
    expect(codigoDoErroMeta({ error: { code: 131026 } })).toBe(131026);
    expect(codigoDoErroMeta({ statuses: [{ errors: [{ code: 131047 }] }] })).toBe(131047);
    // O webhook de entrega, que é onde chega a falha DEFINITIVA — ler só o
    // primeiro formato deixava justamente esse caso sem explicação.
    expect(
      codigoDoErroMeta({ entry: [{ changes: [{ value: { statuses: [{ errors: [{ code: 130497 }] }] } }] }] }),
    ).toBe(130497);
  });

  it("não confunde ausência de erro com código zero", () => {
    expect(codigoDoErroMeta({ error: { message: "sem código" } })).toBeNull();
    expect(codigoDoErroMeta({ messages: [{ id: "wamid.x" }] })).toBeNull();
  });
});

describe("descreverFalhaMeta", () => {
  it("devolve a frase útil quando conhece o código", () => {
    const texto = descreverFalhaMeta({ error: { code: 131047 } });
    expect(texto).toContain("Janela de 24 horas fechada");
    expect(texto).toContain("→");
  });

  it("devolve a mensagem CRUA da Meta quando não conhece — feia, mas verdadeira", () => {
    const texto = descreverFalhaMeta({ error: { code: 987654, message: "Unsupported post request" } });
    expect(texto).toBe("A Meta recusou: Unsupported post request");
  });

  it("cabe no campo: nunca passa de 400 caracteres", () => {
    const gigante = { error: { code: 987654, message: "x".repeat(5000) } };
    expect(descreverFalhaMeta(gigante).length).toBeLessThanOrEqual(400);
    expect(descreverFalhaMeta({ lixo: "y".repeat(5000) }).length).toBeLessThanOrEqual(400);
  });
});

/**
 * Marketing API: sincronizar, pausar e mudar verba. Um caso por código novo —
 * cada grupo manda a operação para um lado diferente (permissão, espera, valor,
 * versão), e é isso que a frase precisa acertar. Todos com o contexto
 * "anuncios", que é o que metaGraph.ts passa: sem ele, o número é o do WhatsApp.
 */
describe("erros da Marketing API", () => {
  it.each([10, 200, 294])("código %i: token sem permissão de anúncios, e repetir não adianta", (code) => {
    const erro = explicarErroMeta({ error: { code, message: "(#200) Permissions error" } }, "anuncios");
    expect(erro?.titulo).toBe("Token sem permissão para anúncios");
    expect(erro?.proximo_passo).toMatch(/ads_management/);
    expect(erro?.vale_repetir).toBe(false);
  });

  it.each([4, 17, 613, 80004])("código %i: limite de chamadas, passa esperando", (code) => {
    const erro = explicarErroMeta({ error: { code } }, "anuncios");
    expect(erro?.titulo).toBe("Limite de chamadas da Marketing API");
    // O 4 do catálogo comum manda clicar em Disparar, botão que só o remarketing tem.
    expect(erro?.proximo_passo).not.toMatch(/Disparar/);
    expect(erro?.vale_repetir).toBe(true);
  });

  it("código que não é só de anúncio continua traduzido no contexto de anúncios", () => {
    // Token expirado é a falha mais comum da sincronização; o catálogo à parte não pode escondê-la.
    expect(explicarErroMeta({ error: { code: 190 } }, "anuncios")?.titulo).toBe("Token de acesso expirado ou inválido");
  });

  it("código 100: diz que um valor foi recusado e QUAL, pela frase da Meta", () => {
    const texto = descreverFalhaMeta(
      {
        error: { code: 100, message: "(#100) Invalid parameter", error_user_msg: "O orçamento diário está abaixo do mínimo." },
      },
      "anuncios",
    );
    expect(texto).toMatch(/^A Meta recusou um valor enviado/);
    expect(texto).toContain("(Meta: O orçamento diário está abaixo do mínimo.)");
    expect(texto.length).toBeLessThanOrEqual(400);
    // Sem a frase para gente, fica a técnica — melhor que nenhuma.
    expect(descreverFalhaMeta({ error: { code: 100, message: "(#100) Invalid parameter" } }, "anuncios")).toContain(
      "(Meta: (#100) Invalid parameter)",
    );
    expect(explicarErroMeta({ error: { code: 100 } }, "anuncios")?.vale_repetir).toBe(false);
  });

  it("código 2635: versão desativada diz onde se troca", () => {
    const erro = explicarErroMeta(
      { error: { code: 2635, message: "(#2635) You are calling a deprecated version of the Ads API." } },
      "anuncios",
    );
    expect(erro?.titulo).toBe("Versão da Marketing API desativada");
    expect(erro?.proximo_passo).toContain("META_GRAPH");
  });

  it("a frase que o cliente da Marketing API já lançou passa direto", () => {
    // metaGraph.ts lança MetaApiError com a frase pronta; timeout e rede chegam como Error.
    expect(descreverFalhaMeta(new Error("A Meta não respondeu em 30 s."))).toBe("A Meta não respondeu em 30 s.");
  });
});

/**
 * O mesmo número fora dos anúncios. A WhatsApp Cloud API usa 100 para parâmetro
 * inválido e 10/200 para falta de permissão: o disparo de template do
 * remarketing (que chama sem contexto) não pode receber orientação de verba nem
 * de ads_management, e volta à mensagem crua da Meta, como antes da integração.
 */
describe("sem contexto de anúncios (WhatsApp)", () => {
  it("parâmetro de template inválido não fala de verba e mantém o detalhe da Meta", () => {
    const texto = descreverFalhaMeta({ error: { code: 100, message: "(#100) Invalid parameter" } });
    expect(texto).toBe("A Meta recusou: (#100) Invalid parameter");
    expect(texto).not.toMatch(/verba|valor enviado/i);
  });

  it.each([10, 200, 294, 17, 613, 80004, 2635])("código %i não recebe a explicação da Marketing API", (code) => {
    expect(explicarErroMeta({ error: { code } })).toBeNull();
    const texto = descreverFalhaMeta({ error: { code, message: `(#${code}) Permission denied` } });
    expect(texto).toBe(`A Meta recusou: (#${code}) Permission denied`);
    expect(texto).not.toMatch(/ads_management|anúncio/i);
  });
});

describe("AVISO_ACEITE", () => {
  it("diz que o 200 é aceite e não entrega", () => {
    // A tela que escreve "enviado" no 200 mente por omissão: a falha definitiva
    // chega depois, pelo webhook de status.
    expect(AVISO_ACEITE).toMatch(/aceite/i);
    expect(AVISO_ACEITE).toMatch(/webhook/i);
  });
});
