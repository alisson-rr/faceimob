import { supabase } from "@/integrations/supabase/client";
import { dbError } from "@/lib/supabaseError";
import {
  DAILY_FIELDS,
  fromDailyEntry,
  zeroDailyRow,
  type DailyEntry,
  type DailyFieldKey,
  type DailyRow,
} from "@/lib/dailyFunnel";
import { hojeLocal } from "./vezPorDia";

/**
 * O diário de HOJE — a coluna da esquerda do Painel.
 *
 * As seis linhas do print são métricas do DIÁRIO (`daily_entries`, migration
 * 0009), não etapas do pipeline. O Painel mostrava o funil de ETAPAS
 * (`SalesFunnelCard`), que é outra conta com outros rótulos.
 *
 * NÃO há `if` de papel aqui, de propósito: quem recorta é a RLS
 * (`daily_entries_select`, reescrita pela 0109) e ela já entrega exatamente o
 * que o print pede — o corretor lê só a PRÓPRIA linha, gerente e diretor leem
 * as equipes que lideram (`auth_led_team_ids()`), admin e sócio leem a casa.
 * Repetir esse recorte no front seria uma segunda regra para divergir da
 * primeira, que foi o defeito que a 0109 acabou de tirar do Checkpoint.
 */

/**
 * As seis linhas do print aprovado, na ordem dele — com a cor de cada uma.
 *
 * A CHAVE sai de `DAILY_FIELDS`, o catálogo das oito métricas do diário — o
 * `satisfies` faz uma chave errada virar erro de compilação em vez de uma linha
 * silenciosamente zerada. Visita agendada e visita realizada ficam de fora por
 * decisão do print, não por não existirem.
 *
 * O RÓTULO é escrito por extenso porque o do catálogo é a abreviação da grade
 * de oito colunas do checkpoint ("Coleta Docs", "Análise Env.", "Venda"), e
 * nesta coluna larga o cliente aprovou o nome inteiro.
 *
 * A COR é daqui, e não de `DAILY_FIELDS[].color`, de propósito: aquela paleta
 * pinta a grade de oito colunas do Diário (`pages/DailyReport.tsx`) e mudá-la
 * repintaria aquela tela junto. O print do Painel faz outra leitura — Leads em
 * vermelho para puxar o olho para a entrada, Vendas em verde no desfecho e as
 * quatro do meio neutras, que é o caminho entre os dois. Classe do design
 * system nos dois casos; nenhum hex, nenhum tom fora dos tokens.
 */
export const LINHAS_DO_PAINEL = [
  { key: "leads", label: "Leads", rotulo: "text-info", barra: "bg-destructive" },
  { key: "ligacoes", label: "Ligações", rotulo: "text-foreground", barra: "bg-muted-foreground" },
  { key: "coleta_docs", label: "Coleta de Documentos", rotulo: "text-foreground", barra: "bg-muted-foreground" },
  { key: "analises", label: "Análise Enviada", rotulo: "text-foreground", barra: "bg-muted-foreground" },
  { key: "aprovados", label: "Análise Aprovada", rotulo: "text-foreground", barra: "bg-muted-foreground" },
  { key: "vendas", label: "Vendas", rotulo: "text-success", barra: "bg-success" },
] as const satisfies readonly {
  key: DailyFieldKey;
  label: string;
  rotulo: string;
  barra: string;
}[];

/**
 * Denominador da barra: o MAIOR número do dia.
 *
 * O diário não tem meta por métrica — a régua de `funnel_targets` é percentual
 * e só cobre análise, aprovação e venda. A barra compara as seis linhas entre
 * si; escolher qualquer outro denominador seria inventar uma meta que ninguém
 * cadastrou, e número errado num painel é pior do que número ausente.
 *
 * É pelo mesmo motivo que a linha escreve UM número, e não o "0/0" do print:
 * não existe o segundo número. Quatro traços "realizado/meta" com um
 * denominador inventado seriam seis linhas mentindo todo dia.
 */
