import { useId, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * "Em análise" e "Esteira Ágil" escolhidos no Status 2 da ficha (pedido de
 * 01/10/2026): em vez de um item cinza "fora da sua função", o corretor recebe
 * a explicação de que a análise começa pela conferência do gerente e o botão
 * que faz o envio. Quem envia de fato é `submit_deal_for_manager_review`, o
 * mesmo da aba Anexos; o motivo de uma recusa (documento faltando, construtora)
 * volta em `erro` e o operador segue para a aba Anexos.
 */
export function ConferenciaGerenteDialog({ cliente, isNew, enviando, erro, onEnviar, onAnexos, onClose }: {
  cliente: string;
  isNew: boolean;
  enviando: boolean;
  erro: string | null;
  onEnviar: (mensagem: string) => void;
  onAnexos: (mensagem: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [mensagem, setMensagem] = useState("");
  const limpa = mensagem.trim();

  return (
    <Dialog open onOpenChange={(aberto) => { if (!aberto && !enviando) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Conferência do gerente</DialogTitle>
          <DialogDescription>
            A análise começa pela conferência dos documentos pelo gerente.
            Quando ele aprovar, {cliente.trim() || "o negócio"} entra na Esteira Ágil e segue para o CCA.
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
          {isNew && <li>O negócio é criado com o que você preencheu.</li>}
          <li>Os documentos obrigatórios precisam estar anexados (aba Anexos).</li>
          <li>O gerente recebe o aviso com a sua mensagem e confere.</li>
        </ol>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-mensagem`}>Mensagem para o gerente</Label>
          <Textarea
            id={`${id}-mensagem`} rows={3} maxLength={4000} required
            value={mensagem} onChange={(e) => setMensagem(e.target.value)}
            aria-describedby={erro ? `${id}-erro` : undefined}
            placeholder="Ex.: dossiê completo, renda formal, cliente quer a Esteira Ágil."
          />
        </div>
        {erro && (
          <p id={`${id}-erro`} role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            {erro}
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onAnexos(limpa)} disabled={enviando}>
            {isNew ? "Criar e anexar documentos" : "Anexar documentos"}
          </Button>
          <Button onClick={() => onEnviar(limpa)} disabled={!limpa || enviando} className="gap-1">
            <Send className="h-3.5 w-3.5" aria-hidden />
            {enviando ? "Enviando…" : "Enviar ao gerente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
