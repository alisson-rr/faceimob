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
      const { data } = await client
        .from("public_links")
        .select("slug")
        .eq("kind", "daily_team")
        .eq("team_id", body.team_id)
        .eq("active", true)
        .maybeSingle();
      slug = data?.slug;
    }
    if (!slug) throw new Error("Link diário não encontrado.");

    const { data, error } = await client.rpc("public_daily_team", {
      p_slug: slug,
      p_pin: body.pin || null,
    });
    if (error) throw error;
    if (!data) {
      return new Response(JSON.stringify({ pin_ok: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const roster = (data.roster || []).map((row: any) => ({
      broker_id: row.profile_id,
      broker_name: row.full_name,
      active: true,
    }));
    return new Response(JSON.stringify({
      info: {
        team_id: data.team_id,
        team_name: data.team_name,
        has_pin: data.has_pin,
      },
      pin_ok: true,
      roster,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
