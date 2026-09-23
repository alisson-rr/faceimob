import { describe, expect, it } from "vitest";
import { linkDoPipeline, montarEmailDeMovimento } from "./email.ts";

const base = {
  deal_code: "NEG-155",
  client_name: "Maria Souza",
  stage_name: "APROVADO TOTAL",
  actor_name: "Ana da CCA",
  message: "Crédito aprovado.\nAgendar assinatura.",
};

describe("montarEmailDeMovimento", () => {
  it("identifica o movimento do Pipeline e preserva as duas mudanças", () => {
    const { subject, html } = montarEmailDeMovimento({ ...base, source: "pipeline",
      message: "Status 1: Proposta → Análise\nStatus 2: PROPOSTA → BACEN" });
    expect(subject).toBe("Pipeline NEG-155: APROVADO TOTAL");
    expect(html).toContain("Status 1: Proposta → Análise<br>Status 2: PROPOSTA → BACEN");
  });
  it("leva código, cliente, coluna, quem moveu e a mensagem, com o título do aviso", () => {
    const { subject, html } = montarEmailDeMovimento(base, "https://app.exemplo.com.br");
    expect(subject).toBe("Crédito NEG-155: APROVADO TOTAL");
    expect(html).toContain("Ana da CCA moveu o negócio <b>NEG-155</b> (Maria Souza) para <b>APROVADO TOTAL</b>");
    expect(html).toContain("Crédito aprovado.<br>Agendar assinatura.");
    expect(html).toContain('<a href="https://app.exemplo.com.br/pipeline">');
  });

  it("escapa o HTML de tudo que vem do usuário", () => {
    const { html } = montarEmailDeMovimento({
      deal_code: "<b>X</b>",
      client_name: "Zé & Cia",
      stage_name: '"><img src=x onerror=alert(1)>',
      actor_name: "<script>alert(1)</script>",
      message: "<a href='https://mal.example'>clique</a>",
    });
    expect(html).not.toMatch(/<script|<img|<a href='https:\/\/mal/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Zé &amp; Cia");
    expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;a href=&#39;https://mal.example&#39;&gt;clique&lt;/a&gt;");
  });

  it("assunto numa linha só e textos padrão quando falta dado", () => {
    const { subject, html } = montarEmailDeMovimento({
      ...base, deal_code: null, client_name: "", actor_name: null, stage_name: "EM\r\nANÁLISE",
    });
    expect(subject).toBe("Crédito negócio sem código: EM ANÁLISE");
    expect(html).toContain("Alguém moveu o negócio <b>negócio sem código</b> (cliente não informado)");
    expect(html).toContain("Abra o Pipeline no FACEIMOB e procure o negócio negócio sem código.");
  });
});

describe("linkDoPipeline", () => {
  it("só https, sem barra dobrada", () => {
    expect(linkDoPipeline("https://app.exemplo.com.br/")).toBe("https://app.exemplo.com.br/pipeline");
    expect(linkDoPipeline("https://exemplo.com.br/crm")).toBe("https://exemplo.com.br/crm/pipeline");
    expect(linkDoPipeline("http://app.exemplo.com.br")).toBeNull();
    expect(linkDoPipeline("javascript:alert(1)")).toBeNull();
    expect(linkDoPipeline("")).toBeNull();
    expect(linkDoPipeline(undefined)).toBeNull();
  });
});
