// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { montarNomeCampanha } from "../_shared/campaignName.ts";
import {
  type BuscaDeInteresses,
  type Contexto,
  lerEntrada,
  montarPlano,
  montarPrompt,
  palavrasDeInteresse,
} from "./plano.ts";

/**
 * O planejador. O que se trava aqui é o que o sistema antigo errava: ID de
 * interesse e nome inventados pela IA, idade e gênero num anúncio de imóvel, o
 * link do produto baixado pelo servidor (SSRF) e número de resultado que a IA
 * "estimava".
 */

const CTX: Contexto = {
  developer_id: "11111111-1111-4111-8111-111111111111",
  project_id: "22222222-2222-4222-8222-222222222222",
  padrao: "mcmv",
  formato: "imagem",
  canal: "formulario",
  verba_diaria: 50,
  link: "https://exemplo.com.br/residencial-sol",
  observacoes: "Entrada parcelada em 60x.",
  construtora: "Construtora Alfa",
  empreendimento: "Residencial Sol",
  cidade: "Canoas",
  uf: "RS",
};

const texto = (n: number) => ({ texto: `Texto ${n} do anúncio.`, titulo: `Título ${n}`, descricao: `Descrição ${n}`, cta: "SIGN_UP" });

const saida = (extra: Record<string, unknown> = {}) => ({
  titulo: "Seu apê com entrada facilitada",
  publico: { localizacao: "Canoas", raio_km: 15, descricao: "Quem busca o primeiro imóvel." },
  palavras_interesse: ["imóveis", "financiamento imobiliário", "casa própria"],
  textos: [texto(1), texto(2), texto(3)],
  verba_sugerida: 60,
  justificativa_verba: "Cabe num teste inicial.",
  ...extra,
});

const meta = (id: string, name: string) => ({ id, name, audience_size_lower_bound: 1000, audience_size_upper_bound: 2000 });
const busca = (pares: [string, unknown][], aviso: string | null = null): BuscaDeInteresses => ({
  porPalavra: new Map(pares),
  aviso,
});

describe("montarPlano", () => {
  it("ignora nome e IDs de interesse vindos da IA: só entra o que a busca da Meta devolveu", () => {
    const plano = montarPlano(
      saida({ nome: "NOME DA IA", campaign_name: "NOME DA IA", interesses: [{ id: "999", name: "Inventado pela IA" }] }),
      CTX,
      busca([["imóveis", [meta("6003", "Imóveis")]], ["financiamento imobiliário", []]]),
    );

    expect(plano.nome).toBe(
      montarNomeCampanha({ construtora: "Construtora Alfa", empreendimento: "Residencial Sol", canal: "formulario" }),
    );
    expect(plano.interesses).toEqual([{ id: "6003", name: "Imóveis", audiencia_min: 1000, audiencia_max: 2000 }]);
    // "financiamento" a Meta não achou; "casa própria" nem foi buscada.
    expect(plano.interesses_nao_validados).toBe(2);
    expect(JSON.stringify(plano)).not.toContain("999");
    expect(JSON.stringify(plano)).not.toContain("NOME DA IA");
  });

  it("item da busca sem ID numérico não entra, e o mesmo interesse não entra duas vezes", () => {
    const plano = montarPlano(
      saida({ palavras_interesse: ["imóveis", "apartamento"] }),
      CTX,
      busca([
        ["imóveis", [{ id: "abc", name: "Falso" }, meta("6003", "Imóveis")]],
        ["apartamento", [meta("6003", "Imóveis"), meta("6004", "Apartamento")]],
      ]),
    );
    expect(plano.interesses.map((i) => i.id)).toEqual(["6003", "6004"]);
    expect(plano.interesses_nao_validados).toBe(0);
  });

  it("HOUSING sempre; idade, gênero e exclusões fora; título cortado em 40 e descrição em 30", () => {
    const plano = montarPlano(
      saida({
        categoria_especial: "NONE",
        objetivo: "OUTCOME_SALES",
        idade_min: 18,
        generos: [1],
        publico: {
          localizacao: "Canoas",
          raio_km: 15,
          descricao: "Famílias.",
          idade_min: 25,
          idade_max: 45,
          genero: "mulheres",
          exclusoes: ["quem já comprou"],
        },
        textos: [{ ...texto(1), titulo: "T".repeat(60), descricao: "D".repeat(50) }, texto(2), texto(3)],
      }),
      CTX,
      busca([]),
    );

    expect(plano.categoria_especial).toBe("HOUSING");
    expect(plano.objetivo).toBe("OUTCOME_LEADS");
    expect(Object.keys(plano.publico).sort()).toEqual(["descricao", "localizacao", "raio_km"]);
    expect(JSON.stringify(plano)).not.toMatch(/idade|genero|exclus/i);
    expect(plano.publico.localizacao).toBe("Canoas/RS");
    expect(plano.textos[0].titulo).toHaveLength(40);
    expect(plano.textos[0].descricao).toHaveLength(30);
  });

  it("sem token: nenhum interesse, o número de palavras não validadas e o motivo", () => {
    const plano = montarPlano(saida(), CTX, busca([], "Sem token da Marketing API."));
    expect(plano.interesses).toEqual([]);
    expect(plano.interesses_nao_validados).toBe(3);
    expect(plano.interesses_aviso).toBe("Sem token da Marketing API.");
  });

  it("recusa mais ou menos de 3 textos, e texto sem título", () => {
    expect(() => montarPlano(saida({ textos: [texto(1), texto(2)] }), CTX, busca([]))).toThrow(/2 textos em vez de 3/);
    expect(() => montarPlano(saida({ textos: [texto(1), texto(2), texto(3), texto(4)] }), CTX, busca([]))).toThrow(
      /4 textos em vez de 3/,
    );
    expect(() => montarPlano(saida({ textos: [texto(1), { ...texto(2), titulo: " " }, texto(3)] }), CTX, busca([]))).toThrow(
      /texto 2/,
    );
  });

  it("objetivo e botão saem do canal; verba e raio fora do formato viram vazio, nunca um número escolhido aqui", () => {
    const plano = montarPlano(
      saida({
        textos: [{ ...texto(1), cta: "BUY_NOW" }, { ...texto(2), cta: "LEARN_MORE" }, texto(3)],
        verba_sugerida: "60",
        publico: { raio_km: 500 },
      }),
      { ...CTX, canal: "whatsapp" },
      busca([]),
    );
    expect(plano.objetivo).toBe("OUTCOME_ENGAGEMENT");
    expect(plano.textos.map((t) => t.cta)).toEqual(["WHATSAPP_MESSAGE", "LEARN_MORE", "WHATSAPP_MESSAGE"]);
    expect(plano.verba_sugerida).toBeNull();
    expect(plano.publico.raio_km).toBeNull();
    expect(plano.nome).toMatch(/\| WHATSAPP$/);
  });

  it("palavras de interesse: sem repetição, só texto e no máximo 10", () => {
    const palavras = palavrasDeInteresse({
      palavras_interesse: ["Imóveis", "imóveis", " ", 3, ...Array.from({ length: 12 }, (_, i) => `tema ${i}`)],
    });
    expect(palavras).toHaveLength(10);
    expect(palavras[0]).toBe("Imóveis");
    expect(palavras).not.toContain("imóveis");
  });
});

