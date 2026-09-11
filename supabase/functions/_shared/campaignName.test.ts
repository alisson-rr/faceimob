import { describe, expect, it } from "vitest";
import { lerNomeCampanha, montarNomeCampanha, normalizarParte, sugerirConstrutora } from "./campaignName.ts";

/**
 * O nome no padrão é o que liga a campanha da Meta à construtora sem ninguém
 * digitar nada. O defeito do padrão antigo era a colisão: só a primeira palavra
 * do cliente, e "Casa Nova" virava a mesma construtora que "Casa Bella".
 */
describe("montarNomeCampanha e lerNomeCampanha", () => {
  it("montar e depois ler faz a volta", () => {
    const nome = montarNomeCampanha({
      construtora: "Casa Nova Incorporadora", empreendimento: "Residencial Jardim", canal: "whatsapp",
    });
    expect(nome).toBe("CASA NOVA INCORPORADORA | RESIDENCIAL JARDIM | WHATSAPP");
    expect(lerNomeCampanha(nome)).toEqual({
      construtora: "CASA NOVA INCORPORADORA", empreendimento: "RESIDENCIAL JARDIM", canal: "whatsapp",
    });

    const semEmpreendimento = montarNomeCampanha({ construtora: "Casa Nova", canal: "landing_page" });
    expect(semEmpreendimento).toBe("CASA NOVA | LP");
    expect(lerNomeCampanha(semEmpreendimento)).toEqual({ construtora: "CASA NOVA", empreendimento: null, canal: "landing_page" });
  });

  it("acento e '|' saem de dentro das partes", () => {
    expect(montarNomeCampanha({ construtora: "Construtora  Ávila | Filhos", empreendimento: "São João", canal: "formulario" }))
      .toBe("CONSTRUTORA AVILA FILHOS | SAO JOAO | FORMULARIO");
    expect(normalizarParte("  ação   çedilha ")).toBe("ACAO CEDILHA");
  });

  it("o sufixo livre é ignorado na leitura", () => {
    const nome = montarNomeCampanha({ construtora: "Casa Nova", empreendimento: "Jardim", canal: "whatsapp", sufixo: "v2 | teste" });
    expect(nome).toBe("CASA NOVA | JARDIM | WHATSAPP | V2 TESTE");
    expect(lerNomeCampanha(nome)).toEqual({ construtora: "CASA NOVA", empreendimento: "JARDIM", canal: "whatsapp" });
    expect(lerNomeCampanha("CASA NOVA | LP | versao 3")).toEqual({ construtora: "CASA NOVA", empreendimento: null, canal: "landing_page" });
  });

  it("lê nome digitado à mão, em minúsculas e com acento", () => {
    expect(lerNomeCampanha("casa nova | residencial jardim | whatsapp")?.construtora).toBe("CASA NOVA");
  });

  it("nome fora do padrão devolve null", () => {
    for (const nome of [
      "AG DG IMOB | CASA | PRODUTO | WHATSAPP", "Campanha de agosto", "CASA NOVA", "CASA | JARDIM | TRAFEGO", "| WHATSAPP", "",
    ]) {
      expect(lerNomeCampanha(nome), nome).toBeNull();
    }
  });

  it("recusa o que deixaria o nome sem construtora ou ambíguo", () => {
    expect(() => montarNomeCampanha({ construtora: "  ", canal: "whatsapp" })).toThrow(/construtora/);
    expect(() => montarNomeCampanha({ construtora: "Casa", empreendimento: "lp", canal: "formulario" })).toThrow(/ambíguo/);
  });
});

describe("sugerirConstrutora", () => {
  const construtoras = [{ id: "c1", name: "Casa Nova" }, { id: "c2", name: "Casa Bella" }];

  it("'Casa Nova' e 'Casa Bella' não colidem: o nome inteiro decide", () => {
    expect(sugerirConstrutora("CASA NOVA | JARDIM | WHATSAPP", construtoras)).toBe("c1");
    expect(sugerirConstrutora("CASA BELLA | LP | v2", construtoras)).toBe("c2");
    expect(sugerirConstrutora("CASA | LP", construtoras)).toBeNull();
  });

  it("sem padrão, sem construtora ou com duas iguais: nenhuma sugestão", () => {
    expect(sugerirConstrutora("Campanha de agosto", construtoras)).toBeNull();
    expect(sugerirConstrutora("OUTRA | WHATSAPP", construtoras)).toBeNull();
    expect(sugerirConstrutora("CASA NOVA | WHATSAPP", [...construtoras, { id: "c3", name: "Casa  Nova" }])).toBeNull();
  });
});
