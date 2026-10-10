-- =============================================================================
-- 0260 · Grupo com canal e entrega sem check-in; lead que parou de responder ao
-- robô vai para o grupo
--
-- Pedido de 10/10/2026: leads com nota 80 seguiam "Robô atendendo" e nenhum foi
-- entregue. A nota é parcial (o agente reavalia a cada resposta); a entrega só
-- acontecia no fim da entrevista. Quem parava de responder no meio ficava com o
-- robô para sempre — e, desde a 0259, invisível na fila. Agora:
--
--  1. `sdr_entregar_sem_resposta()`: conversa com robô parada há 30 min vai para
--     o grupo do agente (motivo 'sem_resposta', funil não avança). O cron roda
--     a cada 5 min. Se o lead voltar a falar, a mensagem cai na conversa para o
--     corretor (rota "humano" do webhook), sem robô.
--  2. `distribution_groups.channels`: de onde o grupo recebe — formulário,
--     WhatsApp ou os dois. A tela usa para filtrar os seletores (o grupo de
--     entrega do agente lista só os de WhatsApp).
--  3. `distribution_groups.deliver_without_checkin`: a roleta do grupo entrega
--     a todos os membros ativos, com ou sem check-in e fora do turno. O RH
--     (Candidatos) nasce ligado, como pedido; o resto fica como estava.
-- ponytail: 30 min fixos de silêncio; virar campo quando um agente precisar de
-- outro prazo.
-- =============================================================================

alter table public.distribution_groups
  add column if not exists channels text[] not null default array['formulario', 'whatsapp'],
  add column if not exists deliver_without_checkin boolean not null default false;

alter table public.distribution_groups drop constraint if exists distribution_groups_channels_check;
alter table public.distribution_groups add constraint distribution_groups_channels_check
  check (cardinality(channels) >= 1 and channels <@ array['formulario', 'whatsapp']);

comment on column public.distribution_groups.channels is
  'De onde o grupo recebe leads: formulario, whatsapp ou os dois (0260). Filtra os seletores da tela.';
comment on column public.distribution_groups.deliver_without_checkin is
  'Roleta entrega a todos os membros ativos, sem exigir check-in nem turno aberto (0260).';

update public.distribution_groups
   set deliver_without_checkin = true
 where name = 'Candidatos' and not deliver_without_checkin;

