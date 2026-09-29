import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A versão é o prefixo numérico do arquivo e é a chave de
 * `supabase_migrations.schema_migrations`. Duas frentes criaram
 * `20260929120000_*` no mesmo dia: o CI local passou (ele não confere a
 * tabela de histórico) e o deploy na VPS parou na segunda, com chave duplicada.
 */
describe("migrations", () => {
  it("cada versão aparece em um arquivo só", () => {
    const pasta = path.resolve(__dirname, "../../supabase/migrations");
    const versoes = readdirSync(pasta)
      .filter((arquivo) => arquivo.endsWith(".sql"))
      .map((arquivo) => arquivo.split("_")[0]);
    const repetidas = versoes.filter((versao, i) => versoes.indexOf(versao) !== i);
    expect(repetidas, "versão de migration repetida — renomeie o arquivo novo").toEqual([]);
  });
});
