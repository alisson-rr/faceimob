-- =============================================================================
-- 0272 · Candidato a corretor nunca vai para a roleta de leads
--
-- Pedido de 13/10/2026: "não entregue candidatos aos corretores, eles dizem estar
-- recebendo". O caminho da Luna (0264) já levava o candidato aprovado para a tela
-- Candidatos, mas a roleta (`assign_lead`) não sabia o que é candidato, e três
-- buracos entregavam um a corretor:
--   · a conversa da Luna passa a humana sem dono (áudio que falhou, por exemplo)
--     e a roleta "não prende o lead": o dreno o distribui;
--   · o lead nasce antes da conversa da Luna abrir e o dreno passa no intervalo;
--   · o anúncio ou formulário de vaga cai na origem geral.
--
-- Agora `assign_lead` recusa o lead de candidato — o que tem conversa de agente
-- com `lead_de_compra = false`, ou vem de origem cujo agente é assim — de
-- QUALQUER caminho (dreno, "Distribuir" à mão, site). Quando não há conversa ativa
-- da Luna há mais de 15 minutos, ele vira candidato (disponível na tela
-- Candidatos); antes disso espera. Se a Luna já havia aberto o candidato sem
-- conversa, a entrega dela completa o mesmo registro, sem duplicar.
-- O que JÁ está com corretor não é tirado daqui.
-- =============================================================================

create or replace function public.lead_e_candidato(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
           select 1 from public.sdr_conversations c
             join public.sdr_agents a on a.id = c.agent_id
            where c.lead_id = p_lead_id and a.lead_de_compra = false)
      or exists (
           select 1 from public.leads l
             join public.lead_sources s on s.id = l.source_id
             join public.sdr_agents a on a.id = s.sdr_agent_id
            where l.id = p_lead_id and a.lead_de_compra = false);
$$;
revoke all on function public.lead_e_candidato(uuid) from public, anon, authenticated;
grant execute on function public.lead_e_candidato(uuid) to service_role;

