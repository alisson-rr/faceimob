import { useMemo, useState } from "react";
import { CheckCircle, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { createLeads, type LeadSource } from "@/integrations/supabase/leads";
import { useInvalidateLeads } from "./data";
import { FileDropzone } from "./FileDropzone";
import { ImportError, parseSheet, rowsToLeads } from "./importSheet";

/** Cabeçalho + 10 linhas: a tabela é amostra, a importação leva o arquivo todo. */
const PREVIEW_ROWS = 11;

/**
 * Importação de planilha do Leadfy (CSV/XLSX).
 *
 * `rows` guarda o arquivo inteiro e a amostra é derivada na renderização — o
 * estado já guardou só as 11 primeiras linhas uma vez, e a importação levava 10
 * leads em silêncio (F03). O total aparece antes de confirmar, no texto e no
 * botão, justamente para esse erro não voltar sem ninguém perceber.
 */
export function LeadImportDialog({
  sources, onClose,
}: {
  sources: LeadSource[];
  onClose: () => void;
}) {
  const invalidateLeads = useInvalidateLeads();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const preview = rows.slice(0, PREVIEW_ROWS);
  const payload = useMemo(() => (rows.length ? rowsToLeads(rows, sources) : []), [rows, sources]);

  const receive = async (file: File) => {
    setError(null);
    try {
      setRows(await parseSheet(file));
      setFileName(file.name);
    } catch (err) {
      setRows([]);
      setFileName("");
      setError(err instanceof ImportError ? err.message : "Não foi possível ler o arquivo.");
    }
  };

  const confirm = async () => {
    if (!payload.length) return;
    setImporting(true);
    try {
      const count = await createLeads(payload);
      toast({
        title: `${num(count)} leads importados`,
        description: "Entraram na fila; a roleta distribui conforme o check-in.",
      });
      await invalidateLeads();
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro na importação",
        description: describeError(err, "não foi possível salvar os leads"),
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="glass-strong max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-success" aria-hidden /> Importar leads (CSV/XLSX)
          </DialogTitle>
          <DialogDescription>
            Os leads entram na fila da roleta, sem corretor. As colunas de nome, telefone,
            e-mail, origem e observação são reconhecidas pelo cabeçalho da planilha.
          </DialogDescription>
        </DialogHeader>

        <FileDropzone
          label={fileName || "Solte a planilha aqui ou clique para escolher"}
          hint="CSV ou XLSX exportado do Leadfy · até 8 MB"
          accept=".csv,.xlsx,.xls"
          onFile={receive}
        />

        {error && (
          <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {rows.length > 0 && (
          <>
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{num(payload.length)} leads</span> serão
              importados de {num(rows.length - 1)} linhas
              {rows.length > preview.length && ` — a tabela abaixo mostra as ${preview.length - 1} primeiras`}.
            </p>
            <div className="max-h-60 overflow-y-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {preview[0]?.map((header, index) => (
                      <TableHead key={index} className="whitespace-nowrap">{header || `Coluna ${index + 1}`}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slice(1).map((row, rowIndex) => (
                    <TableRow key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <TableCell key={cellIndex} className="whitespace-nowrap text-xs">{cell}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
          <Button onClick={confirm} disabled={!payload.length || importing}>
            <CheckCircle className="h-4 w-4" />
            {importing ? "Importando…" : `Importar ${num(payload.length)} leads`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
