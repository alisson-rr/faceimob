-- -----------------------------------------------------------------------------
-- 0057 — o dia operacional do check-in é o de São Paulo, e sondar a
--        elegibilidade/IP de um colega deixa de ser possível
--
-- 1. O TURNO NOITE FECHAVA 30 MINUTOS ANTES (defeito confirmado na homologação)
--
-- O Postgres da homologação roda em UTC. Às 21:00 em São Paulo o `current_date`
-- do banco JÁ VIROU para o dia seguinte (00:00 UTC). Todas as funções da roleta
-- usavam `current_date` cru, e o turno Noite (18:30 → 21:30) é o único que
-- cruza essa fronteira. Efeito encadeado, todo dia, entre 21:00 e 21:30:
--
--   a) `auto_checkout_expired` casava `c.work_date < current_date` e fechava a
--      presença às 21:00 com `auto_checkout = true` — 30 min antes do horário
--      que o admin configurou em `work_shifts.checkout_time`;
--   b) no mesmo instante o corretor saía de `distribution_queue`
--      (`c.work_date = current_date`) e parava de receber lead;
--   c) `perform_checkout()` respondia "Nenhum check-in aberto hoje.";
--   d) `listTodayCheckins` (tela) consultava `current_work_date()` = `current_date`,
--      a presença sumia da tela, o botão "Fazer check-in" reabilitava e um
--      SEGUNDO check-in do mesmo turno podia ser gravado — a unique é
--      (profile_id, work_date, shift_id) e o work_date já era outro.
--
-- A correção é uma só, no ponto compartilhado: `current_work_date()` passa a
-- devolver a data em America/Sao_Paulo (o mesmo fuso que `current_shift()` já
-- usava para decidir o turno) e todo mundo que decidia o dia operacional passa a
-- chamá-la, em vez de repetir `current_date`. O default da coluna
-- `checkins.work_date` entra junto: sem ele, uma linha inserida por seed ou pela
-- suíte E2E às 21h nasceria no dia errado e ficaria invisível para a fila.
--
-- Fica de fora de propósito: `assign_lead` (0005), que incrementa
-- `checkins.leads_received` por `work_date = current_date`. É outra frente
-- editando a mesma função nesta rodada; o contador do turno erra só na janela
-- 21:00–21:30 e a distribuição em si já está correta, porque ela sai de
-- `distribution_queue`.
--
-- 2. SONDAGEM DE PERFIL ALHEIO
--
-- `checkin_eligibility(who)` e `ip_is_allowed(candidate, who)` são SECURITY
-- DEFINER, estão concedidas a `authenticated` e aceitavam qualquer `who`.
-- Qualquer corretor logado podia descobrir quantos leads atrasados um colega
-- tem, se o perfil dele está inativo e quais IPs liberam quem — enquanto a
-- tabela `allowed_ips` só é legível por admin/sócio (`allowed_ips_read`) e
-- `profiles` já é recortada por `auth_visible_profiles()`. As duas passam a
-- respeitar a MESMA visibilidade das tabelas que consultam.
--
-- `auth.uid() is null` continua liberado: é o `service_role` (harness SQL, suíte
-- E2E, cron), que já ignora RLS por definição. `anon` não alcança nenhuma das
-- duas (revogado desde a 0023).
--
-- Idempotente: só `create or replace` e `alter column ... set default`.
-- -----------------------------------------------------------------------------

-- 1. O dia operacional -------------------------------------------------------

create or replace function public.current_work_date()
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  -- America/Sao_Paulo, e nunca a data do servidor: o banco roda em UTC e o
  -- turno noite (18:30→21:30) atravessa a meia-noite UTC às 21:00 SP.
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

comment on function public.current_work_date is
  'Data operacional (America/Sao_Paulo) usada por checkins e pela fila. A interface deve consultar esta função, nunca recalcular a data local; o banco deve chamá-la em vez de current_date, que está em UTC.';

alter table public.checkins
  alter column work_date set default public.current_work_date();

-- 2. Check-in / check-out / fila passam a usar o dia de São Paulo ------------

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

  -- A trava de loja é por IP; sem IP identificado não há trava (0020).
  if client_ip is null then
    raise exception 'IP não identificado — faça o check-in pelo aplicativo.'
      using errcode = 'P0001';
  end if;

  if not public.ip_is_allowed(client_ip, v_who) then
    raise exception 'IP % não autorizado para check-in.', host(client_ip)
      using errcode = 'P0001';
  end if;

  insert into public.checkins (profile_id, shift_id, work_date, ip_address)
  values (v_who, v_shift, public.current_work_date(), client_ip)
  on conflict (profile_id, work_date, shift_id) do update
    set checked_out_at = null,
        auto_checkout  = false,
        ip_address     = coalesce(excluded.ip_address, public.checkins.ip_address)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.perform_checkout()
returns public.checkins
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.checkins;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  update public.checkins
     set checked_out_at = now()
   where profile_id = auth.uid()
     and work_date = public.current_work_date()
     and checked_out_at is null
  returning * into v_row;

  if not found then
    raise exception 'Nenhum check-in aberto hoje.' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