export const maiorValor = (linha: DailyRow): number =>
  Math.max(...LINHAS_DO_PAINEL.map((item) => linha[item.key]));

/** Chave de cache com o dia no nome: na virada do dia o cache troca sozinho. */
export const diarioKeys = {
  hoje: (dia: string) => ["painel", "diario", dia] as const,
};

/** Soma as linhas do dia numa só, já no vocabulário da tela (`fromDailyEntry`). */
export const somaDiaria = (linhas: DailyEntry[]): DailyRow =>
  linhas.reduce<DailyRow>((acc, linha) => {
    const valores = fromDailyEntry(linha);
    DAILY_FIELDS.forEach((campo) => {
      acc[campo.key] += valores[campo.key];
    });
    return acc;
  }, zeroDailyRow());

/**
 * O que a leitura do dia pode devolver — e são TRÊS coisas, não uma.
 *
 * `zeroDailyRow()` para tudo era o defeito: seis zeros na tela do corretor
 * diziam "a equipe não trabalhou hoje" tanto quando ninguém tinha lançado
 * quanto quando a RLS simplesmente não devolveu nada para ele. Número errado é
 * pior do que número ausente, e os dois estados têm frases diferentes.
 */
export type DiarioDeHoje =
  /** Nenhum relatório de hoje no meu recorte — ninguém lançou (ainda). */
  | { estado: "sem-lancamento" }
  /**
   * Há relatório de hoje, e NENHUMA linha dele chegou até mim.
   *
   * É recorte, não vazio: `daily_reports_select` (0109) entrega o CABEÇALHO ao
   * membro da equipe, enquanto `daily_entries_select` entrega ao corretor só a
   * própria linha. Relatório visível com zero linhas é exatamente o corte da
   * policy — somar isso como zero seria a tela afirmando sobre um dado que ela
   * não tem permissão de ler.
   */
  | { estado: "sem-acesso" }
  | { estado: "ok"; linha: DailyRow };

/**
 * O lançamento de hoje, somado no recorte que a RLS permitir.
 *
 * Dois passos porque `daily_entries` não tem data: a data mora no cabeçalho
 * (`daily_reports.report_date`). É o mesmo caminho de `Checkpoint.tsx`, e por
 * isso os dois mostram o mesmo número para o mesmo dia.
 *
 * São também os dois passos que separam "ninguém lançou" de "não posso ver":
 * o primeiro responde se EXISTE relatório hoje no meu recorte, o segundo se
 * alguma LINHA dele é minha de ler. Um passo só confundia os dois em zero.
 *
 * ponytail: `dia` é o relógio do NAVEGADOR, a mesma régua do Checkpoint, e
 * `public_daily_submit` grava em `current_date` (UTC) — depois das 21h de
 * Brasília os dois ficam um dia atrás do banco, juntos. Evoluir para
 * `current_work_date()` quando o Checkpoint migrar, para os dois não divergirem.
 */
export async function loadDiarioDeHoje(dia: string = hojeLocal()): Promise<DiarioDeHoje> {
  const relatorios = await supabase
    .from("daily_reports")
    .select("id")
    .eq("report_date", dia);
  if (relatorios.error) throw dbError("daily_reports", relatorios.error);

  const ids = (relatorios.data ?? []).map((linha) => linha.id);
  if (!ids.length) return { estado: "sem-lancamento" };

  const entradas = await supabase
    .from("daily_entries")
    .select(
      "profile_id,leads,calls,doc_collections,visits_scheduled,visits_done,analyses_sent,analyses_approved,sales",
    )
    .in("report_id", ids);
  if (entradas.error) throw dbError("daily_entries", entradas.error);

  const linhas = (entradas.data ?? []) as DailyEntry[];
  if (!linhas.length) return { estado: "sem-acesso" };

  return { estado: "ok", linha: somaDiaria(linhas) };
}
