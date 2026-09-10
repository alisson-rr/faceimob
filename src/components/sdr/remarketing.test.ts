import { describe, expect, it } from "vitest";
import { chaveDeTelefone, disparoEmAndamento, lerContatos, MINUTOS_DE_TRAVA } from "./remarketing";

describe("chaveDeTelefone", () => {
  it("reduz máscara, espaço e DDI ao mesmo formato de normalize_phone", () => {
    expect(chaveDeTelefone("(11) 98888-1234")).toBe("5511988881234");
    expect(chaveDeTelefone("11 98888 1234")).toBe("5511988881234");
    expect(chaveDeTelefone("+55 (11) 98888-1234")).toBe("5511988881234");
    expect(chaveDeTelefone("1133334444")).toBe("551133334444");
  });

  it("telefone sem nenhum dígito não vira chave — quem recusa é o trigger", () => {
    expect(chaveDeTelefone("telefone não informado")).toBeNull();
    expect(chaveDeTelefone("")).toBeNull();
  });
});

describe("lerContatos", () => {
  it("telefone repetido com máscara diferente entra uma vez só", () => {
    // O defeito: `unique (list_id, phone)` levanta 23505, a importação é
    // atômica, e a planilha inteira era perdida com "Já existe um registro
    // com esses dados." — sem dizer qual linha.
    const { contatos, repetidos } = lerContatos([
      { nome: "Ana", fone: "(11) 98888-1234", campanha: "Retomada" },
      { nome: "Ana de novo", fone: "11988881234", campanha: "Retomada" },
      { nome: "Bruno", fone: "+55 11 97777-4321", campanha: "Retomada" },
    ]);
    expect(repetidos).toBe(1);
    expect(contatos.map(c => c.full_name)).toEqual(["Ana", "Bruno"]);
    // Fica o telefone CRU da primeira linha: normalizar é trabalho do trigger.
    expect(contatos[0].phone).toBe("(11) 98888-1234");
  });

  it("linha sem telefone é ignorada e telefone impossível segue para o banco", () => {
    const { contatos, repetidos } = lerContatos([
      { nome: "Sem fone", fone: "", campanha: "x" },
      { nome: "Fone impossível", fone: "telefone não informado", campanha: "x" },
    ]);
    expect(repetidos).toBe(0);
    expect(contatos).toHaveLength(1);
    expect(contatos[0].phone).toBe("telefone não informado");
  });

  it("aceita os apelidos de coluna e guarda a linha inteira em extra", () => {
    const { contatos } = lerContatos([
      { cliente: "Carla", celular: "21966661111", origem: "Feirão", empreendimento: "Torre A" },
    ]);
    expect(contatos[0].full_name).toBe("Carla");
    expect(contatos[0].extra.campaign).toBe("Feirão");
    expect(contatos[0].extra.empreendimento).toBe("Torre A");
  });
});

describe("disparoEmAndamento", () => {
  const agora = Date.parse("2026-09-05T12:00:00Z");
  const minutosAtras = (m: number) => new Date(agora - m * 60_000).toISOString();

  it("lista disparando agora bloqueia um segundo clique", () => {
    expect(disparoEmAndamento({ status: "running", updated_at: minutosAtras(1) }, agora)).toBe(true);
  });

  it("trava esquecida pela function morta no teto de tempo expira", () => {
    // Sem isso o botão "Disparar" ficava desabilitado para sempre e não havia
    // como destravar a lista pela tela.
    expect(disparoEmAndamento(
      { status: "running", updated_at: minutosAtras(MINUTOS_DE_TRAVA + 1) },
      agora,
    )).toBe(false);
  });

  it("lista que não está em running nunca bloqueia", () => {
    expect(disparoEmAndamento({ status: "draft", updated_at: minutosAtras(0) }, agora)).toBe(false);
    expect(disparoEmAndamento({ status: "failed", updated_at: null }, agora)).toBe(false);
  });

  it("sem data confiável, o conservador é tratar como em andamento", () => {
    expect(disparoEmAndamento({ status: "running", updated_at: null }, agora)).toBe(true);
  });
});
