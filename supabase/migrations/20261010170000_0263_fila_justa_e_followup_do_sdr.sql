-- =============================================================================
-- 0263 · Fila justa; follow-up e arquivo do SDR; candidato fora da base
--
-- FILA. Reclamação de 10/10/2026 (Julia, 09:04): "era a 14ª e do nada passei
-- para 15ª" e "entre eu e a Kayte (09:03/09:04) tinha a Ângela, que entrou
-- 09:28". A chave da fila (0200) é o momento em que a pessoa entrou nela por
-- último: o check-in ou a última vez. Só que a "última vez" era o horário em
-- que o lead CHEGOU (`assigned_at`). Enquanto o lead espera "Atender", a pessoa
-- sai da fila (0220); quando atende, volta com a chave antiga — o horário do
-- recebimento — e reaparece NA FRENTE de quem entrou depois disso e nunca
-- recebeu. Exemplo: Pedro recebe às 09:01, atende às 09:40 e volta com 09:01,
-- à frente da Julia (09:04): ela cai de 14ª para 15ª.
-- Agora a pessoa volta para a fila quando a vez TERMINA: ao atender
-- (`responded_at`) ou ao perder o prazo (`released_at` de timeout; realocação
-- pelo gestor segue sem tirar a vez, como na 0014). Quem volta, volta para o
-- fim. A Ângela à frente da Julia é a mesma regra: quem já teve a vez
-- vai para trás de quem chegou depois (0200). A tela passa a mostrar a hora
-- em que cada um voltou à fila, não só o check-in.
--
-- SDR. Pedido de 10/10/2026:
--  * Follow-up 1 h e 23 h depois da última mensagem do lead (dentro da janela
--    de 24 h do WhatsApp). Sem resposta em 24 h: a conversa é arquivada
--    ('abandoned', fora da caixa) e o lead sai da fila. Se o lead voltar a
--    escrever, o robô retoma de onde parou.
--  * Candidato não é lead de compra: `sdr_agents.lead_de_compra = false` (Luna)
--    manda o lead arquivado ou fora do perfil para descartado, não para a base.
--  * O agente nunca se despede antes do fim e, no fim, avisa que um
--    colaborador entra em contato em instantes (o texto vai no turno; aqui só
--    o encerramento da Luna é alinhado).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Fila: a vez termina ao atender ou ao perder o prazo.
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

create or replace function public.fila_em_formacao()
returns table (group_id uuid, group_name text, profile_id uuid, full_name text,
  posicao integer, situacao text, checked_in_at timestamptz, abre_as text,
  last_turn_at timestamptz, atrasados integer)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  return query
  with presentes as (
    select g.id g_id, g.name g_name, c.profile_id p_id, p.full_name p_nome,
      c.checked_in_at entrou, s.distribution_start abre,
      (now() at time zone 'America/Sao_Paulo')::time >= s.distribution_start aberta,
      public.overdue_lead_count(c.profile_id) atrasos,
      exists (select 1 from public.lead_assignments la where la.profile_id = c.profile_id
               and la.counts_for_queue and la.released_at is null and la.responded_at is null) com_lead,
      (select max(coalesce(la.responded_at, case when la.release_reason = 'timeout' then la.released_at end, la.assigned_at))
         from public.lead_assignments la where la.profile_id = c.profile_id and la.counts_for_queue) ultima_vez
    from public.checkins c
    join public.profiles p on p.id = c.profile_id
    join public.distribution_group_members m on m.profile_id = c.profile_id and m.active
    join public.distribution_groups g on g.id = m.group_id and g.active
    join public.work_shifts s on s.id = c.shift_id
    where c.work_date = public.current_work_date() and c.checked_out_at is null and p.status = 'active'
  ), classificados as (
    select pr.*, case
      when pr.atrasos >= (select a.overdue_block_threshold from public.automation_settings a where a.id) then 'bloqueado'
      when pr.com_lead then 'com_lead' when pr.aberta then 'na_fila' else 'aguardando' end sit
    from presentes pr
  )
  select k.g_id, k.g_name, k.p_id, k.p_nome,
    case when k.sit in ('bloqueado', 'com_lead') then null
         else row_number() over (partition by k.g_id, (k.sit in ('bloqueado', 'com_lead'))
                order by (k.sit = 'aguardando'), greatest(k.entrou, k.ultima_vez), k.p_id)::int end,
    k.sit, k.entrou, to_char(k.abre, 'HH24:MI'), k.ultima_vez, k.atrasos::int
  from classificados k
  order by k.g_name, (k.sit = 'bloqueado'), (k.sit = 'com_lead'),
           (k.sit = 'aguardando'), greatest(k.entrou, k.ultima_vez), k.p_id;
