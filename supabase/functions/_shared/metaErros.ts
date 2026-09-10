/**
 * O que a Meta recusou, em português, e o que fazer a respeito.
 *
 * POR QUE ISTO EXISTE. Quando um disparo falha, o que sobrava na tela era
 * `JSON.stringify(data)` cortado em 500 caracteres, gravado em
 * `remarketing_contacts.last_error`. Quem opera lia algo como
 * `{"error":{"message":"(#131047) Re-engagement message","code":131047,...}}` e
 * não tinha como saber que aquilo NÃO é defeito do sistema: é a janela de 24 h
 * da Meta fechada, e a saída é mandar um template aprovado. Sem a tradução, todo
 * código vira "deu erro" e o próximo passo é ligar para o desenvolvedor.
 *
 * REGRA DE OURO DAQUI: **código que não conhecemos devolve `null`.** Inventar
 * uma explicação plausível para um código novo é pior que não explicar — manda
 * a operação para o lado errado com ar de certeza. Quem recebe `null` mostra a
 * mensagem crua da Meta, que ao menos é verdadeira.
 *
 * A LISTA É CURTA DE PROPÓSITO: só os códigos que aparecem de fato numa operação
 * brasileira. Cobrir o catálogo inteiro da Graph API seria decorar documentação
 * que envelhece; estes são os que a equipe vai encontrar.
 *
 * Sem `import` nenhum, de propósito: é isto que permite ao vitest carregar o
 * arquivo (o resto de `_shared/` importa `secrets.ts`, que lê `Deno.env` e
 * quebra fora do runtime de edge function).
 */

export type ErroMeta = {
  codigo: number;
  titulo: string;
  /** O que aconteceu, sem jargão. */
  explicacao: string;
  /** O que a pessoa faz agora. Sempre acionável por quem opera, não por quem programa. */
  proximo_passo: string;
  /**
   * `true` quando tentar de novo com a MESMA mensagem tende a funcionar (limite
   * de ritmo, instabilidade). `false` quando repetir só gasta tentativa: a
   * recusa é de regra, e o que precisa mudar é a mensagem, o número ou a conta.
   */
  vale_repetir: boolean;
};

const CATALOGO: Record<number, Omit<ErroMeta, "codigo">> = {
  131047: {
    titulo: "Janela de 24 horas fechada",
    explicacao:
      "Passaram-se mais de 24 h desde a última mensagem que essa pessoa enviou. Fora dessa janela a Meta só entrega template aprovado — texto livre é recusado.",
    proximo_passo:
      "Use um template aprovado (categoria Utility ou Marketing, conforme o conteúdo) ou espere a pessoa responder primeiro.",
    vale_repetir: false,
  },
  131026: {
    titulo: "Entrega recusada",
    explicacao:
      "A Meta não conseguiu entregar para este WhatsApp. Costuma ser número sem WhatsApp, conta que não aceitou os termos mais recentes, ou remetente bloqueado pela pessoa.",
    proximo_passo:
      "Confirme o número com o cliente por outro caminho antes de repetir — insistir aqui não muda o resultado.",
    vale_repetir: false,
  },
  130497: {
    titulo: "Conta sem permissão para enviar a este país",
    explicacao:
      "O número emissor não está autorizado a mandar mensagem para usuários deste país. É restrição da conta na Meta, não da mensagem nem da janela de 24 h.",
    proximo_passo:
      "Confira em Integrações se o phone number id cadastrado é o do número BRASILEIRO de produção, dentro da WABA aprovada. Número de teste não entrega para o Brasil.",
    vale_repetir: false,
  },
  131031: {
    titulo: "Conta do WhatsApp bloqueada",
    explicacao:
      "A Meta suspendeu a conta emissora, normalmente por qualidade baixa (muita gente marcando as mensagens como spam) ou por violação de política.",
    proximo_passo:
      "Abra o WhatsApp Manager e veja o motivo e o prazo. Enquanto isso NENHUM disparo sai — não adianta reenfileirar.",
    vale_repetir: false,
  },
  132000: {
    titulo: "O template não bate com as variáveis enviadas",
    explicacao:
      "A quantidade de variáveis mandadas é diferente da que o template aprovado espera. A Meta recusa antes de entregar.",
    proximo_passo:
      "Abra o template na aba WhatsApp e confira quantos {{n}} ele tem — a lista precisa mandar exatamente essa quantidade, na ordem.",
    vale_repetir: false,
  },
  132001: {
    titulo: "Template não existe ou não está aprovado",
    explicacao:
      "O nome do template não foi encontrado na conta, ou existe com outro idioma, ou ainda está em análise pela Meta.",
    proximo_passo:
      "O nome aqui precisa ser idêntico ao do template APROVADO na Meta, com o mesmo idioma. Confira no WhatsApp Manager e corrija o cadastro.",
    vale_repetir: false,
  },
  133010: {
    titulo: "Número emissor não registrado",
    explicacao: "O phone number id cadastrado existe mas não completou o registro na Cloud API.",
    proximo_passo: "Termine o registro do número no WhatsApp Manager e tente de novo.",
    vale_repetir: false,
  },
  190: {
    titulo: "Token de acesso expirado ou inválido",
    explicacao:
      "A credencial que o sistema usa para falar com a Meta perdeu a validade. Token de usuário comum expira em 60 dias, e ninguém é avisado.",
    proximo_passo:
      "Gere um token de USUÁRIO DE SISTEMA no Business Manager (não expira) e regrave em Integrações.",
    vale_repetir: false,
  },
  131056: {
    titulo: "Muitas mensagens para o mesmo número",
    explicacao:
      "A Meta limita quantas mensagens saem para um MESMO destinatário num intervalo curto, e este passou do limite.",
    proximo_passo: "Espere alguns minutos. O envio para os outros contatos da lista continua normal.",
    vale_repetir: true,
  },
  80007: {
    titulo: "Limite de ritmo da conta",
    explicacao: "A conta passou do volume por hora que a Meta permite no nível atual.",
    proximo_passo:
      "Reduza o ritmo da lista (campo 'por minuto') e dispare de novo mais tarde. O que já saiu está entregue.",
    vale_repetir: true,
  },
  4: {
    titulo: "Limite de chamadas à Meta",
    explicacao: "A aplicação bateu o teto de requisições da Graph API neste momento.",
    proximo_passo: "Espere alguns minutos e clique em Disparar de novo — o que sobrou continua na fila.",
    vale_repetir: true,
  },
  368: {
    titulo: "Bloqueio temporário por política",
    explicacao:
      "A Meta bloqueou temporariamente a ação por violação das políticas da plataforma.",
    proximo_passo:
      "Veja o aviso no WhatsApp Manager. Repetir durante o bloqueio costuma prolongá-lo.",
    vale_repetir: false,
  },
};

