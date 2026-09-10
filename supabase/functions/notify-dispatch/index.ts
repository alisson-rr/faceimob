import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecret } from "../_shared/secrets.ts";
import { requireServiceRole } from "../_shared/auth.ts";

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

/**
 * Entrega as notificações que pedem WhatsApp.
 *
 * Os gatilhos `notify_lead_assigned` e `notify_lead_timeout` já gravavam em
 * `notifications` com `channel = 'whatsapp'` desde a 0011 — e nada nunca leu
 * essa fila, então "avisar o corretor que perdeu o lead por prazo" (ata 14/07)
 * existia só como linha no banco.
 *
 * Idempotência por `sent_at`: só linhas com `sent_at is null` são processadas e
 * a marcação acontece por id. Reexecutar a função não remanda nada — o que
 * importa porque o agendador pode disparar duas vezes na virada.
 *
 * Falha de envio NÃO marca `sent_at`: fica na fila para a próxima passada. O
 * limite por execução evita que uma fila represada estoure o tempo da function.
 *
 * O CORTE POR IDADE NÃO ESTÁ AQUI, de propósito: quem descarta a mensagem
 * vencida é `expire_stale_outbound_notifications()` (migration 0083), chamada
 * pelo gatilho do cron a cada minuto. A regra precisa valer mesmo com este
 * worker fora do ar, sem credencial ou em redeploy — que são justamente os três
 * estados em que a fila cresce. Aqui a leitura continua sendo uma só:
 * `sent_at is null`.
 */
const BATCH_LIMIT = 50;

// Depois disto a mensagem é marcada com last_error em vez de retentada para
// sempre — telefone inválido não pode travar a fila eternamente.
const MAX_ATTEMPTS = 5;

/** Um parâmetro de template não aceita quebra de linha nem passa de 1024 caracteres. */
const TEMPLATE_PARAM_LIMIT = 1024;

type PendingRow = {
  id: string;
  profile_id: string;
  title: string;
  body: string | null;
  attempts: number;
  profiles: { phone: string | null; full_name: string | null } | null;
};