-- -----------------------------------------------------------------------------
-- Roleta: membros sem check-in entram quando o grupo dispensa o check-in.
-- Mesmas travas de antes (vencidos, um lead pendente por vez). A ordem segue a
-- última vez de cada um; quem nunca recebeu nem fez check-in vai primeiro.
-- -----------------------------------------------------------------------------
create or replace function public.distribution_queue_interna(p_group_id uuid)
returns table(profile_id uuid, full_name text, queue_position integer,
              last_assigned_at timestamptz, last_turn_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  with eligible as (
    select m.profile_id, p.full_name,
      (select max(la.assigned_at) from public.lead_assignments la
        where la.profile_id = m.profile_id and la.counts_for_queue) as last_assigned_at,
      (select max(case when la.release_reason = 'timeout' then la.released_at else la.assigned_at end)
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
    where m.group_id = p_group_id and m.active and p.status = 'active'
      and (g.deliver_without_checkin
           or (c.profile_id is not null
               and (now() at time zone 'America/Sao_Paulo')::time >= s.distribution_start))
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

-- -----------------------------------------------------------------------------
-- sdr_handoff aceita 'sem_resposta'. Igual à 0064 no resto.
-- -----------------------------------------------------------------------------
create or replace function public.sdr_handoff(
  p_conversation_id uuid,
  p_reason text default 'qualified'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv   public.sdr_conversations;
  v_group  uuid;
  v_broker uuid;
begin
  if p_reason not in ('qualified', 'exhausted', 'sem_resposta') then
    raise exception 'Motivo de handoff desconhecido: %', p_reason using errcode = 'P0001';
  end if;

  if auth.uid() is not null and not public.has_any_role('admin','sdr','marketing') then
    raise exception 'Sem permissão para devolver a conversa do SDR à roleta.'
      using errcode = '42501';
  end if;

  select * into v_conv from public.sdr_conversations
  where id = p_conversation_id for update;
  if not found then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;

  if v_conv.status = 'handed_off' then
    return v_conv.handed_off_to;
  end if;

  select coalesce(a.handoff_group_id,
                  (select g.id from public.distribution_groups g
                   where g.kind = 'general' and g.active limit 1))
    into v_group
  from public.sdr_agents a where a.id = v_conv.agent_id;

  if v_group is null then
    select g.id into v_group from public.distribution_groups g
    where g.kind = 'general' and g.active limit 1;
  end if;

  update public.leads
     set distribution_group_id = coalesce(v_group, distribution_group_id),
         status                = 'queued',
         assigned_to           = null,
         assigned_at           = null,
         attend_deadline       = null,
         sdr_qualified_at      = case when p_reason = 'qualified' then now() else sdr_qualified_at end,
         funnel_stage          = case when p_reason = 'qualified' then 'qualified'::lead_funnel_stage else funnel_stage end,
         last_activity_at      = now()
   where id = v_conv.lead_id;

  insert into public.lead_events (lead_id, actor_id, kind, detail)
  values (v_conv.lead_id, null, 'sdr_qualified',
          jsonb_build_object('conversation_id', p_conversation_id,
                             'reason', p_reason,
                             'score', v_conv.score,
                             'group_id', v_group));

  v_broker := public.assign_lead(v_conv.lead_id);

  update public.sdr_conversations
     set status        = 'handed_off',
         qualified_at  = case when p_reason = 'qualified' then coalesce(qualified_at, now()) else qualified_at end,
         handed_off_at = now(),
         handed_off_to = v_broker
   where id = p_conversation_id;

  return v_broker;
end;
$$;

revoke all on function public.sdr_handoff(uuid, text) from public, anon;
grant execute on function public.sdr_handoff(uuid, text) to authenticated, service_role;

comment on function public.sdr_handoff(uuid, text) is
  'Devolve o lead da conversa à roleta. p_reason: qualified (a IA qualificou), exhausted (teto de turnos) ou sem_resposta (0260: lead parou de responder). Só qualified avança o funil.';

-- -----------------------------------------------------------------------------
-- Varredura: conversa com robô parada há 30 min vai para o grupo do agente.
-- -----------------------------------------------------------------------------
create or replace function public.sdr_entregar_sem_resposta()
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
     where c.status = 'active' and c.agent_id is not null
       and coalesce(c.last_message_at, c.started_at) < now() - interval '30 minutes'
     order by coalesce(c.last_message_at, c.started_at)
  loop
    insert into public.sdr_messages (conversation_id, author, body)
    values (v_conv, 'system', 'Lead parou de responder ao robô por 30 min: entregue ao grupo para o atendimento seguir.');
    perform public.sdr_handoff(v_conv, 'sem_resposta');
    v_feitas := v_feitas + 1;
  end loop;
  return v_feitas;
end;
$$;

revoke all on function public.sdr_entregar_sem_resposta() from public, anon, authenticated;
grant execute on function public.sdr_entregar_sem_resposta() to service_role;

comment on function public.sdr_entregar_sem_resposta() is
  'Entrega ao grupo do agente as conversas com robô sem mensagem há 30 min (0260). Cron a cada 5 min.';

do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0260] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;

  begin
    if exists (select 1 from cron.job where jobname = 'faceimob-sdr-sem-resposta') then
      perform cron.unschedule('faceimob-sdr-sem-resposta');
    end if;
    perform cron.schedule(
      'faceimob-sdr-sem-resposta',
      '*/5 * * * *',
      $cmd$select public.sdr_entregar_sem_resposta();$cmd$
    );
  exception when others then
    raise warning '[0260] não foi possível agendar a entrega das conversas paradas: %', sqlerrm;
  end;
end
$do$;
