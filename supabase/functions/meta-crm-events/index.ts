// Eventos do CRM para a Meta (0288) — chamado pelo pg_cron
// (`dispatch_meta_crm_events`) a cada 5 min, só com a chave de serviço.
// Reserva os eventos da fila, monta o lote da API de Conversões para CRM e
// marca cada um como enviado ou com falha (até 5 tentativas). Sem token ou sem
// conjunto de dados em Integrações, não reserva nada: a fila espera intacta.
import { requireServiceRole, serviceClient } from '../_shared/auth.ts';
import { normalizePhone } from '../_shared/meta.ts';
import { META_GRAPH } from '../_shared/metaGraph.ts';
import { getSecret } from '../_shared/secrets.ts';
import { corpoDoLote, eventoParaMeta, type EventoDaFila, type EventoMeta } from './payload.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** A Meta aceita até 1.000 eventos por chamada; lotes menores isolam uma falha. */
const POR_CHAMADA = 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const denied = await requireServiceRole(req, corsHeaders);
  if (denied) return denied;

  const [token, conjunto] = await Promise.all([
    getSecret('META_CAPI_ACCESS_TOKEN'),
    getSecret('META_CAPI_DATASET_ID'),
  ]);
  if (!token || !conjunto || !/^[0-9]+$/.test(conjunto)) {
    return json({ skipped: 'cadastre o token e o conjunto de dados da API de Conversões em Integrações' });
  }

  const supabase = serviceClient();
  const { data, error } = await supabase.rpc('meta_crm_reservar', { p_limite: 200 });
  if (error) {
    console.error('meta-crm-events: reserva falhou —', error.message);
    return json({ error: 'reserva falhou' }, 500);
  }

  const prontos: { id: string; evento: EventoMeta }[] = [];
  const semLead: string[] = [];
  for (const linha of (data ?? []) as EventoDaFila[]) {
    const evento = await eventoParaMeta({ ...linha, phone: normalizePhone(linha.phone) });
    if (evento) prontos.push({ id: linha.id, evento });
    else semLead.push(linha.id);
  }
  if (semLead.length) {
    await supabase.from('meta_crm_events')
      .update({ status: 'failed', attempts: 5, last_error: 'lead sem leadgen_id da Meta' })
      .in('id', semLead);
  }

  let enviados = 0;
  let falhas = 0;
  for (let i = 0; i < prontos.length; i += POR_CHAMADA) {
    const lote = prontos.slice(i, i + POR_CHAMADA);
    const ids = lote.map((p) => p.id);
    let erro: string | null = null;
    try {
      const res = await fetch(`${META_GRAPH}/${conjunto}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: corpoDoLote(lote.map((p) => p.evento), token),
      });
      if (!res.ok) {
        // Só a mensagem da Meta: o corpo inteiro poderia ecoar dados do lote.
        const corpo = await res.json().catch(() => null) as { error?: { message?: string; code?: number } } | null;
        erro = `HTTP ${res.status}${corpo?.error?.code ? ` (${corpo.error.code})` : ''}: ${corpo?.error?.message ?? 'sem detalhe'}`;
      }
    } catch (e) {
      erro = `rede: ${e instanceof Error ? e.message : String(e)}`;
    }

    if (erro) {
      falhas += ids.length;
      console.error('meta-crm-events: lote recusado —', erro.slice(0, 300));
      await supabase.from('meta_crm_events')
        .update({ status: 'failed', last_error: erro.slice(0, 500) })
        .in('id', ids);
    } else {
      enviados += ids.length;
      await supabase.from('meta_crm_events')
        .update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null })
        .in('id', ids);
    }
  }

  return json({ enviados, falhas, sem_lead: semLead.length });
});
