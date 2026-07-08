import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";

const half = z.number().min(0).max(9999).multipleOf(0.5).default(0);
const EntrySchema = z.object({
  broker_id: z.string().uuid().nullable().optional(),
  broker_name: z.string().min(1).max(120),
  leads: half,
  ligacoes: half,
  coleta_docs: half,
  atendimentos: half,
  propostas: half,
  visitas_agendadas: half,
  visitas_realizadas: half,
  analises: half,
  aprovados: half,
  vendas: half,
});

const BodySchema = z.object({
  team_id: z.string().uuid(),
  pin: z.string().min(4).max(10).optional().nullable(),
  director_slug: z.string().min(1).max(120).optional().nullable(),
  report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  filled_by_name: z.string().min(1).max(120),
  notes: z.string().max(4000).optional().nullable(),
  entries: z.array(EntrySchema).min(1).max(200),
});

function slugify(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = parsed.data;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Validate PIN
    const { data: pinRow } = await supabase
      .from("team_pins").select("pin_hash, active").eq("team_id", body.team_id).maybeSingle();
    if (!pinRow || !pinRow.active) {
      return new Response(JSON.stringify({ error: "PIN não configurado para esta equipe." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const hash = await sha256(body.pin);
    if (hash !== pinRow.pin_hash) {
      return new Response(JSON.stringify({ error: "PIN incorreto." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upsert report
    const { data: existing } = await supabase
      .from("daily_team_reports")
      .select("id")
      .eq("team_id", body.team_id)
      .eq("report_date", body.report_date)
      .maybeSingle();

    let reportId = existing?.id as string | undefined;
    let backup: any[] | null = null;
    if (reportId) {
      await supabase.from("daily_team_reports").update({
        filled_by_name: body.filled_by_name, notes: body.notes ?? null,
      }).eq("id", reportId);
      // Snapshot existing entries so we can restore them if the new insert fails.
      const { data: prev } = await supabase
        .from("daily_broker_entries").select("*").eq("report_id", reportId);
      backup = (prev as any[]) ?? [];
      await supabase.from("daily_broker_entries").delete().eq("report_id", reportId);
    } else {
      const { data: inserted, error } = await supabase
        .from("daily_team_reports")
        .insert({
          team_id: body.team_id, report_date: body.report_date,
          filled_by_name: body.filled_by_name, notes: body.notes ?? null,
        }).select("id").single();
      if (error) throw error;
      reportId = inserted.id;
    }

    const entries = body.entries.map((e) => ({ ...e, report_id: reportId }));
    const { error: entriesErr } = await supabase.from("daily_broker_entries").insert(entries);
    if (entriesErr) {
      // Restore previous entries so we don't leave the report with zero rows.
      if (backup && backup.length) {
        const restore = backup.map(({ id, created_at, ...rest }: any) => rest);
        await supabase.from("daily_broker_entries").insert(restore);
      }
      throw entriesErr;
    }


    return new Response(JSON.stringify({ ok: true, report_id: reportId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("submit-daily-report error", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
