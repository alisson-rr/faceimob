-- =============================================================================
-- 0043 — Regras de automação que a tela prometia e nada executava
--
-- `automation_settings` tem `no_response_hours` e `auto_first_contact` desde a
-- 0004, e a tela de Automação de Leads grava os dois — mas nenhuma função,
-- trigger, cron ou edge function lia qualquer um deles (auditoria de
-- 01/09/2026: `pg_proc.prosrc` não cita nenhum dos dois). O admin ajustava um
-- número que não virava regra em lugar nenhum.
--
-- O que passa a valer:
--
--   · `auto_first_contact` — ao "Atender" (`claim_lead`), o lead sai de `new`
--     e entra em `first_contact`. `first_contact_at` já era carimbado ali; o
--     que faltava era a etapa do funil acompanhar. Desligado, comportamento de
--     antes: o corretor move à mão no kanban.
--
--   · `no_response_hours` — `mark_no_response_leads()`: lead parado em
--     `first_contact` há mais de N horas vai para `no_response` e o corretor
--     recebe um aviso no sino. Roda por pg_cron a cada 5 minutos, no mesmo
--     padrão dos jobs da 0013/0018/0020. Só enfileira in-app: a entrega por
--     WhatsApp segue represada até haver credencial (decisão de 05/08).
--
-- Relógio da regra: `first_contact_at`, que a tela regrava toda vez que o lead
-- entra em Primeiro Contato (`moveLeadStage`), com `last_activity_at` de
-- reserva. Mover o lead de volta para Primeiro Contato reinicia a contagem.
--
-- O card "Tempo máx. por etapa (min)" da mesma tela foi removido em vez de
-- ganhar coluna: era um segundo SLA para as mesmas etapas, sem consumidor.
-- =============================================================================

comment on column public.automation_settings.no_response_hours is
  'Horas em Primeiro Contato sem avanço até mark_no_response_leads() mover o lead para Sem Resposta e avisar o corretor.';
comment on column public.automation_settings.auto_first_contact is
  'Quando true, claim_lead() move o lead de new para first_contact ao Atender.';

-- -----------------------------------------------------------------------------
-- claim_lead — corpo da 0005, só a etapa do funil muda quando o auto está ligado
-- -----------------------------------------------------------------------------
create or replace function public.claim_lead(p_lead_id uuid)
returns public.leads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead public.leads;
  v_auto boolean;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  if v_lead.assigned_to is distinct from auth.uid() then
    raise exception 'Este lead não está atribuído a você.' using errcode = '42501';
  end if;

  if v_lead.status <> 'assigned' then
    raise exception 'Lead não está aguardando atendimento.' using errcode = 'P0001';
  end if;

  select s.auto_first_contact into v_auto from public.automation_settings s where s.id;

  update public.lead_assignments
     set responded_at = now()
   where lead_id = p_lead_id and released_at is null;

  update public.leads
     set status           = 'attending',
         attend_deadline  = null,       -- travado com o corretor
         first_contact_at = coalesce(first_contact_at, now()),
         -- "Auto 1º contato": atender já é o primeiro contato. Só sai de `new`
         -- para não regredir um lead que o SDR ou o corretor já moveram.
         funnel_stage     = case
                              when coalesce(v_auto, false) and funnel_stage = 'new'
                              then 'first_contact'::lead_funnel_stage
                              else funnel_stage
                            end,
         last_activity_at = now()
   where id = p_lead_id
  returning * into v_lead;

  insert into public.lead_events (lead_id, actor_id, kind)
  values (p_lead_id, auth.uid(), 'claimed');

  return v_lead;
end;
$$;

-- -----------------------------------------------------------------------------
-- mark_no_response_leads — a varredura que lê `no_response_hours`
-- -----------------------------------------------------------------------------
create or replace function public.mark_no_response_leads()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hours int;
  v_lead  record;
  v_count int := 0;
begin
  select s.no_response_hours into v_hours from public.automation_settings s where s.id;
  v_hours := coalesce(v_hours, 24);
  if v_hours <= 0 then
    return 0;
  end if;

  -- Só lead que está com corretor: convertido, perdido e descartado já têm
  -- desfecho, e lead na roleta ainda não teve primeiro contato.
  for v_lead in
    select l.id, l.full_name, l.assigned_to
    from public.leads l
    where l.funnel_stage = 'first_contact'
      and l.status in ('attending', 'in_progress')
      and coalesce(l.first_contact_at, l.last_activity_at) < now() - make_interval(hours => v_hours)
    for update skip locked
  loop
    -- `leads_log_changes` registra o stage_changed com actor nulo (sistema).
    update public.leads
       set funnel_stage = 'no_response'
     where id = v_lead.id;

    if v_lead.assigned_to is not null then
      insert into public.notifications (profile_id, kind, title, body, link, channel)
      values (
        v_lead.assigned_to,
        'lead_no_response',
        'Sem resposta: ' || coalesce(v_lead.full_name, 'lead sem nome'),
        format('%s h desde o primeiro contato sem avanço. O lead foi para Sem Resposta — tente outro canal ou registre o desfecho.',
               v_hours),
        '/leads?lead=' || v_lead.id::text,
        'in_app'
      );
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.mark_no_response_leads() from public, anon, authenticated;
grant execute on function public.mark_no_response_leads() to service_role;

comment on function public.mark_no_response_leads() is
  'Varredura do pg_cron: lead em first_contact há mais de automation_settings.no_response_hours vai para no_response e o corretor é avisado in-app. Devolve quantos moveu.';

-- -----------------------------------------------------------------------------
-- Agendamento. Mesmo padrão defensivo da 0013: estado conhecido antes de criar.
-- -----------------------------------------------------------------------------
do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0043] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;

  begin
    perform cron.unschedule('faceimob-mark-no-response');
  exception when others then
    null;
  end;

  -- A configuração é em horas: 5 minutos de cadência é resolução de sobra e
  -- não concorre com a varredura de 30 s da roleta.
  perform cron.schedule(
    'faceimob-mark-no-response',
    '*/5 * * * *',
    $cmd$select public.mark_no_response_leads();$cmd$
  );
  raise notice '[0043] mark-no-response agendada a cada 5 minutos.';
end
$do$;