create or replace function public.auto_checkout_expired()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  with fechados as (
    update public.checkins c
       set checked_out_at = now(), auto_checkout = true
      from public.work_shifts s
     where s.id = c.shift_id
       and c.checked_out_at is null
       and (
         -- Presença de um dia operacional anterior (fica aberta se o job caiu).
         c.work_date < public.current_work_date()
         -- Ou o turno de hoje já passou do horário configurado.
         or (now() at time zone 'America/Sao_Paulo')::time > s.checkout_time
       )
    returning c.id
  )
  select count(*) into v_count from fechados;

  return v_count;
end;
$$;

create or replace function public.distribution_queue(p_group_id uuid)
returns table (
  profile_id       uuid,
  full_name        text,
  queue_position   int,
  last_assigned_at timestamptz,
  last_turn_at     timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with eligible as (
    select
      c.profile_id,
      p.full_name,
      (
        select max(la.assigned_at)
        from public.lead_assignments la
        where la.profile_id = c.profile_id
      ) as last_assigned_at,
      -- Fim da última vez na roleta: lead perdido no prazo encerra a vez no
      -- released_at, não no assigned_at (0014).
      (
        select max(
          case
            when la.release_reason = 'timeout' then la.released_at
            else la.assigned_at
          end
        )
        from public.lead_assignments la
        where la.profile_id = c.profile_id
      ) as last_turn_at
    from public.checkins c
    join public.profiles p on p.id = c.profile_id
    join public.distribution_group_members m
      on m.profile_id = c.profile_id and m.active
    join public.work_shifts s on s.id = c.shift_id
    where c.work_date = public.current_work_date()
      and c.checked_out_at is null
      and m.group_id = p_group_id
      and p.status = 'active'
      and (now() at time zone 'America/Sao_Paulo')::time >= s.distribution_start
      and public.overdue_lead_count(c.profile_id)
          < (select s2.overdue_block_threshold from public.automation_settings s2 where s2.id)
  )
  select
    e.profile_id,
    e.full_name,
    row_number() over (order by e.last_turn_at asc nulls first, e.profile_id)::int
      as queue_position,
    e.last_assigned_at,
    e.last_turn_at
  from eligible e;
$$;

-- 3. Quem pode perguntar sobre QUEM ------------------------------------------

create or replace function public.can_probe_profile(who uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    -- service_role / cron / harness: já ignoram RLS por definição.
    auth.uid() is null
    or who = auth.uid()
    or who in (select public.auth_visible_profiles());
$$;

comment on function public.can_probe_profile is
  'Regra única de quem pode consultar o estado operacional de um perfil (elegibilidade de check-in, cobertura de IP). Espelha auth_visible_profiles(), que é o mesmo recorte de profiles_select.';

revoke all on function public.can_probe_profile(uuid) from public, anon;
grant execute on function public.can_probe_profile(uuid) to authenticated, service_role;

create or replace function public.checkin_eligibility(who uuid default auth.uid())
returns table (allowed boolean, reason text, overdue_count int, threshold int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_overdue   int;
  v_threshold int;
  v_status    profile_status;
begin
  if not public.can_probe_profile(who) then
    raise exception 'Sem permissão para consultar a elegibilidade deste perfil.'
      using errcode = '42501';
  end if;

  select p.status into v_status from public.profiles p where p.id = who;
  select s.overdue_block_threshold into v_threshold from public.automation_settings s where s.id;

  v_overdue   := public.overdue_lead_count(who);
  v_threshold := coalesce(v_threshold, 20);

  if v_status is null then
    return query select false, 'Perfil não encontrado.', 0, v_threshold;
  elsif v_status <> 'active' then
    return query select false, 'Perfil inativo.', v_overdue, v_threshold;
  elsif v_overdue >= v_threshold then
    return query select false,
      format('Você tem %s leads atrasados. Regularize até %s para liberar o check-in.',
             v_overdue, v_threshold - 1),
      v_overdue, v_threshold;
  else
    return query select true, null::text, v_overdue, v_threshold;
  end if;
end;
$$;

create or replace function public.ip_is_allowed(candidate inet, who uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.can_probe_profile(who) then
    raise exception 'Sem permissão para consultar a cobertura de IP deste perfil.'
      using errcode = '42501';
  end if;

  -- `<<=` (contido OU igual) desde a 0024: com `<<` um /32 nunca liberava.
  return coalesce((select p.bypass_ip_check from public.profiles p where p.id = who), false)
    or exists (
      select 1
      from public.allowed_ips a
      where a.active
        and candidate <<= a.ip_range
        and (
          a.team_id is null
          or a.team_id in (
            select tm.team_id from public.team_members tm
            where tm.profile_id = who and tm.left_at is null
          )
        )
    );
end;
$$;

-- `create or replace` preserva a ACL, mas repetir aqui deixa o contrato escrito
-- no arquivo em vez de depender do histórico (0005/0023/0024).
revoke all on function public.checkin_eligibility(uuid) from public, anon;
revoke all on function public.ip_is_allowed(inet, uuid)  from public, anon;
revoke all on function public.auto_checkout_expired()    from public, anon, authenticated;
grant execute on function public.checkin_eligibility(uuid) to authenticated, service_role;
grant execute on function public.ip_is_allowed(inet, uuid) to authenticated, service_role;
grant execute on function public.auto_checkout_expired()   to service_role;
