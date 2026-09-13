import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, CalendarRange, CheckCircle, Columns3, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge, type StatusTone } from "@/components/shared";
import { FileDropzone } from "@/components/leads/FileDropzone";
import { ImportError, parseSheet } from "@/components/leads/importSheet";
import { adSpendBook, importMetaSpend } from "@/integrations/supabase/analytics";
import { brl, date, num } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import {
  COLUNA_LABEL, conciliar, mapearColunas, paraImportacao, resumir,
  type CampanhaCadastrada, type ColunaDoRelatorio, type EstadoDaLinha, type LinhaConciliada,
  type LinhaDoLivro,
} from "./metaReport";

/** Quantas linhas a tabela desenha. O RESUMO conta todas — a prévia é amostra,
 *  e é por isso que os números da frase acima dela não saem daqui. */
const PREVIA = 50;

const TOM: Record<EstadoDaLinha, StatusTone> = {
  nova: "success",
  substitui: "info",
  "sem-campanha": "warning",
  ambigua: "danger",
  invalida: "danger",
  repetida: "warning",
};

const ROTULO: Record<EstadoDaLinha, string> = {
  nova: "grava",
  substitui: "substitui",
  "sem-campanha": "sem campanha",
  ambigua: "ambígua, escolha",
  invalida: "não lida",
  repetida: "repetida",
};

/** Problema primeiro: a linha que NÃO vai entrar é a que precisa ser vista, e
 *  ela costuma estar no fim de um arquivo de duzentas campanhas. A ambígua vem
 *  antes de todas — é a única que o operador consegue resolver aqui mesmo. */
const ORDEM: Record<EstadoDaLinha, number> = {
  ambigua: 0, invalida: 1, "sem-campanha": 2, repetida: 3, substitui: 4, nova: 5,
};

/** Duas frases de `parseSheet` falam de lead e do Leadfy — ele nasceu para a
 *  planilha de leads e é reusado aqui inteiro (mesmo teto de bytes, mesmo
 *  leitor). O arquivo daqui é outro, e a instrução precisa apontar para o lugar
 *  certo de onde reexportar. */
const comLinguagemDaMeta = (mensagem: string) =>
  mensagem
    .replace("exportado do Leadfy", "exportado do Gerenciador de Anúncios")
    .replace("ao menos um lead", "ao menos uma campanha");

/** Duas somas de centavos em ponto flutuante não fecham na última casa (a soma
 *  por campanha não segue a ordem da soma por linha). Comparar em centavos
 *  evita acender o aviso de "o total muda" por um erro de 1e-12. */
const emCentavos = (valor: number) => Math.round(valor * 100);

const periodoDaLinha = (linha: LinhaConciliada) => {
  if (!linha.inicio || !linha.fim) return "—";
  return linha.inicio === linha.fim ? date(linha.inicio) : `${date(linha.inicio)} a ${date(linha.fim)}`;
};

export interface MetaReportImportDialogProps {
  /** As campanhas que a tela já carregou: o casamento é com elas, sem segunda consulta. */
  campanhas: CampanhaCadastrada[];
  onClose: () => void;
  /** Recarrega a tela depois de gravar — o gasto muda CPL, ROAS e os KPIs. */
  onImported: () => void;
}

/**
 * Importa o relatório do Gerenciador de Anúncios da Meta (CSV/XLSX).
 *
 * POR QUE ARQUIVO: a Marketing API exige app revisado pela Meta e token de longa
 * duração com `ads_read`, que o cofre não tem. O relatório exportado traz o
 * mesmo gasto e depende só de quem já entra no Gerenciador.
 *
 * A PRÉVIA mostra o que vai acontecer com cada linha, e não a planilha crua: o
 * erro que importa aqui não é de digitação, é de casamento — linha que não
 * achou campanha e período que se sobrepõe a um relatório já importado. As duas
 * aparecem com motivo antes de qualquer gravação. Nome repetido no cadastro não
 * casa sozinho: a linha fica ambígua e o operador escolhe.
 *
 * E o valor anunciado é o que VAI FICAR GRAVADO, não a soma do arquivo: a
 * importação regrava o gasto da campanha como a soma de todos os períodos do
 * livro dela, então a prévia carrega o livro (`adSpendBook`) para prometer o
 * número certo.
 *
 * Reimportar o mesmo arquivo não duplica: a chave é campanha + período, e a
 * gravação inteira é uma transação só (`marketing_import_ad_spend`, 0113).
 */
