import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

/**
 * Só a ENTRADA identifica o build. Os chunks de rota (`DailyReport-*.js`,
 * `Pipeline-*.js`, `ComparativeFunnel-*.js`, …) entram no DOM sob demanda e
 * nunca aparecem no `index.html` — comparar o DOM inteiro com o HTML remoto
 * era comparar "o que esta aba carregou" com "o que o app carrega no boot",
 * e acusava versão nova em qualquer rota lazy, ou seja, em todas.
 */
const ENTRY_ASSET = /^\/assets\/index-[A-Za-z0-9_-]+\.(?:js|css)$/;

/**
 * A premissa é que a entrada é o único `index-*.js`: o `manualChunks` do
 * `vite.config.ts` só nomeia `react`, `charts`, `supabase` e `motion`. Se
 * aparecer um segundo — um chunk lazy vindo de algum módulo `index.ts`, por
 * exemplo — o detector voltaria a comparar conjuntos diferentes. Nesse caso
 * ele desliga (`null`): falso negativo custa uma atualização manual; falso
 * positivo é o cliente vendo o app pedir atualização o tempo todo.
 */
function entrySignature(paths: string[]): string | null {
  const entry = Array.from(new Set(paths.filter((p) => ENTRY_ASSET.test(p))));
  if (entry.filter((p) => p.endsWith(".js")).length !== 1) return null;
  return entry.sort().join("|");
}

/**
 * Periodically polls the current HTML and compares the bundled asset hash.
 * If it changes (new deploy), shows a floating button prompting the user to reload.
 */
export function useAppUpdateAvailable() {
  const [hasUpdate, setHasUpdate] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") return;

    // Assinatura da entrada ATUALMENTE carregada nesta aba (do DOM, não do fetch)
    const loadedSignature = (() => {
      const scripts = Array.from(document.querySelectorAll('script[src*="/assets/"]'))
        .map((s) => new URL((s as HTMLScriptElement).src, window.location.origin).pathname);
      const links = Array.from(document.querySelectorAll('link[href*="/assets/"]'))
        .map((l) => new URL((l as HTMLLinkElement).href, window.location.origin).pathname);
      return entrySignature([...scripts, ...links]);
    })();

    const fetchRemoteSignature = async (): Promise<string | null> => {
      try {
        const res = await fetch(`${window.location.origin}/index.html?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return null;
        const html = await res.text();
        return entrySignature(html.match(/\/assets\/[A-Za-z0-9_-]+\.(?:js|css)/g) ?? []);
      } catch {
        return null;
      }
    };

    const check = async () => {
      if (!loadedSignature) return;
      const remote = await fetchRemoteSignature();
      if (remote && remote !== loadedSignature) setHasUpdate(true);
    };

    check(); // primeira checagem imediata
    const interval = window.setInterval(check, 30_000);
    const onFocus = () => check();
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return hasUpdate;
}

export function UpdateNotifier() {
  const hasUpdate = useAppUpdateAvailable();
  if (!hasUpdate) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999]">
      <Button
        onClick={() => window.location.reload()}
        className="shadow-lg gap-2 bg-gradient-to-r from-primary to-info hover:opacity-90"
      >
        <RefreshCw className="h-4 w-4" />
        Nova versão disponível — Atualizar
      </Button>
    </div>
  );
}

export function UpdateBanner() {
  const hasUpdate = useAppUpdateAvailable();
  if (!hasUpdate) return null;

  return (
    <div className="rounded-xl border border-primary/40 bg-gradient-to-r from-primary/20 to-chart-5/20 backdrop-blur-xl p-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm">
        <RefreshCw className="h-4 w-4 text-primary animate-spin" />
        <span className="font-semibold">Nova versão disponível!</span>
        <span className="text-muted-foreground hidden sm:inline">Atualize para receber as últimas melhorias.</span>
      </div>
      <Button
        size="sm"
        onClick={() => window.location.reload()}
        className="bg-gradient-to-r from-primary to-info hover:opacity-90"
      >
        Atualizar agora
      </Button>
    </div>
  );
}