describe("lerEntrada", () => {
  const base = {
    developer_id: CTX.developer_id,
    padrao: "mcmv",
    formato: "imagem",
    canal: "formulario",
    verba_diaria: 50,
  };

  it("link http://, maior que 500 caracteres ou de outro esquema é recusado; https passa e vazio vira null", () => {
    expect(lerEntrada({ ...base, link: "http://exemplo.com.br" })).toEqual({
      ok: false,
      error: expect.stringContaining("https://"),
    });
    expect(lerEntrada({ ...base, link: `https://exemplo.com/${"a".repeat(490)}` }).ok).toBe(false);
    expect(lerEntrada({ ...base, link: "javascript:alert(1)" }).ok).toBe(false);
    expect(lerEntrada({ ...base, link: " https://exemplo.com.br/sol ", observacoes: "" })).toEqual({
      ok: true,
      entrada: { ...base, project_id: null, link: "https://exemplo.com.br/sol", observacoes: null },
    });
  });

  it("recusa construtora, opção, verba e observações fora do formato", () => {
    expect(lerEntrada(null).ok).toBe(false);
    expect(lerEntrada({ ...base, developer_id: "abc" }).ok).toBe(false);
    expect(lerEntrada({ ...base, project_id: "abc" }).ok).toBe(false);
    // Chave do protótipo não é opção válida.
    expect(lerEntrada({ ...base, padrao: "toString" }).ok).toBe(false);
    expect(lerEntrada({ ...base, verba_diaria: 0 }).ok).toBe(false);
    expect(lerEntrada({ ...base, verba_diaria: "50" }).ok).toBe(false);
    expect(lerEntrada({ ...base, observacoes: "x".repeat(1001) }).ok).toBe(false);
  });
});

describe("edge meta-campaign-planner (leitura do fonte)", () => {
  const fonte = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
  const puro = readFileSync(fileURLToPath(new URL("./plano.ts", import.meta.url)), "utf8");

  it("o link do usuário não é baixado nem vai para a IA", () => {
    expect(fonte).not.toMatch(/\bfetch\s*\(/);
    expect(puro).not.toMatch(/\bfetch\s*\(/);
    const { system, user } = montarPrompt(CTX);
    expect(system + user).not.toContain("exemplo.com.br");
    expect(user).toContain("Canoas/RS");
  });

  it("porta marketing.meta_manage, teto antes da IA e o plano gravado em nome de quem pediu", () => {
    expect(fonte).toContain('requireUserPermission(req, "marketing.meta_manage"');
    const teto = fonte.indexOf("json({ error: FRASE_LIMITE_PLANOS }, 429)");
    expect(teto).toBeGreaterThan(-1);
    expect(teto).toBeLessThan(fonte.indexOf("chatJson<unknown>("));
    // O teto conta tentativas no banco (0121), não planos salvos: a IA é paga
    // mesmo quando o plano falha. Voltar a contar meta_campaign_plans quebra aqui.
    const tentativa = fonte.indexOf('rpc("meta_plano_tentativa_registrar"');
    expect(tentativa).toBeGreaterThan(-1);
    expect(tentativa).toBeLessThan(fonte.indexOf("chatJson<unknown>("));
    expect(fonte).not.toMatch(/from\("meta_campaign_plans"\)[\s\S]{0,200}count/);
    expect(fonte).toContain("created_by: gate.userId");
    expect(fonte).not.toContain("access_token");
  });
});
