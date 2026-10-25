import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PdfDocumentViewer from "./PdfDocumentViewer";

const h = vi.hoisted(() => ({
  getPage: vi.fn(), destroy: vi.fn(), cancel: vi.fn(), fail: false,
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: h.fail ? Promise.reject(new Error("indisponível")) : Promise.resolve({ numPages: 3, getPage: h.getPage }),
    destroy: h.destroy,
  }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  h.fail = false;
  vi.clearAllMocks();
  h.getPage.mockResolvedValue({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: h.cancel }),
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: (entries: unknown[]) => void) {}
    observe() { this.callback([{ contentRect: { width: 600 } }]); }
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const button = (label: string) => [...container.querySelectorAll("button")].find((node) => node.textContent === label)!;

describe("PDF multipágina", () => {
  it("permite conferir todas as páginas e voltar, respeitando os limites", async () => {
    await act(async () => root.render(<PdfDocumentViewer url="https://storage.test/privado.pdf" />));
    expect(container.textContent).toContain("Página 1 de 3");
    expect(button("Anterior").disabled).toBe(true);
    await act(async () => button("Próxima").click());
    expect(container.textContent).toContain("Página 2 de 3");
    expect(h.getPage).toHaveBeenLastCalledWith(2);
    await act(async () => button("Próxima").click());
    expect(h.getPage).toHaveBeenLastCalledWith(3);
    expect(button("Próxima").disabled).toBe(true);
    await act(async () => button("Anterior").click());
    expect(h.getPage).toHaveBeenLastCalledWith(2);
    await act(async () => root.render(<PdfDocumentViewer url="https://storage.test/outro.pdf" />));
    expect(container.textContent).toContain("Página 1 de 3");
    expect(h.destroy).toHaveBeenCalled();
  });

  it("orienta a abrir o original quando o PDF não carrega", async () => {
    h.fail = true;
    await act(async () => root.render(<PdfDocumentViewer url="https://storage.test/expirado.pdf" />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Abrir em tela cheia");
    expect(button("Próxima").disabled).toBe(true);
  });
});
