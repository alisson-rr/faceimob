import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

/**
 * Periodically polls the current HTML and compares the bundled asset hash.
 * If it changes (new deploy), shows a floating button prompting the user to reload.
 */
export function UpdateNotifier() {
  const [hasUpdate, setHasUpdate] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hostname === "localhost") return;

    let initial: string | null = null;

    const fetchHash = async (): Promise<string | null> => {
      try {
        const res = await fetch(`${window.location.origin}/index.html`, { cache: "no-store" });
        const html = await res.text();
        // Extract the built JS bundle path (unique per build)
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

    const interval = window.setInterval(check, 60_000); // a cada 1 min
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

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
