import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Database, Download, FileSpreadsheet, Inbox, Pencil, Save, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, LoadingState, PageHeader, SectionCard, StatusBadge } from "@/components/shared";
import { COLUMN_LABELS, FileDropzone, ImportError, LeadImportDialog, parseSheet, useLeadSources } from "@/components/leads";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { aportePayload } from "@/integrations/supabase/analytics";
import { useAuth, type AppRole } from "@/contexts/AuthContext";
import { brl, monthStart, num, parseBrl, parseMonthStart } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { cn } from "@/lib/utils";

type Developer = { id: string; name: string; active: boolean };
type Aporte = { id: string; period: string; amount: number; developer_id: string; notes: string | null };
/** Linha da planilha de aportes depois de conferida; `error` é o motivo de não gravar. */
export type SheetAporte = {
  line: number;
  period: string | null;
  developer: string;
  developer_id: string | null;
  amount: number | null;
  notes: string | null;
  error: string | null;
  /** Valor já lançado para a mesma (construtora, mês) — será substituído. */
  replaces: number | null;
};

/** Espelha `leads_insert` (`has_any_role('admin','director','manager','marketing','sdr')`). */
const LEAD_IMPORT_ROLES: AppRole[] = ["director", "manager", "marketing", "sdr"];

const FORM_VAZIO = { amount: "", developer_id: "", notes: "" };

/** Falha de rede, 500 e timeout não têm `code`: sem uma orientação no fallback,
 *  `describeError` devolve a paráfrase do título e a tela repete a mesma frase
 *  duas vezes sem dizer o que fazer. */
