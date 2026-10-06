import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type Opcao = { value: string; label: string; active: boolean };

/**
 * Status 2 com vários marcados de uma vez (pedido de 02/10/2026). Botão com a
 * lista de caixas abaixo; fecha com Esc ou clique fora. Vazio = todos.
 */
export function Status2Multi({ id, valores, opcoes, onChange, nome = "Status 2" }: {
  id: string;
  valores: string[];
  opcoes: Opcao[];
  onChange: (valores: string[]) => void;
  /** "Status 2" ou "Status 1": o rótulo do "todos" e do grupo de caixas. */
  nome?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const rotulo = valores.length === 0
    ? `Todos os ${nome}`
    : valores.length === 1
      ? opcoes.find((o) => o.value === valores[0])?.label ?? valores[0]
      : `${valores.length} status selecionados`;

  const alternar = (valor: string, marcado: boolean) =>
    onChange(marcado ? [...valores, valor] : valores.filter((v) => v !== valor));

  return (
    <div ref={caixa} className="relative mt-1">
      <button
        id={id}
        type="button"
        aria-haspopup="true"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-xl border border-input bg-background px-3.5 py-2 text-sm",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        )}
      >
        <span className="truncate">{rotulo}</span>
        <ChevronDown className="h-4 w-4 opacity-50" aria-hidden />
      </button>
      {aberto && (
        <div
          role="group"
          aria-label={nome}
          className="absolute z-50 mt-1 max-h-80 w-full min-w-[14rem] overflow-y-auto rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg"
        >
          {valores.length > 0 && (
            <button type="button" className="mb-1 w-full rounded-md px-2 py-1 text-left text-xs text-primary hover:bg-muted" onClick={() => onChange([])}>
              Limpar seleção
            </button>
          )}
          {opcoes.map((o) => {
            const campo = `${id}-${o.value}`;
            return (
              <label key={o.value} htmlFor={campo} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                <Checkbox id={campo} checked={valores.includes(o.value)} onCheckedChange={(c) => alternar(o.value, c === true)} />
                <span>{o.label}</span>
                {!o.active && <span className="text-muted-foreground">(inativo)</span>}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
