import { beforeEach, describe, expect, it, vi } from "vitest";

const { schema } = vi.hoisted(() => ({ schema: vi.fn() }));
vi.mock("./client", () => ({ supabase: { schema, storage: { from: vi.fn() } } }));

import { extensaoDe, linksDaPasta, listarLinksDoCorretor, nomeDoArquivo, type DocumentoDeSuporte } from "./central";

/** Cadeia mínima do PostgREST: todo método devolve a cadeia, e ela resolve no resultado. */
function cadeia(resultado: { data: unknown; error: unknown }) {
  const alvo: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "order", "not"]) alvo[m] = () => alvo;
  alvo.then = (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok);
  return alvo;
}

describe("Central do Corretor", () => {
  beforeEach(() => schema.mockReset());

  it("lê os atalhos do schema site e tira os do sistema antigo, o Drive (tela própria) e o que aponta para o próprio CRM", async () => {
    schema.mockReturnValue(cadeia({
      data: [
        { id: "1", key: "webmail", label: "Webmail", url: "https://mail", description: null },
        { id: "2", key: "pipeline", label: "Pipeline (CRM)", url: "https://bubble", description: null },
        { id: "3", key: "leads_app", label: "App de Leads", url: "https://leadfy", description: null },
        { id: "4", key: "drive", label: "Drive de Portfólio", url: "https://drive", description: null },
        { id: "5", key: "crm", label: "CRM Faceimob", url: "https://app.faceimob.com.br/", description: null },
      ],
      error: null,
    }));

    const links = await listarLinksDoCorretor();

    expect(schema).toHaveBeenCalledWith("site");
    expect(links.map((l) => l.key)).toEqual(["webmail"]);
  });

  it("erro do banco sobe, e não vira Central vazia", async () => {
    schema.mockReturnValue(cadeia({ data: null, error: { message: "permission denied" } }));
    await expect(listarLinksDoCorretor()).rejects.toMatchObject({ message: "permission denied" });
  });

  it("pasta do Drive: até 3 links válidos, e sem lista vale o drive_url", () => {
    const links = [
      { name: "Tabela", url: "https://a" }, { name: "Sem url" }, "lixo", { url: "https://b" },
      { name: "C", url: "https://c" }, { name: "D", url: "https://d" },
    ];
    expect(linksDaPasta({ drive_url: "https://x", links })).toEqual([
      { name: "Tabela", url: "https://a" }, { name: "", url: "https://b" }, { name: "C", url: "https://c" },
    ]);
    expect(linksDaPasta({ drive_url: "https://x", links: null })).toEqual([{ name: "Abrir Drive", url: "https://x" }]);
    expect(linksDaPasta({ drive_url: null, links: [] })).toEqual([]);
  });

  it("o arquivo baixa com o nome original, ou com o título e a extensão", () => {
    const base: DocumentoDeSuporte = {
      id: "d", title: "Ficha Caixa", description: null, file_path: "abc.pdf", file_name: null,
      file_type: "application/pdf", file_size: 10, sort_order: 0, active: true,
    };
    expect(extensaoDe(base)).toBe("pdf");
    expect(nomeDoArquivo(base)).toBe("Ficha Caixa.pdf");
    expect(nomeDoArquivo({ ...base, file_name: "Ficha de Cadastro.PDF" })).toBe("Ficha de Cadastro.PDF");
  });
});
