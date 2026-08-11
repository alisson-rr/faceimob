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
      if (error) return json({ error: error.message }, 400);
      return json({ success: true, checkin_id: data });
    }

    const ip = clientIp(req);
    if (!ip) {
      return json({ error: "Não foi possível identificar seu IP." }, 400);
    }

    const { data, error } = await client.rpc("perform_checkin", {
      client_ip: ip,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ success: true, checkin_id: data });
  } catch (error) {
    console.error("broker-checkin error:", error);
    return json(
      { error: error instanceof Error ? error.message : "unknown" },
      500,
    );
  }
});
