import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

// Sem @testing-library no projeto, o render é o do react-dom mesmo; a flag é o
// que faz `act` aceitar o jsdom como ambiente de teste.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * O aviso (sonner) no meio da tela passa das bordas de diálogo estreito. Clicar
 * nele não pode fechar o diálogo, que perdia o formulário; clique fora de
 * verdade continua fechando.
 */
it("clique no aviso não fecha o diálogo; clique fora fecha", async () => {
  const lista = document.body.appendChild(document.createElement("ol"));
  lista.setAttribute("data-sonner-toaster", "");
  const xDoAviso = lista.appendChild(document.createElement("button"));
  const onOpenChange = vi.fn();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Agendar visita</DialogTitle>
          <DialogDescription>Escolha a data</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
  });
  // O Radix só passa a escutar o clique fora depois de um tick.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

  await act(async () => {
    xDoAviso.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
  expect(onOpenChange).not.toHaveBeenCalled();

  await act(async () => {
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
  expect(onOpenChange).toHaveBeenCalledWith(false);

  await act(async () => { root.unmount(); });
  container.remove();
  lista.remove();
});
