import { describe, expect, it } from "vitest";
import { INTEGRATION_SLOTS, lerRemetentesDaSonda, slotKey, validarCredencial } from "./integrationCatalog";

/**
 * A regressão que este arquivo trava foi medida no banco, não imaginada: em
 * 02/09/2026 `brevo/sender_email` guardava a MESMA string de 89 caracteres
 * começando com `xkey` que estava em `brevo/api_key` — a chave de API colada
 * duas vezes. O cofre aceitou, a tela continuou dizendo "configurado", e o
 * envio do dossiê falhava na Brevo com "remetente inválido", num log que
 * ninguém lê. Como o cofre nunca devolve o valor gravado, a tela de salvar é a
 * única fronteira que enxerga o que a pessoa colou.
 */
describe("validarCredencial", () => {
  it("recusa chave de API no campo de e-mail — o caso que aconteceu de verdade", () => {
    const chaveDeApi = `xkeysib-${"a".repeat(81)}`;
    expect(validarCredencial("email", chaveDeApi)).toMatch(/não parece um e-mail/i);
  });

  it("aceita o endereço verificado", () => {
    expect(validarCredencial("email", "dossie@faceimob.com.br")).toBeNull();
    expect(validarCredencial("email", "  contato@sub.dominio.com  ")).toBeNull();
  });

  it("campo sem formato declarado aceita qualquer token não vazio", () => {
    // Chave de terceiro não tem forma estável: inventar regra aqui reprovaria
    // credencial boa no dia em que o provedor mudar o prefixo.
    expect(validarCredencial(undefined, "sk-qualquer-coisa")).toBeNull();
    expect(validarCredencial("token", "xkeysib-abc")).toBeNull();
  });

  it("valor em branco é recusado em qualquer formato", () => {
    expect(validarCredencial("email", "   ")).toBe("Informe um valor.");
    expect(validarCredencial(undefined, "")).toBe("Informe um valor.");
  });

  it("URL exige https — http exporia a service role key em trânsito", () => {
    expect(validarCredencial("url", "https://x.supabase.co/functions/v1")).toBeNull();
    expect(validarCredencial("url", "http://x.supabase.co/functions/v1")).toMatch(/https/i);
    expect(validarCredencial("url", "x.supabase.co")).toMatch(/não parece uma URL/i);
  });

  it("phone number id da Meta é só dígitos — colar o número com máscara não serve", () => {
    expect(validarCredencial("digits", "123456789012345")).toBeNull();
    expect(validarCredencial("digits", "+55 (11) 99999-9999")).toMatch(/só números/i);
  });
});

describe("catálogo de credenciais", () => {
  it("não tem slot repetido", () => {
    const chaves = INTEGRATION_SLOTS.map((s) => slotKey(s.provider, s.label));
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("os campos de forma conhecida estão marcados", () => {
    const porChave = new Map(INTEGRATION_SLOTS.map((s) => [slotKey(s.provider, s.label), s]));
    expect(porChave.get("brevo::sender_email")?.formato).toBe("email");
    expect(porChave.get("supabase::functions_url")?.formato).toBe("url");
    expect(porChave.get("meta::whatsapp_phone_number_id")?.formato).toBe("digits");
  });

  it("todo slot diz quem o consome e para quê", () => {
    for (const slot of INTEGRATION_SLOTS) {
      expect(slot.usedBy.trim(), `usedBy de ${slot.provider}/${slot.label}`).not.toBe("");
      expect(slot.help.trim(), `help de ${slot.provider}/${slot.label}`).not.toBe("");
    }
  });
});

/**
 * A lista de remetentes é o caminho de saída de "remetente inválido": a Brevo
 * só aceita endereço verificado na conta dela, e até a sonda trazer
 * `/v3/senders` o admin recebia a recusa sem nenhuma pista do que gravar.
 * Como o payload vem da rede, o que ele traz não é presumido.
 */
describe("lerRemetentesDaSonda", () => {
  it("lê os endereços e o estado de verificação", () => {
    expect(
      lerRemetentesDaSonda({
        ok: false,
        remetentes: [
          { email: "dossie@faceimob.com.br", ativo: true },
          { email: "sem-verificar@faceimob.com.br", ativo: false },
        ],
      }),
    ).toEqual([
      { email: "dossie@faceimob.com.br", ativo: true },
      { email: "sem-verificar@faceimob.com.br", ativo: false },
    ]);
  });

  it("nunca deixa passar o que não é e-mail — a chave de API não pode virar remetente na tela", () => {
    const chaveDeApi = `xkeysib-${"a".repeat(81)}`;
    expect(lerRemetentesDaSonda({ remetentes: [{ email: chaveDeApi, ativo: true }] })).toEqual([]);
  });

  it("sonda sem lista (sem chave, 401, provedor fora) não vira lista falsa", () => {
    // A sonda continua respondendo o veredito mesmo quando /v3/senders falha;
    // a tela não pode inventar remetentes por causa disso.
    expect(lerRemetentesDaSonda({ ok: false, error: "A Brevo recusou a chave de API." })).toEqual([]);
    expect(lerRemetentesDaSonda(null)).toEqual([]);
    expect(lerRemetentesDaSonda(undefined)).toEqual([]);
    expect(lerRemetentesDaSonda({ remetentes: "dossie@faceimob.com.br" })).toEqual([]);
  });

  it("item malformado é descartado sem derrubar os demais", () => {
    expect(
      lerRemetentesDaSonda({
        remetentes: [null, { ativo: true }, { email: 42 }, { email: " ok@faceimob.com.br " }],
      }),
    ).toEqual([{ email: "ok@faceimob.com.br", ativo: false }]);
  });
});
