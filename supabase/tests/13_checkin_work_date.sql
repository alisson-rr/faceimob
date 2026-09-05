-- =============================================================================
-- Dia operacional do check-in, fechamento automático de turno e sondagem de
-- perfil alheio  (migrations 0029 e 0057)
--
-- A versão anterior deste arquivo afirmava `current_work_date() = current_date`
-- — ou seja, FIXAVA o defeito que a 0057 corrigiu, em vez de pegá-lo. O banco
-- roda em UTC: às 21:00 em São Paulo o `current_date` já é o dia seguinte, e
-- toda presença do turno Noite (18:30→21:30) era fechada 30 minutos antes.
--
-- Também não havia NENHUM teste de comportamento de `auto_checkout_expired()`:
-- o 04_cron_scheduling.sql só conferia que o job existe e está ativo. Função
-- agendada, correta na aparência e errada no resultado passava em tudo.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check13(cond boolean, label text)
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

\echo '== data operacional vem de America/Sao_Paulo, não de current_date =='

do $$
begin
  perform pg_temp.check13(
    public.current_work_date() = (now() at time zone 'America/Sao_Paulo')::date,
    'current_work_date() é a data em São Paulo');

  perform pg_temp.check13(
    has_function_privilege('authenticated', 'public.current_work_date()', 'execute'),
    'frontend consegue consultar current_work_date');

  perform pg_temp.check13(
    not has_function_privilege('anon', 'public.current_work_date()', 'execute'),
    'current_work_date continua fora do alcance de anon');
end
$$;

-- O teste acima só distingue certo de errado entre 21:00 e 00:00 SP — nas
-- outras 21 horas do dia as duas datas coincidem. Este confere a CAUSA: nenhuma
-- função do dia operacional pode voltar a usar `current_date` cru.
\echo '== nenhuma função da roleta decide o dia por current_date =='

do $$
declare
  alvo text;
  reincidentes text[] := '{}';
begin
  foreach alvo in array array[
    'current_work_date', 'perform_checkin', 'perform_checkout',
    'auto_checkout_expired', 'distribution_queue'
  ] loop
    if exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = alvo
        and pg_get_functiondef(p.oid) like '%current_date%'
    ) then
      reincidentes := reincidentes || alvo;
    end if;
  end loop;

  perform pg_temp.check13(cardinality(reincidentes) = 0,
    format('o dia operacional sai de current_work_date() (usam current_date: %s)',
           coalesce(array_to_string(reincidentes, ', '), '')));

  perform pg_temp.check13(
    (select pg_get_expr(d.adbin, d.adrelid)
       from pg_attrdef d
       join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      where d.adrelid = 'public.checkins'::regclass and a.attname = 'work_date')
      like '%current_work_date%',
    'o default de checkins.work_date também é o dia de São Paulo');
end
$$;

\echo '== auto_checkout_expired fecha o que venceu e só o que venceu =='

do $$
declare
  v_prof       uuid;
  v_now        time := (now() at time zone 'America/Sao_Paulo')::time;
  v_hoje       date := public.current_work_date();
  v_shift_open uuid;
  v_shift_past uuid;
  v_qualquer   uuid;
  v_id_ontem   uuid := '13000000-0000-0000-0000-000000000001';
  v_id_aberto  uuid := '13000000-0000-0000-0000-000000000002';
  v_id_vencido uuid := '13000000-0000-0000-0000-000000000003';
  v_saida      timestamptz;
  v_auto       boolean;
