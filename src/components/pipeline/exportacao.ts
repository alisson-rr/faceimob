import { date as formatDate } from "@/lib/format";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import type { DealStatusCatalog } from "@/integrations/supabase/dealStatuses";
import type { SheetData } from "write-excel-file/browser";
import { dealMonth } from "./filters";
import { statusGroupLabel, statusLabel } from "./statuses";

/**
 * Exportação do recorte filtrado do Pipeline.
 *
 * ERA CSV até 05/09/2026, e o CSV mentia de um jeito silencioso: toda célula
 * saía entre aspas, então VGV, percentual e "dias" chegavam ao Excel como
 * TEXTO. Somar a coluna de VGV do mês dava zero, e o `SOMASE` de comissão por
 * corretor também — a planilha que existe justamente para conferir comissão
 * precisava de um "texto para colunas" antes de servir. Em `.xlsx` o número
 * viaja como número e a data como data; ninguém converte nada.
 *
 * O rateio (`deal_participants.share_pct`, calculado por `recalc_deal_shares`)
 * está aqui porque só existia dentro do modal, ao lado do nome do corretor:
 * conferir o mês inteiro exigia abrir negócio por negócio.
 */
const COLUNAS = [
  { titulo: "Código", largura: 12 },
  { titulo: "Cliente", largura: 28 },
  { titulo: "Construtora", largura: 20 },
  { titulo: "Empreendimento", largura: 22 },
  { titulo: "Unidade", largura: 10 },
  { titulo: "Etapa", largura: 18 },
  { titulo: "Status 1", largura: 14 },
  { titulo: "Status 2", largura: 18 },
  { titulo: "VGV", largura: 14 },
  { titulo: "Dias", largura: 8 },
  { titulo: "Corretor 1", largura: 22 },
  { titulo: "% Corretor 1", largura: 12 },
  { titulo: "VGV Corretor 1", largura: 16 },
  { titulo: "Corretor 2", largura: 22 },
  { titulo: "% Corretor 2", largura: 12 },
  { titulo: "VGV Corretor 2", largura: 16 },
  { titulo: "Corretor 3", largura: 22 },
  { titulo: "% Corretor 3", largura: 12 },
  { titulo: "VGV Corretor 3", largura: 16 },
  { titulo: "Gerente 1", largura: 22 },
  { titulo: "Mês-base", largura: 10 },
] as const;

export const HEADERS: string[] = COLUNAS.map((c) => c.titulo);

/**
 * Fatia do participante em reais — o número que a conferência de comissão usa.
 *
 * `null` (e não zero) quando não há corretor no slot ou quando o rateio ainda
 * não foi calculado: zero afirmaria "este corretor não leva nada".
 */
export const shareValue = (value: number, share?: number | null): number | null =>
  share == null ? null : Math.round((value || 0) * Number(share)) / 100;

/** Célula da planilha: `null` vira vazio, o resto carrega o tipo junto. */
export type Celula =
  | { valor: string | null; tipo: "texto" }
  | { valor: number | null; tipo: "numero" }
  | { valor: number | null; tipo: "dinheiro" };

const texto = (v: unknown): Celula => ({ valor: v == null || v === "" ? null : String(v), tipo: "texto" });
const numero = (v: number | null | undefined): Celula =>
  ({ valor: v == null || Number.isNaN(v) ? null : Number(v), tipo: "numero" });
const dinheiro = (v: number | null | undefined): Celula =>
  ({ valor: v == null || Number.isNaN(v) ? null : Number(v), tipo: "dinheiro" });

/**
 * As linhas da planilha, sem depender do navegador — é por aqui que o teste
 * entra. O que sai daqui é o conteúdo; quem o transforma em arquivo é
 * `baixarPlanilhaDeNegocios`.
 */
export function linhasDeNegocios(deals: LegacyDealRecord[], catalog: DealStatusCatalog): Celula[][] {
  return deals.map((deal) => [
    texto(deal.code),
    texto(deal.client),
    texto(deal.developer),
    texto(deal.project),
    texto(deal.unit),
    texto(deal.stage_label),
    // Negócio sem Status 1 (Status 2 fora do catálogo) sai com a célula vazia,
    // como toda ausência desta planilha: filtrar "vazias" no Excel funciona, e
    // um "—" viraria texto a mais para limpar.
    texto(statusGroupLabel(catalog, deal.status_group_id)),
    // O nome exibido, igual à tela: a planilha é o que se confere AO LADO dela —
    // "17. DISTRATO" no arquivo e "DISTRATO" no sistema viram dúvida sobre se
    // são o mesmo status. O valor gravado em `status_detail` não muda.
    texto(statusLabel(catalog, deal.status)),
    dinheiro(deal.deal_value),
    numero(deal.days_in_pipeline),
    texto(deal.broker1),
    numero(deal.broker1_share),
    dinheiro(shareValue(deal.deal_value, deal.broker1_share)),
    texto(deal.broker2),
    numero(deal.broker2_share),
    dinheiro(shareValue(deal.deal_value, deal.broker2_share)),
    texto(deal.broker3),
    numero(deal.broker3_share),
    dinheiro(shareValue(deal.deal_value, deal.broker3_share)),
    texto(deal.manager1),
    texto(dealMonth(deal)),
  ]);
}

/**
 * Gera e baixa o `.xlsx`.
 *
 * A biblioteca entra por `import()` dinâmico: ela carrega um escritor de ZIP e
 * só faz falta no clique de quem exporta — no pacote inicial do Pipeline seria
 * peso morto para todo mundo que só quer ver o quadro.
 */
export async function baixarPlanilhaDeNegocios(
  deals: LegacyDealRecord[],
  catalog: DealStatusCatalog,
): Promise<void> {
  // `/browser`: o pacote não tem raiz — só os subcaminhos `node`, `browser`,
  // `universal` e `utility`. Mesmo padrão do `read-excel-file/browser` que a
  // importação de planilha já usa.
  const { default: writeXlsxFile } = await import("write-excel-file/browser");

  // Célula vazia é `null` puro, e não `{ value: null }`: é o que a biblioteca
  // espera, e é o que mantém a coluna sem "0" inventado.
  const conteudo: SheetData = [
    HEADERS.map((titulo) => ({ value: titulo, fontWeight: "bold" as const })),
    ...linhasDeNegocios(deals, catalog).map((linha) =>
      linha.map((celula) => {
        if (celula.valor == null) return null;
        if (celula.tipo === "texto") return { value: celula.valor, type: String };
        // `#,##0.00` em vez de moeda: a planilha é de conferência e some com o
        // "R$" na hora de colar em outra ferramenta. O número continua número.
        if (celula.tipo === "dinheiro") {
          return { value: celula.valor, type: Number, format: "#,##0.00" };
        }
        return { value: celula.valor, type: Number };
      }),
    ),
  ];

  // Na versão 4 a build de navegador não baixa sozinha: devolve
  // `{ toBlob, toFile }` e é o `toFile` que dispara o download. Passar
  // `fileName` nas opções (como nas versões antigas) compila — e não baixa nada.
  await writeXlsxFile(conteudo, {
    columns: COLUNAS.map((c) => ({ width: c.largura as number })),
    // A primeira linha fica presa no topo: a planilha do mês passa de cem
    // linhas e sem isso o cabeçalho some no primeiro rolar.
    stickyRowsCount: 1,
    sheet: "Negócios",
  }).toFile(`pipeline_${formatDate(new Date()).replace(/\//g, "-")}.xlsx`);
}
