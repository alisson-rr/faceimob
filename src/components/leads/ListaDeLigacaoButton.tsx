import { useState } from "react";
import { FileSpreadsheet, FileText, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  // 0339: mês e DDD opcionais; sem mês vale a regra antiga (ano até o mês passado).
  const [mes, setMes] = useState("");
  const [ddd, setDdd] = useState("");

  if (!can("leads.call_list")) return null;

  const montar = async (filtro?: { mes: string; ddd: string }) => {
    setLinhas(null);
    try {
      setLinhas(await buscarListaDeLigacao(filtro?.mes ? filtro : undefined));
    } catch (err) {
      setLinhas([]);
      toast.error("Não foi possível montar a lista", { description: describeError(err, "Tente de novo em instantes.") });
    }
  };

  const abrir = async () => {
    setAberto(true);
    setMes("");
    setDdd("");
    await montar();
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
              Leads que não viraram negócio, com campanha, cliente e telefone. Sem mês escolhido, vale o ano
              corrente até o mês passado.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => { e.preventDefault(); void montar({ mes, ddd }); }}
          >
            <div className="space-y-1">
              <Label htmlFor="lista-mes">Mês</Label>
              <Input id="lista-mes" type="month" className="h-9 w-40" value={mes} onChange={(e) => setMes(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lista-ddd">DDD</Label>
              <Input
                id="lista-ddd" inputMode="numeric" maxLength={2} placeholder="Todos" className="h-9 w-20"
                value={ddd} onChange={(e) => setDdd(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <Button type="submit" variant="secondary" size="sm" disabled={linhas === null || !mes || (ddd !== "" && ddd.length !== 2)}>
              Atualizar lista
            </Button>
          </form>
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
