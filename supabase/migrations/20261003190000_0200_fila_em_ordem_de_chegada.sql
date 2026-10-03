-- =============================================================================
-- 0200 — fila da roleta em ordem de chegada
--
-- Reclamação de 03/10/2026 (corretor era o 9º de 24, virou 10º com 25 e 11º
-- com 26): a fila ordenava pelo fim da última vez (0014) com nulos primeiro.
-- Quem batia ponto depois e nunca tinha recebido — ou só tinha recebido ontem —
-- entrava NA FRENTE de quem esperava desde cedo.
--
-- Pedido do cliente: "deixe a colocação de quem fez o check-in fixa; novos
-- check-ins vão para o fim da fila; quem já recebeu não entra na frente de
-- quem não recebeu". A chave da fila passa a ser o momento em que a pessoa
-- entrou nela por último: o check-in de hoje ou o fim da última vez (o
-- recebimento, ou a perda do prazo — a regra da 0014 continua), o que for
-- mais recente. Exemplo: Ana entra 08:00, Bia 08:10, Caio 08:30. Ana recebe às
-- 08:40 e vai para depois do Caio; Duda bate ponto às 09:00 e fica atrás de
-- todos eles.
--
-- A mesma chave na fila em formação do admin (0198). `last_turn_at` continua
-- sendo devolvido com o mesmo sentido; muda só a ordem.
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
    case when k.sit = 'bloqueado' then null
         else (row_number() over (partition by k.g_id, (k.sit = 'bloqueado')
                                  order by (k.sit = 'aguardando'), greatest(k.entrou, k.ultima_vez), k.p_id))::int
    end,
    k.sit,
    k.entrou,
    to_char(k.abre, 'HH24:MI'),
    k.ultima_vez,
    k.atrasos::int
  from classificados k
  order by k.g_name, (k.sit = 'bloqueado'), (k.sit = 'aguardando'), greatest(k.entrou, k.ultima_vez), k.p_id;
end;
$$;
