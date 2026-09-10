/**
 * A tabela equivalente de um grafico.
 *
 * Grafico do Recharts e um `<svg>` de retangulos: para leitor de tela o bloco
 * inteiro e vazio, e o cartao aparecia como um titulo seguido de nada. Aqui os
 * mesmos numeros saem em tabela de verdade (`caption`, `th scope`), so que
 * `sr-only` — quem enxerga ve o grafico, quem nao enxerga le a tabela.
 *
 * Quem usa marca o container do grafico com `aria-hidden` para o mesmo dado nao
 * ser anunciado duas vezes. O SVG do Recharts nao tem nada focavel (o tooltip e
 * de mouse), entao esconder nao tira nada do teclado.
 *
 * O `sr-only` fica no DIV, e nao na `<table>` — e a diferenca nao e de estilo.
 * `sr-only` esconde com `position:absolute; width:1px; overflow:hidden`, e um
 * elemento `display:table` IGNORA essa largura: o layout de tabela dimensiona
 * pelo conteudo minimo. Resultado medido em 05/09/2026 a 375 px: a tabela
 * "invisivel" ficava com 352 px, absoluta, e empurrava `scrollWidth` para
 * 388 px — 13 px de rolagem horizontal no Dashboard inteiro, vindos de um
 * elemento que ninguem ve. Num `<div>` a regra vale, porque `display:block`
 * respeita largura e `overflow`.
 */
export interface ChartDataProps {
  /** O que a tabela mostra, na voz do titulo do cartao. */
  caption: string;
  columns: string[];
  /** Uma linha por item; a primeira celula e o rotulo (vira `th scope="row"`). */
  rows: (string | number)[][];
}

export function ChartData({ caption, columns, rows }: ChartDataProps) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row[0])}>
              {row.map((cell, index) =>
                index === 0 ? (
                  <th key={index} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={index}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
