import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { slug, week_start } = await req.json();
    if (!slug || typeof slug !== "string") {
      return new Response(JSON.stringify({ error: "slug required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // resolve director broker by slug
    const { data: directors } = await supabase.from("brokers").select("id,name,active,role").eq("role", "director");
    const director = (directors || []).find((b: any) => b.active !== false && slugify(b.name || "") === slug);
    if (!director) {
      return new Response(JSON.stringify({ error: "director not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // managers under director
    const { data: managers } = await supabase.from("brokers").select("id,name").eq("director_id", director.id);
    const mgrIds = (managers || []).map((m: any) => m.id);

    // teams under those managers + teams managed directly by the director
    const scopeIds = Array.from(new Set([...mgrIds, director.id]));
    const { data: t } = await supabase.from("teams").select("id,name,display_name,manager_id").in("manager_id", scopeIds);
    const teams: any[] = t || [];
    const teamIds = teams.map((t: any) => t.id);

    // week window (monday-based)
    const now = week_start ? new Date(week_start) : new Date();
    const day = now.getDay(); // 0 Sun .. 6 Sat
    const diffToMon = (day + 6) % 7;
    const ws = new Date(now); ws.setDate(now.getDate() - diffToMon); ws.setHours(0, 0, 0, 0);
    const we = new Date(ws); we.setDate(ws.getDate() + 6);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const from = fmt(ws), to = fmt(we);

    // reports + entries
    let reports: any[] = [];
    let entries: any[] = [];
    if (teamIds.length) {
      const { data: rep } = await supabase.from("daily_team_reports").select("id,team_id,report_date").in("team_id", teamIds).gte("report_date", from).lte("report_date", to);
      reports = rep || [];
      const rIds = reports.map((r: any) => r.id);
      if (rIds.length) {
        const { data: ent } = await supabase.from("daily_broker_entries").select("report_id,leads,ligacoes,coleta_docs,analises,aprovados,vendas").in("report_id", rIds);
        entries = ent || [];
      }
    }

    // targets (global + per team)
    const { data: tg } = await supabase.from("checkpoint_targets").select("team_id,analise_enviada_pct,aprovada_pct,venda_pct");
    const targetsMap: Record<string, any> = {};
    (tg || []).forEach((r: any) => {
      targetsMap[r.team_id ?? "__global__"] = {
        analise_enviada_pct: Number(r.analise_enviada_pct),
        aprovada_pct: Number(r.aprovada_pct),
        venda_pct: Number(r.venda_pct),
      };
    });

    // aggregate per team
    const teamOut = teams.map((t: any) => {
      const rIds = new Set(reports.filter((r: any) => r.team_id === t.id).map((r: any) => r.id));
      const acc = { leads: 0, ligacoes: 0, coleta_docs: 0, enviadas: 0, aprovadas: 0, vendas: 0 };
      entries.forEach((e: any) => {
        if (!rIds.has(e.report_id)) return;
        acc.leads += e.leads || 0;
        acc.ligacoes += e.ligacoes || 0;
        acc.coleta_docs += e.coleta_docs || 0;
        acc.enviadas += e.analises || 0;
        acc.aprovadas += e.aprovados || 0;
        acc.vendas += e.vendas || 0;
      });
      return {
        id: t.id,
        name: (t.display_name?.trim?.() || t.name || "Equipe"),
        aggr: acc,
        targets: targetsMap[t.id] ?? targetsMap["__global__"] ?? { analise_enviada_pct: 10, aprovada_pct: 40, venda_pct: 50 },
      };
    });

    return new Response(JSON.stringify({
      director: { id: director.id, name: director.name },
      week: { start: from, end: to },
      teams: teamOut,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
