/**
 * Busca que ignora acento e caixa, dos dois lados: "jose" acha "José" e "José"
 * acha "Jose" (pedido de 14/10/2026). Uma regra só para a tela e para o banco.
 */
export const semAcento = (texto: string): string => texto.normalize("NFD").replace(/\p{M}/gu, "");

/** O texto contém o termo, sem diferenciar acento nem maiúscula. */
export const contemTexto = (texto: string | null | undefined, termo: string): boolean =>
  semAcento(texto ?? "").toLowerCase().includes(semAcento(termo).toLowerCase());

const VARIANTES: Record<string, string> = {
  a: "aàáâãäåAÀÁÂÃÄÅ", e: "eèéêëEÈÉÊË", i: "iìíîïIÌÍÎÏ", o: "oòóôõöOÒÓÔÕÖ",
  u: "uùúûüUÙÚÛÜ", c: "cçCÇ", n: "nñNÑ",
};

/**
 * Expressão regular (`imatch` do PostgREST, `~*` do Postgres) que casa o termo
 * com ou sem acento. O banco guarda "José" e o corretor digita "jose": o
 * `ilike` não junta os dois, e criar coluna sem acento só para isso seria mais
 * dado para manter. Todo caractere que não é letra ou espaço vira classe
 * literal, então o termo digitado nunca vira sintaxe de regex.
 */
export const padraoSemAcento = (termo: string): string =>
  [...semAcento(termo).toLowerCase()].map((c) => {
    if (VARIANTES[c]) return `[${VARIANTES[c]}]`;
    if (/[a-z0-9 ]/.test(c)) return c;
    if (/[\\^\][]/.test(c)) return ".";
    return `[${c}]`;
  }).join("");
