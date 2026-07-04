import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";

const Schema = z.object({
  team_id: z.string().uuid().optional().nullable(),
  slug: z.string().min(1).max(120).optional().nullable(),
  pin: z.string().min(4).max(10).optional().nullable(),
});

function slugify(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/^equipe\s+/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function sha256(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { team_id: teamIdIn, slug, pin } = parsed.data;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve team by slug if no uuid provided
    let team_id = teamIdIn ?? null;
    if (!team_id && slug) {
      const { data: all } = await supabase.from("teams").select("id, name, display_name");
      const match = (all ?? []).find((t: any) =>
        slugify(t.display_name || "") === slug || slugify(t.name || "") === slug
      );
      if (match) team_id = match.id;
    }
    if (!team_id) {
      return new Response(JSON.stringify({ error: "Equipe não encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: infoRows, error: infoErr } = await supabase.rpc("get_team_public_info", { _team_id: team_id });
    if (infoErr) throw infoErr;
    const info = Array.isArray(infoRows) ? infoRows[0] : null;
    if (!info) {
      return new Response(JSON.stringify({ error: "Equipe não encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    (info as any).team_id = team_id;

    const { data: teamRow } = await supabase.from("teams").select("display_name").eq("id", team_id).maybeSingle();
    if (teamRow?.display_name) (info as any).team_name = teamRow.display_name;

    let roster: Array<{ broker_id: string; broker_name: string }> = [];
    let pin_ok = false;
    if (pin) {
      const { data: pinRow } = await supabase
        .from("team_pins").select("pin_hash, active").eq("team_id", team_id).maybeSingle();
      if (pinRow && pinRow.active && (await sha256(pin)) === pinRow.pin_hash) {
        pin_ok = true;
        const { data: rosterRows, error: rosterErr } = await supabase.rpc("get_team_roster", { _team_id: team_id });
        if (rosterErr) throw rosterErr;
        roster = (rosterRows as any) ?? [];
      }
    }

    return new Response(JSON.stringify({ info, roster, pin_ok }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("daily-team-info error", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
