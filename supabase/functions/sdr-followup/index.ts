// SDR Follow-up (0263) — chamado pelo pg_cron (`dispatch_sdr_followup`) a cada
// 5 min, só com a chave de serviço. Para cada conversa devida, o agente escreve
// UMA mensagem curta retomando a pergunta pendente e ela vai pelo WhatsApp.
// A reserva (`sdr_reservar_followups`) marca a etapa ANTES do envio: duas
// execuções seguidas nunca mandam o mesmo follow-up duas vezes. O preço é que
// uma falha de envio não é repetida — o próximo follow-up, ou o arquivo em
// 24 h, segue o fluxo.
import { requireServiceRole, serviceClient } from '../_shared/auth.ts';
import { ConversationClosedError, InactiveAgentError, runSdrAgentTurn } from '../_shared/sdrAgent.ts';
import { normalizePhone, sendWhatsAppText } from '../_shared/meta.ts';
import { baloesDaResposta } from '../whatsapp-inbound-webhook/parse.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** O que o agente faz em cada etapa; a conversa e o prompt dele dão o resto. */
const INSTRUCAO: Record<number, string> = {
  1: 'FOLLOW-UP: o lead não responde há cerca de 1 hora. Escreva UMA mensagem curta e gentil retomando ' +
    'a última pergunta que ficou sem resposta. Não repita a apresentação, não se despeça e não use [QUALIFICADO] nem [DESQUALIFICADO].',
  2: 'FOLLOW-UP: o lead não responde há quase um dia. Escreva UMA mensagem curta e calorosa, diga que segue à ' +
    'disposição e repita a pergunta pendente de forma simples. Não se despeça e não use [QUALIFICADO] nem [DESQUALIFICADO].',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const denied = await requireServiceRole(req, corsHeaders);
  if (denied) return denied;

  const supabase = serviceClient();
  const { data, error } = await supabase.rpc('sdr_reservar_followups');
  if (error) {
    console.error('sdr-followup: reserva falhou —', error.message);
    return json({ error: 'reserva falhou' }, 500);
  }

  let enviados = 0;
  for (const linha of (data ?? []) as Array<{ conversation_id: string; phone: string | null; etapa: number }>) {
    const fone = normalizePhone(linha.phone ?? '');
    const instrucao = INSTRUCAO[linha.etapa];
    if (!fone || !instrucao) continue;
    try {
      const turno = await runSdrAgentTurn(supabase, {
        conversationId: linha.conversation_id,
        message: null,
        instrucaoDoTurno: instrucao,
      });
      for (const balao of baloesDaResposta(turno.reply)) {
        const res = await sendWhatsAppText(fone, balao).catch(() => ({ ok: false }));
        if (!res.ok) {
          console.error('sdr-followup: WhatsApp não aceitou o follow-up da conversa', linha.conversation_id);
          break;
        }
      }
      enviados++;
    } catch (e) {
      // Conversa assumida ou agente desligado entre a reserva e o turno: nada a fazer.
      if (e instanceof ConversationClosedError || e instanceof InactiveAgentError) continue;
      console.error('sdr-followup: turno falhou —', e instanceof Error ? e.message : String(e));
    }
  }
  return json({ reservados: data?.length ?? 0, enviados });
});
