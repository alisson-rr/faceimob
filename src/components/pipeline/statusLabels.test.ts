/**
 * O corte entre o nome que a tela mostra e o valor que o banco guarda.
 *
 * Desde a 0149 o nome exibido do Status 2 é o `label` do catálogo, que o
 * administrador edita; o `value` continua sendo o texto de `deals.status_detail`
 * que `LOSS_REASONS`, `SYSTEM_STATUSES` e os negócios casam.
 *
 * Por que este arquivo lê o código-fonte dos Selects: a primeira versão da
 * tarefa do rótulo sem número derivou um campo no catálogo, travou o campo no
 * teste — e nenhum render usava. O teste passava e a tela continuava mostrando
 * o valor cru. O que quebra é a ligação entre o nome e o `<SelectItem>`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogoDeTeste as catalogo } from "./statusCatalog.fixture";
import { statusChoices, statusLabel } from "./statuses";

/** Os lugares que exibem um Status 2 e o filho de JSX que cada um precisa ter. */
const RENDERS: Record<string, string> = {
  "DealFilters.tsx": ">{option.label}<",
  "DealForm.tsx": ">{option.label}<",
  "DealsTable.tsx": ">{option.label}<",
  "LoseDealDialog.tsx": ">{statusLabel(catalog,option)}<",
};

/**
 * Filhos de JSX que imprimiriam o valor gravado, com o número. `{option}` cru
 * fica de fora: é legítimo em Select que não é de Status 2 (a origem do lead,
 * em `DealForm`).
 */
const CRUS = [">{option.value}<", ">{status.value}<", ">{bareStatus(option.value)}<"];

/** JSX sem espaço: `>\n  {x}\n<` e `> {x} <` viram o mesmo `>{x}<`. */
const semEspaco = (arquivo: string) =>
  readFileSync(join(__dirname, arquivo), "utf8").replace(/\s+/g, "");

describe("nome de tela do Status 2", () => {
  it("os Selects exibem o nome do catálogo, não o valor cru", () => {
    for (const [arquivo, esperado] of Object.entries(RENDERS)) {
      const fonte = semEspaco(arquivo);
      expect(fonte, `${arquivo} deixou de exibir por ${esperado}`).toContain(esperado);
      for (const cru of CRUS) {
        expect(fonte, `${arquivo} imprime ${cru} — é o valor gravado`).not.toContain(cru);
      }
    }
  });

  it("o nome vem do catálogo, e o valor gravado não muda", () => {
    const opcao = statusChoices(catalogo, "16. PENDENTE").find((option) => option.value === "02. ASS. BANCO");
    expect(opcao).toMatchObject({ value: "02. ASS. BANCO", label: "Assinado no banco" });
  });

  it("fora do catálogo o nome chega limpo do número", () => {
    expect(statusLabel(catalogo, "99. RÓTULO ANTIGO")).toBe("RÓTULO ANTIGO");
    expect(statusLabel(catalogo, "17. DISTRATO")).toBe("DISTRATO");
  });

  it("a chave do Select é o valor, que mantém o número: dois \"15.\" não colidem", () => {
    const values = catalogo.statuses.map((status) => status.value);
    expect(new Set(values).size).toBe(values.length);
    expect(statusLabel(catalogo, "15. INTERNALIZADO")).not.toBe(statusLabel(catalogo, "15. ANÁLISE P/ VIRAR NEGÓCIO"));
  });
});