begin
  -- Perfil sem presença nos dois últimos dias: a unique é
  -- (profile_id, work_date, shift_id) e o seed já bate ponto para vários.
  select p.id into v_prof
  from public.profiles p
  where not exists (
    select 1 from public.checkins c
    where c.profile_id = p.id and c.work_date >= v_hoje - 1
  )
  order by p.id
  limit 1;
  perform pg_temp.check13(v_prof is not null,
    'cenário: há perfil sem presença nos últimos dois dias');

  select s.id into v_qualquer   from public.work_shifts s where s.active order by s.position limit 1;
  select s.id into v_shift_open from public.work_shifts s where s.active and s.checkout_time >= v_now order by s.position limit 1;
  select s.id into v_shift_past from public.work_shifts s where s.active and s.checkout_time <  v_now order by s.position limit 1;
  perform pg_temp.check13(v_qualquer is not null, 'cenário: há turno ativo cadastrado');

  -- 1. Presença de um dia operacional anterior é fechada (o job caiu ontem).
  insert into public.checkins (id, profile_id, shift_id, work_date)
  values (v_id_ontem, v_prof, v_qualquer, v_hoje - 1);

  -- 2. Presença de hoje num turno que ainda não terminou NÃO pode ser fechada.
  if v_shift_open is not null then
    insert into public.checkins (id, profile_id, shift_id, work_date)
    values (v_id_aberto, v_prof, v_shift_open, v_hoje);
  end if;

  -- 3. Presença de hoje num turno que já passou do horário é fechada.
  if v_shift_past is not null then
    insert into public.checkins (id, profile_id, shift_id, work_date)
    values (v_id_vencido, v_prof, v_shift_past, v_hoje);
  end if;

  perform public.auto_checkout_expired();

  select checked_out_at, auto_checkout into v_saida, v_auto
  from public.checkins where id = v_id_ontem;
  perform pg_temp.check13(v_saida is not null,
    'presença de um dia anterior é encerrada pelo job');
  perform pg_temp.check13(v_auto,
    'o encerramento do job é marcado como automático (auto_checkout)');

  if v_shift_open is not null then
    select checked_out_at into v_saida from public.checkins where id = v_id_aberto;
    perform pg_temp.check13(v_saida is null,
      'presença dentro do turno vigente continua aberta');
  end if;

  if v_shift_past is not null then
    select checked_out_at, auto_checkout into v_saida, v_auto from public.checkins where id = v_id_vencido;
    perform pg_temp.check13(v_saida is not null and v_auto,
      'presença de turno já encerrado é fechada automaticamente');
  end if;

  delete from public.checkins where id in (v_id_ontem, v_id_aberto, v_id_vencido);
end
$$;

\echo '== elegibilidade e cobertura de IP só respondem sobre quem o usuário enxerga =='

do $$
declare
  v_eu    uuid;
  v_outro uuid;
  v_ok    boolean;
begin
  -- Corretor puro: não é admin/sócio e não lidera equipe, então
  -- `auth_visible_profiles()` devolve só ele mesmo.
  select p.id into v_eu
  from public.profiles p
  where exists (select 1 from public.user_roles r where r.profile_id = p.id and r.role = 'broker')
    and not exists (
      select 1 from public.user_roles r
      where r.profile_id = p.id and r.role in ('admin', 'partner', 'director', 'manager')
    )
    and not exists (select 1 from public.teams t where t.manager_id = p.id or t.director_id = p.id)
  order by p.id
  limit 1;

  select p.id into v_outro from public.profiles p where p.id <> v_eu order by p.id desc limit 1;
  perform pg_temp.check13(v_eu is not null and v_outro is not null,
    'cenário: há um corretor puro e outro perfil para sondar');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_eu::text, 'role', 'authenticated')::text, false);

  perform pg_temp.check13(public.can_probe_profile(v_eu),
    'o corretor consulta o próprio estado');
  perform pg_temp.check13(not public.can_probe_profile(v_outro),
    'cenário: o outro perfil está fora da visibilidade do corretor');

  begin
    select allowed into v_ok from public.checkin_eligibility(v_outro);
    raise exception 'FALHOU: checkin_eligibility respondeu sobre perfil de terceiro';
  exception when insufficient_privilege then
    raise notice '  ok  checkin_eligibility recusa perfil de terceiro';
  end;

  begin
    v_ok := public.ip_is_allowed('203.0.113.77'::inet, v_outro);
    raise exception 'FALHOU: ip_is_allowed respondeu sobre perfil de terceiro';
  exception when insufficient_privilege then
    raise notice '  ok  ip_is_allowed recusa perfil de terceiro';
  end;

  -- Sobre si mesmo continua respondendo: é o que a tela de check-in consulta.
  select allowed into v_ok from public.checkin_eligibility(v_eu);
  perform pg_temp.check13(v_ok is not null, 'a própria elegibilidade continua legível');

  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo '== elegibilidade cobre os dois estados de perfil =='

do $$
declare
  v_admin  uuid;
  v_prof   uuid;
  v_status public.profile_status;
  v_ok     boolean;
  v_reason text;