export function MetaReportImportDialog({ campanhas, onClose, onImported }: MetaReportImportDialogProps) {
  // `useToast`, e não o `toast` solto: é o que o painel que abre este diálogo já
  // usa, e um segundo caminho para a mesma fila não tem motivo.
  const { toast } = useToast();
  const campoId = useId();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  /** Período informado à mão — só entra em jogo quando o arquivo veio sem as
   *  colunas de data. Sem ele, gasto sem período não tem como ser guardado. */
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  /** Campanha escolhida à mão para uma linha ambígua: nº da linha → id. Sem
   *  isso, duas campanhas homônimas faziam o gasto cair numa delas ao acaso. */
  const [escolhas, setEscolhas] = useState<Record<number, string>>({});
  /** O gasto já gravado das campanhas. É o que permite dizer quanto o campo vai
   *  valer DEPOIS — a soma do arquivo não é o que fica gravado. */
  const [livro, setLivro] = useState<LinhaDoLivro[]>([]);
  const [livroErro, setLivroErro] = useState<string | null>(null);

  // Chave estável: `campanhas` é um array recriado a cada render do painel, e
  // um efeito preso a ele recarregaria o livro em laço.
  const ids = useMemo(() => campanhas.map((c) => c.id).sort().join(","), [campanhas]);
  useEffect(() => {
    let vivo = true;
    adSpendBook(ids ? ids.split(",") : [])
      .then((lidas) => { if (vivo) { setLivro(lidas); setLivroErro(null); } })
      .catch((err) => {
        if (!vivo) return;
        setLivro([]);
        setLivroErro(describeError(err, "não foi possível ler o gasto já importado"));
      });
    return () => { vivo = false; };
  }, [ids]);

  const colunas = useMemo(() => (rows.length ? mapearColunas(rows[0]) : null), [rows]);
  const periodoNoArquivo = (colunas?.inicio ?? -1) >= 0;
  const periodoManual = useMemo(
    () => (inicio && fim ? { inicio, fim } : null),
    [inicio, fim],
  );
  const linhas = useMemo(
    () => conciliar(rows, campanhas, { periodoManual, escolhas }),
    [rows, campanhas, periodoManual, escolhas],
  );
  const resumo = useMemo(() => resumir(linhas, livro), [linhas, livro]);
  const previa = useMemo(
    () => [...linhas].sort((a, b) => ORDEM[a.estado] - ORDEM[b.estado] || a.linha - b.linha).slice(0, PREVIA),
    [linhas],
  );

  const receber = async (file: File) => {
    setErro(null);
    // Escolha de linha ambígua é por NÚMERO de linha: mantê-la valendo para
    // outro arquivo casaria a linha 7 de um relatório com a decisão tomada
    // sobre a linha 7 do anterior.
    setEscolhas({});
    try {
      const lidas = await parseSheet(file);
      setRows(lidas);
      setFileName(file.name);
    } catch (err) {
      setRows([]);
      setFileName("");
      setErro(err instanceof ImportError
        ? comLinguagemDaMeta(err.message)
        : "Não foi possível ler o arquivo.");
    }
  };

  const confirmar = async () => {
    const payload = paraImportacao(linhas);
    if (!payload.length) return;
    setGravando(true);
    try {
      const resultado = await importMetaSpend(payload, fileName);
      toast({
        variant: "success",
        title: "Relatório importado",
        description: resultado.substituidas > 0
          ? `Gasto gravado em ${num(resultado.campanhas)} campanha(s): ${num(resultado.linhas)} linha(s); ${num(resultado.substituidas)} período(s) já importado(s) foram substituídos.`
          : `Gasto gravado em ${num(resultado.campanhas)} campanha(s): ${num(resultado.linhas)} linha(s). O CPL e o ROAS passam a usar este número.`,
      });
      onImported();
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível importar o relatório",
        // Recusa nossa ("nenhuma linha casou") já vem em pt-BR; a do banco não pode sair crua.
        description: describeError(err, err instanceof Error && !("db" in err) ? err.message : "Confira o arquivo e tente de novo."),
      });
    } finally {
      setGravando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(aberto) => { if (!aberto) onClose(); }}>
      <DialogContent className="glass-strong max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" aria-hidden /> Importar relatório da Meta (CSV/XLSX)
          </DialogTitle>
          <DialogDescription>
            No Gerenciador de Anúncios, exporte o relatório de campanhas com as colunas de identificação, valor
            usado e período. O gasto importado substitui o digitado e vale pelo período do relatório — para o
            acumulado da campanha, exporte com o intervalo "Máximo".
          </DialogDescription>
        </DialogHeader>

        <FileDropzone
          label={fileName || "Solte o relatório aqui ou clique para escolher"}
          hint="CSV ou XLSX exportado do Gerenciador de Anúncios · até 8 MB"
          accept=".csv,.xlsx,.xls"
          onFile={receber}
        />

        {erro && (
          <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {erro}
          </p>
        )}

        {rows.length > 0 && colunas && (
          <>
            {/* Qual coluna virou qual campo. Sem isso, a conferência do operador
                seria contra a planilha crua — e o erro de coluna só apareceria
                depois de gravado, no número que divide o CPL. */}
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-3 py-2">
              <Columns3 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              {(Object.keys(COLUNA_LABEL) as ColunaDoRelatorio[]).map((campo) => (
                <StatusBadge key={campo} tone={colunas[campo] >= 0 ? "info" : "neutral"}>
                  {COLUNA_LABEL[campo]}
                  {colunas[campo] >= 0
                    ? ` → ${rows[0][colunas[campo]] || `coluna ${colunas[campo] + 1}`}`
                    : " → não encontrada"}
                </StatusBadge>
              ))}
            </div>

            {/* O arquivo sem coluna de data não é recusado: o período é do
                relatório inteiro e quem exportou sabe qual é. Gravar gasto sem
                período é que não dá — é ele que impede a reimportação de somar
                o mesmo dinheiro duas vezes. */}
            {!periodoNoArquivo && (
              <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2">
                <p className="flex items-start gap-2 text-sm text-warning">
                  <CalendarRange className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    O arquivo não trouxe as colunas de período. Informe o intervalo que você escolheu no
                    Gerenciador — é ele que identifica este relatório e impede que reimportar some duas vezes.
                  </span>
                </p>
                <div className="flex flex-wrap gap-3">
                  <div className="space-y-1">
                    <Label htmlFor={`${campoId}-inicio`} className="text-xs">Início do período</Label>
                    <Input
                      id={`${campoId}-inicio`}
                      type="date"
                      value={inicio}
                      onChange={(e) => setInicio(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${campoId}-fim`} className="text-xs">Fim do período</Label>
                    <Input
                      id={`${campoId}-fim`}
                      type="date"
                      value={fim}
                      onChange={(e) => setFim(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">
                {num(resumo.importar)} de {num(resumo.total)} linhas
              </span>{" "}
              serão gravadas, somando {brl(resumo.gasto, { cents: true })} neste arquivo
              {resumo.substitui > 0 && ` · ${num(resumo.substitui)} substituem gasto já lançado`}
              {resumo.total > previa.length && ` · a tabela mostra as ${num(previa.length)} primeiras, problemas no topo`}.
            </p>

            {/* O NÚMERO QUE FICA GRAVADO, e não o do arquivo. A importação
                regrava o gasto da campanha como a soma de TODOS os períodos do
                livro dela: prometer a soma do arquivo fazia a tela mostrar
                depois um valor maior do que o anunciado, sem explicação. */}
            {resumo.importar > 0 && (
              <div className="space-y-1 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                <p className="text-foreground">
                  Depois de gravar, {num(resumo.campanhas)} campanha(s) passam a valer{" "}
                  <span className="font-semibold">{brl(resumo.gastoFinal, { cents: true })}</span>{" "}
                  no total — hoje somam {brl(resumo.gastoAtual, { cents: true })}.
                </p>
                {emCentavos(resumo.gastoFinal) !== emCentavos(resumo.gasto) && (
                  <p className="text-muted-foreground">
                    O gasto de cada campanha é a soma de todos os períodos já importados dela, e este
                    relatório cobre só parte deles: o valor acima é o que a tela vai mostrar.
                  </p>
                )}
                {resumo.digitadoDescartado > 0 && (
                  <p className="text-muted-foreground">
                    {brl(resumo.digitadoDescartado, { cents: true })} digitados à mão saem da conta.
                    A correção manual vale até a importação seguinte — desta aqui em diante, o gasto
                    volta a ser o dos relatórios.
                  </p>
                )}
              </div>
            )}

            {(resumo.incerto || livroErro) && (
              <p role="alert" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  Não consegui ler o gasto já importado{livroErro ? ` (${livroErro})` : ""}. O total
                  previsto acima é o mínimo: o valor gravado pode ficar maior, porque a importação
                  soma os períodos que já estavam lá.
                </span>
              </p>
            )}

            {resumo.ambiguas > 0 && (
              <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {num(resumo.ambiguas)} linha(s) alcançam mais de uma campanha cadastrada e ficam de
                  fora até você escolher qual recebe o gasto, na tabela abaixo. Nome de campanha se
                  repete no cadastro; o ID externo não — exportar o relatório com a coluna de
                  identificação resolve de vez.
                </span>
              </p>
            )}

            {/* Linha que não entra tem de aparecer com o conserto ao lado: a
                campanha não cadastrada é justamente a que some do custo por
                lead sem ninguém perceber. */}
            {resumo.semCampanha > 0 && (
              <p role="alert" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {num(resumo.semCampanha)} linha(s) não casaram com campanha cadastrada e ficam de fora.
                  Cadastre a campanha com o mesmo ID externo do relatório e importe de novo — sem isso, o
                  gasto dela não entra no CPL nem no ROAS.
                </span>
              </p>
            )}

            {(resumo.invalidas > 0 || resumo.repetidas > 0) && (
              <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {resumo.invalidas > 0 && `${num(resumo.invalidas)} linha(s) sem período ou sem valor legível. `}
                  {resumo.repetidas > 0 && `${num(resumo.repetidas)} linha(s) repetem o período de uma campanha já lida neste arquivo. `}
                  O motivo de cada uma está na tabela abaixo.
                </span>
              </p>
            )}

            <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Linha</TableHead>
                    <TableHead>Campanha no relatório</TableHead>
                    <TableHead className="whitespace-nowrap">Período</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Gasto</TableHead>
                    <TableHead>O que acontece</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previa.map((linha) => (
                    <TableRow key={linha.linha}>
                      <TableCell className="text-xs tabular-nums">{linha.linha}</TableCell>
                      <TableCell className="text-xs">
                        {linha.campanha?.name || linha.nome || "—"}
                        {linha.idExterno && (
                          <span className="block text-muted-foreground">{linha.idExterno}</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{periodoDaLinha(linha)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                        {linha.gasto === null ? "—" : brl(linha.gasto, { cents: true })}
                      </TableCell>
                      <TableCell className="text-xs">
                        <StatusBadge tone={TOM[linha.estado]}>{ROTULO[linha.estado]}</StatusBadge>
                        {linha.motivo && <span className="mt-0.5 block text-muted-foreground">{linha.motivo}</span>}
                        {/* A decisão é do operador, e continua disponível DEPOIS
                            de escolher: só ele sabe qual das homônimas é a do
                            relatório, e trocar de ideia não pode exigir
                            reenviar o arquivo. */}
                        {linha.candidatas.length > 1 && (
                          <Select
                            value={escolhas[linha.linha] ?? ""}
                            onValueChange={(id) => setEscolhas((atual) => ({ ...atual, [linha.linha]: id }))}
                          >
                            <SelectTrigger
                              className="mt-1 h-8 text-xs"
                              aria-label={`Campanha que recebe o gasto da linha ${linha.linha}`}
                            >
                              <SelectValue placeholder="Escolha a campanha" />
                            </SelectTrigger>
                            <SelectContent>
                              {linha.candidatas.map((c) => (
                                <SelectItem key={c.id} value={c.id} className="text-xs">
                                  {c.externalId || "sem ID externo"} · {brl(c.spend, { cents: true })} hoje
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
          <Button onClick={() => void confirmar()} disabled={!resumo.importar || gravando}>
            {gravando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            {gravando ? "Gravando…" : `Importar ${num(resumo.importar)} linha(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
