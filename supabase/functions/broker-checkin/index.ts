import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Repassa a recusa do banco COM o código, não só com o texto.
 *
 * `perform_checkin` distingue os motivos por `errcode` — `42501` é perfil sem
 * `menu.checkin`, `P0001` é regra de operação (fora da janela de turno, IP não
 * autorizado, presença já fechada), `28000` é sessão perdida. Devolvendo só
 * `message`, a tela precisava adivinhar o motivo pelo texto em português: um
 * ajuste de redação na migration mudava silenciosamente o comportamento do
 * cliente. Com o código, a tela decide o que mostrar (e o que esconder) sem ler
 * frase.
 *
 * A mensagem continua sendo a do banco, que já vem em pt-BR e é a única que
 * conhece o detalhe (qual IP, qual turno).
 */
function rpcError(error: { message: string; code?: string | null }) {
  return { error: error.message, code: error.code ?? null };
}

function clientIp(req: Request): string | null {
  // Medição na hospedagem (10/08/2026): o x-forwarded-for chega como
  // "cliente, cliente, 13.248.114.x" — o ÚLTIMO salto é o Global Accelerator
  // da AWS (e rotaciona), nunca o cliente. Os headers que o gateway
  // sobrescreve são sb-forwarded-for e cf-connecting-ip: forja testada com
  // os três headers e todas descartadas antes de chegar à função.
  // O último salto do x-forwarded-for fica só para o stack local, onde é o
  // Kong quem anexa o IP real e os headers acima não existem.
  const confiavel =
    req.headers.get("sb-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip")?.trim();
  if (confiavel) return confiavel;
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const last = forwarded.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last || req.headers.get("x-real-ip")?.trim() || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body?.action === "checkout" ? "checkout" : "checkin";

    if (action === "checkout") {
      const { data, error } = await client.rpc("perform_checkout");
      if (error) return json(rpcError(error), 400);
      return json({ success: true, checkin_id: data });
    }

    const ip = clientIp(req);
    if (!ip) {
      // A escolha de header é específica da hospedagem e já esteve errada uma
      // vez (10/08: o último salto do x-forwarded-for era o Global Accelerator
      // da AWS, não o cliente). Se o gateway mudar, TODO check-in passa a ser
      // negado aqui — e sem este log a operação inteira ficaria de fora sem
      // ninguém saber por quê. Registra só QUAIS headers vieram, nunca o valor:
      // endereço de rede é dado pessoal.
      const vistos = ["sb-forwarded-for", "cf-connecting-ip", "x-forwarded-for", "x-real-ip"]
        .filter((h) => req.headers.get(h));
      console.error(
        `broker-checkin: IP não identificado; headers presentes: ${vistos.join(", ") || "nenhum"}`,
      );
      return json({ error: "Não foi possível identificar seu IP." }, 400);
    }

    const { data, error } = await client.rpc("perform_checkin", {
      client_ip: ip,
    });
    if (error) return json(rpcError(error), 400);
    return json({ success: true, checkin_id: data });
  } catch (error) {
    console.error("broker-checkin error:", error);
    return json(
      { error: error instanceof Error ? error.message : "unknown" },
      500,
    );
  }
});
