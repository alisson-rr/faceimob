-- =============================================================================
-- 0306 · Mesmo contato, mesmo corretor — de verdade
--
-- 26/10/2026: o mesmo cliente preencheu o WhatsApp flutuante do site e um
-- formulário da Meta no mesmo minuto, e cada lead foi para um corretor. A
-- afinidade por telefone da 0251 tinha três furos:
--   1. comparava o telefone inteiro: o site grava como o cliente digitou e a
--      Meta com DDI — com e sem o nono dígito — e "o mesmo" não casava;
--   2. exigia que o corretor anterior estivesse no grupo de distribuição do
--      lead novo: site e Meta caem em grupos diferentes;
--   3. dois leads do mesmo telefone distribuídos ao mesmo tempo não se viam.
--
-- Agora: casa pelos últimos 8 dígitos; vale qualquer corretor ativo que já
-- tenha o contato (em atendimento, ou o último que pegou o lead); e uma trava
-- por telefone (`pg_advisory_xact_lock`) faz o segundo lead esperar o primeiro
-- ganhar dono. Continua só na primeira passagem do lead, como antes.
-- =============================================================================

create or replace function public.telefone_chave(p_phone text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select nullif(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 8), '');
$$;
revoke all on function public.telefone_chave(text) from public, anon;
grant execute on function public.telefone_chave(text) to authenticated, service_role;
comment on function public.telefone_chave(text) is
  'Últimos 8 dígitos do telefone: casa o mesmo número com e sem DDI, DDD e nono dígito (0306).';

create index if not exists leads_telefone_chave_idx
  on public.leads (public.telefone_chave(phone)) where phone is not null;

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
  v_chave       text;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead % não encontrado.', p_lead_id using errcode = 'P0002';
  end if;

  -- 0306: dois leads do mesmo telefone não são distribuídos ao mesmo tempo;
  -- o segundo espera o primeiro ganhar dono e cai na afinidade.
  v_chave := public.telefone_chave(v_lead.phone);
  if v_chave is not null then
    perform pg_advisory_xact_lock(hashtext('faceimob.lead_telefone:' || v_chave));
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

  -- 0281: nenhuma entrega automatica fura o horario.
  if not public.roleta_horario_aberto() then
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
  if v_chave is not null
     and not exists (select 1 from public.lead_assignments x where x.lead_id = p_lead_id) then
    select candidato.profile_id into v_target
      from (
        -- Um contato que ainda está em atendimento tem precedência.
        select outro.assigned_to as profile_id,
               coalesce(outro.assigned_at, outro.updated_at, outro.created_at) as ocorrido_em,
               0 as prioridade
          from public.leads outro
         where outro.id <> p_lead_id
           and public.telefone_chave(outro.phone) = v_chave
           and outro.assigned_to is not null
        union all
        -- Se o lead anterior já foi encerrado e perdeu `assigned_to`, conserva
        -- o corretor que realmente o pegou, não alguém que apenas deixou o
        -- cronômetro vencer.
        select la.profile_id, la.responded_at as ocorrido_em, 1 as prioridade
          from public.leads outro
          join public.lead_assignments la on la.lead_id = outro.id
         where outro.id <> p_lead_id
           and public.telefone_chave(outro.phone) = v_chave
           and la.responded_at is not null
      ) candidato
      -- 0306: qualquer corretor ativo que já tem o contato, mesmo de outro grupo.
      join public.profiles p on p.id = candidato.profile_id and p.status = 'active'
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

