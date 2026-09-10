import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de classe, não de caso.
 *
 * `UPDATE` recusado por RLS casa 0 linhas e o PostgREST devolve 204 SEM erro.
 * Quem só olha `error` mostra toast verde para gravação que não aconteceu — e
 * na tela de Equipes isso é caminho REAL, não teoria: `team_members_manage`
 * exige `has_permission('teams.manage')` (revogar vale na hora, a sessão do
 * gerente só relê no F5) e `teams_admin_write` exige diretor DA equipe.
 *
 * O defeito já foi corrigido três vezes neste arquivo e reapareceu duas —
 * sempre num `update` novo. Por isso a regra é sobre TODOS os updates da tela,
 * não sobre os que já quebraram: sem `.select(...)` não há como saber quantas
 * linhas mudaram, e sem `.data` conferido o número do toast é chute.
 */
const fonte = readFileSync(path.resolve(__dirname, "Equipes.tsx"), "utf8");

/** Cada cadeia `supabase.from(...).update(...)` até o `;` que a encerra. */
const cadeiasDeUpdate = fonte
  .split(".update(")
  .slice(1)
  .map((trecho) => trecho.slice(0, trecho.indexOf(";")));

describe("Equipes: nenhum update mente sobre ter gravado", () => {
  it("toda cadeia .update() pede a linha de volta com .select()", () => {
    expect(cadeiasDeUpdate.length, "esperava encontrar os updates da tela").toBeGreaterThan(0);
    for (const cadeia of cadeiasDeUpdate) {
      expect(cadeia, `update sem .select(): ${cadeia.slice(0, 80)}`).toContain(".select(");
    }
  });

  it("nenhum retorno de supabase é descartado por inteiro", () => {
    // `await supabase.from(...).update(...)` como comando solto engole erro E
    // contagem — foi assim que o fechamento do vínculo anterior falhava calado
    // e o insert seguinte estourava 23505 com uma frase que não dizia nada.
    // Quem guarda o retorno escreve `const x = await supabase`; quem descarta
    // deixa a linha `await supabase` sozinha.
    expect(fonte, "retorno de chamada supabase descartado").not.toMatch(/^\s*await supabase/m);
  });

  it("o toast de desligamento em massa conta o que o banco devolveu", () => {
    // Contar `desligar.length` (a intenção) em vez de `saiu` (o que gravou) foi
    // o defeito: a tela anunciava desligamentos que a RLS tinha recusado.
    expect(fonte).toMatch(/saiu\s*=\s*saida\.data\?\.length\s*\?\?\s*0/);
    expect(fonte, "o toast de sucesso tem de usar a contagem do banco")
      .toContain("${saiu} desligamento(s) aplicados");
    // E quando o banco grava menos do que se pediu, o aviso é vermelho e diz
    // quantos de quantos — nunca um número inventado.
    expect(fonte).toMatch(/\$\{saiu\} de \$\{desligar\.length\} desligamento/);
  });
});
