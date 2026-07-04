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
    if (window.location.hostname === "localhost") return;

    let initial: string | null = null;

    const fetchHash = async (): Promise<string | null> => {
      try {
        const res = await fetch(`${window.location.origin}/index.html`, { cache: "no-store" });
        const html = await res.text();
        const m = html.match(/\/assets\/[A-Za-z0-9_-]+\.js/);
        return m ? m[0] : null;
      } catch {
        return null;
      }
    };

    (async () => {
      initial = await fetchHash();
    })();

    const check = async () => {
      const current = await fetchHash();
      if (current && initial && current !== initial) setHasUpdate(true);
    };

    const interval = window.setInterval(check, 60_000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
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
