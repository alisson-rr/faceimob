/**
 * Respostas que o agente de SDR tem de trazer (0261) e o pedido que transforma
 * o resumo da aba Agentes num prompt. Puro, sem Deno: o vitest cobre.
 *
 * A cada turno o modelo devolve o que já apurou numa tag escondida do lead:
 *   [DADOS: Nome: Ana | Unidade: Zona Sul | CRECI: ?]
 * Só entram os campos configurados no agente; "?" e vazio não apagam o que
 * uma resposta anterior já trouxe.
 */

/** Tag escondida do lead, removida junto das outras de controle. */
export const TAG_DADOS = /\[DADOS:[^\]]*\]/gi;

const limpar = (valor: string) => valor.replace(/[\r\n[\]|]/g, " ").replace(/\s+/g, " ").trim();

/** Campos configurados: sem vazio, sem repetição, curtos. */
export function camposValidos(campos: unknown): string[] {
  if (!Array.isArray(campos)) return [];
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const campo of campos) {
    if (typeof campo !== "string") continue;
    const nome = limpar(campo).replace(/:/g, " ").trim().slice(0, 60);
    if (!nome || vistos.has(nome.toLowerCase())) continue;
    vistos.add(nome.toLowerCase());
    saida.push(nome);
    if (saida.length === 30) break;
  }
  return saida;
}

/** Instrução que vai no fim do prompt do sistema quando o agente tem campos. */
export function instrucaoDeColeta(campos: string[]): string {
  if (campos.length === 0) return "";
  return "\n\nEm TODA resposta, acrescente também numa linha própria, ao final, o que você já sabe destas respostas:" +
    `\n[DADOS: ${campos.map((c) => `${c}: valor`).join(" | ")}]` +
    "\nUse \"?\" no que ainda não souber. Valor curto, com as palavras do lead. Não comente esta tag.";
}

/** Respostas da tag `[DADOS: ...]`, só dos campos configurados; vazio se não veio. */
export function lerColeta(texto: string, campos: string[]): Record<string, string> {
  if (campos.length === 0) return {};
  const tag = /\[DADOS:\s*([^\]]{1,3000})\]/i.exec(texto);
  if (!tag) return {};
  const porNome = new Map(campos.map((c) => [c.toLowerCase(), c]));
  const coleta: Record<string, string> = {};
  for (const parte of tag[1].split("|")) {
    const sep = parte.indexOf(":");
    if (sep < 0) continue;
    const campo = porNome.get(limpar(parte.slice(0, sep)).toLowerCase());
    const valor = limpar(parte.slice(sep + 1)).slice(0, 300);
    if (!campo || !valor || valor === "?") continue;
    coleta[campo] = valor;
  }
  return coleta;
}

/** Mensagens para a IA escrever o prompt do agente a partir do resumo. */
export function pedidoDePrompt(nome: string, resumo: string, campos: string[]) {
  const sistema =
    "Você escreve prompts de sistema para agentes de atendimento por WhatsApp de uma imobiliária brasileira (Faceimob). " +
    "Escreva em português do Brasil, em texto simples (sem markdown, sem asteriscos), com seções em CAIXA ALTA. " +
    "O prompt deve conter: quem é o agente e o objetivo; tom (simpático, natural, mensagens curtas, no máximo 1 emoji por mensagem); " +
    "REGRA DE OURO (uma pergunta por mensagem, esperar a resposta, não repetir o que já foi respondido, " +
    "responder dúvida em uma frase e voltar à pergunta pendente); o ROTEIRO numerado com as perguntas na ordem; " +
    "o que o agente NÃO faz (não promete, não agenda, não fala de sistema nem diz que anotou algo); " +
    "e o ENCERRAMENTO: quando terminar com o perfil certo, despedir-se e terminar com [QUALIFICADO]; " +
    "fora do perfil ou sem interesse, agradecer e terminar com [DESQUALIFICADO]; nunca usar essas marcas antes do fim. " +
    "Inclua um critério de PONTUAÇÃO de 0 a 100 coerente com o resumo. " +
    "Não escreva nada sobre tags de SCORE, RESUMO ou DADOS: o sistema acrescenta isso. " +
    "Devolva só o prompt, sem introdução nem comentário.";
  const usuario =
    `Nome do agente: ${limpar(nome).slice(0, 80) || "Assistente"}\n\n` +
    `Resumo de quem configurou (o que o agente faz e pergunta):\n${resumo.trim().slice(0, 6000)}\n\n` +
    (campos.length
      ? `Respostas que o agente tem de trazer (todas viram perguntas do roteiro):\n${campos.map((c) => `- ${c}`).join("\n")}`
      : "Nenhuma lista de respostas: tire as perguntas do resumo.");
  return [
    { role: "system", content: sistema },
    { role: "user", content: usuario },
  ];
}
