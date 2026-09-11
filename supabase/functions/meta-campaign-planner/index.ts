import { requireUserPermission, serviceClient } from "../_shared/auth.ts";
import { descreverFalhaMeta } from "../_shared/metaErros.ts";
import { MetaApiError, metaGet, metaToken } from "../_shared/metaAds.ts";
import { chatJson } from "../_shared/openai.ts";
import {
  type BuscaDeInteresses,
  type Contexto,
  FRASE_LIMITE_PLANOS,
  lerEntrada,
  montarPlano,
  montarPrompt,
  nomeDoPlano,
  palavrasDeInteresse,
} from "./plano.ts";

/**
 * Planejador de campanha (F2.3): uma chamada de IA por plano, nome pela F0,
 * interesses validados na busca da Meta, HOUSING fixo. O plano é salvo e a tela
 * o imprime; nada é publicado na Meta.
 *
 * Porta: `marketing.meta_manage`. A tabela não tem policy de insert: este é o
 * único caminho que grava plano, com a service role e `created_by` = quem pediu
 * — "interesse com ID da Meta" e "HOUSING" só valem porque só daqui sai plano.
 *
 * O link do imóvel é só texto: o servidor nunca o baixa (sem SSRF) e ele nem
 * vai para a IA. Teto de tentativas por pessoa por dia, registrado no banco
 * antes de pagar a IA.
 *
 * 200 {ok, plan_id} · 422 pedido inválido · 429 teto do dia · 502 a IA falhou
 * · 500 banco. Nada do pedido, do plano nem de token vai para o log.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SEM_TOKEN =
  "Sem token da Marketing API: nenhum interesse foi validado na Meta. Cadastre o token em Admin → Meta Ads e gere de novo.";

const MAX_TOKENS_IA = 1500;

const mensagem = (e: unknown) => (e instanceof Error ? e.message : "falha sem mensagem");

/**
 * Cada palavra na busca de interesses da Meta. Sem token ou com falha, a
 * palavra fica sem validação e o motivo vai para o plano — nunca um ID
 * inventado nem uma lista vazia sem explicação.
 */
async function buscarInteresses(palavras: string[]): Promise<BuscaDeInteresses> {
  const porPalavra = new Map<string, unknown>();
  if (palavras.length === 0) return { porPalavra, aviso: null };
  try {
    const token = await metaToken();
    if (!token) return { porPalavra, aviso: SEM_TOKEN };
    const respostas = await Promise.allSettled(
      palavras.map((q) =>
        metaGet<{ data?: unknown }>("search", { type: "adinterest", q, limit: "5", locale: "pt_BR" }, token)
      ),
    );
    let aviso: string | null = null;
    respostas.forEach((r, i) => {
      if (r.status === "fulfilled") {
        porPalavra.set(palavras[i], r.value.data);
        return;
      }
      const e = r.reason;
      console.error(
        "meta-campaign-planner: busca de interesse falhou",
        e instanceof MetaApiError ? `status=${e.status} code=${e.code ?? "-"}` : "sem resposta",
      );
      aviso ??= `A busca de interesses na Meta falhou: ${descreverFalhaMeta(e)}`;
    });
    return { porPalavra, aviso };
  } catch (e) {
    return { porPalavra, aviso: `A busca de interesses na Meta falhou: ${descreverFalhaMeta(e)}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const gate = await requireUserPermission(req, "marketing.meta_manage", corsHeaders);
  if (gate.denied) return gate.denied;

  const lido = lerEntrada(await req.json().catch(() => null));
  if (!lido.ok) return json({ error: lido.error }, 422);
  const entrada = lido.entrada;
  const db = serviceClient();

  const { data: construtora, error: erroConstrutora } = await db
    .from("developers")
    .select("name")
    .eq("id", entrada.developer_id)
    .maybeSingle();
  if (erroConstrutora) {
    console.error("meta-campaign-planner: leitura da construtora falhou", erroConstrutora.code);
    return json({ error: "Não consegui ler a construtora. Tente de novo." }, 500);
  }
  if (!construtora) return json({ error: "Construtora não encontrada." }, 422);

  let projeto: { name: string; city: string | null; state: string | null } | null = null;
  if (entrada.project_id) {
    const { data, error } = await db
      .from("developer_projects")
      .select("name, city, state")
      .eq("id", entrada.project_id)
      .eq("developer_id", entrada.developer_id)
      .maybeSingle();
    if (error) {
      console.error("meta-campaign-planner: leitura do empreendimento falhou", error.code);
      return json({ error: "Não consegui ler o empreendimento. Tente de novo." }, 500);
    }
    if (!data) return json({ error: "Empreendimento não encontrado nesta construtora." }, 422);
    projeto = data;
  }

  const ctx: Contexto = {
    ...entrada,
    construtora: construtora.name,
    empreendimento: projeto?.name ?? null,
    cidade: projeto?.city?.trim() || null,
    uf: projeto?.state?.trim() || null,
  };
  // Nome fora do padrão F0 (empreendimento chamado "WHATSAPP", por exemplo) é
  // recusado antes de pagar a IA.
  try {
    nomeDoPlano(ctx);
  } catch (e) {
    return json({ error: mensagem(e) }, 422);
  }

  // O teto conta tentativas, não planos salvos: a IA é paga mesmo quando o plano
  // falha na montagem ou o JSON vem inválido. Registrada antes da IA, com trava
  // por perfil no banco.
  const { data: dentroDoTeto, error: erroTeto } = await db.rpc("meta_plano_tentativa_registrar", {
    p_profile_id: gate.userId,
  });
  if (erroTeto) {
    console.error("meta-campaign-planner: registro da tentativa falhou", erroTeto.code);
    return json({ error: "Não consegui conferir o limite diário de planos. Tente de novo." }, 500);
  }
  if (dentroDoTeto !== true) return json({ error: FRASE_LIMITE_PLANOS }, 429);

  let ia: { data: unknown; model: string };
  try {
    ia = await chatJson<unknown>({ ...montarPrompt(ctx), maxTokens: MAX_TOKENS_IA });
  } catch (e) {
    console.error("meta-campaign-planner: a IA falhou");
    return json({ error: `A IA não gerou o plano: ${mensagem(e)}` }, 502);
  }

  const busca = await buscarInteresses(palavrasDeInteresse(ia.data));
  let plano;
  try {
    plano = montarPlano(ia.data, ctx, busca);
  } catch (e) {
    return json({ error: mensagem(e) }, 502);
  }

  const { data: salvo, error: erroInsert } = await db
    .from("meta_campaign_plans")
    .insert({
      developer_id: entrada.developer_id,
      project_id: entrada.project_id,
      padrao: entrada.padrao,
      formato: entrada.formato,
      canal: entrada.canal,
      verba_diaria: entrada.verba_diaria,
      link: entrada.link,
      observacoes: entrada.observacoes,
      nome: plano.nome,
      plano,
      model: ia.model,
      created_by: gate.userId,
    })
    .select("id")
    .single();
  if (erroInsert || !salvo) {
    console.error("meta-campaign-planner: gravação do plano falhou", erroInsert?.code);
    return json({ error: "O plano foi gerado mas não consegui salvá-lo. Tente de novo." }, 500);
  }

  return json({ ok: true, plan_id: salvo.id });
});
