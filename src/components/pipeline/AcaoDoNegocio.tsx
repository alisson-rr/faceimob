import { useId, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * Molde de toda ação da aba Negócio (pedido de 14/10/2026): o toggle à esquerda,
 * a ação descrita à direita, e as opções (comentário, campos, botão de confirmar)
 * só abrem com o toggle ligado. Quem confirma fecha o card.
 */
export function AcaoDoNegocio({
  titulo, descricao, aberta, onAlternar, desabilitado = false, aviso, tom = "neutro", children,
}: {
  titulo: string;
  descricao?: string;
  aberta: boolean;
  onAlternar: (ligado: boolean) => void;
  desabilitado?: boolean;
  /** Por que a ação não está disponível agora: aparece sob a descrição. */
  aviso?: string | null;
  tom?: "neutro" | "perigo" | "sucesso" | "atencao";
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <section
      className={cn(
        "space-y-3 rounded-lg border p-3",
        tom === "perigo" && "border-destructive/40 bg-destructive/5",
        tom === "sucesso" && "border-success/40 bg-success/5",
        tom === "atencao" && "border-warning/40 bg-warning/5",
        tom === "neutro" && "border-border/60",
      )}
    >
      <div className="flex items-start gap-3">
        <Switch id={id} className="mt-0.5 shrink-0" checked={aberta} disabled={desabilitado} onCheckedChange={onAlternar} />
        <div className="min-w-0 space-y-1">
          <Label htmlFor={id} className="text-sm font-bold">{titulo}</Label>
          {descricao && <p className="text-xs text-muted-foreground">{descricao}</p>}
          {aviso && <p className="text-xs text-muted-foreground">{aviso}</p>}
        </div>
      </div>
      {aberta && !desabilitado && children && <div className="space-y-2">{children}</div>}
    </section>
  );
}
