import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * Todas as páginas de um PDF, uma embaixo da outra, para rolar no celular
 * (pedido de 19/10/2026). No `<iframe>` o Safari do iPhone mostra só a 1ª página
 * e o Chrome do Android nem tem leitor de PDF embutido. O `pdfjs-dist` é
 * carregado só aqui, na primeira abertura de PDF.
 */
export function PdfPaginas({ url, titulo }: { url: string; titulo: string }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<"carregando" | "pronto" | "erro">("carregando");
  const [paginas, setPaginas] = useState(0);

  useEffect(() => {
    let cancelado = false;
    const alvo = caixa.current;
    if (!alvo) return;
    alvo.replaceChildren();
    setEstado("carregando");

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const { default: worker } = await import("pdfjs-dist/build/pdf.worker.min.js?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        // `isEvalSupported: false`: mitigação do CVE-2024-4367 (PDF malicioso
        // executando código pela fonte) nas versões 3.x do pdf.js.
        const doc = await pdfjs.getDocument({ url, isEvalSupported: false }).promise;
        if (cancelado) return;
        setPaginas(doc.numPages);
        const largura = alvo.clientWidth || window.innerWidth;
        const densidade = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= doc.numPages && !cancelado; n++) {
          const pagina = await doc.getPage(n);
          const base = pagina.getViewport({ scale: 1 });
          const viewport = pagina.getViewport({ scale: (largura / base.width) * densidade });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "mx-auto mb-2 block h-auto w-full rounded bg-white";
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `${titulo}, página ${n} de ${doc.numPages}`);
          const contexto = canvas.getContext("2d");
          if (!contexto) continue;
          await pagina.render({ canvasContext: contexto, viewport }).promise;
          if (cancelado) return;
          alvo.appendChild(canvas);
        }
        if (!cancelado) setEstado("pronto");
      } catch {
        if (!cancelado) setEstado("erro");
      }
    })();

    return () => { cancelado = true; };
  }, [url, titulo]);

  return (
    <div>
      {estado === "carregando" && (
        <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {paginas ? `Carregando ${paginas} páginas…` : "Carregando o documento…"}
        </p>
      )}
      {estado === "erro" && (
        <p role="alert" className="py-6 text-center text-xs text-destructive">
          Não consegui exibir este PDF aqui. Use "Abrir em tela cheia" ou Baixar.
        </p>
      )}
      <div ref={caixa} />
    </div>
  );
}
