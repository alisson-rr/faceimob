// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { actId, META_GRAPH, MetaApiError, metaGet, metaGetAll, metaPost } from "./metaGraph.ts";

/**
 * O cliente da Marketing API. O que se trava aqui são as duas regras que já
 * custaram caro no sistema antigo: o token na URL (que acaba em log) e o número
 * que some sem aviso — uma leitura paginada que para no meio e devolve o que
 * veio como se fosse tudo.
 */

const TOKEN = "EAAB-token-de-teste";

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

function fetchFalso(...respostas: Array<Response | Error>) {
  const fn = vi.fn();
  for (const r of respostas) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r);
    else fn.mockResolvedValueOnce(r);
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Uma aresta com `total` páginas; cada `next` devolve o token na URL, como a Meta faz. */
function paginas(total: number) {
  let n = 0;
  const fn = vi.fn(async () => {
    n++;
    const next = `${META_GRAPH}/act_1/insights?after=c${n}&access_token=VAZOU`;
    return json({ data: [n], paging: n < total ? { next } : {} });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

type Chamada = [string, RequestInit & { headers: Record<string, string> }];
const chamada = (fn: ReturnType<typeof vi.fn>, i: number) => fn.mock.calls[i] as Chamada;
const tempoEsgotado = () => Object.assign(new Error(`timeout em ${META_GRAPH}/act_1`), { name: "TimeoutError" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("metaGet", () => {
  it("manda o token só no header — nem um access_token passado por engano vai para a URL", async () => {
    const fn = fetchFalso(json({ id: "act_1", name: "Conta" }));
    const conta = await metaGet<{ name: string }>("act_1", { fields: "name", access_token: TOKEN }, TOKEN);
    expect(conta.name).toBe("Conta");
    const [url, init] = chamada(fn, 0);
    expect(url).toBe(`${META_GRAPH}/act_1?fields=name`);
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("erro da Meta vira MetaApiError com a frase traduzida, o código e o subcódigo", async () => {
    fetchFalso(json({ error: { code: 200, error_subcode: 1487, message: "(#200) Requires ads_management permission" } }, 403));
    const erro = await metaGet("act_1/campaigns", {}, TOKEN).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(MetaApiError);
    expect(erro).toMatchObject({ status: 403, code: 200, subcode: 1487 });
    // Só sai a frase de anúncios porque o cliente passa o contexto: sem ele, o
    // 200 é tratado como o do WhatsApp e volta a mensagem crua da Meta.
    expect((erro as Error).message).toMatch(/^Token sem permissão para anúncios/);
  });

  it("sem resposta vira falha com status 0 e sem a URL na mensagem", async () => {
    fetchFalso(tempoEsgotado());
    const erro = await metaGet("act_1", {}, TOKEN).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(MetaApiError);
    expect(erro).toMatchObject({ status: 0, message: "A Meta não respondeu em 30 s." });
  });

  it("recusa caminho que mudaria a chamada, sem chegar a chamar a Meta", async () => {
    const fn = fetchFalso();
    for (const caminho of ["123/../me", "123?fields=id", "act_1/insights&limit=1", ""]) {
      await expect(metaGet(caminho, {}, TOKEN), caminho).rejects.toThrow(/Caminho da Graph inválido/);
    }
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("metaGetAll", () => {
  it("segue paging.next tirando o token que a Meta devolve na URL", async () => {
    const fn = fetchFalso(
      json({ data: [{ id: "1" }, { id: "2" }], paging: { next: `${META_GRAPH}/act_1/campaigns?after=abc&access_token=VAZOU` } }),
      json({ data: [{ id: "3" }], paging: {} }),
    );
    const itens = await metaGetAll<{ id: string }>("act_1/campaigns", { fields: "id", limit: "2" }, TOKEN);
    expect(itens.map((i) => i.id)).toEqual(["1", "2", "3"]);
    const [url, init] = chamada(fn, 1);
    expect(url).toBe(`${META_GRAPH}/act_1/campaigns?after=abc`);
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("LANÇA ao passar do teto de páginas em vez de devolver só parte (51 páginas)", async () => {
    const fn = paginas(51);
    await expect(metaGetAll("act_1/insights", {}, TOKEN)).rejects.toThrow(/mais de 50 páginas/);
    // A 51ª nem é pedida: parar ali e devolver 50 páginas seria o número pela metade.
    expect(fn).toHaveBeenCalledTimes(50);
    for (const [url] of fn.mock.calls as unknown as Chamada[]) expect(url).not.toContain("access_token");
  });

  it("exatamente 50 páginas cabem no teto", async () => {
    paginas(50);
    expect(await metaGetAll("act_1/insights", {}, TOKEN)).toHaveLength(50);
  });

  it("não segue link de outra origem levando o token", async () => {
    const fn = fetchFalso(json({ data: [1], paging: { next: "https://outro.example/v25.0/act_1?after=x" } }));
    await expect(metaGetAll("act_1/ads", {}, TOKEN)).rejects.toThrow(/fora da Graph/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("página sem lista não vira 'nenhum item'", async () => {
    fetchFalso(json({ paging: {} }));
    await expect(metaGetAll("act_1/ads", {}, TOKEN)).rejects.toThrow(/sem a lista/);
  });
});

describe("metaPost", () => {
  it("manda form-urlencoded, com o token no header e fora do corpo", async () => {
    const fn = fetchFalso(json({ success: true }));
    expect(await metaPost("120210000000001", { status: "PAUSED", access_token: TOKEN }, TOKEN)).toEqual({ success: true });
    const [url, init] = chamada(fn, 0);
    expect(url).toBe(`${META_GRAPH}/120210000000001`);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.body).toBe("status=PAUSED");
  });

  it("escrita sem resposta não finge que nada mudou", async () => {
    fetchFalso(tempoEsgotado());
    const erro = await metaPost("120210000000001", { daily_budget: "15000" }, TOKEN).catch((e: unknown) => e);
    expect((erro as Error).message).toMatch(/pode ter sido aplicado/);
  });
});

describe("actId", () => {
  it("normaliza para act_ e recusa o que não é id de conta", () => {
    expect(actId("123")).toBe("act_123");
    expect(actId(" act_456 ")).toBe("act_456");
    for (const ruim of ["", "act_", "abc", "act_12/../me", "12 34"]) expect(() => actId(ruim), ruim).toThrow(/inválido/);
  });
});

describe("fonte", () => {
  it("nenhuma URL montada com o token: access_token só aparece para ser retirado", () => {
    for (const arquivo of ["./metaGraph.ts", "./metaAds.ts"]) {
      const fonte = readFileSync(fileURLToPath(new URL(arquivo, import.meta.url)), "utf8");
      expect(fonte, arquivo).not.toContain("access_token=");
      const codigo = fonte.split("\n").filter((l) => l.includes("access_token") && !/^\s*(\/\/|\*|\/\*)/.test(l));
      for (const linha of codigo) expect(linha, arquivo).toMatch(/\.delete\("access_token"\)/);
    }
  });
});
