/**
 * O corte entre o rótulo que a tela mostra e o valor que o banco guarda.
 *
 * O cliente pediu o Status 2 sem o prefixo numerado (10/09/2026). O caminho
 * barato — apagar o número do `label` — trocaria também o valor gravado, e
 * `LOSS_REASONS`, `SYSTEM_STATUSES` e os negócios já no banco casam por esse
 * valor. Quem limpa é `bareStatus`, no ponto de exibição.
 *
 * Por que este arquivo lê o código-fonte dos quatro Selects: a primeira versão
 * desta tarefa derivou um campo `text` no catálogo, travou o campo no teste — e
 * nenhum render usava. O teste passava e a tela continuava mostrando
 * "17. DISTRATO". Um teste que só chama `bareStatus` testa `bareStatus`; o que
 * quebrou foi a ligação entre o helper e o `<SelectItem>`. Mesmo feitio do
 * `type-scale.test.ts`, que lê o repositório em vez de uma cópia dos números.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOSS_REASONS, SYSTEM_STATUSES, bareStatus } from "@/lib/dealStatus";
import { FACEIMOB_STATUSES, statusChoices } from "./statuses";

/**
 * Os quatro lugares que exibem um rótulo de Status 2, e o filho de JSX que cada
 * um precisa ter. `LoseDealDialog` itera strings de `LOSS_REASONS`, os outros
 * três iteram entradas do catálogo — daí a expressão diferente.
 */
const RENDERS: Record<string, string> = {
  "DealFilters.tsx": ">{bareStatus(status.label)}<",
  "DealForm.tsx": ">{bareStatus(option.label)}<",
  "DealsTable.tsx": ">{bareStatus(option.label)}<",
  "LoseDealDialog.tsx": ">{bareStatus(option)}<",
};

/**
 * Filho de JSX que imprimiria o valor gravado, com o número. Só as duas formas
 * do catálogo: `{option}` cru é legítimo em Select que não é de Status 2 (a
 * origem do lead, em `DealForm`), e ali o valor não tem prefixo nenhum.
 */
const CRUS = [">{option.label}<", ">{status.label}<"];

/** JSX sem espaço: `>\n  {x}\n<` e `> {x} <` viram o mesmo `>{x}<`. */
const semEspaco = (arquivo: string) =>
  readFileSync(join(__dirname, arquivo), "utf8").replace(/\s+/g, "");

describe("rotulo de tela do Status 2", () => {
  it("nenhum rotulo exibido comeca com digito", () => {
    for (const status of FACEIMOB_STATUSES) expect(bareStatus(status.label)).not.toMatch(/^\d/);
    for (const option of statusChoices("PROPOSTA")) expect(bareStatus(option.label)).not.toMatch(/^\d/);
    for (const motivo of LOSS_REASONS) expect(bareStatus(motivo)).not.toMatch(/^\d/);
  });

  it("os quatro Selects exibem pelo helper, nao o valor cru", () => {
    for (const [arquivo, esperado] of Object.entries(RENDERS)) {
      const fonte = semEspaco(arquivo);
      expect(fonte, `${arquivo} deixou de exibir por ${esperado} — o número volta para a tela`)
        .toContain(esperado);
      for (const cru of CRUS) {
        expect(fonte, `${arquivo} imprime ${cru} — é o valor gravado, com o número`).not.toContain(cru);
      }
    }
  });

  it("a ordem exibida continua sendo a do array, nao a alfabetica", () => {
    const textos = FACEIMOB_STATUSES.map((s) => bareStatus(s.label));
    expect(textos[0]).toBe("PROPOSTA");
    expect(textos[1]).toBe("ASS. BANCO");
    expect(textos.at(-1)).toBe("RET. ESTEIRA AGIL");
    expect(textos).not.toEqual([...textos].sort());

    // As duas entradas "15." ficam, nesta ordem, e sem o número viram rótulos
    // distintos na tela.
    const quinze = textos.slice(textos.indexOf("ANÁLISE P/ VIRAR NEGÓCIO"), textos.indexOf("PENDENTE"));
    expect(quinze).toEqual(["ANÁLISE P/ VIRAR NEGÓCIO", "INTERNALIZADO"]);
    expect(new Set(textos).size).toBe(textos.length);

    // A chave de lista do Select é o `label`, que mantém o número: tirar o
    // número da tela não pode aproximar duas chaves.
    const labels = FACEIMOB_STATUSES.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("o valor gravado nao muda: LOSS_REASONS e SYSTEM_STATUSES continuam batendo", () => {
    const labels = FACEIMOB_STATUSES.map((s) => s.label);
    // "OFF" é motivo do diálogo de perda e não está no catálogo (já coberto em
    // statuses.test.ts); os outros três precisam existir com o prefixo.
    for (const motivo of LOSS_REASONS.filter((m) => m !== "OFF")) expect(labels).toContain(motivo);
    for (const rotulo of SYSTEM_STATUSES) expect(labels).toContain(rotulo);
    expect(labels.filter((l) => /^\d/.test(l))).toHaveLength(21);
  });

  it("um valor fora do catalogo tambem chega limpo na tela", () => {
    // Importação antiga: o Select precisa oferecer o valor gravado (senão abre
    // em branco), e o rótulo dele passa pela mesma limpeza do catálogo.
    const [primeiro] = statusChoices("99. RÓTULO ANTIGO");
    expect(primeiro.label).toBe("99. RÓTULO ANTIGO");
    expect(bareStatus(primeiro.label)).toBe("RÓTULO ANTIGO");
  });
});
