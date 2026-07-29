import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json();
    let slug = body.slug as string | undefined;
    if (!slug && body.team_id) {
      const { data } = await client.from("public_links").select("slug")
        .eq("kind", "daily_team").eq("team_id", body.team_id).eq("active", true).maybeSingle();
      slug = data?.slug;
    }
    if (!slug) throw new Error("Link diário não encontrado.");

    const entries = (body.entries || []).map((row: any) => ({
      profile_id: row.profile_id || row.broker_id,
      leads: row.leads || 0,
      calls: row.calls ?? row.ligacoes ?? 0,
      doc_collections: row.doc_collections ?? row.coleta_docs ?? 0,
      visits_scheduled: row.visits_scheduled ?? row.visitas_agendadas ?? 0,
      visits_done: row.visits_done ?? row.visitas_realizadas ?? 0,
      analyses_sent: row.analyses_sent ?? row.analises ?? 0,
      analyses_approved: row.analyses_approved ?? row.aprovados ?? 0,
      sales: row.sales ?? row.vendas ?? 0,
    }));
    const { data, error } = await client.rpc("public_daily_submit", {
      p_slug: slug,
      p_pin: body.pin || null,
      p_entries: entries,
    });
    if (error) throw error;
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
