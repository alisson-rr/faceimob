-- =============================================================================
-- 0305 · Contatos do WhatsApp que nunca viraram lead vão para a fila
--
-- Pedido de 24/10/2026: "os contatos do WhatsApp pode colocar na fila com
-- exceção dos 3 números que falei". Até a 0303, número desconhecido que
-- escrevia sem vir de anúncio ficava só em `whatsapp_inbound_messages` como
-- `unmatched`. Agora cada telefone desses vira UM lead `queued` (o cron da
-- roleta acha o dono), com a conversa aberta para o corretor (`human`, sem IA)
-- e as mensagens já recebidas dentro dela — igual ao que o webhook faz hoje.
--
-- Fica de fora: os três números da casa (os mesmos de `numeroIgnorado` em
-- `whatsapp-inbound-webhook/parse.ts`) e telefone que já tem lead no CRM
-- (últimos 8 dígitos, para casar com e sem DDI e nono dígito). Idempotente:
-- rodar de novo não acha ninguém.
-- =============================================================================

do $$
declare
  r       record;
  v_lead  uuid;
  v_conv  uuid;
  v_origem uuid;
begin
  select id into v_origem from public.lead_sources where code = 'whatsapp_direto';

  for r in
    with pendentes as (
      select w.*, right(regexp_replace(w.from_phone, '\D', '', 'g'), 8) as chave
        from public.whatsapp_inbound_messages w
       where w.outcome = 'unmatched'
         and w.lead_id is null
         and length(regexp_replace(w.from_phone, '\D', '', 'g')) >= 8
    )
    select p.chave,
           (array_agg(p.from_phone order by p.created_at desc))[1] as telefone,
           (array_agg(p.body order by p.created_at) filter (where p.body is not null))[1] as primeira
      from pendentes p
     where p.chave not in ('92942662', '83319176', '82791505')
       and not exists (
         select 1 from public.leads l
          where right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 8) = p.chave)
     group by p.chave
  loop
    insert into public.leads (full_name, phone, phone_raw, status, funnel_stage, source_id,
                              utm_source, raw_payload)
    values ('Lead do WhatsApp', r.telefone, r.telefone, 'queued', 'new', v_origem,
            'whatsapp', jsonb_build_object('primeira_mensagem', r.primeira, 'resgate', '0305'))
    returning id into v_lead;

    insert into public.sdr_conversations (lead_id, status)
    values (v_lead, 'human')
    returning id into v_conv;

    insert into public.sdr_messages (conversation_id, author, body, provider_message_id, created_at)
    select v_conv, 'lead', coalesce(nullif(btrim(w.body), ''), '[mensagem]'), w.provider_message_id, w.created_at
      from public.whatsapp_inbound_messages w
     where w.outcome = 'unmatched' and w.lead_id is null
       and right(regexp_replace(w.from_phone, '\D', '', 'g'), 8) = r.chave
    on conflict do nothing;

    update public.whatsapp_inbound_messages w
       set lead_id = v_lead, conversation_id = v_conv, handled_at = coalesce(w.handled_at, now())
     where w.outcome = 'unmatched' and w.lead_id is null
       and right(regexp_replace(w.from_phone, '\D', '', 'g'), 8) = r.chave;
  end loop;
end;
$$;
