-- =============================================================================
-- 0020 — Correções críticas apontadas pela auditoria de 08/08
--
-- 1. Triggers de log sem SECURITY DEFINER: lead_events/deal_history/
--    cca_case_events só têm policy de SELECT, então o INSERT do trigger rodava
--    como o usuário e o RLS derrubava o UPDATE inteiro. Confirmado no remoto:
--    mudar status de lead como authenticated falha com "new row violates
--    row-level security policy for table lead_events". Como o frontend engole
--    erros, as telas pareciam funcionar.
-- 2. Realtime morto: a publication supabase_realtime estava vazia no remoto —
--    popup de lead novo, sino, posição de fila e comemoração de venda nunca
--    disparavam. Nenhuma migration adicionava as tabelas.
-- 3. Matriz de estágios só valia na UI: can_enter_stage()/can_exit existiam e
--    nenhum trigger as aplicava — mover card por API ignorava a matriz.
-- 4. deals não tinha coluna para o "Status 2" (34 rótulos FACEIMOB) — a tela
--    escolhia e o valor evaporava.
-- 5. cca_cases não tinha onde guardar os campos de análise digitados na aba
--    CCA do modal (tabela, fator, FGTS, renda aprovada…).
-- 6. perform_checkin aceitava IP nulo — bastava chamar a RPC direto para
--    contornar a trava de loja da ata 14/07.
-- 7. Lead sem corretor elegível ficava 'queued' para sempre: assign_lead
--    devolve null e nada varria a fila depois.
-- 8. developer_submissions enfileirava e-mail que nunca saía: a edge function
--    submission-dispatch existe e nada a invocava.
-- 9. notifications sem contador de tentativas: uma mensagem com telefone
--    inválido seria retentada para sempre pelo notify-dispatch.
-- 10. deal_history é escrita só por triggers; o CCA pediu comentário manual
--     também no negócio (ata 23/07) — entra por RPC com checagem de acesso.
-- =============================================================================

-- 1. Logs de auditoria gravam com privilégio da função, não do usuário --------

alter function public.leads_log_changes() security definer;
alter function public.deals_log_changes() security definer;
alter function public.cca_cases_log()     security definer;

-- 2. Realtime: publica as tabelas que o frontend assina -----------------------

