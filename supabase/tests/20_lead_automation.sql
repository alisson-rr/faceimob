-- =============================================================================
-- Regressão da 0043 — "Auto 1º contato" e "Sem resposta (h)" têm quem os leia.
--
-- Até a 0043 os dois campos de `automation_settings` eram gravados pela tela e
-- lidos por ninguém. Aqui se afirma o elo que faltava, no mesmo espírito do
-- 04_cron_scheduling.sql: a regra roda quando chamada E existe quem a chame.
--
--   1. `claim_lead` move o lead para `first_contact` só com o auto ligado, e
--      nunca regride um lead que já saiu de `new`.
--   2. `mark_no_response_leads()` respeita o prazo configurado, avisa o
--      corretor e é idempotente.
--   3. O job do cron existe e só o serviço executa a varredura.
--
-- Não depende de seed.sql.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check20(cond boolean, label text)
returns void
language plpgsql
as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FALHOU: %', label;
  end if;
  raise notice '  ok  %', label;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cenário
-- -----------------------------------------------------------------------------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-0000a0430001';
  cor uuid := '00000000-0000-0000-0000-0000a0430002';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@automacao.test', '{"full_name":"Admin Automação"}'),
    (cor, 'cor@automacao.test', '{"full_name":"Corretor Automação"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (cor, 'broker')
  on conflict do nothing;
end
$$;

\echo '== 1. auto_first_contact: Atender leva o lead a Primeiro Contato =='

do $$
declare
  cor uuid := '00000000-0000-0000-0000-0000a0430002';
  v_lead  uuid;
  v_stage lead_funnel_stage;
begin
  update public.automation_settings set auto_first_contact = true where id;

  insert into public.leads (full_name, phone, status, assigned_to, funnel_stage)
  values ('Lead Auto Contato', '11977770043', 'assigned', cor, 'new')
  returning id into v_lead;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.claim_lead(v_lead);
  reset role;

  select funnel_stage into v_stage from public.leads where id = v_lead;
  perform pg_temp.check20(v_stage = 'first_contact',
    'com o auto ligado, Atender move o lead de new para first_contact');
  perform pg_temp.check20(
    exists (select 1 from public.lead_events
            where lead_id = v_lead and kind = 'stage_changed'
              and to_value = 'first_contact' and actor_id = cor),
    'a mudança de etapa fica no log com o corretor como autor');

  -- Já fora de `new` (SDR qualificou): o auto não regride a etapa.
  insert into public.leads (full_name, phone, status, assigned_to, funnel_stage)
  values ('Lead Qualificado', '11977770044', 'assigned', cor, 'qualified')
  returning id into v_lead;

  set local role authenticated;
  perform public.claim_lead(v_lead);
  reset role;

  select funnel_stage into v_stage from public.leads where id = v_lead;
  perform pg_temp.check20(v_stage = 'qualified',
    'lead que já saiu de new mantém a etapa ao Atender');

  -- Desligado: comportamento anterior, o corretor move à mão.
  update public.automation_settings set auto_first_contact = false where id;

  insert into public.leads (full_name, phone, status, assigned_to, funnel_stage)
  values ('Lead Sem Auto', '11977770045', 'assigned', cor, 'new')
  returning id into v_lead;

  set local role authenticated;
  perform public.claim_lead(v_lead);
  reset role;

  select funnel_stage into v_stage from public.leads where id = v_lead;
  perform pg_temp.check20(v_stage = 'new',
    'com o auto desligado, Atender deixa o lead em new');
end
$$;

\echo '== 2. mark_no_response_leads: prazo estourado vira Sem Resposta e avisa =='

do $$
declare
  cor uuid := '00000000-0000-0000-0000-0000a0430002';
  v_vencido uuid;
  v_recente uuid;
  v_perdido uuid;
  v_n int;
begin
  -- A seção 1 deixou o `sub` do corretor nas claims (nível de sessão). A
  -- varredura roda pelo cron, sem JWT: zerar aqui é o que faz o log sair com
  -- actor nulo, como em produção.
  perform set_config('request.jwt.claims', '', false);
  update public.automation_settings set no_response_hours = 24 where id;

  insert into public.leads (full_name, phone, status, assigned_to, funnel_stage, first_contact_at)
  values ('Lead Vencido', '11977770046', 'attending', cor, 'first_contact', now() - interval '25 hours')
  returning id into v_vencido;

  -- `now()` é fixo dentro da transação: 2 h garante folga para o prazo de 1 h abaixo.
  insert into public.leads (full_name, phone, status, assigned_to, funnel_stage, first_contact_at)
  values ('Lead Recente', '11977770047', 'attending', cor, 'first_contact', now() - interval '2 hours')
  returning id into v_recente;

  -- Já tem desfecho: fora da varredura mesmo com prazo estourado.
  insert into public.leads (full_name, phone, status, assigned_to, funnel_stage, first_contact_at, lost_at)
  values ('Lead Perdido', '11977770048', 'lost', cor, 'first_contact', now() - interval '48 hours', now())
  returning id into v_perdido;

  v_n := public.mark_no_response_leads();
  perform pg_temp.check20(v_n = 1, format('varredura com 24 h move só o vencido (moveu %s)', v_n));
  perform pg_temp.check20(
    (select funnel_stage from public.leads where id = v_vencido) = 'no_response',
    'lead parado há 25 h vai para no_response');
  perform pg_temp.check20(
    (select funnel_stage from public.leads where id = v_recente) = 'first_contact',
    'lead com 2 h continua em first_contact');
  perform pg_temp.check20(
    (select funnel_stage from public.leads where id = v_perdido) = 'first_contact',
    'lead perdido não é tocado');
  perform pg_temp.check20(
    exists (select 1 from public.notifications
            where profile_id = cor and kind = 'lead_no_response'
              and channel = 'in_app'
              and link = '/leads?lead=' || v_vencido::text),
    'corretor recebe aviso in-app apontando para o lead');
  perform pg_temp.check20(
    exists (select 1 from public.lead_events
            where lead_id = v_vencido and kind = 'stage_changed'
              and to_value = 'no_response' and actor_id is null),
    'a mudança fica no log do lead como ação do sistema');

  v_n := public.mark_no_response_leads();
  perform pg_temp.check20(v_n = 0, 'segunda passada não move nada (idempotente)');

  -- O prazo vem da configuração, não de constante: com 1 h o recente entra.
  update public.automation_settings set no_response_hours = 1 where id;
  v_n := public.mark_no_response_leads();
  perform pg_temp.check20(v_n = 1
    and (select funnel_stage from public.leads where id = v_recente) = 'no_response',
    'prazo de 1 h alcança o lead de 2 h — a varredura lê automation_settings');

  update public.automation_settings set no_response_hours = 24 where id;
end
$$;

\echo '== 3. quem chama: o cron sim, usuário autenticado não =='

do $$
declare
  cor uuid := '00000000-0000-0000-0000-0000a0430002';
  v_schedule text;
  v_command  text;
  v_active   boolean;
begin
  select j.schedule, j.command, j.active
    into v_schedule, v_command, v_active
  from cron.job j
  where j.jobname = 'faceimob-mark-no-response';

  perform pg_temp.check20(v_schedule is not null,
    'job faceimob-mark-no-response está agendado');
  perform pg_temp.check20(coalesce(v_active, true),
    'job da varredura está ativo');
  perform pg_temp.check20(v_command like '%mark_no_response_leads%',
    'job da varredura chama mark_no_response_leads()');

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  begin
    perform public.mark_no_response_leads();
    raise exception 'FALHOU: usuário autenticado executou a varredura';
  exception when insufficient_privilege then
    raise notice '  ok  usuário autenticado não executa mark_no_response_leads()';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', false);
end
$$;
