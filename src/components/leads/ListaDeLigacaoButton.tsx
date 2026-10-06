import { useState } from "react";
import { FileSpreadsheet, FileText, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { describeError } from "@/lib/supabaseError";
import { useAuth } from "@/contexts/AuthContext";
import {
  baixarListaExcel, baixarListaPdf, buscarListaDeLigacao, type LinhaDeLigacao,
} from "./listaDeLigacao";

/** Botão e diálogo da lista de ligação (0185). Só aparece com `leads.call_list`. */
export function ListaDeLigacaoButton() {
  const { can } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [linhas, setLinhas] = useState<LinhaDeLigacao[] | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (!can("leads.call_list")) return null;

  const abrir = async () => {
    setAberto(true);
    setLinhas(null);
    try {
      setLinhas(await buscarListaDeLigacao());
    } catch (err) {
      setAberto(false);
      toast.error("Não foi possível montar a lista", { description: describeError(err, "Tente de novo em instantes.") });
    }
  };

  const baixar = async (formato: "pdf" | "xlsx") => {
    if (!linhas?.length) return;
    setOcupado(true);
    try {
      await (formato === "pdf" ? baixarListaPdf(linhas) : baixarListaExcel(linhas));
      toast.success("Lista gerada", { description: `${linhas.length} contato(s).` });
    } catch (err) {
      toast.error("Não foi possível gerar o arquivo", { description: describeError(err, "Tente de novo em instantes.") });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => void abrir()}>
        <PhoneCall className="h-4 w-4" /> Lista de ligação
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lista de ligação</DialogTitle>
            <DialogDescription>
              Leads de antes deste mês que não viraram negócio, com campanha, cliente e telefone.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm" aria-live="polite">
            {linhas === null ? "Montando a lista…" : `${linhas.length} contato(s) para ligar.`}
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" disabled={!linhas?.length || ocupado} onClick={() => void baixar("xlsx")}>
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
            <Button disabled={!linhas?.length || ocupado} onClick={() => void baixar("pdf")}>
              <FileText className="h-4 w-4" /> PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
