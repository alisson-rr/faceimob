-- =============================================================================
-- 0330 · Conversa da IA parada há 24 h: o lead de compra vai para a roleta
--
-- Pedido de 11/11/2026: 12 leads de compra ("Aprova na Hora") estavam na fila
-- desde 13–14/10 sem nunca ir à roleta. A conversa com a IA ficou `active`
-- sem mensagem nenhuma e o dreno (`assign_queued_leads`) pula lead com IA
-- ativa, então eles travaram. Decisão do Douglas: conversa da IA sem mensagem
-- há 24 h entrega o lead de compra à roleta. Candidato (agente com
-- `lead_de_compra = false`) NÃO vai: fica onde está.
--
-- Isto substitui, para lead de compra, o arquivamento por silêncio da 0263
-- (`sdr_arquivar_sem_resposta`), que passa a tratar só candidato. Roda no
-- começo do dreno, que é o cron de todo minuto (`faceimob-assign-queued`), e
-- já pega os 12 parados no primeiro giro depois do deploy.
-- =============================================================================

create or replace function public.sdr_entregar_conversas_paradas()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv uuid;
  v_feitas int := 0;
begin
  for v_conv in
    select c.id
      from public.sdr_conversations c
      join public.sdr_agents a on a.id = c.agent_id and a.lead_de_compra
      join public.leads l on l.id = c.lead_id
     where c.status = 'active'
       and coalesce(c.last_message_at, c.started_at) <= now() - interval '24 hours'
       and l.status = 'queued' and l.assigned_to is null
       and l.utm_source is distinct from 'sdr_playground'
     order by coalesce(c.last_message_at, c.started_at)
  loop
    -- Uma conversa com problema não pode travar as outras nem o dreno.
    begin
      perform public.sdr_handoff(v_conv, 'sem_resposta');
      v_feitas := v_feitas + 1;
    exception when others then
      raise warning 'sdr_entregar_conversas_paradas %: %', v_conv, sqlerrm;
    end;
  end loop;
  return v_feitas;
end;
$$;
revoke all on function public.sdr_entregar_conversas_paradas() from public, anon, authenticated;
grant execute on function public.sdr_entregar_conversas_paradas() to service_role;

create or replace function public.assign_queued_leads()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead uuid;
  v_done int := 0;
begin
  -- 0315: o bloqueio entra na ordem da fila, então é registrado antes de girar.
  perform public.fila_registrar_bloqueios();
  -- 0330: conversa da IA parada há 24 h solta o lead de compra para a roleta.
  perform public.sdr_entregar_conversas_paradas();

  for v_lead in
    select l.id from public.leads l
    where l.status = 'queued'
      and not exists (
        select 1 from public.sdr_conversations c
        where c.lead_id = l.id and c.status = 'active'
      )
    order by l.created_at, l.id
  loop
    if public.assign_lead(v_lead) is not null then
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$$;
revoke all on function public.assign_queued_leads() from public, anon, authenticated;
grant execute on function public.assign_queued_leads() to service_role;

-- 0263 com uma mudança: só arquiva conversa de candidato. A de compra agora
-- vai para a roleta (acima) em vez de virar lead perdido.
create or replace function public.sdr_arquivar_sem_resposta()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv uuid;
  v_feitas int := 0;
begin
  for v_conv in
    select c.id from public.sdr_conversations c
      join public.sdr_agents a on a.id = c.agent_id and a.lead_de_compra = false
     where c.status = 'active'
       and (select m.author from public.sdr_messages m
             where m.conversation_id = c.id order by m.created_at desc limit 1) = 'agent'
       and coalesce((select max(m.created_at) from public.sdr_messages m
                      where m.conversation_id = c.id and m.author = 'lead'), c.started_at)
           <= now() - interval '24 hours'
  loop
    update public.sdr_conversations set status = 'abandoned' where id = v_conv and status = 'active';
    perform public.sdr_tirar_lead_da_fila(v_conv, 'SDR IA: sem resposta em 24 h');
    v_feitas := v_feitas + 1;
  end loop;
  return v_feitas;
end;
$$;
revoke all on function public.sdr_arquivar_sem_resposta() from public, anon, authenticated;
grant execute on function public.sdr_arquivar_sem_resposta() to service_role;
