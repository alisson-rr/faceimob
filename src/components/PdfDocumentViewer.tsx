import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { Button } from "@/components/ui/button";

GlobalWorkerOptions.workerSrc = workerUrl;

/** Renderiza o PDF localmente: o iframe nativo do iOS só exibe a primeira página. */
export default function PdfDocumentViewer({ url }: { url: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    setPdf(null);
    setPage(1);
    setLoading(true);
    setError("");
    const task = getDocument({ url, isEvalSupported: false });
    task.promise.then((document) => {
      if (!disposed) setPdf(document);
    }).catch(() => {
      if (!disposed) {
        setError("Não foi possível carregar o PDF. Use Abrir em tela cheia para acessar o arquivo original.");
        setLoading(false);
      }
    });
    return () => { disposed = true; void task.destroy(); };
  }, [url]);

  useEffect(() => {
    if (!pdf || !width) return;
    let disposed = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    setLoading(true);
    setError("");
    if (hostRef.current?.parentElement) hostRef.current.parentElement.scrollTop = 0;
    void pdf.getPage(page).then(async (pdfPage) => {
      const canvas = canvasRef.current;
      if (disposed || !canvas) return;
      const viewport = pdfPage.getViewport({ scale: width / pdfPage.getViewport({ scale: 1 }).width });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      renderTask = pdfPage.render({
        canvasContext: canvas.getContext("2d")!, viewport,
        transform: [ratio, 0, 0, ratio, 0, 0],
      });
      await renderTask.promise;
      if (!disposed) setLoading(false);
    }).catch(() => {
      if (!disposed) {
        setError("Não foi possível exibir esta página. Tente outra página ou abra o arquivo original.");
        setLoading(false);
      }
    });
    return () => { disposed = true; renderTask?.cancel(); };
  }, [pdf, page, width]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav aria-label="Páginas do documento" className="flex shrink-0 items-center justify-center gap-3 border-b border-border p-2">
        <Button size="sm" variant="outline" disabled={!pdf || page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</Button>
        <span className="text-sm" aria-live="polite">{pdf ? `Página ${page} de ${pdf.numPages}` : "Carregando PDF…"}</span>
        <Button size="sm" variant="outline" disabled={!pdf || page >= pdf.numPages} onClick={() => setPage((value) => value + 1)}>Próxima</Button>
      </nav>
      <div className="min-h-0 flex-1 overflow-auto bg-slate-950/60 p-2">
        {loading && !error && <p role="status" className="p-3 text-center text-sm">Carregando página…</p>}
        {error && <p role="alert" className="p-3 text-center text-sm">{error}</p>}
        <div ref={hostRef} className="mx-auto w-full max-w-4xl">
          <canvas ref={canvasRef} role="img" aria-label={`Página ${page} do documento`} className={loading || error ? "hidden" : "block bg-white"} />
        </div>
      </div>
    </div>
  );
}
