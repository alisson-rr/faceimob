import { requireServiceRole, serviceClient } from "../_shared/auth.ts";
import { sendWhatsAppTemplate } from "../_shared/meta.ts";

/**
 * Relatório da Meta pelo WhatsApp (0336). Todo dia às 08:30 o pg_cron chama
 * esta função com a service role: ela manda o modelo oficial "relatrio"
 * (imagem + botão "Receber relatório") a cada sócio e administrador com
 * telefone. O relatório em si sai quando a pessoa clica — o webhook
 * `whatsapp-inbound-webhook` reconhece o clique e responde, sem virar lead.
 */
const MODELO = "relatrio";
const IDIOMA = "pt_BR";
// ponytail: imagem fixa servida pelo próprio CRM; evoluir para o cofre quando trocar de domínio.
const IMAGEM = "https://app.faceimob.com.br/relatorio-meta-ads.jpg";

const corsHeaders: Record<string, string> = { "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const negado = await requireServiceRole(req, corsHeaders);
  if (negado) return negado;

  const db = serviceClient();
  const { data, error } = await db.rpc("relatorio_meta_destinatarios");
  if (error) {
    console.error("relatorio-meta-whatsapp: destinatários indisponíveis —", error.message);
    return json({ error: "Não consegui listar os destinatários." }, 500);
  }

  let enviados = 0;
  const destinatarios = (data ?? []) as { profile_id: string; telefone: string }[];
  for (const d of destinatarios) {
    let status: "enviado" | "falhou" = "falhou";
    let erro: string | null = null;
    try {
      const r = await sendWhatsAppTemplate(d.telefone, MODELO, IDIOMA, [], IMAGEM);
      if (r.ok) status = "enviado";
      else erro = String((r.data as { error?: { message?: string } })?.error?.message ?? "a Meta recusou").slice(0, 300);
    } catch (e) {
      erro = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    }
    if (status === "enviado") enviados++;
    const { error: regErr } = await db.from("relatorio_meta_envios")
      .insert({ profile_id: d.profile_id, telefone: d.telefone, status, erro });
    if (regErr) console.error("relatorio-meta-whatsapp: envio não registrado —", regErr.message);
  }
  return json({ ok: true, destinatarios: destinatarios.length, enviados });
});