const TENTE_DE_NOVO = 'A consulta não respondeu. Verifique a conexão e use "Tentar de novo".';

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
/** "Setembro/2026" a partir de `YYYY-MM-01`. */
const monthLabel = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]}/${period.slice(0, 4)}`;

/** Sem acento, caixa ou espaço nas pontas — "Horizonte Urbanismo" casa com "horizonte urbanismo ". */
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

/** Marca de ordem de byte: sem ela o Excel abre o CSV com acento quebrado. */
const BOM = "﻿";

const MODELO_CSV = [
  "Mês,Construtora,Valor,Nota",
  "09/2026,Horizonte Urbanismo,\"21.500,00\",Aporte do mês",
  "09/2026,Viva Lar Incorporadora,16400,",
].join("\n");

export type SheetParse = {
  rows: SheetAporte[];
  /** A planilha trouxe coluna de Nota? Sem ela, a nota já gravada é preservada. */
  hasNotes: boolean;
};

/**
 * Planilha (cabeçalho + linhas) → aportes prontos para `marketing_investments`.
 *
 * A construtora entra pelo nome e precisa existir no cadastro; o mês e o valor
 * aceitam os formatos que o Excel e o usuário costumam mandar. Linha repetida
 * (mesma construtora e mês) é erro aqui porque o `upsert` em lote recusaria a
 * segunda ocorrência com uma mensagem que não diz qual linha é.
 *
 * A coluna de mês é procurada da mais específica para a mais genérica: "data"
 * casaria também com "Data de cadastro", e quem tem uma coluna "Mês" na mesma
 * planilha esperava que ela ganhasse.
 */
// eslint-disable-next-line react-refresh/only-export-components -- regra de negócio pura, exportada para o vitest; não é componente e não afeta o HMR do que importa.
export function rowsToAportes(rows: string[][], devs: Developer[]): SheetParse {
  const headers = (rows[0] ?? []).map(normalize);
  const find = (...keys: string[]) => {
    for (const key of keys) {
      const idx = headers.findIndex((header) => header.includes(key));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const periodIdx = find("mes", "periodo", "month", "data");
  const devIdx = find("construtora", "incorporadora", "developer");
  const amountIdx = find("valor", "aporte", "investimento", "amount");
  const notesIdx = find("nota", "obs", "observac");
  if (periodIdx < 0 || devIdx < 0 || amountIdx < 0) {
    throw new ImportError("A planilha precisa das colunas Mês, Construtora e Valor no cabeçalho.");
  }

  const byName = new Map(devs.map((d) => [normalize(d.name), d.id]));
  const seen = new Set<string>();
  const parsed = rows.slice(1).map((row, index) => {
    const developer = row[devIdx] ?? "";
    const developer_id = byName.get(normalize(developer)) ?? null;
    const period = parseMonthStart(row[periodIdx]);
    const amount = parseBrl(row[amountIdx]);
    const key = `${developer_id}|${period}`;
    const error = !period ? "mês inválido"
      : !developer_id ? "construtora não cadastrada"
      : amount === null || amount < 0 ? "valor inválido"
      : seen.has(key) ? "repetida na planilha"
      : null;
    if (!error) seen.add(key);
    return {
      line: index + 2,
      period,
      developer,
      developer_id,
      amount,
      notes: notesIdx >= 0 ? row[notesIdx] || null : null,
      error,
      replaces: null,
    };
  });
  return { rows: parsed, hasNotes: notesIdx >= 0 };
}

/**
 * Dados — importação de leads do Leadfy e aportes de mídia por construtora.
 *
 * As duas caixas de upload eram decorativas: recebiam o arquivo, mostravam
 * "carregado" e o descartavam. Leadfy agora abre o mesmo diálogo de `/leads`
 * (parse, prévia e `createLeads` já moram lá); aportes têm importador próprio,
 * com prévia e validação antes de gravar.
 */
export default function DataManagement() {
  const { isAdmin, roles, previewRole } = useAuth();
  // Espelha as policies: aporte escreve admin/marketing; lead insere gestor e SDR.
  // `roles` (N:N) e não `role`: diretor que também é marketing tem `role = director`.
  const effectiveRoles = previewRole ? [previewRole] : roles;
  const canEditAporte = isAdmin || effectiveRoles.includes("marketing");
  const canImportLeads = isAdmin || effectiveRoles.some((r) => LEAD_IMPORT_ROLES.includes(r));

  const sourcesQuery = useLeadSources();
  const [importOpen, setImportOpen] = useState(false);
  // Mesma causa do popup de /marketing: o resumo por construtora tem
  // `staleTime` de 60 s, então lançar aporte aqui e abrir /marketing em seguida
  // mostrava o total anterior. Invalidar na escrita é o ponto compartilhado.
  const qc = useQueryClient();
  const invalidarResumo = useCallback(
    () => { void qc.invalidateQueries({ queryKey: ["marketing", "por-construtora"] }); },
    [qc],
  );

  const [period, setPeriod] = useState(() => monthStart());
  const [devs, setDevs] = useState<Developer[]>([]);
  const [devsError, setDevsError] = useState<string | null>(null);
  const [aportes, setAportes] = useState<Aporte[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState(FORM_VAZIO);
  /** Id do aporte trazido pelo botão Editar — só ele autoriza apagar a nota. */
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<{ name: string; rows: SheetAporte[]; hasNotes: boolean } | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const loadAportes = useCallback(async (month: string) => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from("marketing_investments")
      .select("*")
      .eq("period", month)
      .order("amount", { ascending: false });
    setLoading(false);
    if (error) return setLoadError(describeError(error, TENTE_DE_NOVO));
    setAportes((data as Aporte[]) ?? []);
  }, []);

  useEffect(() => { void loadAportes(period); }, [period, loadAportes]);

  /**
   * Sem a lista de construtoras NADA desta aba funciona: o nome de cada aporte
   * vira travessão, o seletor fica sem opção (e o Salvar recusa com "Preencha
   * valor e construtora" sem dizer por quê) e toda linha de planilha é marcada
   * como "construtora não cadastrada". Por isso o erro vira estado, como
   * `loadError` — o toast some em segundos e a tela mentida fica.
   */
  const loadDevs = useCallback(async () => {
    setDevsError(null);
    // Sem filtro de `active`: a construtora desativada continua dona de aporte
    // histórico (a FK é RESTRICT) e o nome dela sumia da lista do mês.
    const { data, error } = await supabase.from("developers").select("id,name,active").order("name");
    if (error) return setDevsError(describeError(error, TENTE_DE_NOVO));
    setDevs(data ?? []);
  }, []);

  useEffect(() => { void loadDevs(); }, [loadDevs]);

  const monthTotal = useMemo(() => aportes.reduce((sum, r) => sum + Number(r.amount || 0), 0), [aportes]);
  // Com a lista fora do ar o travessão dizia "aporte sem construtora", que é
  // outro fato: o nome existe, só não foi lido.
  const developerName = (id: string) => devs.find((d) => d.id === id)?.name || (devsError ? "construtora não carregada" : "—");
  const developerAtivo = (id: string) => devs.find((d) => d.id === id)?.active ?? true;
  /** Ativas + a que está sendo corrigida: não se lança aporte novo em construtora
   *  desativada, mas corrigir o lançamento antigo dela precisa funcionar. Mesmo
   *  desenho do popup de `/marketing`. */
  const opcoes = useMemo(
    () => devs.filter((d) => d.active || d.id === form.developer_id),
    [devs, form.developer_id],
  );

  const startEdit = (row: Aporte) => {
    setEditing(row.id);
    setForm({ amount: String(row.amount), developer_id: row.developer_id, notes: row.notes ?? "" });
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm(FORM_VAZIO);
  };

  const saveAporte = async () => {
    const amount = Number(form.amount);
    if (!form.amount || !form.developer_id || !Number.isFinite(amount) || amount < 0) {
      return toast({ title: "Preencha valor e construtora", variant: "destructive" });
    }
    setSaving(true);
    // `aportePayload` decide se a nota vai: sem Editar e com o campo em branco,
    // `notes` fica fora e a nota já gravada sobrevive ao upsert.
    const payload = aportePayload({ period, amount, developer_id: form.developer_id, notes: form.notes, editing: !!editing });
    // Corrigir grava pela chave DA LINHA, como o popup: pelo upsert, trocar a
    // construtora durante a correção criaria verba nova na escolhida e deixaria
    // a antiga intacta — o mês passaria a contar as duas.
    const { data, error } = editing
      ? await supabase.from("marketing_investments").update(payload).eq("id", editing).select("id")
      : await supabase.from("marketing_investments").upsert(payload, { onConflict: "developer_id,period" }).select("id");
    setSaving(false);
    if (error) return toast({ title: "Falha ao salvar o aporte", description: describeError(error, "Confira valor e construtora e tente de novo."), variant: "destructive" });
    if (!data?.length) {
      return toast({
        title: editing
          ? "O aporte não foi alterado: ou alguém já o excluiu, ou seu papel não pode lançar aporte (apenas admin e marketing)."
          : "Sem permissão para lançar aporte (apenas admin e marketing).",
        variant: "destructive",
      });
    }
    toast({ title: "Aporte salvo" });
    cancelEdit();
    void loadAportes(period);
    invalidarResumo();
  };

  const removeAporte = async (row: Aporte) => {
    if (!confirm(`Excluir o aporte de ${developerName(row.developer_id)} em ${monthLabel(row.period)}?`)) return;
    // `select("id")` porque o RLS não erra ao recusar: filtra a linha e o
    // PostgREST devolve 204 — a linha só reaparecia depois do reload.
    const { data, error } = await supabase.from("marketing_investments").delete().eq("id", row.id).select("id");
    if (error) return toast({ title: "Falha ao excluir o aporte", description: describeError(error, "Não foi possível excluir o aporte."), variant: "destructive" });
    if (!data?.length) return toast({ title: "Sem permissão para excluir aporte (apenas admin e marketing).", variant: "destructive" });
    if (editing === row.id) cancelEdit();
    toast({ title: "Aporte excluído" });
    void loadAportes(period);
    invalidarResumo();
  };

  const receiveSheet = async (file: File) => {
    setSheetError(null);
    setSheet(null);
    try {
      const parsed = rowsToAportes(await parseSheet(file), devs);
      // A prévia prometia "terá o valor substituído" sem mostrar o que seria
      // substituído. Aqui o valor antigo entra linha a linha.
      const periodos = Array.from(new Set(parsed.rows.map((r) => r.period).filter((p): p is string => !!p)));
      let atuais: Aporte[] = [];
      if (periodos.length) {
        const { data, error } = await supabase
          .from("marketing_investments")
          .select("id,period,amount,developer_id,notes")
          .in("period", periodos);
        if (error) throw new ImportError(describeError(error, "Não consegui conferir os aportes já lançados."));
        atuais = (data as Aporte[]) ?? [];
      }
      const porChave = new Map(atuais.map((a) => [`${a.developer_id}|${a.period}`, Number(a.amount)]));
      setSheet({
        name: file.name,
        hasNotes: parsed.hasNotes,
        rows: parsed.rows.map((r) => ({ ...r, replaces: porChave.get(`${r.developer_id}|${r.period}`) ?? null })),
      });
    } catch (err) {
      setSheetError(err instanceof ImportError ? err.message : "Não foi possível ler o arquivo.");
    }
  };

  const sheetErrors = sheet?.rows.filter((r) => r.error).length ?? 0;
  const sheetValidas = sheet ? sheet.rows.length - sheetErrors : 0;
  const substituicoes = sheet?.rows.filter((r) => !r.error && r.replaces !== null).length ?? 0;

  const importSheet = async () => {
    if (!sheet || sheetValidas === 0) return;
    const payload = sheet.rows.flatMap((r) =>
      !r.error && r.period && r.developer_id && r.amount !== null
        ? [{
            period: r.period,
            developer_id: r.developer_id,
            amount: r.amount,
            // Sem coluna de Nota na planilha, `notes` fica FORA do payload: o
            // upsert só sobrescreve coluna enviada, então a nota já gravada
            // sobrevive em vez de virar null.
            ...(sheet.hasNotes ? { notes: r.notes } : {}),
          }]
        : []);
    setImporting(true);
    const { data, error } = await supabase
      .from("marketing_investments")
      .upsert(payload, { onConflict: "developer_id,period" })
      .select("id");
    setImporting(false);
    if (error) return toast({ title: "Falha ao importar os aportes", description: describeError(error, "Não foi possível gravar os aportes."), variant: "destructive" });
    if (!data?.length) return toast({ title: "Sem permissão para importar aportes (apenas admin e marketing).", variant: "destructive" });
    toast({ title: `${num(payload.length)} ${payload.length === 1 ? "aporte importado" : "aportes importados"}` });
    setSheet(null);
    void loadAportes(period);
    invalidarResumo();
  };

  const baixarModelo = () => {
    // BOM para o Excel abrir o acento certo; `URL.revokeObjectURL` evita segurar
    // o blob na memória da aba.
    const url = URL.createObjectURL(new Blob([BOM + MODELO_CSV], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-aportes-marketing.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Gestão de dados"
        eyebrow="Sistema"
        icon={Database}
        description="Importação de leads do Leadfy e aportes de mídia por construtora."
      />

      <Tabs defaultValue="leadfy" className="w-full">
        <TabsList className="bg-transparent border-b border-border/40 rounded-none w-full justify-start gap-4 h-auto p-0">
          {[["leadfy", "Leadfy"], ["marketing", "Marketing"]].map(([v, l]) => (
            <TabsTrigger key={v} value={v} className="bg-transparent rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent pb-2 font-semibold">
              {l}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* LEADFY */}
        <TabsContent value="leadfy" className="mt-6 grid gap-4 md:grid-cols-2">
          <SectionCard title="Importar leads do Leadfy" icon={Upload} description="A planilha entra na fila da roleta, sem corretor.">
            {canImportLeads ? (
              <Button onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" /> Importar planilha (CSV/XLSX)
              </Button>
            ) : (
              /* Era um parágrafo solto, sem tom nem ícone, no lugar onde todo
                 mundo espera um botão: parecia a tela ainda carregando. */
              <EmptyState
                icon={Upload}
                title="Importação indisponível para o seu papel"
                description="Importar lead é de diretor, gerente, marketing ou SDR. Peça a quem tem o papel, ou peça ao administrador para concedê-lo."
              />
            )}
          </SectionCard>
          <SectionCard title="Formato esperado">
            {/* A lista sai de `COLUMN_LABELS`, a MESMA fonte que o importador
                usa para casar cabeçalho. Escrita à mão, ela prometia
                "Empreendimento" e "Status", que o parser ignora em silêncio:
                quem montava a planilha com essas colunas perdia as duas sem
                aviso nenhum. */}
            <div className="text-xs space-y-1 text-muted-foreground">
              <p>Colunas lidas: <code className="text-foreground">{Object.values(COLUMN_LABELS).join(", ")}</code></p>
              <p>Primeira linha deve ser o cabeçalho.</p>
              <p>
                Qualquer outra coluna (Empreendimento, Status, valor) é <strong className="text-foreground">ignorada</strong>:
                a planilha só cria o lead na fila, e esses campos entram depois, no cadastro do lead ou do negócio.
              </p>
            </div>
          </SectionCard>
        </TabsContent>

        {/* MARKETING */}
        <TabsContent value="marketing" className="mt-6 space-y-4">
          <div className={cn("grid gap-4", canEditAporte && "md:grid-cols-2")}>
            <SectionCard
              title={`Aporte de mídia — ${monthLabel(period)}`}
              icon={Save}
              description={canEditAporte
                ? "Um aporte por construtora e mês: salvar de novo corrige o valor. A nota em branco preserva a que já está gravada — use Editar para trocá-la."
                : "Lançamento e correção de aporte são do marketing e do administrador."}
              actions={
                <>
                  <Label htmlFor="aporte-mes" className="text-xs">Mês</Label>
                  <Input
                    id="aporte-mes"
                    type="month"
                    value={period.slice(0, 7)}
                    onChange={(e) => { if (e.target.value) setPeriod(`${e.target.value}-01`); }}
                    className="h-8 w-40 text-xs"
                  />
                </>
              }
            >
              <p className="text-sm mb-3">Total do mês: <strong className="text-success">{brl(monthTotal)}</strong></p>
              {canEditAporte && (devsError ? (
                /* Sem a lista de construtoras o formulário recusaria toda
                   tentativa com "Preencha valor e construtora" — o motivo
                   errado. Aqui a tela diz o motivo certo e oferece a recarga. */
                <EmptyState
                  icon={AlertTriangle}
                  tone="danger"
                  title="Não consegui carregar as construtoras"
                  description={`${devsError} Sem essa lista não dá para lançar nem importar aporte.`}
                  action={<Button variant="outline" onClick={() => void loadDevs()}>Tentar de novo</Button>}
                />
              ) : (
                <div className="space-y-2">
                  {editing && (
                    <p className="text-xs font-semibold">Corrigindo o aporte de {developerName(form.developer_id)}</p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Input type="number" min={0} placeholder="Valor R$" aria-label="Valor do aporte" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} className="h-8 text-xs" />
                    <Select value={form.developer_id} onValueChange={(v) => setForm((p) => ({ ...p, developer_id: v }))}>
                      <SelectTrigger className="h-8 text-xs" aria-label="Construtora"><SelectValue placeholder="Construtora" /></SelectTrigger>
                      <SelectContent>{opcoes.map((d) => <SelectItem key={d.id} value={d.id}>{d.active ? d.name : `${d.name} (inativa)`}</SelectItem>)}</SelectContent>
                    </Select>
                    {/* O popup de /marketing tem campo Nota e este não tinha: a
                        mesma regra com duas interfaces diferentes. */}
                    <Input placeholder="Nota (opcional)" aria-label="Nota do aporte" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className="h-8 text-xs" />
                  </div>
                  <div className="flex justify-end gap-2">
                    {editing && (
                      <Button size="sm" variant="ghost" onClick={cancelEdit} className="gap-1"><X className="h-4 w-4" /> Cancelar</Button>
                    )}
                    <Button size="sm" onClick={saveAporte} disabled={saving} className="gap-1"><Save className="h-4 w-4" />{saving ? "Salvando..." : "Salvar aporte"}</Button>
                  </div>
                </div>
              ))}
            </SectionCard>

            {canEditAporte && (
              <SectionCard
                title="Importar planilha de aportes"
                icon={FileSpreadsheet}
                description="Colunas Mês, Construtora e Valor (Nota é opcional). A construtora precisa existir no cadastro."
                actions={
                  <Button variant="outline" size="sm" onClick={baixarModelo} className="h-8 gap-1 text-xs">
                    <Download className="h-4 w-4" /> Baixar modelo
                  </Button>
                }
              >
                {/* `accept` sem `.xls`: o parser (`read-excel-file`) recusa o
                    formato de 97-2003, então oferecê-lo no seletor era convidar
                    para o arquivo que a tela vai negar. Quem arrastar um .xls
                    continua recebendo a instrução de salvar como .xlsx. */}
                {/* A planilha casa a construtora PELO NOME contra `devs`: com a
                    lista fora do ar toda linha voltaria como "construtora não
                    cadastrada", acusando a planilha de um defeito que é da tela. */}
                {devsError ? (
                  <EmptyState
                    icon={AlertTriangle}
                    tone="danger"
                    title="Importação indisponível: falta a lista de construtoras"
                    description={`${devsError} Sem ela toda linha da planilha seria recusada como "construtora não cadastrada".`}
                    action={<Button variant="outline" onClick={() => void loadDevs()}>Tentar de novo</Button>}
                  />
                ) : (
                  <FileDropzone
                    label={sheet?.name || "Solte a planilha aqui ou clique para escolher"}
                    hint="CSV ou XLSX · até 8 MB · o .xls antigo não é lido"
                    accept=".csv,.xlsx"
                    onFile={receiveSheet}
                  />
                )}
                {sheetError && (
                  <p role="alert" className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {sheetError}
                  </p>
                )}
              </SectionCard>
            )}
          </div>

          {sheet && (
            <SectionCard
              title="Prévia da importação"
              description={sheetErrors
                ? `${num(sheetValidas)} de ${num(sheet.rows.length)} linhas prontas — as ${num(sheetErrors)} com problema ficam de fora.`
                : `${num(sheet.rows.length)} aportes prontos para gravar.`}
              flush
              footer={
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {substituicoes > 0
                      ? `${num(substituicoes)} ${substituicoes === 1 ? "linha substitui" : "linhas substituem"} um aporte já lançado (o valor antigo está na coluna "Substitui").`
                      : "Nenhuma linha substitui aporte existente."}
                    {!sheet.hasNotes && " A planilha não trouxe coluna Nota: a nota já gravada é preservada."}
                  </span>
                  <span className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setSheet(null)}>Descartar</Button>
                    <Button size="sm" onClick={importSheet} disabled={sheetValidas === 0 || importing}>
                      {importing
                        ? "Importando…"
                        : sheetErrors
                          ? `Importar ${num(sheetValidas)} ${sheetValidas === 1 ? "válida" : "válidas"}`
                          : `Importar ${num(sheet.rows.length)} ${sheet.rows.length === 1 ? "aporte" : "aportes"}`}
                    </Button>
                  </span>
                </div>
              }
            >
              <div className="max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Linha</TableHead><TableHead>Mês</TableHead><TableHead>Construtora</TableHead>
                      <TableHead className="text-right">Valor</TableHead><TableHead className="text-right">Substitui</TableHead><TableHead>Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sheet.rows.map((r) => (
                      <TableRow key={r.line}>
                        <TableCell className="text-xs tabular-nums">{r.line}</TableCell>
                        <TableCell className="text-xs">{r.period ? monthLabel(r.period) : "—"}</TableCell>
                        <TableCell className="text-xs">{r.developer || "—"}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{brl(r.amount, { cents: true })}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums text-muted-foreground">{brl(r.replaces, { cents: true })}</TableCell>
                        <TableCell className="text-xs">
                          {r.error
                            ? <StatusBadge tone="danger">{r.error}</StatusBadge>
                            : r.replaces !== null
                              ? <StatusBadge tone="warning">substitui</StatusBadge>
                              : <StatusBadge tone="success">ok</StatusBadge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>
          )}

          <SectionCard title={`Aportes de ${monthLabel(period)}`} flush>
            {loading ? (
              <LoadingState variant="table" rows={3} label="Carregando aportes…" />
            ) : loadError ? (
              <EmptyState
                icon={AlertTriangle}
                tone="danger"
                title="Não consegui carregar os aportes"
                description={loadError}
                action={<Button variant="outline" onClick={() => void loadAportes(period)}>Tentar de novo</Button>}
              />
            ) : aportes.length === 0 ? (
              <EmptyState icon={Inbox} title="Nenhum aporte neste mês" description="Troque o mês acima para ver lançamentos anteriores." />
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mês</TableHead><TableHead>Construtora</TableHead><TableHead>Nota</TableHead>
                      <TableHead className="text-right">Valor</TableHead>{canEditAporte && <TableHead />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aportes.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="text-xs">{monthLabel(a.period)}</TableCell>
                        <TableCell className="text-xs">
                          {developerName(a.developer_id)}
                          {!developerAtivo(a.developer_id) && <StatusBadge tone="neutral" className="ml-1.5">inativa</StatusBadge>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{a.notes || "—"}</TableCell>
                        <TableCell className="text-xs text-right text-success font-semibold tabular-nums">{brl(Number(a.amount))}</TableCell>
                        {canEditAporte && (
                          <TableCell className="text-right whitespace-nowrap">
                            {/* Sem este botão, corrigir o valor por /data obrigava a
                                redigitar tudo — e quem não redigitasse a nota a perdia. */}
                            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Editar aporte de ${developerName(a.developer_id)}`} onClick={() => startEdit(a)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Excluir aporte de ${developerName(a.developer_id)}`} onClick={() => removeAporte(a)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      {importOpen && <LeadImportDialog sources={sourcesQuery.data ?? []} onClose={() => setImportOpen(false)} />}
    </div>
  );
}
