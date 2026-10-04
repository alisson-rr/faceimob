-- =============================================================================
-- 0220 — roleta igualitária: um lead por vez para cada corretor
--
-- Reclamação de 04/10/2026: no começo da roleta uma pessoa recebia vários
-- leads seguidos (ontem a Verônica, hoje a Daiane). Causa: os leads que
-- esperavam na fila (da noite, ou girando sem dono — 0212) eram entregues de
-- uma vez assim que a distribuição abria, e quem tinha feito check-in primeiro
-- era a única na fila naquele minuto: recebia um atrás do outro.
--
-- Pedido: "1 para o primeiro, depois o segundo, e assim sucessivamente até
-- voltar ao primeiro". Regra nova: quem tem lead da roleta esperando "Atender"
-- sai da vez até clicar em Atender ou o prazo vencer. Cada um recebe um, e o
-- próximo lead vai para o próximo da fila; quem chega depois entra na rodada.
-- A ordem da fila continua a da 0200 (chegada / fim da última vez).
--
-- A fila em formação do admin (0198/0200) mostra quem está nessa situação como
-- "com lead para atender", fora da numeração.
-- =============================================================================

create or replace function public.distribution_queue_interna(p_group_id uuid)
returns table(profile_id uuid, full_name text, queue_position integer,
              last_assigned_at timestamptz, last_turn_at timestamptz)
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
      ) as last_turn_at,
      c.checked_in_at
    from public.checkins c
    join public.profiles p on p.id = c.profile_id
    join public.distribution_group_members m
      on m.profile_id = c.profile_id and m.active
    join public.distribution_groups g
      on g.id = m.group_id and g.active
    join public.work_shifts s on s.id = c.shift_id
    where c.work_date = public.current_work_date()
      and c.checked_out_at is null
      and m.group_id = p_group_id
      and p.status = 'active'
      and (now() at time zone 'America/Sao_Paulo')::time >= s.distribution_start
      and public.overdue_lead_count(c.profile_id)
          < (select s2.overdue_block_threshold from public.automation_settings s2 where s2.id)
      -- 0220: um lead por vez. Quem tem lead da roleta esperando "Atender"
      -- sai da vez até atender ou o prazo vencer.
      and not exists (
        select 1 from public.lead_assignments la
         where la.profile_id = c.profile_id
           and la.released_at is null
           and la.responded_at is null
      )
  )
  select
    e.profile_id,
    e.full_name,
    -- Ordem de chegada (0200): a vez de cada um conta a partir do que veio
    -- por último — o check-in de hoje ou o fim da última vez. Quem bate ponto
    -- entra no fim; quem recebe vai para o fim; quem recebeu ontem não fura a
    -- fila de quem chegou antes dele hoje (greatest ignora o nulo).
    row_number() over (order by greatest(e.checked_in_at, e.last_turn_at) asc, e.profile_id)::int
      as queue_position,
    e.last_assigned_at,
    e.last_turn_at
  from eligible e;
$$;

create or replace function public.fila_em_formacao()
returns table (
  group_id       uuid,
  group_name     text,
  profile_id     uuid,
  full_name      text,
  posicao        integer,
  situacao       text,
  checked_in_at  timestamptz,
  abre_as        text,
  last_turn_at   timestamptz,
  atrasados      integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Só administrador vê a fila em formação.' using errcode = '42501';
  end if;

  return query
  with presentes as (
    select
      g.id as g_id,
      g.name as g_name,
      c.profile_id as p_id,
      p.full_name as p_nome,
      c.checked_in_at as entrou,
      s.distribution_start as abre,
      (now() at time zone 'America/Sao_Paulo')::time >= s.distribution_start as aberta,
      public.overdue_lead_count(c.profile_id) as atrasos,
      exists (
        select 1 from public.lead_assignments la
         where la.profile_id = c.profile_id
           and la.released_at is null
           and la.responded_at is null
      ) as com_lead,
      (
        select max(case when la.release_reason = 'timeout' then la.released_at else la.assigned_at end)
          from public.lead_assignments la
         where la.profile_id = c.profile_id
      ) as ultima_vez
    from public.checkins c
    join public.profiles p on p.id = c.profile_id
    join public.distribution_group_members m on m.profile_id = c.profile_id and m.active
    join public.distribution_groups g on g.id = m.group_id and g.active
    join public.work_shifts s on s.id = c.shift_id
    where c.work_date = public.current_work_date()
      and c.checked_out_at is null
      and p.status = 'active'
  ),
  classificados as (
    select pr.*,
           case
             when pr.atrasos >= (select a.overdue_block_threshold from public.automation_settings a where a.id) then 'bloqueado'
             when pr.com_lead then 'com_lead'
             when pr.aberta then 'na_fila'
             else 'aguardando'
           end as sit
      from presentes pr
  )
  select
    k.g_id,
    k.g_name,
    k.p_id,
    k.p_nome,
    case when k.sit in ('bloqueado', 'com_lead') then null
         else (row_number() over (partition by k.g_id, (k.sit in ('bloqueado', 'com_lead'))
                                  order by (k.sit = 'aguardando'), greatest(k.entrou, k.ultima_vez), k.p_id))::int
    end,
    k.sit,
    k.entrou,
    to_char(k.abre, 'HH24:MI'),
    k.ultima_vez,
    k.atrasos::int
  from classificados k
  order by k.g_name, (k.sit = 'bloqueado'), (k.sit = 'com_lead'), (k.sit = 'aguardando'), greatest(k.entrou, k.ultima_vez), k.p_id;
end;
$$;

revoke all on function public.distribution_queue_interna(uuid) from public, anon, authenticated;
grant execute on function public.distribution_queue_interna(uuid) to service_role;
