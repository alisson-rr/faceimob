import { useState } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import { cpfDigitos, negocioDoCpf, type NegocioDoCpf } from "@/integrations/supabase/batidaCpf";
import { promoteLeadAttachments, vincularLeadAoNegocio, type LeadRecord } from "@/integrations/supabase/leads";
import { useInvalidateLeads } from "./data";

/**
 * Vincular o lead a um negócio que já existe (14/10/2026). O corretor esqueceu de
 * converter e criou o negócio à mão: pelo CPF do cliente o sistema acha o negócio
 * e liga o lead a ele, sem criar cadastro duplo. O banco confere que o CPF é de um
 * cliente do negócio e que quem vincula pode mexer nos dois.
 */
export function VincularNegocioDialog({
  lead, onClose, onVinculado,
}: {
  lead: LeadRecord;
  onClose: () => void;
  onVinculado?: () => void;
}) {
  const invalidateLeads = useInvalidateLeads();
  const [cpf, setCpf] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [vinculando, setVinculando] = useState(false);
  const [negocio, setNegocio] = useState<NegocioDoCpf | null>(null);
  const [semNegocio, setSemNegocio] = useState(false);

  const digitos = cpfDigitos(cpf);
  const cpfCompleto = digitos.length === 11;

  const buscar = async () => {
    if (!cpfCompleto) return;
    setBuscando(true);
    setNegocio(null);
    setSemNegocio(false);
    try {
      const achado = await negocioDoCpf([digitos]);
      setNegocio(achado);
      setSemNegocio(!achado);
    } catch (erro) {
      toast({ variant: "destructive", title: "Não foi possível buscar o negócio", description: describeError(erro, "Tente de novo.") });
    } finally {
      setBuscando(false);
    }
  };

  const vincular = async () => {
    if (!negocio) return;
    setVinculando(true);
    try {
      await vincularLeadAoNegocio(lead.id, negocio.deal_id, digitos);
    } catch (erro) {
      toast({ variant: "destructive", title: "Não foi possível vincular", description: describeError(erro, "Confira o CPF e a permissão sobre o lead e o negócio.") });
      setVinculando(false);
      return;
    }
    // Daqui em diante o lead já está ligado: falha na cópia do anexo avisa e não desfaz.
    try {
      await promoteLeadAttachments(lead.id);
      toast({ variant: "success", title: "Lead vinculado ao negócio", description: `${lead.name} agora está ligado a ${negocio.cliente ?? "o negócio"}.` });
    } catch (erro) {
      toast({ variant: "destructive", title: "Lead vinculado, mas o anexo não foi copiado", description: describeError(erro, "Anexe o documento de novo na aba Anexos do negócio.") });
    }
    await invalidateLeads();
    onVinculado?.();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(aberto) => { if (!aberto) onClose(); }}>
      <DialogContent className="glass-strong max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-success" aria-hidden /> Vincular a negócio existente
          </DialogTitle>
          <DialogDescription>
            Já criou o negócio de {lead.name} à mão? Informe o CPF do cliente: o lead é ligado ao negócio que já existe, sem cadastro duplo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="vincular-cpf">CPF do cliente</Label>
          <div className="flex gap-2">
            <Input
              id="vincular-cpf" inputMode="numeric" autoComplete="off" maxLength={14} placeholder="000.000.000-00"
              value={cpf}
              onChange={(e) => { setCpf(e.target.value); setNegocio(null); setSemNegocio(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") void buscar(); }}
            />
            <Button type="button" variant="outline" disabled={!cpfCompleto || buscando} onClick={() => void buscar()}>
              {buscando ? "Buscando…" : "Buscar"}
            </Button>
          </div>
        </div>

        {semNegocio && (
          <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs">
            Nenhum negócio com esse CPF. Crie o negócio ou use "Converter" para criar um a partir do lead.
          </p>
        )}

        {negocio && (
          <div className="space-y-1 rounded-xl bg-muted/60 p-3 text-xs">
            <p className="text-sm font-semibold text-foreground">{negocio.cliente ?? "Cliente sem nome"}{negocio.codigo ? ` · ${negocio.codigo}` : ""}</p>
            <p className="text-muted-foreground">Status 2: {negocio.status2 ?? "—"} · Corretor: {negocio.corretor ?? "—"}</p>
            <p className="text-muted-foreground">Gerente: {negocio.gerente ?? "—"}</p>
            {negocio.situacao !== "ativo" && (
              <p className="text-warning">Este negócio está {negocio.situacao === "distrato" ? "em distrato" : "encerrado"}. Confirme que é o certo antes de vincular.</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="button" variant="success" disabled={!negocio || vinculando} onClick={() => void vincular()}>
            {vinculando ? "Vinculando…" : "Vincular e converter lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
