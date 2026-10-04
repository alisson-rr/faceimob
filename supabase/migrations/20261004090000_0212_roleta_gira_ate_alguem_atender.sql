-- =============================================================================
-- 0212 — a roleta gira até alguém atender
--
-- Pedido de 04/10/2026: o aviso "Lead sem atendimento: voltou 5 vezes…"
-- confundia a equipe. O lead saía da roleta (0074) e ninguém conseguia pegar —
-- ficava num limbo. Agora:
--   * sem teto de voltas: o lead continua sendo entregue, um corretor por vez,
--     até alguém clicar em "Atender";
--   * sem o aviso `lead_unattended` (e os que já estavam no sino vão para lidos);
--   * para quando acaba o horário da distribuição: só recebe quem está de
--     check-in aberto e já passou do início da distribuição do turno
--     (`distribution_queue_interna`, 0200), e o check-in fecha sozinho no fim do
--     turno (`auto_checkout_expired`, 0057). Fora do horário o lead espera na
--     fila e volta a girar no próximo turno.
-- Continua valendo: quem deixou o lead vencer não é o primeiro a recebê-lo de
-- volta, se houver outro corretor na fila.
--
-- `automation_settings.roulette_max_rounds` fica no banco valendo 0 (= sem
-- teto): a tela usa o 0 para não mostrar a bandeja "sem atendimento".
-- =============================================================================

alter table public.automation_settings alter column roulette_max_rounds set default 0;
update public.automation_settings set roulette_max_rounds = 0 where roulette_max_rounds <> 0;

comment on column public.automation_settings.roulette_max_rounds is
  'Sem uso desde a 0212 (0 = sem teto): a roleta entrega o lead até alguém atender.';

-- Os avisos que já estavam no sino apontavam para leads que ninguém conseguia
-- pegar. Ficam como lidos; nada é apagado.
update public.notifications
   set read_at = now()
 where kind = 'lead_unattended'
   and read_at is null;

-- Corpo da 0148 sem o teto total, sem o aviso e sem o limite de 3 voltas com
-- um corretor só.
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

  -- Quem deixou ESTE lead vencer na rodada anterior não é o primeiro a recebê-lo
  -- de volta, se houver outro na fila.
  select la.profile_id into v_last_miss
  from public.lead_assignments la
  where la.lead_id = p_lead_id
    and la.release_reason = 'timeout'
  order by la.released_at desc nulls last
  limit 1;

  select q.profile_id into v_target
  from public.distribution_queue_interna(v_group) q
  where v_last_miss is null or q.profile_id <> v_last_miss
  order by q.queue_position
  limit 1;

  -- Fila com um corretor só: o lead volta para ele (0212: até alguém atender).
  if v_target is null and v_last_miss is not null then
    select q.profile_id into v_target
    from public.distribution_queue_interna(v_group) q
    order by q.queue_position
    limit 1;
  end if;

  -- Ninguém na fila (fora do horário, todos bloqueados ou sem check-in): o
  -- lead espera `queued` e o cron tenta de novo.
  if v_target is null then
    return null;
  end if;

  v_timeout := public.effective_attend_timeout(v_group);

  select coalesce(max(la.sequence), 0) + 1 into v_seq
  from public.lead_assignments la where la.lead_id = p_lead_id;

  insert into public.lead_assignments (lead_id, profile_id, group_id, sequence, deadline)
  values (p_lead_id, v_target, v_group, v_seq, now() + make_interval(secs => v_timeout));

  update public.leads
     set status                = 'assigned',
         assigned_to           = v_target,
         assigned_at           = now(),
         attend_deadline       = now() + make_interval(secs => v_timeout),
         distribution_group_id = v_group,
         last_activity_at      = now()
   where id = p_lead_id;

  update public.checkins
     set leads_received = leads_received + 1
   where profile_id = v_target
     and work_date = public.current_work_date()
     and checked_out_at is null;

  insert into public.lead_events (lead_id, actor_id, kind, to_value, detail)
  values (p_lead_id, null, 'assigned', v_target::text,
          jsonb_build_object('group_id', v_group, 'sequence', v_seq,
                             'timeout_seconds', v_timeout, 'misses', v_total_miss));

  return v_target;
end;
$$;

comment on function public.assign_lead(uuid, boolean) is
  'Entrega o lead ao próximo da fila interna da roleta. Sem teto de voltas (0212): gira até alguém atender; sem ninguém na fila, fica queued. p_force ficou sem efeito e segue na assinatura pelo botão "Distribuir".';

-- Corpo da 0121 sem o filtro do teto de voltas.
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
    order by l.created_at
    limit 50
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
  'Varre a fila e distribui (até 50 por vez, mais antigos primeiro). Ignora lead em conversa ativa de SDR. Sem teto de voltas desde a 0212.';
