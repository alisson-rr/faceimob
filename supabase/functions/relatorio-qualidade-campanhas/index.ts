import { serviceClient } from "../_shared/auth.ts";
import { getSecret } from "../_shared/secrets.ts";
import { tokensIguais } from "./token.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Ponte do relatório do Telegram ("Assistente DG") com a qualidade por
 * campanha do CRM (0267/0268). Só leitura: devolve o que a tela Marketing →
 * Qualidade mostra — gasto, leads, atendidos, qualificados, análise,
 * aprovadas, vendas e o que a Meta contou. Nenhum dado de lead (nome, telefone)
 * sai daqui; são contagens por campanha.
 *
 * Autentica com um token só desta ponte, guardado no cofre
 * (`relatorio/api_token`), e NÃO com a service role: quem vaza o token do
 * relatório lê números de campanha, nada além. Sem o token cadastrado a ponte
 * responde 503 e não abre para ninguém.
 */
Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const esperado = await getSecret("RELATORIO_API_TOKEN");
  if (!esperado) {
    console.error("relatorio-qualidade-campanhas: RELATORIO_API_TOKEN ausente no cofre");
    return json({ error: "Ponte não configurada.", detail: "Cadastre relatorio/api_token em Admin → Integrações." }, 503);
  }
  const recebido = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!tokensIguais(recebido, esperado)) return json({ error: "unauthorized" }, 401);

  // `dias` na URL ou no corpo; a função do banco limita a 1–365.
  const url = new URL(req.url);
  let dias = Number(url.searchParams.get("dias"));
  if (!dias && req.method === "POST") {
    const corpo = await req.json().catch(() => null);
    dias = Number(corpo?.dias);
  }
  dias = Number.isFinite(dias) && dias >= 1 ? Math.min(Math.floor(dias), 365) : 30;

  const { data, error } = await serviceClient().rpc("qualidade_por_campanha", { p_dias: dias });
  if (error) {
    console.error("relatorio-qualidade-campanhas: falha na consulta", error.code);
    return json({ error: "Não foi possível calcular a qualidade das campanhas." }, 500);
  }
  return json({ dias, gerado_em: new Date().toISOString(), campanhas: data ?? [] });
});