end;
$$;
revoke all on function public.fila_em_formacao() from public, anon;
grant execute on function public.fila_em_formacao() to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Agente de lead de compra ou não; etapa do follow-up na conversa.
-- -----------------------------------------------------------------------------
alter table public.sdr_agents
  add column if not exists lead_de_compra boolean not null default true;
comment on column public.sdr_agents.lead_de_compra is
  'Lead de compra (0263). Falso (RH, candidatos): arquivado ou fora do perfil vai para descartado, não para a base.';

update public.sdr_agents set lead_de_compra = false where name = 'Luna';

-- Encerramento da Luna: o colaborador entra em contato em instantes.
update public.sdr_agents
   set system_prompt = replace(system_prompt,
         'Seu cadastro segue para a equipe de recrutamento. Se seu perfil estiver
  alinhado, o gerente da unidade escolhida poderá entrar em contato para dar
  continuidade.',
         'Um de nossos colaboradores vai entrar em contato com você em instantes
  para dar continuidade.')
 where name = 'Luna';

alter table public.sdr_conversations
  add column if not exists followup_stage smallint not null default 0;
comment on column public.sdr_conversations.followup_stage is
  'Follow-ups enviados desde a última mensagem do lead (0263): 1 = de 1 h, 2 = de 23 h. Volta a 0 quando o lead escreve.';

create or replace function public.sdr_messages_zera_followup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.sdr_conversations set followup_stage = 0
   where id = new.conversation_id and followup_stage <> 0;
  return null;
end;
$$;
revoke all on function public.sdr_messages_zera_followup() from public, anon, authenticated;

drop trigger if exists sdr_messages_zera_followup on public.sdr_messages;
create trigger sdr_messages_zera_followup
  after insert on public.sdr_messages
  for each row when (new.author = 'lead')
  execute function public.sdr_messages_zera_followup();

-- -----------------------------------------------------------------------------
-- 3. Lead que sai da conversa sem entrega: base (compra) ou descartado (RH).
--    Só mexe em lead sem corretor; um ponto só para webhook, "Passar" e arquivo.
-- -----------------------------------------------------------------------------
create or replace function public.sdr_tirar_lead_da_fila(p_conversation_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead uuid;
  v_compra boolean;
begin
  if p_motivo is null or length(btrim(p_motivo)) = 0 or length(p_motivo) > 200 then
    raise exception 'Motivo obrigatório (até 200 caracteres).' using errcode = '22023';
  end if;
  select c.lead_id, coalesce(a.lead_de_compra, true) into v_lead, v_compra
    from public.sdr_conversations c
    left join public.sdr_agents a on a.id = c.agent_id
   where c.id = p_conversation_id;
  if v_lead is null then return; end if;

  update public.leads
     set status = case when v_compra then 'lost'::lead_status else 'discarded'::lead_status end,
         lost_reason = p_motivo,
         -- `leads_lost_consistency`: lost_at só existe em 'lost'.
         lost_at = case when v_compra then now() end
   where id = v_lead and assigned_to is null and status not in ('lost', 'discarded', 'converted');
end;
$$;
revoke all on function public.sdr_tirar_lead_da_fila(uuid, text) from public, anon, authenticated;
grant execute on function public.sdr_tirar_lead_da_fila(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Follow-up: reserva as conversas devidas (a edge function escreve e envia).
--    Robô falou por último; base = última mensagem do lead.
-- -----------------------------------------------------------------------------
create or replace function public.sdr_reservar_followups()
returns table (conversation_id uuid, phone text, etapa smallint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with ultima as (
    select c.id,
           (select max(m.created_at) from public.sdr_messages m
             where m.conversation_id = c.id and m.author = 'lead') as do_lead,
           (select m.author from public.sdr_messages m
             where m.conversation_id = c.id order by m.created_at desc limit 1) as autor
      from public.sdr_conversations c
      join public.leads l on l.id = c.lead_id
     where c.status = 'active' and c.agent_id is not null and c.followup_stage < 2
       and coalesce(l.utm_source, '') <> 'sdr_playground'
       and coalesce(l.phone, l.phone_raw) is not null
  ), devidas as (
    select u.id, case
        when c.followup_stage = 0 and u.do_lead <= now() - interval '23 hours' then 2
        when c.followup_stage = 0 and u.do_lead <= now() - interval '1 hour' then 1
        when c.followup_stage = 1 and u.do_lead <= now() - interval '23 hours' then 2
      end::smallint as nova
      from ultima u
      join public.sdr_conversations c on c.id = u.id
     where u.autor = 'agent' and u.do_lead is not null
       and u.do_lead > now() - interval '24 hours'
  ), reservadas as (
    update public.sdr_conversations c
       set followup_stage = d.nova
      from devidas d
     where c.id = d.id and d.nova is not null and c.status = 'active'
    returning c.id, c.lead_id, d.nova
  )
  select r.id, coalesce(l.phone, l.phone_raw), r.nova
    from reservadas r join public.leads l on l.id = r.lead_id;
end;
$$;
revoke all on function public.sdr_reservar_followups() from public, anon, authenticated;
grant execute on function public.sdr_reservar_followups() to service_role;

-- -----------------------------------------------------------------------------
-- 5. Arquivo: robô falou por último e o lead não responde há 24 h.
-- -----------------------------------------------------------------------------
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
     where c.status = 'active' and c.agent_id is not null
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

-- -----------------------------------------------------------------------------
-- 6. Lead arquivado voltou a escrever: o robô retoma de onde parou.
-- -----------------------------------------------------------------------------
create or replace function public.sdr_retomar_conversa(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead uuid;
begin
  update public.sdr_conversations
     set status = 'active', followup_stage = 0
   where id = p_conversation_id and status = 'abandoned'
  returning lead_id into v_lead;
  if not found then return false; end if;

  update public.leads
     set status = 'queued', lost_reason = null, lost_at = null
   where id = v_lead and assigned_to is null
     and status in ('lost', 'discarded') and lost_reason = 'SDR IA: sem resposta em 24 h';
  return true;
end;
$$;
revoke all on function public.sdr_retomar_conversa(uuid) from public, anon, authenticated;
grant execute on function public.sdr_retomar_conversa(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 7. Gatilho: arquiva e, havendo follow-up devido, chama a edge `sdr-followup`.
-- -----------------------------------------------------------------------------
create or replace function public.dispatch_sdr_followup()
returns boolean
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_url text;
  v_key text;
begin
  perform public.sdr_arquivar_sem_resposta();

  if not exists (
    select 1 from public.sdr_conversations c
     where c.status = 'active' and c.agent_id is not null and c.followup_stage < 2
       and c.last_message_at <= now() - interval '1 hour'
  ) then
    return false;
  end if;

  select secret into v_url from private.integration_credentials
   where provider = 'supabase' and label = 'functions_url' and active;
  select secret into v_key from private.integration_credentials
   where provider = 'supabase' and label = 'service_role_key' and active;
  if v_url is null or v_key is null then
    raise warning 'dispatch_sdr_followup: cadastre functions_url e service_role_key em Integrações.';
    return false;
  end if;

  perform net.http_post(
    url                  := rtrim(v_url, '/') || '/sdr-followup',
    headers              := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  return true;
end;
$$;
revoke all on function public.dispatch_sdr_followup() from public, anon, authenticated;
grant execute on function public.dispatch_sdr_followup() to service_role;

do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0263] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;
  begin
    if exists (select 1 from cron.job where jobname = 'faceimob-sdr-followup') then
      perform cron.unschedule('faceimob-sdr-followup');
    end if;
    perform cron.schedule('faceimob-sdr-followup', '*/5 * * * *', $cmd$select public.dispatch_sdr_followup();$cmd$);
  exception when others then
    raise warning '[0263] não foi possível agendar o follow-up do SDR: %', sqlerrm;
  end;
end
$do$;
