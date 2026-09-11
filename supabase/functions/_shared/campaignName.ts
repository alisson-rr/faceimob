/**
 * Padrão de nome de campanha (F0): `CONSTRUTORA | EMPREENDIMENTO | CANAL`, com um
 * ` | SUFIXO` livre opcional no fim; sem empreendimento, `CONSTRUTORA | CANAL`.
 *
 * Um montador e um leitor, com dois consumidores em Deno: o planejador monta o
 * nome (a IA nunca escreve o nome) e a sincronização lê o nome para sugerir a
 * construtora. O front não importa este arquivo.
 *
 * Diferente do padrão antigo da agência: o nome da construtora vai INTEIRO — só
 * a primeira palavra fazia "Casa Nova" e "Casa Bella" virarem a mesma — e não há
 * prefixo fixo.
 *
 * Sem `import` nenhum, de propósito: é isso que deixa o vitest carregar o arquivo.
 */

export type CanalCampanha = "formulario" | "whatsapp" | "landing_page";

const TOKEN_DO_CANAL = new Map<CanalCampanha, string>([
  ["formulario", "FORMULARIO"],
  ["whatsapp", "WHATSAPP"],
  ["landing_page", "LP"],
]);
const CANAL_DO_TOKEN = new Map([...TOKEN_DO_CANAL].map(([canal, token]) => [token, canal]));

/** Maiúsculas, sem acento, sem `|` e com os espaços colapsados. */
export function normalizarParte(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function montarNomeCampanha(p: {
  construtora: string;
  empreendimento?: string | null;
  canal: CanalCampanha;
  sufixo?: string | null;
}): string {
  const construtora = normalizarParte(p.construtora);
  const empreendimento = normalizarParte(p.empreendimento ?? "");
  const sufixo = normalizarParte(p.sufixo ?? "");
  const token = TOKEN_DO_CANAL.get(p.canal);
  if (!construtora) throw new Error("O nome da campanha precisa da construtora.");
  if (!token) throw new Error("Canal da campanha desconhecido: use formulario, whatsapp ou landing_page.");
  // Empreendimento ou sufixo igual a um canal deixaria a leitura ambígua.
  if (CANAL_DO_TOKEN.has(empreendimento) || CANAL_DO_TOKEN.has(sufixo)) {
    throw new Error("Empreendimento e sufixo não podem ser só FORMULARIO, WHATSAPP ou LP: o nome ficaria ambíguo.");
  }
  return [construtora, empreendimento, token, sufixo].filter(Boolean).join(" | ");
}

/**
 * Lê um nome no padrão, tolerando caixa, acento e o sufixo livre (ignorado).
 * O canal fica logo depois da construtora ou depois do empreendimento; nome
 * fora disso (o padrão antigo da agência, por exemplo) devolve `null`.
 */
export function lerNomeCampanha(
  nome: string,
): { construtora: string; empreendimento: string | null; canal: CanalCampanha } | null {
  const partes = nome.split("|").map(normalizarParte);
  const [construtora, segunda, terceira] = partes;
  if (partes.length < 2 || !construtora) return null;
  const direto = CANAL_DO_TOKEN.get(segunda);
  if (direto) return { construtora, empreendimento: null, canal: direto };
  const depoisDoEmpreendimento = terceira === undefined ? undefined : CANAL_DO_TOKEN.get(terceira);
  if (depoisDoEmpreendimento && segunda) return { construtora, empreendimento: segunda, canal: depoisDoEmpreendimento };
  return null;
}

/** Id da construtora cujo nome inteiro, normalizado, é o do nome da campanha.
 *  Nenhuma ou mais de uma: `null` — sugerir uma entre duas iguais seria chute. */
export function sugerirConstrutora(nome: string, construtoras: { id: string; name: string }[]): string | null {
  const lido = lerNomeCampanha(nome);
  if (!lido) return null;
  const achadas = construtoras.filter((c) => normalizarParte(c.name) === lido.construtora);
  return achadas.length === 1 ? achadas[0].id : null;
}