-- O lead vira candidato disponível e sai das telas de leads. Não mexe no status
-- da conversa (abandonada continua abandonada). Idempotente.
create or replace function public.lead_virar_candidato(p_lead_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead public.leads;
  v_conv public.sdr_conversations;
  v_id   uuid;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    return null;
  end if;
  select id into v_id from public.candidatos where lead_id = p_lead_id limit 1;

  if v_id is null then
    select c.* into v_conv
      from public.sdr_conversations c
      join public.sdr_agents a on a.id = c.agent_id and a.lead_de_compra = false
     where c.lead_id = p_lead_id
     order by c.started_at desc limit 1;

    insert into public.candidatos (conversation_id, lead_id, nome, telefone, zona, respostas, resumo, score)
    values (v_conv.id, p_lead_id,
            coalesce(nullif(btrim(v_conv.collected ->> 'Nome'), ''), nullif(btrim(v_lead.full_name), ''), 'Candidato'),
            coalesce(v_lead.phone, v_lead.phone_raw),
            public.candidato_zona(coalesce(v_conv.collected, '{}'::jsonb)),
            coalesce(v_conv.collected, '{}'::jsonb), v_conv.summary, v_conv.score)
    on conflict (conversation_id) do nothing
    returning id into v_id;
  end if;

  update public.lead_assignments
     set released_at = now(), release_reason = 'sdr_handoff'
   where lead_id = p_lead_id and released_at is null;

  update public.leads
     set status = 'discarded', lost_reason = 'Candidato (RH)', lost_at = null,
         assigned_to = null, assigned_at = null, attend_deadline = null
   where id = p_lead_id and status = 'queued';

  return v_id;
end;
$$;
revoke all on function public.lead_virar_candidato(uuid) from public, anon, authenticated;
grant execute on function public.lead_virar_candidato(uuid) to service_role;

create or replace function public.sdr_virar_candidato(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv public.sdr_conversations;
  v_lead public.leads;
  v_id uuid;
begin
  select * into v_conv from public.sdr_conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  select * into v_lead from public.leads where id = v_conv.lead_id;

  -- 0272: candidato aberto antes pela roleta (sem conversa) é completado, não duplicado.
  update public.candidatos
     set conversation_id = v_conv.id,
         respostas = coalesce(v_conv.collected, '{}'::jsonb),
         resumo = v_conv.summary, score = v_conv.score,
         zona = public.candidato_zona(v_conv.collected),
         nome = coalesce(nullif(btrim(v_conv.collected ->> 'Nome'), ''), nome)
   where lead_id = v_conv.lead_id and conversation_id is null
  returning id into v_id;

  if v_id is null then
    insert into public.candidatos (conversation_id, lead_id, nome, telefone, zona, respostas, resumo, score)
    values (v_conv.id, v_conv.lead_id,
            coalesce(nullif(btrim(v_conv.collected ->> 'Nome'), ''), nullif(btrim(v_lead.full_name), ''), 'Candidato'),
            coalesce(v_lead.phone, v_lead.phone_raw),
            public.candidato_zona(v_conv.collected),
            coalesce(v_conv.collected, '{}'::jsonb), v_conv.summary, v_conv.score)
    on conflict (conversation_id) do nothing
    returning id into v_id;
  end if;

  update public.lead_assignments
     set released_at = now(), release_reason = 'sdr_handoff'
   where lead_id = v_conv.lead_id and released_at is null;

  update public.leads
     set status = 'discarded', lost_reason = 'Candidato (RH)', lost_at = null,
         assigned_to = null, assigned_at = null, attend_deadline = null
   where id = v_conv.lead_id and status <> 'converted';

  update public.sdr_conversations
     set status = 'handed_off',
         qualified_at = coalesce(qualified_at, now()),
         handed_off_at = coalesce(handed_off_at, now()),
         handed_off_to = null
   where id = p_conversation_id;

  return v_id;
end;
$$;
revoke all on function public.sdr_virar_candidato(uuid) from public, anon, authenticated;
grant execute on function public.sdr_virar_candidato(uuid) to service_role;

create or replace function public.assign_lead(p_lead_id uuid, p_force boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_lead        public.leads;
  v_group       uuid;
  v_target      uuid;
  v_timeout     int;
  v_seq         int;
  v_paused      boolean;
  v_last_miss   uuid;
  v_total_miss  int;
  v_affinity    boolean := false;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead % não encontrado.', p_lead_id using errcode = 'P0002';
  end if;

  select s.leads_paused into v_paused
  from public.automation_settings s where s.id;

  if coalesce(v_paused, false) then
    return null;
  end if;

  if v_lead.status not in ('queued') then
    return v_lead.assigned_to;
  end if;

  -- 0272: candidato a corretor nunca vai para a roleta de leads. A Luna ainda pode
  -- estar conversando (ou a conversa ainda nem abriu), então só depois de 15
  -- minutos sem conversa ativa ele vira candidato; até lá fica parado, sem dono.
  if public.lead_e_candidato(p_lead_id) then
    if v_lead.created_at < now() - interval '15 minutes'
       and not exists (select 1 from public.sdr_conversations c where c.lead_id = p_lead_id and c.status = 'active') then
      perform public.lead_virar_candidato(p_lead_id);
    end if;
    return null;
  end if;

  v_group := public.lead_distribution_group(p_lead_id);
  if v_group is null then
    return null;
  end if;

  select count(*)::int into v_total_miss
  from public.lead_assignments la
  where la.lead_id = p_lead_id
    and la.release_reason = 'timeout';

  select la.profile_id into v_last_miss
  from public.lead_assignments la
  where la.lead_id = p_lead_id
    and la.release_reason = 'timeout'
  order by la.released_at desc nulls last
  limit 1;

  -- Afinidade vale só na primeira passagem. Depois de um prazo vencido, a
  -- roleta precisa continuar girando em vez de insistir eternamente no mesmo
  -- corretor do contato anterior.
  if v_lead.phone is not null
     and not exists (select 1 from public.lead_assignments x where x.lead_id = p_lead_id) then
    select candidato.profile_id into v_target
      from (
        -- Um contato que ainda está em atendimento tem precedência.
        select outro.assigned_to as profile_id,
               coalesce(outro.assigned_at, outro.updated_at, outro.created_at) as ocorrido_em,
               0 as prioridade
          from public.leads outro
         where outro.id <> p_lead_id
           and outro.phone = v_lead.phone
           and outro.assigned_to is not null
        union all
        -- Se o lead anterior já foi encerrado e perdeu `assigned_to`, conserva
        -- o corretor que realmente o pegou, não alguém que apenas deixou o
        -- cronômetro vencer.
        select la.profile_id, la.responded_at as ocorrido_em, 1 as prioridade
          from public.leads outro
          join public.lead_assignments la on la.lead_id = outro.id
         where outro.id <> p_lead_id
           and outro.phone = v_lead.phone
           and la.responded_at is not null
      ) candidato
      join public.profiles p on p.id = candidato.profile_id and p.status = 'active'
      join public.distribution_group_members m
        on m.profile_id = candidato.profile_id
       and m.group_id = v_group
       and m.active
     order by candidato.prioridade, candidato.ocorrido_em desc nulls last
     limit 1;

    v_affinity := v_target is not null;
  end if;

  if v_target is null then
    select q.profile_id into v_target
    from public.distribution_queue_interna(v_group) q
    where v_last_miss is null or q.profile_id <> v_last_miss
    order by q.queue_position
    limit 1;
  end if;

  if v_target is null and v_last_miss is not null then
    select q.profile_id into v_target
    from public.distribution_queue_interna(v_group) q
    order by q.queue_position
    limit 1;
  end if;

  if v_target is null then
    return null;
  end if;

  v_timeout := public.effective_attend_timeout(v_group);

  select coalesce(max(la.sequence), 0) + 1 into v_seq
  from public.lead_assignments la where la.lead_id = p_lead_id;

  insert into public.lead_assignments
    (lead_id, profile_id, group_id, sequence, deadline, counts_for_queue)
  values
    (p_lead_id, v_target, v_group, v_seq,
     now() + make_interval(secs => v_timeout), not v_affinity);

  update public.leads
     set status                = 'assigned',
         assigned_to           = v_target,
         assigned_at           = now(),
         attend_deadline       = now() + make_interval(secs => v_timeout),
         distribution_group_id = v_group,
         last_activity_at      = now()
   where id = p_lead_id;

  -- Afinidade não consome a vez do corretor nem altera sua posição: é o mesmo
  -- contato voltando, não uma nova passagem da roleta.
  if not v_affinity then
    update public.checkins
       set leads_received = leads_received + 1
     where profile_id = v_target
       and work_date = public.current_work_date()
       and checked_out_at is null;
  end if;

  insert into public.lead_events (lead_id, actor_id, kind, to_value, detail)
  values (p_lead_id, null, 'assigned', v_target::text,
          jsonb_build_object('group_id', v_group, 'sequence', v_seq,
                             'timeout_seconds', v_timeout, 'misses', v_total_miss,
                             'phone_affinity', v_affinity));

  return v_target;
end;
$$;

revoke all on function public.assign_lead(uuid, boolean) from public, anon, authenticated;
grant execute on function public.assign_lead(uuid, boolean) to service_role;

comment on function public.assign_lead(uuid, boolean) is
  'Entrega lead novo ao corretor do mesmo telefone quando houver vínculo válido no grupo; sem afinidade, usa a ordem da roleta. Após timeout sempre volta a girar (0251).';
