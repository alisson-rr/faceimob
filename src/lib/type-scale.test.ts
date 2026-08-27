import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trava do piso tipografico (X07, redefinido em 27/08/2026).
 *
 * O piso e 12 px (`text-xs`). Abaixo dele existe UMA excecao: 11 px em rotulo
 * curto em CAIXA ALTA com `letter-spacing` de pelo menos 0.1em — na pratica a
 * `.text-eyebrow` de `index.css`. A excecao e a FORMA, nao o numero: caixa
 * alta nao tem descendente e o tracking devolve a separacao que o corpo menor
 * tira. Texto corrido de 11 px nao tem nem uma coisa nem outra.
 *
 * Existe porque "zero text-[Npx] nos MEUS arquivos" nao segura nada: os
 * handoffs G e H declararam isso e estavam certos: o piso vazou pela classe do
 * kit que eles adotaram no lugar dos literais, e toda tela voltou a ter de 7 a
 * 17 elementos em 11 px (handoff-J §3.3). Numero em documento nao reprova
 * ninguem; este arquivo reprova.
 *
 * Le o repositorio de verdade, nao uma copia dos numeros — mesmo feitio do
 * `theme-contrast.test.ts`, que le o `index.css` para medir contraste.
 */

const SRC = resolve(__dirname, "..");

/** 12 px. Piso de texto. */
const PISO_REM = 0.75;
/** 11 px. Chao absoluto da excecao: abaixo disso nem caixa alta salva. */
const EXCECAO_REM = 0.6875;
/** O tracking que paga o corpo menor, em `em`. */
const TRACKING_MINIMO = 0.1;

/**
 * Arquivos de OUTRA tarefa que ainda carregam literal, com dono.
 *
 * A comparacao e exata nos dois sentidos: literal em arquivo fora da lista
 * reprova, e arquivo da lista que ja foi limpo tambem reprova — para a linha
 * ser apagada junto com a divida. Lista que so cresce vira licenca permanente,
 * que e exatamente como o piso se perdeu da primeira vez.
 */
const PENDENTE_DE_OUTRA_TAREFA: string[] = [];

const arquivosDeInterface = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) return arquivosDeInterface(caminho);
    if (!/\.tsx?$/.test(entrada.name)) return [];
    // Teste nao pinta tela — e este aqui cita as classes proibidas de proposito.
    if (/\.(test|spec)\.tsx?$/.test(entrada.name)) return [];
    return [caminho];
  });

/**
 * Comentario e prosa, nao classe. Sem isso o teste reprova quem DOCUMENTA que
 * removeu um tamanho literal — que e o oposto do que ele quer incentivar.
 */
const semComentarios = (fonte: string) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const emRem = (valor: string, unidade: string) =>
  unidade === "px" ? Number.parseFloat(valor) / 16 : Number.parseFloat(valor);

const emPx = (rem: number) => `${(rem * 16).toFixed(1).replace(/\.0$/, "")} px`;

describe("piso tipografico", () => {
  it("nenhuma tela escreve tamanho de fonte literal", () => {
    const porArquivo = new Map<string, string[]>();

    for (const caminho of arquivosDeInterface(SRC)) {
      const literais = [...semComentarios(readFileSync(caminho, "utf8")).matchAll(/text-\[(\d+(?:\.\d+)?)(px|rem|em)\]/g)]
        .map(([classe, valor, unidade]) => {
          const rem = emRem(valor, unidade);
          return `${classe} = ${emPx(rem)}${rem < PISO_REM ? " — ABAIXO DO PISO" : " — fora da escala"}`;
        });
      if (literais.length > 0) porArquivo.set(relative(SRC, caminho).replace(/\\/g, "/"), literais);
    }

    const encontrados = [...porArquivo.keys()].sort();
    const dica = encontrados.length > PENDENTE_DE_OUTRA_TAREFA.length
      ? `Troque por text-xs/text-sm/text-base, ou por .text-eyebrow se for rotulo em CAIXA ALTA. Achados: ${JSON.stringify(Object.fromEntries(porArquivo), null, 2)}`
      : "Arquivo da lista PENDENTE_DE_OUTRA_TAREFA ja foi limpo: apague a linha dele daqui.";

    expect(encontrados, dica).toEqual([...PENDENTE_DE_OUTRA_TAREFA].sort());
  });
});

describe("index.css", () => {
  const css = readFileSync(resolve(SRC, "index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  /** Blocos planos: `[^{}]` nao atravessa chave, entao pega a regra de dentro do @layer/@media. */
  const regras = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, seletor, corpo]) => ({
    seletor: seletor.trim().replace(/\s+/g, " "),
    corpo,
    tamanho: /font-size:\s*(\d+(?:\.\d+)?)(px|rem|em)/.exec(corpo),
  }));

  it("a excecao existe e tem a forma que a justifica", () => {
    const eyebrow = regras.find((regra) => regra.seletor.includes(".text-eyebrow"));
    // Ancora o parser: se o regex de blocos quebrar, a varredura abaixo passa
    // sem ter olhado para nada. Aqui ela quebra alto.
    expect(eyebrow, ".text-eyebrow sumiu do index.css — o kit perdeu o rotulo em caixa alta").toBeDefined();
    expect(emRem(eyebrow!.tamanho![1], eyebrow!.tamanho![2])).toBe(EXCECAO_REM);
    expect(eyebrow!.corpo).toMatch(/text-transform:\s*uppercase/);
  });

  it("toda regra abaixo de 12 px e rotulo em caixa alta com tracking aberto", () => {
    const abaixoDoPiso = regras.filter((regra) => regra.tamanho && emRem(regra.tamanho[1], regra.tamanho[2]) < PISO_REM);

    for (const regra of abaixoDoPiso) {
      const rem = emRem(regra.tamanho![1], regra.tamanho![2]);
      const contexto = `${regra.seletor} (${emPx(rem)})`;

      expect(rem, `${contexto}: 11 px e o chao absoluto, nem caixa alta salva abaixo disso`)
        .toBeGreaterThanOrEqual(EXCECAO_REM);
      expect(regra.corpo, `${contexto}: abaixo de 12 px so vale CAIXA ALTA — falta text-transform: uppercase`)
        .toMatch(/text-transform:\s*uppercase/);

      const tracking = /letter-spacing:\s*(\d+(?:\.\d+)?)em/.exec(regra.corpo);
      expect(tracking, `${contexto}: abaixo de 12 px exige letter-spacing declarado em "em"`).not.toBeNull();
      expect(Number.parseFloat(tracking![1]), `${contexto}: tracking minimo de ${TRACKING_MINIMO}em`)
        .toBeGreaterThanOrEqual(TRACKING_MINIMO);
    }
  });
});
