/**
 * Exportação do quadro da semana.
 *
 * O Checkpoint é tela de reunião: até aqui, quem precisava levar o número para
 * fora (ata, planilha da diretoria, cobrança de meta) copiava card por card. O
 * CSV sai com TODAS as colunas do diário — inclusive visitas, que a tela mostra
 * como chip — e com o gargalo já calculado por `teamBottleneck`, para não
 * existir uma segunda conta do gargalo divergindo do que está na tela.
 *
 * Mesmo formato do CSV do pipeline (`components/pipeline/csv.ts`): aspas
 * duplicadas na célula e BOM na frente, senão o Excel troca os acentos.
 */
import { teamBottleneck, type TeamAggr, type Targets } from "./funnel";

export type CheckpointExportRow = {
  equipe: string;
  /** Equipe desativada no meio da semana continua exportando o que lançou. */
  ativa: boolean;
  aggr: TeamAggr;
  targets: Targets;
};

const HEADERS = [
  "Equipe", "Situação", "Lançamentos", "Leads", "Ligações", "Coleta docs",
  "Visitas agendadas", "Visitas realizadas", "Análises enviadas",
  "Análises aprovadas", "Vendas", "Meta análise %", "Meta aprovação %",
  "Meta venda %", "Gargalo",
];

const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export function checkpointCsv(rows: CheckpointExportRow[]): string {
  const linhas = rows.map(({ equipe, ativa, aggr, targets }) => {
    const gargalo = teamBottleneck(aggr, targets);
    return [
      equipe,
      ativa ? "ativa" : "desativada",
      aggr.lancamentos, aggr.leads, aggr.ligacoes, aggr.coleta_docs,
      aggr.visitas_agendadas, aggr.visitas_feitas,
      aggr.enviadas, aggr.aprovadas, aggr.vendas,
      targets.analise_enviada_pct, targets.aprovada_pct, targets.venda_pct,
      // Sem base não é "no ritmo": não há denominador para medir nada.
      gargalo ? gargalo.label : (aggr.leads === 0 ? "sem base" : "no ritmo"),
    ].map(cell).join(",");
  });
  return [HEADERS.map(cell).join(","), ...linhas].join("\n");
}

/** `semana` entra no nome do arquivo: dois downloads seguidos não se sobrescrevem. */
export function downloadCheckpointCsv(rows: CheckpointExportRow[], semana: string): void {
  // BOM em bytes (EF BB BF): sem ele o Excel abre o CSV em ANSI e troca os acentos.
  const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), checkpointCsv(rows)], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `checkpoint_${semana}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
