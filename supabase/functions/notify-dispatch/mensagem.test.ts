import { describe, expect, it } from "vitest";
import { ASSINATURA, montarMensagemWhatsApp } from "./mensagem.ts";

describe("montarMensagemWhatsApp", () => {
  it("emoji pelo tipo, título em negrito, texto e assinatura", () => {
    expect(montarMensagemWhatsApp({
      kind: "lead_assigned", title: "Novo lead atribuído", body: "Teste acabou de cair para você.",
    })).toBe(`🔔 *Novo lead atribuído*\n\nTeste acabou de cair para você.\n\n${ASSINATURA}`);
  });

  it("sem texto, só título e assinatura", () => {
    expect(montarMensagemWhatsApp({ kind: "document_review_approved", title: "Documentos aprovados: JOAO" }))
      .toBe(`📄 *Documentos aprovados: JOAO*\n\n${ASSINATURA}`);
  });

  it("título que já tem emoji não ganha outro; tipo desconhecido usa o sino", () => {
    expect(montarMensagemWhatsApp({ kind: "meta_resumo_diario", title: "📊 Resumo do dia" }))
      .toBe(`*📊 Resumo do dia*\n\n${ASSINATURA}`);
    expect(montarMensagemWhatsApp({ kind: "outro", title: "Aviso" })).toBe(`🔔 *Aviso*\n\n${ASSINATURA}`);
  });
});
