/**
 * Variáveis de template do WhatsApp — o que a tela precisa saber ANTES do envio.
 *
 * A Meta espera os placeholders `{{1}}`, `{{2}}`… na ordem, e recusa a mensagem
 * quando a quantidade de parâmetros não bate com a do template aprovado. Até
 * aqui o corpo era texto livre, `whatsapp_templates.variables` não tinha campo
 * na tela, e cada caminho mandava um número fixo diferente: as boas-vindas
 * (`meta-ads-webhook`) mandavam 1 e o broadcast (`sdr-whatsapp-broadcast`)
 * mandava 2. O mesmo template quebrava num dos dois, e o erro só aparecia em
 * `remarketing_contacts.last_error`.
 *
 * Agora `variables` é a fonte de verdade dos dois envios, e este arquivo é o
 * que avisa o operador enquanto ele ainda pode consertar.
 *
 * `VAR_ALIASES` está duplicado nas duas edge functions (Deno não importa de
 * `src/`). Mudou aqui, muda lá — os arquivos apontam um para o outro.
 */

/** Nome do dado do contato → apelidos aceitos no campo `variables`. */
export const VAR_ALIASES: Record<string, string[]> = {
  nome: ["nome", "name", "cliente", "contato", "1"],
  campanha: ["campanha", "campaign", "origem", "2"],
};

const CANONICAL = Object.entries(VAR_ALIASES);

/** Valor que o envio real usaria, por dado conhecido. Só para pré-visualização. */
const EXEMPLO: Record<string, string> = { nome: "Maria Souza", campanha: "Lançamento Parque" };

/** A que dado do contato um nome de variável se refere, ou `null` se a nenhum. */
export const canonicalVar = (name: string): string | null => {
  const key = name.trim().toLowerCase();
  return CANONICAL.find(([, aliases]) => aliases.includes(key))?.[0] ?? null;
};

/** Maior `{{n}}` usado no corpo — é quantos parâmetros a Meta vai exigir. */
export function placeholderCount(body: string): number {
  let max = 0;
  for (const m of body.matchAll(/\{\{\s*(\d{1,2})\s*\}\}/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** "nome, campanha" → ["nome","campanha"]. Vazio vira lista vazia, não [""]. */
export const parseVariables = (input: string): string[] =>
  input.split(",").map((v) => v.trim()).filter(Boolean);

/**
 * O que impede este template de sair, em ordem de gravidade. Lista vazia =
 * corpo e variáveis combinam.
 */
export function templateIssues(body: string, variables: string[]): string[] {
  const usados = placeholderCount(body);
  const problemas: string[] = [];

  if (usados > variables.length) {
    problemas.push(
      `O corpo usa {{${usados}}} mas só ${variables.length} variável(is) está(ão) declarada(s): a Meta recusa o envio.`,
    );
  } else if (variables.length > usados) {
    problemas.push(
      `${variables.length} variável(is) declarada(s) e o corpo usa ${usados}: a Meta recusa parâmetro sobrando.`,
    );
  }

  const desconhecidas = variables.filter((v) => !canonicalVar(v));
  if (desconhecidas.length > 0) {
    problemas.push(
      `Sem dado do contato para ${desconhecidas.map((v) => `"${v}"`).join(", ")} — vai como "-" no envio. `
      + `Nomes reconhecidos: ${Object.keys(VAR_ALIASES).join(", ")}.`,
    );
  }

  return problemas;
}

/**
 * O que impede o nome de casar com um template aprovado na Meta, ou `null`.
 *
 * O disparo casa pelo NOME (`sendWhatsAppTemplate(to, tpl.name, …)` no
 * `meta-ads-webhook` e no `sdr-whatsapp-broadcast`), e a Meta só registra nome
 * em minúsculas, dígitos e `_`. "Boas Vindas" salvava aqui e era recusado lá —
 * a falha aparecia em `remarketing_contacts.last_error`, longe de quem
 * cadastrou. Campo vazio não é problema DESTA função: quem cobra o
 * obrigatório é o salvar, antes de chamar aqui.
 */
export function nameIssue(name: string): string | null {
  const nome = name.trim();
  if (!nome) return null;
  if (nome.length > 512) return "O nome passa de 512 caracteres: a Meta não registra nome tão longo.";
  if (!/^[a-z0-9_]+$/.test(nome)) {
    return "A Meta só aceita letras minúsculas, números e \"_\" no nome do template — "
      + "e ele tem de ser idêntico ao do template aprovado lá, porque é por ele que o disparo casa.";
  }
  return null;
}

/** O corpo com os placeholders trocados pelo que o envio real colocaria. */
export function renderPreview(body: string, variables: string[]): string {
  return body.replace(/\{\{\s*(\d{1,2})\s*\}\}/g, (_, n) => {
    const nome = variables[Number(n) - 1];
    if (!nome) return "«sem variável»";
    const canonical = canonicalVar(nome);
    return canonical ? EXEMPLO[canonical] : "-";
  });
}
