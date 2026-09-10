/**
 * Cor como string CSS, a partir do nome do token.
 *
 * `hsl(var(--x))` vale em atributo de SVG (e o Recharts pinta em SVG) e em
 * `style` inline, e acompanha a troca de tema — coisa que os 34 hex fixos do
 * Dashboard nao faziam (achado T04). Classe do Tailwind resolve o resto; isto
 * e so para onde nao cabe classe.
 */
export const tone = (token: string, alpha?: number) =>
  alpha === undefined ? `hsl(var(--${token}))` : `hsl(var(--${token}) / ${alpha})`;

/** Series de grafico. Ordem fixa do design system: azul, menta, amarelo, ciano, violeta. */
export const CHART_SERIES = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const;
export type ChartToken = (typeof CHART_SERIES)[number];

/** Cor da n-esima serie de um grafico (ano, status, canal). */
export const seriesToken = (index: number): ChartToken =>
  CHART_SERIES[((index % CHART_SERIES.length) + CHART_SERIES.length) % CHART_SERIES.length];

/**
 * Cor da construtora — deterministica pelo NOME, nao pela posicao na lista.
 *
 * Era o achado T05: a MRV saia verde no Dashboard e ambar no Pipeline porque
 * cada tela mantinha o seu mapa, e quem caia no `SOURCE_COLORS[i % 5]` trocava
 * de cor toda vez que uma construtora nova entrava e mexia no indice. Hash do
 * nome normalizado resolve os dois: a mesma construtora tem a mesma cor em
 * qualquer tela e em qualquer ordem de consulta.
 *
 * Cinco tokens para N construtoras significa que duas podem repetir cor. E
 * aceitavel: em todo grafico daqui o nome esta escrito no eixo ou na legenda —
 * cor nunca e o unico sinal.
 */
export function developerColor(name: string): ChartToken {
  const key = name.trim().toUpperCase();
  if (!key) return CHART_SERIES[0];
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return CHART_SERIES[hash % CHART_SERIES.length];
}

/** Pódio: 0 = ouro, 1 = prata, 2 = bronze. Fora disso nao ha medalha. */
export const PODIUM_TOKENS = ["gold", "silver", "bronze"] as const;
export type PodiumToken = (typeof PODIUM_TOKENS)[number];
export const podiumToken = (rank: number): PodiumToken | null => PODIUM_TOKENS[rank] ?? null;

// ─── Recharts ───────────────────────────────────────────────────────────────
// O Recharts nao le classe do Tailwind: eixo, grade e tooltip sao props com
// valor de cor. Sao estes os tres objetos, para as telas nao inventarem cada
// uma o seu cinza.

export const chartAxis = {
  stroke: tone("muted-foreground"),
  fontSize: 12,
  tickLine: false,
} as const;

export const chartGrid = tone("border");

/** Fundo `popover` porque o tooltip flutua sobre o card — igual a select e dropdown. */
export const chartTooltip = {
  contentStyle: {
    background: tone("popover"),
    border: `1px solid ${tone("border")}`,
    borderRadius: "0.75rem",
    color: tone("popover-foreground"),
    fontSize: 12,
  },
  labelStyle: { color: tone("popover-foreground"), fontWeight: 600 },
  itemStyle: { color: tone("popover-foreground") },
  cursor: { fill: tone("muted", 0.5) },
} as const;

export const chartLegend = { color: tone("muted-foreground"), fontSize: 12 } as const;

/** Rotulo escrito na ponta da barra. */
export const chartBarLabel = { fill: tone("muted-foreground"), fontSize: 12 } as const;

/**
 * O Recharts nao corta rotulo de eixo: "HORIZONTE URBANISMO" invade o vizinho
 * a 375 px. O nome inteiro continua no tooltip.
 */
export const shortTick = (value: string, max = 14) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/**
 * Animacao de entrada dos graficos desligada de proposito.
 *
 * O `ResponsiveContainer` refaz a serie a cada mudanca de largura — recolher a
 * barra lateral ou girar o celular reanimava 1,5 s de barra crescendo, o que
 * atropela `prefers-reduced-motion` e ainda deixava o grafico em branco em
 * captura de tela. O movimento desta tela e o do kit (150–300 ms), nao o do
 * Recharts.
 */
export const chartStill = { isAnimationActive: false } as const;
