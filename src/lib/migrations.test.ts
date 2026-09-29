import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O que o `db push` da VPS recusa e o CI local deixava passar.
 *
 * 1. A versão é o prefixo numérico do arquivo e é a chave de
 *    `supabase_migrations.schema_migrations`. Duas frentes criaram
 *    `20260929120000_*` no mesmo dia e o deploy parou na segunda, com chave
 *    duplicada.
 * 2. Comando do psql (`\restrict`, `\i`, `\set`…): o CI aplica as migrations
 *    pelo psql, que os entende; o `db push` manda o SQL cru ao servidor, que
 *    recusa. O pg_dump recente escreve `\restrict` no topo do arquivo, e foi
 *    assim que a 0169 parou o deploy.
 */
const pasta = path.resolve(__dirname, "../../supabase/migrations");
const arquivos = readdirSync(pasta).filter((arquivo) => arquivo.endsWith(".sql"));

describe("migrations", () => {
  it("cada versão aparece em um arquivo só", () => {
    const versoes = arquivos.map((arquivo) => arquivo.split("_")[0]);
    const repetidas = versoes.filter((versao, i) => versoes.indexOf(versao) !== i);
    expect(repetidas, "versão de migration repetida — renomeie o arquivo novo").toEqual([]);
  });

  it("nenhuma usa comando do psql", () => {
    const comComando = arquivos.filter((arquivo) =>
      /^\\[a-z]/m.test(readFileSync(path.resolve(pasta, arquivo), "utf8")));
    expect(comComando, "linha começando com \\ só o psql entende; o db push recusa").toEqual([]);
  });
});
