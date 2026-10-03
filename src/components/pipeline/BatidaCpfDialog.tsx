import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { bareStatus } from "@/lib/dealStatus";
import { dateTime } from "@/lib/format";
import type { NegocioDoCpf } from "@/integrations/supabase/batidaCpf";

/**
 * Resultado da batida de CPF (0179; 0205: ao sair do campo CPF, pedido de
 * 03/10/2026).
 *
 *  · ATIVO: não cadastra. Diz com quem o cliente está e o último comentário do
 *    negócio, e orienta a falar com o gerente sobre o fifty.
 *  · OFF ou QUEDA: o cliente já existe no Pipeline; "retomar" traz o negócio
 *    com tudo (dados, histórico, documentos) para quem cadastra, reaberto em
 *    PROPOSTA. Nenhum negócio novo é criado.
 *  · DISTRATO: só avisa. Já foi contabilizado em mês anterior; retomar é com o
 *    gerente.
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
  const cliente = negocio.cliente ?? "Este cliente";
  const corretor = negocio.corretor ?? "sem corretor";
  const gerente = negocio.gerente ?? "sem gerente";
  const status = negocio.status2 ? bareStatus(negocio.status2) : null;

  const quemEsta = (
    <>
      <strong className="text-foreground">{cliente}</strong> já está no Pipeline com o corretor{" "}
      <strong className="text-foreground">{corretor}</strong> e o gerente{" "}
      <strong className="text-foreground">{gerente}</strong>
      {status ? <> (Status 2: {status})</> : null}.
    </>
  );

  if (negocio.situacao === "ativo" || negocio.situacao === "distrato") {
    const distrato = negocio.situacao === "distrato";
    return (
      <Dialog open onOpenChange={(aberto) => { if (!aberto) onClose(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{distrato ? "Cliente com distrato no Pipeline" : "Cliente já está no Pipeline"}</DialogTitle>
            <DialogDescription>{quemEsta}</DialogDescription>
          </DialogHeader>
          {negocio.ultimo_comentario && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="text-eyebrow">
                Último comentário{negocio.ultimo_comentario_em ? ` · ${dateTime(negocio.ultimo_comentario_em)}` : ""}
              </p>
              <p className="mt-1 whitespace-pre-line">{negocio.ultimo_comentario}</p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {distrato
              ? "Este negócio já foi contabilizado em mês anterior. Para retomar, fale com o seu gerente."
              : "Fale com o seu gerente para combinar o fifty com o corretor do negócio. O cliente não foi cadastrado de novo."}
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
          <DialogTitle>Cliente já existe no Pipeline</DialogTitle>
          <DialogDescription>
            <strong className="text-foreground">{cliente}</strong> tem um negócio
            {status ? <> em <strong className="text-foreground">{status}</strong></> : " encerrado"} com o corretor{" "}
            {corretor} e o gerente {gerente}. Quer retomar a negociação?
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Retomando, o negócio vem para você com tudo o que já existe — dados do cliente, histórico e documentos — e
          volta para PROPOSTA, com o seu gerente e diretor. Nenhum cadastro novo é criado.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-comentario`}>Comentário (opcional)</Label>
          <Textarea
            id={`${id}-comentario`} rows={2} maxLength={2000}
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
          <Button variant="outline" onClick={onClose} disabled={enviando}>Não</Button>
          <Button onClick={() => onAssumir(comentario)} disabled={enviando}>
            {enviando ? "Retomando…" : "Sim, retomar negociação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
