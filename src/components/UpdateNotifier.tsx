import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

/**
 * Periodically polls the current HTML and compares the bundled asset hash.
 * If it changes (new deploy), shows a floating button prompting the user to reload.
 */
export function useAppUpdateAvailable() {
  const [hasUpdate, setHasUpdate] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") return;

    let initial: string | null = null;
    let cancelled = false;

    const fetchSignature = async (): Promise<string | null> => {
      try {
        const url = `${window.location.origin}/index.html?_=${Date.now()}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return null;
        const html = await res.text();
        // Coleta TODOS os assets referenciados (js/css) — mais robusto que 1 bundle só
        const matches = html.match(/\/assets\/[A-Za-z0-9_-]+\.(?:js|css)/g);
        if (matches && matches.length) return matches.sort().join("|");
        // Fallback: comprimento do HTML (muda quando o build muda)
        return `len:${html.length}`;
      } catch {
        return null;
      }
    };

    const init = async () => {
      for (let i = 0; i < 5 && !cancelled; i++) {
        const s = await fetchSignature();
        if (s) { initial = s; return; }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    init();

    const check = async () => {
      if (!initial) { await init(); return; }
      const current = await fetchSignature();
      if (current && current !== initial) setHasUpdate(true);
    };

    const interval = window.setInterval(check, 30_000);
    const onFocus = () => check();
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
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
        className="shadow-lg gap-2 bg-gradient-to-r from-primary to-blue-600 hover:opacity-90"
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
    <div className="rounded-xl border border-primary/40 bg-gradient-to-r from-primary/20 to-fuchsia-500/20 backdrop-blur-xl p-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm">
        <RefreshCw className="h-4 w-4 text-primary animate-spin" />
        <span className="font-semibold">Nova versão disponível!</span>
        <span className="text-muted-foreground hidden sm:inline">Atualize para receber as últimas melhorias.</span>
      </div>
      <Button
        size="sm"
        onClick={() => window.location.reload()}
        className="bg-gradient-to-r from-primary to-blue-600 hover:opacity-90"
      >
        Atualizar agora
      </Button>
    </div>
  );
}
