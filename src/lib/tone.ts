import type { StatusTone } from "@/components/shared";

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

/** Hash do nome normalizado: a mesma cor para o mesmo nome em qualquer tela e
 *  em qualquer ordem de consulta. */
function nameHash(name: string): number {
  const key = name.trim().toUpperCase();
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash;
}

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
  return CHART_SERIES[nameHash(name) % CHART_SERIES.length];
}

/** O formato que `developers.color` aceita (0152) e que `<input type="color">` devolve. */
export const isDeveloperColor = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/** Classes literais, para o Tailwind enxergar na varredura. */
const DEVELOPER_DOT: Record<ChartToken, string> = {
  "chart-1": "bg-chart-1",
  "chart-2": "bg-chart-2",
  "chart-3": "bg-chart-3",
  "chart-4": "bg-chart-4",
  "chart-5": "bg-chart-5",
};

/**
 * Bolinha da construtora no Pipeline (tabela e cartao). A cor escolhida no
 * cadastro manda; sem ela, a cor do nome (`developerColor`).
 *
 * A cor livre do admin pode sumir contra o fundo de um dos temas: o anel
 * `ring-border` segura o contorno. O nome continua escrito ao lado, entao a
 * cor nunca e o unico sinal.
 */
export function developerDot(
  name: string,
  color?: string | null,
): { className: string; style?: { backgroundColor: string } } {
  return isDeveloperColor(color)
    ? { className: "ring-1 ring-border", style: { backgroundColor: color } }
    : { className: DEVELOPER_DOT[developerColor(name)] };
}

/**
 * Cor do CORRETOR, para escrever o nome dele colorido no Pipeline (pedido do
 * cliente em 10/09/2026: a cor do corretor precisa ser visivel, por corretor).
 *
 * Mesma regra do `developerColor`, com uma paleta menor: `chart-3` fica de fora
 * porque no tema claro ele da 3,98:1 sobre `card` e nome de corretor e texto de
 * 12 px, que exige 4,5:1. Os outros quatro passam nos dois temas. A bolinha da
 * construtora continua usando a serie inteira — ali e objeto grafico (3:1).
 */
const BROKER_TEXT = ["text-chart-1", "text-chart-2", "text-chart-4", "text-chart-5"] as const;

export const brokerTextClass = (name: string): string =>
  BROKER_TEXT[nameHash(name) % BROKER_TEXT.length];

/**
 * Faixa de tempo do negocio em tres cores (decisao do cliente em 10/09/2026):
 * verde ate 3 dias, amarelo de 4 a 9, vermelho de 10 em diante.
 *
 * O tipo DERIVA de `StatusTone` em vez de repetir os tres nomes: sem o
 * `Extract`, um union proprio so indexa um `Record<StatusTone, …>` por
 * coincidencia de chaves, e a coincidencia some no dia em que um dos dois
 * lados renomear um tom.
 */
export type AgeTone = Extract<StatusTone, "success" | "warning" | "danger">;

export const dealAgeTone = (days: number): AgeTone =>
  days >= 10 ? "danger" : days >= 4 ? "warning" : "success";

/**
 * Cor da idade do negocio — fonte unica, e SO de idade, para a tabela e o
 * cartao.
 *
 * Nao usa `STATUS_TONE_CLASS`: aquele mapa e a paleta do Status 2, significado
 * sem relacao nenhuma com idade. Emprestado, quem ajustasse a cor de um status
 * repintava a coluna "Dias" sem querer.
 *
 * `text` = numero do cartao · `soft` = pilula da coluna "Dias" · `solid` =
 * faixa vertical da linha. Classes literais, para o Tailwind enxergar.
 */
export const DEAL_AGE_CLASS: Record<AgeTone, { text: string; soft: string; solid: string }> = {
  success: { text: "text-success", soft: "bg-success/15 text-success", solid: "bg-success" },
  warning: { text: "text-warning", soft: "bg-warning/15 text-warning", solid: "bg-warning" },
  danger: {
    text: "text-destructive",
    soft: "bg-destructive/15 text-destructive",
    solid: "bg-destructive",
  },
};

/** Pódio: 0 = ouro, 1 = prata, 2 = bronze. Fora disso nao ha medalha. */
export const PODIUM_TOKENS = ["gold", "silver", "bronze"] as const;
export type PodiumToken = (typeof PODIUM_TOKENS)[number];
export const podiumToken = (rank: number): PodiumToken | null => PODIUM_TOKENS[rank] ?? null;

/**
 * Classes do podio por token. Literais, para o Tailwind enxergar na varredura.
 *
 * Havia tres implementacoes da mesma cor — `podiumToken` aqui, um `podiumTone`
 * de indice BASE 1 no `AppLayout` e um par `MEDALHA`/`ANEL` de base 0 no
 * `PainelDoCorretor`. Bases diferentes para a mesma ideia sao convite a coroar
 * o segundo colocado de ouro; a base agora e uma so, a de `podiumToken`.
 */
export const PODIUM_CLASS: Record<PodiumToken, { text: string; ring: string }> = {
  gold: { text: "text-gold", ring: "ring-gold" },
  silver: { text: "text-silver", ring: "ring-silver" },
  bronze: { text: "text-bronze", ring: "ring-bronze" },
};

/**
 * Cor do texto da colocacao. `rank` e BASE 0, igual a `podiumToken`.
 *
 * Fora do podio nao ha degrau: o 12o colocado com a cor de bronze anunciava uma
 * medalha que ele nao tem.
 */
export const podiumTextClass = (rank: number): string => {
  const token = podiumToken(rank);
  return token ? PODIUM_CLASS[token].text : "text-muted-foreground";
};

/** Anel do avatar no podio. Mesma base 0; sem medalha, sem anel colorido. */
export const podiumRingClass = (rank: number): string => {
  const token = podiumToken(rank);
  return token ? PODIUM_CLASS[token].ring : "ring-border";
};

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
