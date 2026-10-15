-- 0281: horário vale inclusive para afinidade e grupos sem check-in.
-- O fim do turno é exclusivo; fora da janela o lead continua aguardando.
create or replace function public.roleta_horario_aberto(p_at timestamptz default now())
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.work_shifts s where s.active
      and (p_at at time zone 'America/Sao_Paulo')::time >= s.distribution_start
      and (p_at at time zone 'America/Sao_Paulo')::time < s.checkout_time
  );
$$;
revoke all on function public.roleta_horario_aberto(timestamptz) from public, anon, authenticated;
grant execute on function public.roleta_horario_aberto(timestamptz) to service_role;
comment on column public.distribution_groups.deliver_without_checkin is
  'Dispensa check-in, mas respeita os horários dos turnos ativos (0281).';

create or replace function public.distribution_queue_interna(p_group_id uuid)
returns table(profile_id uuid, full_name text, queue_position integer,
              last_assigned_at timestamptz, last_turn_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  with eligible as (
    select m.profile_id, p.full_name,
      (select max(la.assigned_at) from public.lead_assignments la
        where la.profile_id = m.profile_id and la.counts_for_queue) as last_assigned_at,
      (select max(coalesce(la.responded_at, case when la.release_reason = 'timeout' then la.released_at end, la.assigned_at))
         from public.lead_assignments la
        where la.profile_id = m.profile_id and la.counts_for_queue) as last_turn_at,
      c.checked_in_at
    from public.distribution_group_members m
    join public.distribution_groups g on g.id = m.group_id and g.active
    join public.profiles p on p.id = m.profile_id
    left join public.checkins c
      on c.profile_id = m.profile_id
     and c.work_date = public.current_work_date() and c.checked_out_at is null
    left join public.work_shifts s on s.id = c.shift_id
    where public.roleta_horario_aberto()
      and m.group_id = p_group_id and m.active and p.status = 'active'
      and (g.deliver_without_checkin
           or (c.profile_id is not null
               and s.active
               and (now() at time zone 'America/Sao_Paulo')::time >= s.distribution_start
               and (now() at time zone 'America/Sao_Paulo')::time < s.checkout_time))
      and public.overdue_lead_count(m.profile_id)
          < (select s2.overdue_block_threshold from public.automation_settings s2 where s2.id)
      and not exists (
        select 1 from public.lead_assignments la where la.profile_id = m.profile_id
          and la.counts_for_queue and la.released_at is null and la.responded_at is null)
  )
  select e.profile_id, e.full_name,
         row_number() over (order by greatest(e.checked_in_at, e.last_turn_at) nulls first, e.profile_id)::int,
         e.last_assigned_at, e.last_turn_at
    from eligible e;
$$;
revoke all on function public.distribution_queue_interna(uuid) from public, anon, authenticated;
grant execute on function public.distribution_queue_interna(uuid) to service_role;

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