/**
 * Extrai o código de erro de uma resposta da Graph API.
 *
 * A Meta devolve o erro em lugares diferentes conforme a chamada: no corpo do
 * POST (`error.code`), dentro de um status de webhook (`statuses[].errors[]`) e
 * mais fundo ainda no webhook de entrega (`entry[].changes[].value.statuses[]`).
 * Ler só o primeiro deixava a explicação de fora justamente no webhook, que é
 * onde a falha DEFINITIVA chega.
 */
export function codigoDoErroMeta(payload: unknown): number | null {
  const p = payload as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== "object") return null;

  const candidatos: unknown[] = [
    (p as { error?: unknown }).error,
    ((p as { statuses?: Array<{ errors?: unknown[] }> }).statuses ?? [])[0]?.errors?.[0],
    (
      ((p as { entry?: Array<{ changes?: Array<{ value?: { statuses?: Array<{ errors?: unknown[] }> } }> }> })
        .entry ?? [])[0]?.changes ?? []
    )[0]?.value?.statuses?.[0]?.errors?.[0],
  ];

  for (const c of candidatos) {
    const codigo = Number((c as { code?: unknown } | undefined)?.code);
    if (Number.isFinite(codigo) && codigo !== 0) return codigo;
  }
  return null;
}

/** A explicação, ou `null` para código que não conhecemos. */
export function explicarErroMeta(payload: unknown): ErroMeta | null {
  const codigo = codigoDoErroMeta(payload);
  if (codigo === null) return null;
  const entrada = CATALOGO[codigo];
  return entrada ? { codigo, ...entrada } : null;
}

/**
 * Uma linha para gravar em `last_error` e mostrar na tela.
 *
 * Sem tradução, devolve a mensagem crua da Meta — que é feia, mas verdadeira.
 * O limite de 400 caracteres é do campo; cortar aqui evita que a frase útil
 * seja engolida por um JSON gigante.
 */
export function descreverFalhaMeta(payload: unknown): string {
  const erro = explicarErroMeta(payload);
  if (erro) return `${erro.titulo}: ${erro.explicacao} → ${erro.proximo_passo}`.slice(0, 400);

  const cru = (payload as { error?: { message?: string } } | null)?.error?.message;
  if (cru) return `A Meta recusou: ${cru}`.slice(0, 400);
  return JSON.stringify(payload ?? {}).slice(0, 400);
}

/**
 * O 200 da Meta significa ACEITE, não entrega.
 *
 * A confirmação de que a mensagem chegou (ou falhou de vez) vem depois, pelo
 * webhook de status. Uma tela que escreve "enviado" no 200 mente por omissão —
 * é a mesma disciplina que já vale para a fila de notificações.
 */
export const AVISO_ACEITE =
  "A Meta confirmou o aceite do envio. A entrega (ou a falha definitiva) chega depois, pelo webhook de status.";