/** Mesma normalização do banco: dígitos com DDI 55 implícito. */
const normalizePhone = (raw: string | null | undefined): string => {
  const d = (raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
};

/**
 * Traduz a recusa da Meta para uma frase que diz o que fazer.
 *
 * Só o STATUS e o CÓDIGO da resposta entram na linha — nunca a mensagem do
 * provedor, que costuma repetir o telefone do destinatário.
 *
 * O código 131047 (e o 131026, seu irmão) é o que separa "a credencial está
 * errada" de "a credencial está certa e a Meta exige template": o destinatário
 * aqui é o próprio corretor, que nunca escreveu para o número da empresa, então
 * a janela de 24 h de atendimento nunca está aberta e uma mensagem de texto
 * livre é recusada SEMPRE. Sem esta distinção, cadastrar o token viraria uma
 * fila inteira de recusas com "envio recusado pela Cloud API" e ninguém
 * saberia que o que falta é um template aprovado.
 */
function explainMetaRejection(status: number, code: number | null, attempt: number): string {
  if (status === 401 || code === 190) {
    return `token da Cloud API recusado pela Meta (HTTP ${status}); gere outro em Admin → Integrações (tentativa ${attempt})`;
  }
  if (code === 131047 || code === 131026) {
    return "a Meta exige template aprovado para iniciar conversa (código " +
      `${code}); cadastre meta/whatsapp_notify_template em Admin → Integrações (tentativa ${attempt})`;
  }
  return `envio recusado pela Cloud API (HTTP ${status}, código ${code ?? "sem código"}, tentativa ${attempt})`;
}

type SendOutcome = { ok: boolean; status: number; code: number | null };

/**
 * Envia por template quando há um nome cadastrado, e por texto livre quando não
 * há.
 *
 * O template é o caminho correto para este conteúdo (mensagem iniciada pela
 * empresa), e o texto livre continua existindo porque funciona dentro da janela
 * de 24 h e é o que o ambiente de teste do WhatsApp aceita sem aprovação prévia.
 *
 * O template precisa ter EXATAMENTE UMA variável no corpo (`{{1}}`), que recebe
 * o aviso inteiro. O contrato está em docs/integracoes/whatsapp-cloud-api.md.
 * ponytail: uma variável só; vira lista de parâmetros no dia em que a operação
 * pedir um template com campos separados.
 */
async function sendWhatsApp(
  token: string,
  phoneId: string,
  to: string,
  text: string,
  templateName: string | null,
): Promise<SendOutcome> {
  const payload = templateName
    ? {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: "pt_BR" },
        components: [{
          type: "body",
          parameters: [{
            type: "text",
            // Parâmetro de template não aceita quebra de linha nem tabulação.
            text: text.replace(/\s*\n+\s*/g, " — ").slice(0, TEMPLATE_PARAM_LIMIT),
          }],
        }],
      },
    }
    : {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    };

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({})) as { error?: { code?: number } };
  const code = typeof data?.error?.code === "number" ? data.error.code : null;
  return { ok: res.ok, status: res.status, code };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Worker de fila: o único chamador legítimo é o pg_cron (0018), que manda a
    // chave de serviço no header. Sem esta porta, a chave publicável do bundle
    // dispara a fila de WhatsApp de fora (achado S04).
    const denied = await requireServiceRole(req, corsHeaders);
    if (denied) return denied;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("notifications")
      .select("id,profile_id,title,body,attempts,profiles(phone,full_name)")
      .eq("channel", "whatsapp")
      .is("sent_at", null)
      .lt("attempts", MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (error) throw error;

    const pending = (data ?? []) as unknown as PendingRow[];
    if (pending.length === 0) return json({ processed: 0, sent: 0, skipped: 0, failed: 0 });

    const token = await getSecret("META_WHATSAPP_ACCESS_TOKEN");
    const phoneId = await getSecret("META_WHATSAPP_PHONE_NUMBER_ID");
    const templateName = await getSecret("META_WHATSAPP_NOTIFY_TEMPLATE");

    // Sem credencial não há envio possível — e `requireSecret` fazia isso pelo
    // caminho errado: o throw acontecia ANTES do laço, então `attempts` ficava
    // em 0, nada era marcado e a fila crescia para sempre sem deixar rastro
    // (77 linhas represadas desde 30/07 e todas com attempts = 0).
    //
    // Aqui a ausência é registrada NA LINHA, sem gastar tentativa: a mensagem
    // não falhou, ela nem foi tentada. `sent_at` continua nulo — quando a chave
    // entrar, a mesma fila drena. E 503 (não 500) diz ao chamador que falta
    // configuração, não que a function quebrou.
    if (!token || !phoneId) {
      const motivo = "credencial da WhatsApp Cloud API ausente no cofre";

      // A marcação vai por FILTRO, não por `.in(id, lote)`. Com o lote de 50
      // mais antigas, toda passada repescava as MESMAS 50 linhas — que já
      // tinham `last_error` — e as outras 262 nunca receberiam explicação
      // nenhuma: 53 marcadas de 312 pendentes, número congelado desde 17:08.
      //
      // `last_error is null` como recorte faz duas coisas: o UPDATE converge
      // para zero linha (não reescreve a fila inteira a cada minuto) e preserva
      // um motivo mais específico já registrado — uma recusa da Meta diz mais
      // sobre a linha do que "falta credencial".
      const { data: marcadas, error: markError } = await supabase
        .from("notifications")
        .update({ last_error: motivo })
        .eq("channel", "whatsapp")
        .is("sent_at", null)
        .is("last_error", null)
        .lt("attempts", MAX_ATTEMPTS)
        .select("id");
      if (markError) {
        console.error("notify-dispatch: falha ao marcar fila bloqueada —", markError.message);
      }
      console.error(`notify-dispatch: ${motivo}; ${pending.length} mensagens aguardando`);
      return json({
        error: motivo,
        detail: "Cadastre meta/whatsapp_access_token e meta/whatsapp_phone_number_id em Admin → Integrações.",
        pending: pending.length,
        marked: marcadas?.length ?? 0,
        processed: 0, sent: 0, skipped: 0, failed: 0,
      }, 503);
    }

    let sent = 0, skipped = 0, failed = 0;

    for (const row of pending) {
      const phone = normalizePhone(row.profiles?.phone);
      if (!phone) {
        // Sem telefone não há o que tentar de novo: marca como tratada para a
        // fila não travar num registro impossível.
        await supabase.from("notifications").update({
          sent_at: new Date().toISOString(),
          last_error: "perfil sem telefone",
        }).eq("id", row.id);
        skipped++;
        continue;
      }

      const text = row.body ? `${row.title}\n\n${row.body}` : row.title;
      const result = await sendWhatsApp(token, phoneId, phone, text, templateName);

      if (result.ok) {
        await supabase.from("notifications").update({
          sent_at: new Date().toISOString(),
          last_error: null,
        }).eq("id", row.id);
        sent++;
      } else {
        // Não logar o corpo inteiro da resposta do provedor: pode conter dado
        // pessoal. Só o id da notificação, o status e o código da Meta.
        console.error(
          `notify-dispatch: falha ao enviar notificação ${row.id} (HTTP ${result.status}, código ${result.code ?? "-"})`,
        );
        const attempts = (row.attempts ?? 0) + 1;
        const gaveUp = attempts >= MAX_ATTEMPTS;
        await supabase.from("notifications").update({
          attempts,
          last_error: explainMetaRejection(result.status, result.code, attempts),
          // Desistiu: marca sent_at para sair da fila; last_error conta a história.
          ...(gaveUp ? { sent_at: new Date().toISOString() } : {}),
        }).eq("id", row.id);
        failed++;
      }
    }

    return json({ processed: pending.length, sent, skipped, failed, template: Boolean(templateName) });
  } catch (error) {
    console.error("notify-dispatch error:", error);
    return json({ error: error instanceof Error ? error.message : "unknown" }, 500);
  }
});
