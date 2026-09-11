import { useId, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { ERRO_XLS } from "./importSheet";

/**
 * O arquivo casa com o `accept`?
 *
 * O atributo só filtra a janela de escolha do `<input type="file">`; o arquivo
 * ARRASTADO passava direto por ele — era por aí que um binário com a extensão
 * trocada chegava ao leitor de planilha. As duas formas que o `accept` aceita
 * valem aqui: extensão (".csv") e tipo MIME ("image/*", "application/pdf").
 *
 * Filtro de intenção, não de segurança: quem valida de verdade é quem lê o
 * conteúdo do arquivo (`parseSheet` confere a assinatura dos bytes).
 */
export const aceitaArquivo = (file: File, accept?: string): boolean => {
  if (!accept?.trim()) return true;
  const nome = file.name.toLowerCase();
  const tipo = file.type.toLowerCase();
  return accept
    .split(",")
    .map((regra) => regra.trim().toLowerCase())
    .filter(Boolean)
    .some((regra) => {
      if (regra.startsWith(".")) return nome.endsWith(regra);
      if (regra.endsWith("/*")) return tipo.startsWith(regra.slice(0, -1));
      return tipo === regra;
    });
};

/**
 * Por que este arquivo não serve — na linguagem do problema dele.
 *
 * A frase genérica ("não é um dos formatos aceitos") é o que sobra quando o
 * filtro do `drop` responde antes do parser. Para o `.xls` isso apagava a única
 * instrução acionável que existia: o formato de 97-2003 não é lido por
 * NENHUMA tela daqui, e o conserto é salvar de novo — não trocar de arquivo.
 * A frase é a mesma de `parseSheet` de propósito: uma regra, um texto.
 */
export const mensagemRecusa = (file: File, accept = ""): string =>
  /\.xls$/i.test(file.name) && /\.(xlsx|csv)/i.test(accept)
    ? ERRO_XLS
    : `“${file.name}” não é um dos formatos aceitos (${accept}).`;

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
  const alertaId = useId();
  const [over, setOver] = useState(false);
  /** Arquivo solto que não casa com o `accept`. Recusar em silêncio seria pior
   *  do que aceitar: a tela ficaria igual e ninguém saberia por quê. */
  const [recusado, setRecusado] = useState<string | null>(null);

  const receber = (file: File) => {
    if (!aceitaArquivo(file, accept)) {
      setRecusado(mensagemRecusa(file, accept));
      return;
    }
    setRecusado(null);
    onFile(file);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) receber(file);
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
          if (file) receber(file);
        }}
        aria-describedby={recusado ? alertaId : undefined}
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
      {recusado && (
        <p id={alertaId} role="alert" className="mt-1 text-xs text-destructive">{recusado}</p>
      )}
    </>
  );
}
