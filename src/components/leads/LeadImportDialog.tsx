import { useId, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle, Columns3, CopyCheck, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/shared";
import { toast } from "@/hooks/use-toast";
import { num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { createLeads, existingLeadPhones, type LeadSource, type NewLeadInput } from "@/integrations/supabase/leads";
import { useDistributionGroups, useInvalidateLeads } from "./data";
import { FileDropzone } from "./FileDropzone";
import {
  COLUMN_LABELS, explainEmptyImport, ImportError, mapColumns, parseSheet, rowsToLeads,
  splitDuplicates, type ColumnMap,
} from "./importSheet";

/** Cabeçalho + 10 linhas: a tabela é amostra, a importação leva o arquivo todo. */
const PREVIEW_ROWS = 11;

/**
 * Importação de planilha do Leadfy (CSV/XLSX).
 *
 * `rows` guarda o arquivo inteiro e a amostra é derivada na renderização — o
 * estado já guardou só as 11 primeiras linhas uma vez, e a importação levava 10
 * leads em silêncio (F03). O total aparece antes de confirmar, no texto e no
 * botão, justamente para esse erro não voltar sem ninguém perceber.
 *
 * Duas defesas que a prévia ganhou depois:
 *   · o MAPA DE COLUNAS, porque a prévia repete a planilha crua e não mostrava
 *     qual coluna virava qual campo — e-mail indo para o nome só aparecia
 *     depois de gravado;
 *   · a marcação de REPETIDOS, porque reimportar a mesma exportação criava
 *     todos os leads de novo e mandava dois corretores ao mesmo cliente.
 */
export function LeadImportDialog({
  sources, onClose,
}: {
  sources: LeadSource[];
  onClose: () => void;
}) {
  const invalidateLeads = useInvalidateLeads();
  const groupsQuery = useDistributionGroups();
  const fieldId = useId();
  /**
   * Grupo de distribuição do lote. Vazio = o banco decide
   * (`lead_distribution_group`: formulário → fila geral), que é o
   * comportamento antigo e continua sendo o padrão.
   */
  const [groupId, setGroupId] = useState("auto");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  /** Telefones já existentes no banco. `null` = a conferência não pôde rodar. */
  const [existentes, setExistentes] = useState<Set<string> | null>(null);
  const [avisoDedupe, setAvisoDedupe] = useState<string | null>(null);
  /** Lote que falhou depois de outros já terem entrado. Null = nada quebrou. */
  const [falhaParcial, setFalhaParcial] = useState<string | null>(null);

  const preview = rows.slice(0, PREVIEW_ROWS);
  const columns: ColumnMap | null = useMemo(() => (rows.length ? mapColumns(rows[0]) : null), [rows]);
  const grupoEscolhido = groupId === "auto" ? null : groupId;
  const payload = useMemo(
    () => (rows.length ? rowsToLeads(rows, sources, grupoEscolhido) : []),
    [rows, sources, grupoEscolhido],
  );
  // Por que 0: separador errado, coluna de nome ausente ou linhas sem nome têm
  // conserto diferente, e "0 leads serão importados" não dizia qual era.
  const motivoVazio = useMemo(
    () => (rows.length ? explainEmptyImport(rows, sources) : null),
    [rows, sources],
  );
  const { novos, repetidos } = useMemo(
    () => splitDuplicates<NewLeadInput>(payload, existentes ?? new Set()),
    [payload, existentes],
  );

  const receive = async (file: File) => {
    setError(null);
    setAvisoDedupe(null);
    setExistentes(null);
    setFalhaParcial(null);
    setProgress(0);
    let lidas: string[][];
    try {
      lidas = await parseSheet(file);
      setRows(lidas);
      setFileName(file.name);
    } catch (err) {
      setRows([]);
      setFileName("");
      setError(err instanceof ImportError ? err.message : "Não foi possível ler o arquivo.");
      return;
    }

    // A conferência de repetidos é do banco (`existing_lead_phones`): a
    // duplicata pode estar num lead de outra equipe, invisível para quem
    // importa. Falhar aqui não pode impedir a importação — avisa e segue.
    try {
      const phones = rowsToLeads(lidas, sources).map((lead) => lead.phone ?? "");
      setExistentes(await existingLeadPhones(phones));
    } catch (err) {
      setExistentes(null);
      setAvisoDedupe(describeError(err, "não foi possível conferir telefones já cadastrados"));
    }
  };

  // Linha sem telefone não é conferível: depois de uma falha parcial ela pode
  // ter entrado e reimportar duplicaria em silêncio.
  const semTelefone = falhaParcial ? novos.filter((lead) => !lead.phone?.trim()).length : 0;
  const bloqueado = Boolean(falhaParcial) && existentes === null;

  const confirm = async () => {
    if (!novos.length || bloqueado) return;
    setImporting(true);
    setProgress(0);
    try {
      const count = await createLeads(novos, (done) => setProgress(done));
      toast({
        title: `${num(count)} leads importados`,
        description: repetidos.length
          ? `Entraram na fila; ${num(repetidos.length)} linha(s) repetida(s) foram puladas.`
          : "Entraram na fila; a roleta distribui conforme o check-in.",
      });
      await invalidateLeads();
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro na importação",
        description: describeError(err, "não foi possível salvar os leads"),
      });
      // `createLeads` grava em lotes e para no primeiro que falha: os lotes
      // anteriores JÁ ESTÃO no banco. Sem recarregar, a lista não mostra o que
      // entrou e um segundo clique reinsere tudo — a duplicata na roleta que o
      // dedupe existe para impedir. Reconferir os telefones marca o que já
      // entrou como repetido, e o botão passa a importar só o restante.
      setFalhaParcial(describeError(err, "não foi possível salvar os leads"));
      await invalidateLeads();
      try {
        setExistentes(await existingLeadPhones(payload.map((lead) => lead.phone ?? "")));
      } catch (recheck) {
        // Sem a reconferência não dá para saber o que entrou: reimportar às
        // cegas duplica. O botão fica travado até recarregar a planilha.
        setExistentes(null);
        setAvisoDedupe(describeError(recheck, "não foi possível reconferir os telefones já cadastrados"));
      }
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

        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-group`}>Grupo de distribuição</Label>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger id={`${fieldId}-group`}>
              <SelectValue placeholder="Deixar o sistema decidir" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Deixar o sistema decidir (fila geral)</SelectItem>
              {(groupsQuery.data ?? []).map((group) => (
                <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {groupsQuery.error
              ? describeError(groupsQuery.error, "não foi possível carregar os grupos; o lote cai na fila geral")
              : "É a fila que vai distribuir estes leads. Sem escolha, todos caem na fila geral — os outros grupos ficavam inalcançáveis por planilha."}
          </p>
        </div>

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

        {rows.length > 0 && columns && (
          <>
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{num(novos.length)} leads</span> serão
              importados de {num(rows.length - 1)} linhas
              {rows.length > preview.length && ` — a tabela abaixo mostra as ${preview.length - 1} primeiras`}.
            </p>

            {motivoVazio && (
              <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{motivoVazio}</span>
              </p>
            )}

            {/* Qual coluna vira qual campo: a prévia repetia a planilha crua e o
                erro de mapeamento só aparecia depois de gravado. */}
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-3 py-2">
              <Columns3 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              {(Object.keys(COLUMN_LABELS) as (keyof ColumnMap)[]).map((field) => (
                <StatusBadge key={field} tone={columns[field] >= 0 ? "info" : "neutral"}>
                  {COLUMN_LABELS[field]}
                  {columns[field] >= 0
                    ? ` → ${rows[0][columns[field]] || `coluna ${columns[field] + 1}`}`
                    : " → não encontrada"}
                </StatusBadge>
              ))}
            </div>

            {repetidos.length > 0 && (
              <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                <CopyCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {num(repetidos.length)} linha(s) com telefone já cadastrado serão puladas
                  ({repetidos.slice(0, 3).map((lead) => lead.full_name).join(", ")}
                  {repetidos.length > 3 ? "…" : ""}). Duplicata na roleta faz dois corretores
                  atenderem o mesmo cliente.
                </span>
              </p>
            )}

            {falhaParcial && (
              <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  A importação parou no meio: {falhaParcial}
                  {bloqueado
                    ? ". Não deu para conferir o que já entrou — recarregue a planilha antes de tentar de novo, ou os leads gravados entrariam duas vezes."
                    : `. Os leads que já entraram estão marcados como repetidos acima; o botão importa só as ${num(novos.length)} linha(s) que faltam.`}
                  {semTelefone > 0 && ` Atenção: ${num(semTelefone)} dessas linhas não têm telefone e não podem ser conferidas — confira na lista antes de repetir.`}
                </span>
              </p>
            )}

            {avisoDedupe && (
              <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{avisoDedupe}. As linhas repetidas não foram marcadas — confira antes de importar.</span>
              </p>
            )}

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
          <Button onClick={confirm} disabled={!novos.length || importing || bloqueado}>
            <CheckCircle className="h-4 w-4" />
            {importing
              ? `Importando ${num(progress)} de ${num(novos.length)}…`
              : bloqueado
                ? "Recarregue a planilha"
                : `Importar ${num(novos.length)} leads`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