do $do$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array[
    'leads', 'lead_assignments', 'lead_events', 'lead_comments',
    'lead_attachments', 'notifications', 'game_events', 'checkins'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$do$;

-- 3. Matriz de estágios aplicada no servidor ----------------------------------

create or replace function public.can_exit_stage(target_stage uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin()
      or exists (
        select 1
        from public.stage_permissions sp
        join public.user_roles ur on ur.role = sp.role
        where ur.profile_id = auth.uid()
          and sp.stage_id = target_stage
          and sp.can_exit
      );
$$;

revoke execute on function public.can_exit_stage(uuid) from public, anon;
grant execute on function public.can_exit_stage(uuid) to authenticated, service_role;

-- Mesmo corpo da 0006, com a checagem da matriz no início. auth.uid() nulo é
-- automação (service_role, cron) e passa direto — a matriz governa pessoas.
create or replace function public.deals_guard_stage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requires boolean;
  v_docs     int;
  v_outcome  deal_outcome;
begin
  if new.stage_id is distinct from old.stage_id then
    if auth.uid() is not null then
      if not public.can_exit_stage(old.stage_id) then
        raise exception 'Seu papel não pode tirar um negócio deste estágio.'
          using errcode = '42501';
      end if;
      if not public.can_enter_stage(new.stage_id) then
        raise exception 'Seu papel não pode mover um negócio para este estágio.'
          using errcode = '42501';
      end if;
    end if;

    select requires_document, outcome into v_requires, v_outcome
    from public.pipeline_stages where id = new.stage_id;

    if coalesce(v_requires, false) then
      select count(*) into v_docs
      from public.deal_documents
      where deal_id = new.id and superseded_at is null;

      if v_docs = 0 then
        raise exception
          'O estágio exige ao menos um documento anexado antes do avanço.'
          using errcode = 'P0001';
      end if;
    end if;

    new.stage_entered_at := now();
    new.outcome := coalesce(v_outcome, new.outcome);

    if new.outcome <> 'open' and new.closed_at is null then
      new.closed_at := now();
    elsif new.outcome = 'open' then
      new.closed_at := null;
    end if;
  end if;

  return new;
end;
$$;

-- 4. Status detalhado do negócio (os 34 rótulos operacionais da FACEIMOB) -----

alter table public.deals add column if not exists status_detail text;

comment on column public.deals.status_detail is
  'Rótulo operacional livre (34 status FACEIMOB). O estágio canônico é stage_id; isto é o refinamento que a operação usa no dia a dia.';

-- 5. Campos de análise do CCA digitados no modal ------------------------------

alter table public.cca_cases add column if not exists analysis jsonb not null default '{}'::jsonb;

comment on column public.cca_cases.analysis is
  'Campos de análise de crédito da aba CCA (tabela, fator, FGTS, renda/parcela aprovada…). Chaves livres; a tela é a dona do vocabulário.';

-- 6. Check-in exige IP identificado -------------------------------------------

create or replace function public.perform_checkin(client_ip inet default null)
returns public.checkins
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_who      uuid := auth.uid();
  v_shift    uuid;
  v_ok       boolean;
  v_reason   text;
  v_row      public.checkins;
begin
  if v_who is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  v_shift := public.current_shift();
  if v_shift is null then
    raise exception 'Fora da janela de check-in.' using errcode = 'P0001';
  end if;

  select e.allowed, e.reason into v_ok, v_reason
  from public.checkin_eligibility(v_who) e;

  if not v_ok then
    raise exception '%', v_reason using errcode = 'P0001';
  end if;

  -- A trava de loja é por IP; sem IP identificado não há trava. Chamada direta
  -- à RPC (sem passar pela edge function que resolve o IP) parava aqui só
  -- quando o IP vinha preenchido — agora para sempre.
  if client_ip is null then
    raise exception 'IP não identificado — faça o check-in pelo aplicativo.'
      using errcode = 'P0001';
  end if;

  if not public.ip_is_allowed(client_ip, v_who) then
    raise exception 'IP % não autorizado para check-in.', host(client_ip)
      using errcode = 'P0001';
  end if;

  insert into public.checkins (profile_id, shift_id, work_date, ip_address)
  values (v_who, v_shift, current_date, client_ip)
  on conflict (profile_id, work_date, shift_id) do update
    set checked_out_at = null,
        auto_checkout  = false,
        ip_address     = coalesce(excluded.ip_address, public.checkins.ip_address)
  returning * into v_row;

  return v_row;
end;
$$;

-- 7. Varredura da fila: lead 'queued' tenta de novo a cada minuto -------------

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
  -- Mais antigo primeiro; lote limitado para o job nunca passar do minuto.
  for v_lead in
    select l.id from public.leads l
    where l.status = 'queued'
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
  'Reprocessa leads presos em queued (sem corretor elegível na chegada). Chamada pelo pg_cron.';

-- 8. Fila de dossiês para a construtora ganha o gatilho que faltava -----------

create or replace function public.dispatch_pending_submissions()
returns void
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_url text;
  v_key text;
begin
  select secret into v_url from private.integration_credentials
   where provider = 'supabase' and label = 'functions_url' and active;
  select secret into v_key from private.integration_credentials
   where provider = 'supabase' and label = 'service_role_key' and active;

  if v_url is null or v_key is null then
    raise warning 'dispatch_pending_submissions: cadastre functions_url e service_role_key em Integrações.';
    return;
  end if;

  if not exists (
    select 1 from public.developer_submissions where status = 'queued'
  ) then
    return;
  end if;

  perform net.http_post(
    url     := rtrim(v_url, '/') || '/submission-dispatch',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := '{}'::jsonb
  );
end;
$$;

revoke all on function public.dispatch_pending_submissions() from public, anon, authenticated;

comment on function public.dispatch_pending_submissions() is
  'Gatilho da edge function submission-dispatch (dossiê à construtora via Brevo). Chamada pelo pg_cron; lê URL e chave do cofre.';

-- 9. Contador de tentativas de envio ------------------------------------------

alter table public.notifications add column if not exists attempts int not null default 0;

comment on column public.notifications.attempts is
  'Tentativas de envio pelo notify-dispatch. Acima do limite a mensagem é marcada com sent_at e last_error em vez de retentada para sempre.';

alter table public.notifications add column if not exists last_error text;

-- 10. Comentário manual no histórico do negócio -------------------------------

create or replace function public.add_deal_comment(p_deal_id uuid, p_body text)
returns public.deal_history
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.deal_history;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if not public.can_see_deal(p_deal_id) then
    raise exception 'Negócio fora da sua visibilidade.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Comentário vazio.' using errcode = 'P0001';
  end if;
  if length(p_body) > 4000 then
    raise exception 'Comentário longo demais (máx. 4000).' using errcode = 'P0001';
  end if;

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, auth.uid(), 'comment', btrim(p_body))
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.add_deal_comment(uuid, text) from public, anon;
grant execute on function public.add_deal_comment(uuid, text) to authenticated;

comment on function public.add_deal_comment is
  'Comentário manual no histórico do negócio (ata 23/07). Passa pela mesma visibilidade do deal; o log continua imutável fora daqui.';

-- Agendamentos ----------------------------------------------------------------

do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0020] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;

  begin
    perform cron.unschedule('faceimob-assign-queued');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'faceimob-assign-queued',
    '* * * * *',
    $cmd$select public.assign_queued_leads();$cmd$
  );

  begin
    perform cron.unschedule('faceimob-submission-dispatch');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'faceimob-submission-dispatch',
    '* * * * *',
    $cmd$select public.dispatch_pending_submissions();$cmd$
  );

  raise notice '[0020] assign-queued e submission-dispatch agendadas a cada minuto.';
end
$do$;
