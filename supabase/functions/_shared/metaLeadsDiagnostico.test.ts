import { describe, expect, it } from "vitest";
import { diagnosticarLeadsMeta, type FatosDaMeta } from "./metaLeadsDiagnostico";

const tudoCerto: FatosDaMeta = {
  pausado: false,
  temAppSecret: true,
  temVerifyToken: true,
  temPageToken: true,
  token: { tipo: "page", nome: "Face Imob" },
  assinaturas: [{ nome: "FACEIMOB CRM", campos: ["leadgen"] }],
  leituraDeLead: { ok: true },
  ultimaChamada: { em: "2026-09-29T12:00:00Z", resultado: "aceito" },
  ultimoLeadEm: "2026-09-29T12:00:00Z",
};

const porId = (fatos: FatosDaMeta) => new Map(diagnosticarLeadsMeta(fatos).map((c) => [c.id, c]));

describe("diagnosticarLeadsMeta", () => {
  it("corrente inteira de pé: nada reprovado", () => {
    expect(diagnosticarLeadsMeta(tudoCerto).filter((c) => c.ok === false)).toEqual([]);
  });

  it("página sem leadgen no app é o elo que falta", () => {
    const c = porId({ ...tudoCerto, assinaturas: [{ nome: "Outro app", campos: ["feed"] }] }).get("assinatura");
    expect(c?.ok).toBe(false);
    expect(c?.detalhe).toContain("NÃO assinada");
  });

  it("token de usuário no lugar do token da página reprova", () => {
    expect(porId({ ...tudoCerto, token: { tipo: "user", nome: "Fulano" } }).get("page_token")?.ok).toBe(false);
  });

  it("assinatura recusada aponta o app secret de outro app", () => {
    const c = porId({ ...tudoCerto, ultimaChamada: { em: "2026-09-29T12:00:00Z", resultado: "assinatura_invalida" } })
      .get("ultima_chamada");
    expect(c?.ok).toBe(false);
    expect(c?.detalhe).toContain("app secret");
  });

  it("sem chamada registrada não é aprovado nem reprovado", () => {
    expect(porId({ ...tudoCerto, ultimaChamada: null }).get("ultima_chamada")?.ok).toBeNull();
  });

  it("pausa ligada e cofre vazio reprovam", () => {
    const c = porId({ ...tudoCerto, pausado: true, temAppSecret: false, temPageToken: false, token: null, assinaturas: null });
    expect(c.get("pausa")?.ok).toBe(false);
    expect(c.get("app_secret")?.ok).toBe(false);
    expect(c.get("page_token")?.ok).toBe(false);
    expect(c.has("assinatura")).toBe(false);
  });
});
