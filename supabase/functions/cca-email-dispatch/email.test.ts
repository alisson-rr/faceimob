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
  const detalhes = {
    codigo: "NEG-001227", cliente: "JULYA DE PAIVA SCAPIN", cpf: "04367223051",
    empreendimento: "ACQUA DANUBIO", construtora: "Morana", status1: "PROPOSTA",
    status2: "ESTEIRA AGIL", status2_tom: "info", status2_antes: "ANÁLISE",
    corretor1: "Tabhata Nobre", gerente1: "Archimedes Boff", quando: "28/09/2026 às 11:40",
    observacao: "favor reanalizar",
  };

  it("assunto no formato do cliente, sem posições vazias, com CPF completo", () => {
    const { subject } = montarEmailDeMovimento({ ...base, source: "pipeline", detalhes });
    expect(subject).toBe(
      "ESTEIRA AGIL | JULYA DE PAIVA SCAPIN | 043.672.230-51 | ACQUA DANUBIO | Tabhata Nobre | Archimedes Boff",
    );
  });

  it("aviso da conferência (0203): o evento em destaque, a mensagem do envio e o selo Conferência", () => {
    const { subject, html } = montarEmailDeMovimento({
      ...base, source: "conferencia", stage_name: "Análise enviada para conferência",
      message: "ENVIO ESTEIRA ÁGIL: dossiê completo",
      detalhes: { ...detalhes, status2: "Análise enviada para conferência", observacao: "ENVIO ESTEIRA ÁGIL: dossiê completo" },
    });
    expect(subject.startsWith("Análise enviada para conferência | JULYA DE PAIVA SCAPIN")).toBe(true);
    expect(html).toContain("Conferência · NEG-001227");
    expect(html).toContain("ENVIO ESTEIRA ÁGIL: dossiê completo");
  });

  it("corpo com Status 2 em destaque, antes, Status 1, dados, observação, logo e link", () => {
    const { html } = montarEmailDeMovimento({ ...base, source: "pipeline", detalhes }, "https://app.exemplo.com.br");
    expect(html).toContain(">ESTEIRA AGIL</span>");
    expect(html).toContain(">ANÁLISE</span>");
    expect(html).toContain("<b style=\"color:#1b2a4a;\">PROPOSTA</b>");
    expect(html).toContain("043.672.230-51");
    expect(html).toContain("Tabhata Nobre");
    expect(html).toContain("favor reanalizar");
    expect(html).toContain('src="https://app.exemplo.com.br/email/logo-faceimob-branco.png"');
    expect(html).toContain('<a href="https://app.exemplo.com.br/pipeline"');
    expect(html).not.toContain("Corretor 2");
  });

  it("leva o último comentário do negócio, com autor e data, sem repetir a observação (0217)", () => {
    const comComentario = {
      ...detalhes, ultimo_comentario: "Cliente vai mandar holerite amanhã",
      ultimo_comentario_autor: "Tabhata Nobre", ultimo_comentario_quando: "03/10/2026 às 18:02",
    };
    const { html } = montarEmailDeMovimento({ ...base, source: "pipeline", detalhes: comComentario });
    expect(html).toContain("ÚLTIMO COMENTÁRIO");
    expect(html).toContain("Cliente vai mandar holerite amanhã");
    expect(html).toContain("Tabhata Nobre · 03/10/2026 às 18:02");

    const repetido = montarEmailDeMovimento({
      ...base, source: "pipeline", detalhes: { ...detalhes, ultimo_comentario: "ESTEIRA AGIL: favor reanalizar" },
    });
    expect(repetido.html).not.toContain("ÚLTIMO COMENTÁRIO");
  });

  it("CCA: a mensagem da análise vira a observação", () => {
    const { html } = montarEmailDeMovimento({ ...base, detalhes: { ...detalhes, observacao: undefined } });
    expect(html).toContain("Crédito aprovado.<br>Agendar assinatura.");
    expect(html).toContain("Crédito · NEG-001227");
  });

  it("escapa o HTML de tudo que vem do usuário", () => {
    const { html, subject } = montarEmailDeMovimento({
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
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it("sem dados do negócio e sem endereço do app, cai nos textos padrão", () => {
    const { subject, html } = montarEmailDeMovimento({
      ...base, deal_code: null, client_name: "", actor_name: null, stage_name: "EM\r\nANÁLISE",
    });
    expect(subject).toBe("EM ANÁLISE");
    expect(html).toContain("Cliente não informado");
    expect(html).toContain("Abra o Pipeline no FACEIMOB e procure o negócio negócio sem código.");
    expect(html).not.toContain("<img");
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
