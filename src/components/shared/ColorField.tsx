import { Button } from "@/components/ui/button";

/**
 * Seletor de cor nativo com o estado escrito ao lado. Usado na cor da
 * construtora (0152), da coluna da CCA (0153) e do Status 2 (0180): todos
 * gravam `#RRGGBB`, que é o que `<input type="color">` devolve.
 *
 * O seletor nativo não tem "vazio" (mostra preto): o texto ao lado diz o estado,
 * e "Sem cor" devolve `""` — quem usa decide o que isso grava.
 */
export function ColorField({ id, value, onChange, emptyLabel = "Sem cor (automática)", allowEmpty = true }: {
  id: string;
  value: string;
  onChange: (color: string) => void;
  /** O que "Sem cor" significa nesta tela. */
  emptyLabel?: string;
  /** Algumas entidades sempre precisam de uma cor sólida. */
  allowEmpty?: boolean;
}) {
  return (
    <div className="flex h-8 items-center gap-2">
      <input
        id={id}
        type="color"
        value={value || "#000000"}
        onChange={e => onChange(e.target.value)}
        aria-describedby={`${id}-estado`}
        className="h-8 w-10 shrink-0 cursor-pointer rounded-xl border border-input bg-background p-0.5"
      />
      <span id={`${id}-estado`} className="min-w-0 truncate text-xs text-muted-foreground">
        {value ? value.toUpperCase() : emptyLabel}
      </span>
      {allowEmpty && value && (
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onChange("")}>
          Sem cor
        </Button>
      )}
    </div>
  );
}
