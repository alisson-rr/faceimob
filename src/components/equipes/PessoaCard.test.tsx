import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ContagemPessoas, ListaPessoas, PessoaCard } from "./PessoaCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("mantém ativos à vista e suspensos/desligados no grupo recolhido ao final", async () => {
  const pessoas = [{ id: "s", name: "Suspenso", status: "suspended" },
    { id: "a", name: "Ativo", status: "active" }, { id: "d", name: "Desligado", status: "terminated" }];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => root.render(<><ContagemPessoas pessoas={pessoas} /><section>
    <ListaPessoas pessoas={pessoas}>{p => <PessoaCard key={p.id} pessoa={p} />}</ListaPessoas>
  </section></>));
  expect(container.textContent).toContain("1 ativo · 2 inativos");
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(details.textContent).toContain("Suspenso");
  expect(details.textContent).toContain("Desligado");
  expect(details.textContent).not.toContain("Ativo");
  expect(container.querySelector("section")?.lastElementChild).toBe(details);
  await act(async () => container.querySelector("summary")!.click());
  expect(details.open).toBe(true);
  await act(async () => root.unmount());
  container.remove();
});
