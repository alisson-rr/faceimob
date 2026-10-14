import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
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

it("ícone do WhatsApp ao lado do nome: só para ativo, e clicar não abre a ficha", async () => {
  const enviar = vi.fn();
  const abrir = vi.fn();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => root.render(<>
    <PessoaCard pessoa={{ id: "a", name: "Ana", status: "active" }} onAbrir={abrir} onEnviarAcesso={enviar} />
    <PessoaCard pessoa={{ id: "d", name: "Davi", status: "terminated" }} onAbrir={abrir} onEnviarAcesso={enviar} />
  </>));
  const icones = container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Enviar acesso por WhatsApp"]');
  expect(icones).toHaveLength(1);
  expect(icones[0].getAttribute("aria-label")).toBe("Enviar acesso por WhatsApp para Ana");
  await act(async () => icones[0].click());
  expect(enviar).toHaveBeenCalledTimes(1);
  expect(abrir).not.toHaveBeenCalled();
  expect(icones[0].closest("button")?.querySelector("button")).toBeNull();
  await act(async () => root.unmount());
  container.remove();
});
