import { describe, expect, it } from "vitest";
import { preencherMensagem, primeiroNome, saudacao } from "./mensagensProntas";

// Horas de Brasília (UTC-3): 12:00Z = 09h, 18:00Z = 15h, 23:30Z = 20h30.
describe("mensagens prontas", () => {
  it("cumprimenta pela hora de Brasília", () => {
    expect(saudacao(new Date("2026-10-03T12:00:00Z"))).toBe("Bom dia");
    expect(saudacao(new Date("2026-10-03T18:00:00Z"))).toBe("Boa tarde");
    expect(saudacao(new Date("2026-10-03T23:30:00Z"))).toBe("Boa noite");
    expect(saudacao(new Date("2026-10-04T04:00:00Z"))).toBe("Boa noite");
  });

  it("pega o primeiro nome arrumado", () => {
    expect(primeiroNome("NELSON tranquilin")).toBe("Nelson");
    expect(primeiroNome("zoraide_silveira")).toBe("Zoraide");
    expect(primeiroNome("  ")).toBe("");
  });

  it("troca as três variáveis e deixa o resto", () => {
    const texto = "{saudacao}, {primeiro_nome}! Aqui é {corretor} da Faceimob. {outra}";
    expect(preencherMensagem(texto, { cliente: "joão silva", corretor: "Dai", agora: new Date("2026-10-03T23:30:00Z") }))
      .toBe("Boa noite, João! Aqui é Dai da Faceimob. {outra}");
  });
});