begin
  -- Perfil inexistente: o ramo nunca exercitado até aqui.
  select allowed, reason into v_ok, v_reason
  from public.checkin_eligibility('13000000-0000-0000-0000-0000000000ff'::uuid);
  perform pg_temp.check13(not v_ok and v_reason = 'Perfil não encontrado.',
    'perfil inexistente é recusado com motivo próprio');

  select p.id into v_admin
  from public.profiles p
  join public.user_roles r on r.profile_id = p.id and r.role = 'admin'
  order by p.id limit 1;
  select p.id, p.status into v_prof, v_status
  from public.profiles p where p.status = 'active' and p.id <> v_admin order by p.id limit 1;
  perform pg_temp.check13(v_admin is not null and v_prof is not null,
    'cenário: há um admin e um perfil ativo');

  -- `profiles_guard_admin_columns` (0012) só deixa o ADMIN mexer em `status`:
  -- sem o claim o próprio teste seria recusado pelo gatilho, e o ramo continuaria
  -- sem cobertura.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, false);

  update public.profiles set status = 'suspended' where id = v_prof;
  select allowed, reason into v_ok, v_reason from public.checkin_eligibility(v_prof);
  update public.profiles set status = v_status where id = v_prof;

  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check13(not v_ok and v_reason = 'Perfil inativo.',
    'perfil inativo é recusado com motivo próprio');
end
$$;

\echo '== o que a 0065 acrescentou continua de pé depois da 0066 =='

-- A 0066 reescreve `perform_checkin` e `perform_checkout` para devolver o dia
-- operacional de São Paulo. Reescrever é a forma de perder o que a 0065 tinha
-- posto ali: a permissão de menu e o fechamento de UM turno. Os dois asserts
-- abaixo são o tripwire dessa perda.
do $$
begin
  perform pg_temp.check13(
    (select pg_get_functiondef(p.oid) like '%menu.checkin%'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'perform_checkin'),
    'perform_checkin continua exigindo a permissão menu.checkin');

  perform pg_temp.check13(
    (select pg_get_functiondef(p.oid) like '%limit 1%'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'perform_checkout'),
    'perform_checkout continua fechando um turno por chamada');
end
$$;

\echo '== a contagem de atrasados de um colega não é consultável do navegador =='

-- `checkin_eligibility` e `ip_is_allowed` ganharam guarda de visibilidade na
-- 0057, mas o número que vazava continuava legível pela função irmã:
-- `overdue_lead_count(who)` é SECURITY DEFINER, aceita qualquer perfil e tinha
-- `execute` para `authenticated` pelo bloco em massa da 0023. A vedação é por
-- privilégio (0066) — guarda dentro da função quebraria `distribution_queue`,
-- que a chama para todos os membros do grupo.
do $$
declare
  v_grupo uuid;
  v_eu    uuid;
begin
  perform pg_temp.check13(
    not has_function_privilege('authenticated', 'public.overdue_lead_count(uuid)', 'execute'),
    'overdue_lead_count fora do alcance de authenticated');
  perform pg_temp.check13(
    not has_function_privilege('anon', 'public.overdue_lead_count(uuid)', 'execute'),
    'overdue_lead_count fora do alcance de anon');
  perform pg_temp.check13(
    has_function_privilege('service_role', 'public.overdue_lead_count(uuid)', 'execute'),
    'o cron e o harness continuam contando (service_role)');

  -- E a fila do próprio corretor não pode ter ido junto: `distribution_queue` é
  -- SECURITY DEFINER e chama `overdue_lead_count` por dentro. Se a revogação
  -- alcançasse o chamador, isto estouraria com "permission denied for function".
  select g.id into v_grupo from public.distribution_groups g where g.active order by g.id limit 1;
  select p.id into v_eu from public.profiles p where p.status = 'active' order by p.id limit 1;

  if v_grupo is not null and v_eu is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_eu::text, 'role', 'authenticated')::text, false);
    perform count(*) from public.distribution_queue(v_grupo);
    perform set_config('request.jwt.claims', '', false);
    perform pg_temp.check13(true,
      'a fila continua consultável pelo corretor depois da revogação');
  end if;
end
$$;

\echo 'dia operacional do check-in ok'
