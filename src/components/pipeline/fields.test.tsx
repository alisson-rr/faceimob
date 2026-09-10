import { describe, expect, it } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { PersonField } from "./fields";
import type { PersonRecord } from "@/integrations/supabase/newSchema";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * O rateio é DESCRIÇÃO do campo, não o nome dele.
 *
 * Enquanto o percentual morava dentro do `<label>`, o nome acessível de
 * "Corretor 1 *" virava "Corretor 1 *50% do VGV" — e mudava sozinho a cada
 * corretor que entra ou sai do negócio. Quem procura o campo pelo rótulo (leitor
 * de tela, `getByLabel` do E2E) deixava de encontrá-lo assim que o negócio
 * ganhava um segundo corretor.
 */
const PESSOAS: PersonRecord[] = [
  { id: "p1", name: "E2E Corretor", roles: ["broker"], active: true } as unknown as PersonRecord,
];

async function render(hint?: string) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <PersonField
        id="broker1"
        label="Corretor 1 *"
        hint={hint}
        value="p1"
        options={PESSOAS}
        onChange={() => undefined}
      /> as ReactNode,
    );
  });
  const label = container.querySelector('label[for="broker1"]');
  const trigger = container.querySelector("#broker1");
  const describedBy = trigger?.getAttribute("aria-describedby");
  const resultado = {
    rotulo: label?.textContent ?? "",
    descricao: describedBy ? container.querySelector(`#${describedBy}`)?.textContent ?? "" : null,
  };
  await act(async () => { root.unmount(); });
  container.remove();
  return resultado;
}

describe("PersonField · rótulo e rateio", () => {
  it("o rótulo continua sendo só o rótulo quando há rateio", async () => {
    const { rotulo } = await render("50% do VGV");
    expect(rotulo).toBe("Corretor 1 *");
  });

  it("o rateio chega como descrição do campo", async () => {
    expect((await render("50% do VGV")).descricao).toBe("50% do VGV");
  });

  it("sem rateio não sobra `aria-describedby` apontando para nada", async () => {
    expect((await render()).descricao).toBeNull();
  });
});
