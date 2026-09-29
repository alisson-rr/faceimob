/**
 * Diagnóstico da chegada de leads da Meta (pedido de 29/09/2026: "inseri todas
 * as chaves e tirei a pausa, e os leads não chegam").
 *
 * A Meta só entrega um lead de formulário quando TODA a corrente está de pé:
 *   1. a página está assinada no app com o campo `leadgen`
 *      (POST /{page}/subscribed_apps) — sem isso a Meta não chama ninguém, e é o
 *      passo que nenhuma tela fazia;
 *   2. o webhook do app aponta para a nossa URL e passa na verificação;
 *   3. a assinatura de cada chamada confere com o app secret do cofre;
 *   4. o token da PÁGINA lê o lead (`leads_retrieval`);
 *   5. a pausa está desligada.
 *
 * Aqui só a INTERPRETAÇÃO dos fatos que a edge function coleta — sem import,
 * para o vitest carregar (como `metaErros.ts`). Nenhum valor de credencial entra
 * ou sai: só "tem" e "não tem".
 */

export type Checagem = {
  id: string;
  titulo: string;
  /** `null` = não deu para saber (sem dado); não é falha nem sucesso. */
  ok: boolean | null;
  detalhe: string;
};

export type ResultadoDaChamada =
  | "verificacao_ok" | "verificacao_recusada" | "sem_app_secret" | "assinatura_invalida"
  | "pausado" | "sem_lead" | "aceito" | "falha";

export type FatosDaMeta = {
  pausado: boolean;
  temAppSecret: boolean;
  temVerifyToken: boolean;
  temPageToken: boolean;
  /** `me?metadata=1` com o token da página: o tipo do dono do token. */
  token: { tipo: string | null; nome: string | null } | { erro: string } | null;
  /** Apps assinados na página, ou o erro da leitura. `null` = não lido. */
  assinaturas: { nome: string | null; campos: string[] }[] | { erro: string } | null;
  /** Leitura de um lead real com o token da página. `null` = sem lead para testar. */
  leituraDeLead: { ok: true } | { erro: string } | null;
  ultimaChamada: { em: string; resultado: string | null } | null;
  ultimoLeadEm: string | null;
};

const FRASE_DA_CHAMADA: Record<ResultadoDaChamada, { ok: boolean; frase: string }> = {
  verificacao_ok: { ok: true, frase: "a Meta verificou o webhook com sucesso" },
  verificacao_recusada: {
    ok: false,
    frase: "a verificação foi recusada: o token de verificação do painel da Meta não é o mesmo do cofre",
  },
  sem_app_secret: { ok: false, frase: "recusada (401): falta o app secret no cofre" },
  assinatura_invalida: {
    ok: false,
    frase: "recusada (401): a assinatura não confere — o app secret do cofre não é o do app que chama o webhook",
  },
  pausado: { ok: false, frase: "ignorada: a pausa de leads estava ligada" },
  sem_lead: { ok: true, frase: "recebida, mas sem lead no conteúdo (evento que não é de formulário)" },
  aceito: { ok: true, frase: "lead recebido e gravado" },
  falha: { ok: false, frase: "o lead chegou, mas a gravação falhou — ele foi perdido; veja o log da função" },
};

const quando = (iso: string) => {
  const data = new Date(iso);
  return Number.isNaN(data.getTime())
    ? iso
    : data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
};

export function diagnosticarLeadsMeta(f: FatosDaMeta): Checagem[] {
  const checagens: Checagem[] = [];

  checagens.push({
    id: "pausa",
    titulo: "Pausa de leads",
    ok: !f.pausado,
    detalhe: f.pausado
      ? "Ligada: o webhook responde e descarta todo lead. Desligue em Leads."
      : "Desligada.",
  });

  checagens.push({
    id: "app_secret",
    titulo: "App secret no cofre",
    ok: f.temAppSecret,
    detalhe: f.temAppSecret
      ? "Cadastrado. Se a última chamada foi recusada por assinatura, ele é de outro app."
      : "Falta: sem ele o webhook recusa toda chamada da Meta (401). Cadastre em Integrações.",
  });

  checagens.push({
    id: "verify_token",
    titulo: "Token de verificação no cofre",
    ok: f.temVerifyToken,
    detalhe: f.temVerifyToken
      ? "Cadastrado. Ele precisa ser idêntico ao do painel do app (Webhooks → Page)."
      : "Falta: a Meta não consegue verificar a URL do webhook.",
  });

  if (!f.temPageToken) {
    checagens.push({
      id: "page_token",
      titulo: "Token da página",
      ok: false,
      detalhe: "Falta no cofre: sem ele não há como assinar a página nem ler o lead.",
    });
  } else if (f.token && "erro" in f.token) {
    checagens.push({ id: "page_token", titulo: "Token da página", ok: false, detalhe: f.token.erro });
  } else if (f.token) {
    const ehPagina = f.token.tipo === "page";
    checagens.push({
      id: "page_token",
      titulo: "Token da página",
      ok: ehPagina,
      detalhe: ehPagina
        ? `Válido, da página ${f.token.nome ?? "(sem nome)"}.`
        : "O token cadastrado é de USUÁRIO, não da página. Gere o token da Página (Graph API Explorer → escolha a página) e substitua no cofre.",
    });
  }

  if (f.assinaturas && "erro" in f.assinaturas) {
    checagens.push({ id: "assinatura", titulo: "Página assinada no app (leadgen)", ok: false, detalhe: f.assinaturas.erro });
  } else if (f.assinaturas) {
    const comLeadgen = f.assinaturas.filter((app) => app.campos.includes("leadgen"));
    checagens.push({
      id: "assinatura",
      titulo: "Página assinada no app (leadgen)",
      ok: comLeadgen.length > 0,
      detalhe: comLeadgen.length
        ? `Assinada: ${comLeadgen.map((app) => app.nome ?? "app sem nome").join(", ")}.`
        : "NÃO assinada: a Meta não envia os leads desta página a app nenhum. Use \"Assinar a página\".",
    });
  }

  if (f.leituraDeLead) {
    checagens.push({
      id: "leitura",
      titulo: "Leitura de lead com o token",
      ok: "ok" in f.leituraDeLead,
      detalhe: "ok" in f.leituraDeLead
        ? "O token lê o último lead recebido."
        : `${f.leituraDeLead.erro} Confira a permissão leads_retrieval e o Gerenciador de Acesso a Leads.`,
    });
  }

  const chamada = f.ultimaChamada;
  const frase = chamada?.resultado ? FRASE_DA_CHAMADA[chamada.resultado as ResultadoDaChamada] : undefined;
  checagens.push({
    id: "ultima_chamada",
    titulo: "Última chamada da Meta ao webhook",
    ok: chamada ? frase?.ok ?? null : null,
    detalhe: chamada
      ? `${quando(chamada.em)} — ${frase?.frase ?? chamada.resultado ?? "sem resultado"}.`
      : "Nenhuma registrada: a Meta não chamou a URL desde que o registro existe. Veja a assinatura da página e o webhook do app.",
  });

  checagens.push({
    id: "ultimo_lead",
    titulo: "Último lead da Meta gravado",
    ok: null,
    detalhe: f.ultimoLeadEm ? quando(f.ultimoLeadEm) : "Nenhum lead de formulário da Meta no sistema.",
  });

  return checagens;
}
