import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Área de soltar arquivo que realmente recebe o arquivo.
 *
 * O achado P14 era um dropzone que só emitia um toast: arrastar não fazia nada
 * e a instrução mandava o usuário para outra tela. Aqui o `drop` e o clique
 * caem no mesmo `onFile`.
 *
 * É um `<button>` de propósito — um `<div onClick>` não recebe foco nem responde
 * a Enter/Espaço, e o `<input type="file">` escondido continua sendo o caminho
 * de teclado e de leitor de tela (X06/T13).
 */
export function FileDropzone({
  label, hint, accept, onFile, className,
}: {
  label: string;
  hint?: string;
  accept?: string;
  onFile: (file: File) => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          // Permite escolher o mesmo arquivo duas vezes seguidas.
          event.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const file = event.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        className={cn(
          "flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          over ? "border-primary bg-primary/10" : "border-input hover:border-primary/60 hover:bg-muted/50",
          className,
        )}
      >
        <UploadCloud className="h-6 w-6 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium text-foreground">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </button>
    </>
  );
}
