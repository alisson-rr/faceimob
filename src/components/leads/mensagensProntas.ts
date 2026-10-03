/**
 * Mensagens prontas de WhatsApp (0192, pedido de 03/10/2026). Puro: o vitest
 * cobre a troca das variáveis e o cumprimento pela hora.
 */
export type MensagemPronta = {
  id: string;
  titulo: string;
  texto: string;
  dono: string;
  compartilhada: boolean;
};

/** O que o corretor clica para inserir no texto. */
export const VARIAVEIS_DA_MENSAGEM = [
  { chave: "{primeiro_nome}", rotulo: "Primeiro nome do cliente" },
  { chave: "{saudacao}", rotulo: "Bom dia / Boa tarde / Boa noite" },
  { chave: "{corretor}", rotulo: "Seu apelido" },
] as const;

/** Bom dia até 11h59, boa tarde até 17h59, boa noite depois — no horário de Brasília. */
export function saudacao(agora: Date = new Date()): string {
  const hora = Number(
    new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hourCycle: "h23", timeZone: "America/Sao_Paulo" }).format(agora),
  );
  if (hora >= 5 && hora < 12) return "Bom dia";
  if (hora >= 12 && hora < 18) return "Boa tarde";
  return "Boa noite";
}

/** "zoraide_silveira" → "Zoraide"; "NELSON tranquilin" → "Nelson". */
export function primeiroNome(nome: string | null | undefined): string {
  const primeiro = (nome ?? "").trim().split(/[\s_.]+/)[0] ?? "";
  if (!primeiro) return "";
  return primeiro.charAt(0).toLocaleUpperCase("pt-BR") + primeiro.slice(1).toLocaleLowerCase("pt-BR");
}

export function preencherMensagem(
  texto: string,
  dados: { cliente: string | null | undefined; corretor: string; agora?: Date },
): string {
  const valores: Record<string, string> = {
    "{primeiro_nome}": primeiroNome(dados.cliente),
    "{saudacao}": saudacao(dados.agora),
    "{corretor}": dados.corretor,
  };
  return texto.replace(/\{(primeiro_nome|saudacao|corretor)\}/g, (chave) => valores[chave] ?? chave);
}
