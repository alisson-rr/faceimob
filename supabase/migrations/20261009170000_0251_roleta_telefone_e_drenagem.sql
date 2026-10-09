-- =============================================================================
-- 0251 · afinidade por telefone e drenagem completa da roleta
--
-- Um contato que preenche mais de uma campanha precisa continuar com o mesmo
-- corretor. A afinidade usa o telefone já normalizado por `leads_normalize` e,
-- na primeira passagem do novo lead, procura primeiro um lead ainda com dono;
-- senão, o último corretor que de fato clicou em "Pegar lead". O corretor
-- precisa continuar ativo e pertencer ao grupo de distribuição do novo lead.
--
-- A varredura anterior tentava somente os 50 leads `queued` mais antigos. Se
-- esses 50 fossem de um grupo sem ninguém disponível, leads mais novos de
-- outros grupos nunca eram sequer tentados. A nova varredura percorre toda a
-- fila; a regra "um lead automático aguardando por corretor" continua sendo
-- aplicada por `distribution_queue_interna`.
-- =============================================================================

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

comment on function public.assign_queued_leads is
  'Tenta toda a fila queued, sem o corte que deixava grupos posteriores retidos. Um corretor continua recebendo só um lead automático pendente por vez (0251).';

-- O pedido desta entrega inclui soltar imediatamente o estoque real da roleta.
-- Encerrados/perdidos não entram: somente `status = queued` é processado.
select public.assign_queued_leads();
