import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { bareStatus } from "@/lib/dealStatus";
import type { NegocioDoCpf } from "@/integrations/supabase/batidaCpf";

/**
 * Resultado da batida de CPF na criação do negócio (0179, pedido de 01/10/2026).
 *
 *  · ATIVO: não cadastra. Diz com quem o cliente está para o corretor levar a
 *    situação ao gerente dele.
 *  · ENCERRADO (OFF, QUEDA, DISTRATO): o corretor assume aquele negócio, com
 *    comentário obrigatório. Nenhum negócio novo é criado.
 */
export function BatidaCpfDialog({ negocio, enviando, erro, onAssumir, onClose }: {
  negocio: NegocioDoCpf;
  enviando: boolean;
  erro: string | null;
  onAssumir: (comentario: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [comentario, setComentario] = useState("");
  const limpo = comentario.trim();
  const cliente = negocio.cliente ?? "Este cliente";
  const corretor = negocio.corretor ?? "sem corretor";
  const gerente = negocio.gerente ?? "sem gerente";
  const status = negocio.status2 ? bareStatus(negocio.status2) : null;

  if (negocio.situacao === "ativo") {
    return (
      <Dialog open onOpenChange={(aberto) => { if (!aberto) onClose(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>CPF já cadastrado</DialogTitle>
            <DialogDescription>
              <strong className="text-foreground">{cliente}</strong> já está cadastrado com o corretor{" "}
              <strong className="text-foreground">{corretor}</strong> e o gerente{" "}
              <strong className="text-foreground">{gerente}</strong>
              {status ? <> (Status 2: {status})</> : null}.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Reporte a situação ao seu gerente para ele verificar o andamento. O negócio não foi cadastrado de novo.
          </p>
          <DialogFooter>
            <Button onClick={onClose}>Entendi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(aberto) => { if (!aberto && !enviando) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>CPF com negócio encerrado</DialogTitle>
          <DialogDescription>
            <strong className="text-foreground">{cliente}</strong> tem um negócio
            {status ? <> em <strong className="text-foreground">{status}</strong></> : " encerrado"} com o corretor{" "}
            {corretor} e o gerente {gerente}.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Para seguir, assuma esse negócio: os dados do cliente vêm junto e você passa a ser o corretor, com o seu
          gerente e diretor. Nenhum cadastro novo é criado.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-comentario`}>Comentário (obrigatório)</Label>
          <Textarea
            id={`${id}-comentario`} rows={3} maxLength={2000} required
            value={comentario} onChange={(e) => setComentario(e.target.value)}
            aria-describedby={erro ? `${id}-erro` : undefined}
            placeholder="Ex.: cliente voltou pelo site e quer retomar a compra."
          />
        </div>
        {erro && (
          <p id={`${id}-erro`} role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            {erro}
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button onClick={() => onAssumir(limpo)} disabled={limpo.length < 5 || enviando}>
            {enviando ? "Assumindo…" : "Assumir negócio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
