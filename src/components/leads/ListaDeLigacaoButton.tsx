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
import { baixarCsv3c, buscarExportacao3c } from "./exportacao3c";

/** Botão e diálogo da lista de ligação (0185). Só aparece com `leads.call_list`. */
export function ListaDeLigacaoButton() {
  const { can, isAdmin } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [linhas, setLinhas] = useState<LinhaDeLigacao[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // 0339: mês e DDD opcionais; sem mês vale a regra antiga (ano até o mês passado).
  const [mes, setMes] = useState("");
  const [ddd, setDdd] = useState("");
  // 0360: mailing da 3C (CSV com lead_id), só admin e sócio.
  const [de3c, setDe3c] = useState("");
  const [ate3c, setAte3c] = useState("");
  const [exportando3c, setExportando3c] = useState(false);

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

  const exportar3c = async () => {
    if (!de3c || !ate3c || exportando3c) return;
    setExportando3c(true);
    try {
      const linhas3c = await buscarExportacao3c(de3c, ate3c);
      if (linhas3c.length === 0) {
        toast.info("Nenhum contato nesse período");
        return;
      }
      baixarCsv3c(linhas3c, de3c, ate3c);
      toast.success("CSV da 3C gerado", { description: `${linhas3c.length} contato(s), sem telefone repetido.` });
    } catch (err) {
      toast.error("Não foi possível gerar o CSV da 3C", { description: describeError(err, "Tente de novo em instantes.") });
    } finally {
      setExportando3c(false);
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
              {isAdmin
                ? "Leads que não viraram negócio, com campanha, cliente e telefone. Sem mês escolhido, vale o ano corrente até o mês passado, em ordem sortida e sem limite."
                : "Leads que não viraram negócio, com campanha, cliente e telefone: 500 contatos sorteados do ano corrente até o mês passado. Cada nova abertura sorteia outros."}
            </DialogDescription>
          </DialogHeader>
          {/* 0340: mês e DDD só para administrador e sócio; gerente e diretor seguem com a lista sortida. */}
          {isAdmin && <form
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
          </form>}
          <p className="text-sm" aria-live="polite">
            {linhas === null ? "Montando a lista…" : `${linhas.length} contato(s) para ligar.`}
          </p>
          {isAdmin && (
            <form
              className="space-y-2 rounded-lg border p-3"
              onSubmit={(e) => { e.preventDefault(); void exportar3c(); }}
            >
              <p className="text-sm font-medium">Exportação 3C</p>
              <p className="text-xs text-muted-foreground">
                CSV para o agente de voz: identificador (em branco), telefone, nome e lead_id. Telefone repetido sai uma vez.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label htmlFor="lista-3c-de">De</Label>
                  <Input id="lista-3c-de" type="month" className="h-9 w-40" value={de3c} onChange={(e) => setDe3c(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="lista-3c-ate">Até</Label>
                  <Input id="lista-3c-ate" type="month" className="h-9 w-40" value={ate3c} onChange={(e) => setAte3c(e.target.value)} />
                </div>
                <Button type="submit" variant="secondary" size="sm" disabled={!de3c || !ate3c || ate3c < de3c || exportando3c}>
                  <FileSpreadsheet className="h-4 w-4" /> {exportando3c ? "Gerando…" : "Baixar CSV 3C"}
                </Button>
              </div>
            </form>
          )}
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
