import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Linha de lista clicável: `<button>` de verdade, nunca `role="button"` num
 * container.
 *
 * As abas Agentes e Origens montavam a linha como `<div role="button"
 * tabIndex={0}>` com o botão "Excluir …" DENTRO. `button` está na lista de
 * "Presentational Children" da ARIA 1.2: leitores de tela conformes descartam
 * os descendentes da árvore de acessibilidade — o único caminho para excluir um
 * agente ou uma origem deixava de existir para quem depende deles, e o nome
 * acessível da linha virava a concatenação de tudo, inclusive "Excluir agente
 * X". As abas Conversas e WhatsApp sempre fizeram certo (um `<button>` real,
 * sem controle aninhado); este teste é o que impede a volta do padrão errado
 * quando a próxima lista for escrita por cópia da vizinha.
 *
 * Lê o módulo de verdade, no feitio do `src/lib/type-scale.test.ts`: número em
 * documento não reprova ninguém, este arquivo reprova.
 */

const MODULO = resolve(__dirname);

/** Pega `role="button"` e também o condicional que a aba Origens usava
 *  (`role={canWrite ? "button" : undefined}`). */
const ROLE_BUTTON = /role=\{?[^}\n]*"button"/;

const arquivosDeInterface = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) return arquivosDeInterface(caminho);
    if (!/\.tsx$/.test(entrada.name)) return [];
    if (/\.(test|spec)\.tsx$/.test(entrada.name)) return [];
    return [caminho];
  });

/** Comentário é prosa: este módulo documenta o padrão proibido de propósito. */
const semComentarios = (fonte: string) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("linhas clicáveis do módulo SDR", () => {
  it("nenhum container imita um botão com role=\"button\"", () => {
    const culpados = arquivosDeInterface(MODULO)
      .filter((arquivo) => ROLE_BUTTON.test(semComentarios(readFileSync(arquivo, "utf8"))))
      .map((arquivo) => relative(MODULO, arquivo));

    expect(
      culpados,
      "linha clicável tem de ser <button>: com role=\"button\" o leitor de tela descarta o botão de excluir aninhado",
    ).toEqual([]);
  });

  it("a busca acha o padrão errado e ignora o certo", () => {
    // Sem isto, o teste acima passaria por não estar procurando nada — o modo
    // de falha silencioso de toda verificação que lê o repositório.
    expect(ROLE_BUTTON.test('role="button"')).toBe(true);
    expect(ROLE_BUTTON.test('role={canWrite ? "button" : undefined}')).toBe(true);
    expect(ROLE_BUTTON.test('<button type="button" onClick={abrir}>')).toBe(false);

    const arquivos = arquivosDeInterface(MODULO).map((a) => relative(MODULO, a));
    expect(arquivos).toEqual(
      expect.arrayContaining(["AgentsTab.tsx", "SourcesTab.tsx", "ConversationsTab.tsx"]),
    );
  });
});
