-- =============================================================================
-- 0210 — relatório da roleta: leads pegos e perdidos por corretor
--
-- Pedido do cliente em 03/10/2026: corretores dizem ter perdido lead "antes dos
-- 10 minutos" e lugar na fila; "me dê um relatório de leads pegos e perdidos
-- por corretor, caso ele pergunte quantos perdeu".
--
-- Tudo sai de `lead_assignments` (cada vez que a roleta entrega um lead):
--   · recebidos  = atribuições no período;
--   · atendidos  = as que o corretor travou ("Atender", `responded_at`);
--   · perdidos   = as que estouraram o prazo (`release_reason = 'timeout'`);
--   · realocados = as que um gestor tirou e deu a outro.
-- `perdas_na_roleta` lista cada perda com chegada, prazo e saída — o prazo que
-- VALEU (deadline − chegada), que é o que responde "perdi antes dos 10 min?".
--
-- Alcance: `auth_visible_profiles()` — admin vê todos, gestor a equipe e o
-- corretor só a si mesmo.
-- =============================================================================

create or replace function public.relatorio_da_roleta(p_inicio date, p_fim date)
returns table (
  profile_id         uuid,
  full_name          text,
  recebidos          integer,
  atendidos          integer,
  perdidos           integer,
  realocados         integer,
  resposta_media_seg integer,
  prazo_min_seg      integer,
  prazo_max_seg      integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select la.profile_id,
         p.full_name,
         count(*)::int,
         count(*) filter (where la.responded_at is not null)::int,
         count(*) filter (where la.release_reason = 'timeout')::int,
         count(*) filter (where la.release_reason in ('reassigned', 'manual'))::int,
         round(avg(extract(epoch from la.responded_at - la.assigned_at))
               filter (where la.responded_at is not null))::int,
         round(min(extract(epoch from la.deadline - la.assigned_at)))::int,
         round(max(extract(epoch from la.deadline - la.assigned_at)))::int
    from public.lead_assignments la
    join public.profiles p on p.id = la.profile_id
   where auth.uid() is not null
     and la.profile_id in (select public.auth_visible_profiles())
     and (la.assigned_at at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
   group by la.profile_id, p.full_name
   order by count(*) filter (where la.release_reason = 'timeout') desc, p.full_name;
$$;

revoke all on function public.relatorio_da_roleta(date, date) from public, anon;
grant execute on function public.relatorio_da_roleta(date, date) to authenticated;

create or replace function public.perdas_na_roleta(p_profile uuid, p_inicio date, p_fim date)
returns table (
  lead_id     uuid,
  cliente     text,
  roleta      text,
  recebido_em timestamptz,
  prazo_em    timestamptz,
  perdido_em  timestamptz,
  prazo_seg   integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select la.lead_id,
         l.full_name,
         g.name,
         la.assigned_at,
         la.deadline,
         la.released_at,
         round(extract(epoch from la.deadline - la.assigned_at))::int
    from public.lead_assignments la
    join public.leads l on l.id = la.lead_id
    left join public.distribution_groups g on g.id = la.group_id
   where auth.uid() is not null
     and la.profile_id = p_profile
     and p_profile in (select public.auth_visible_profiles())
     and la.release_reason = 'timeout'
     and (la.assigned_at at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
   order by la.assigned_at desc;
$$;

revoke all on function public.perdas_na_roleta(uuid, date, date) from public, anon;
grant execute on function public.perdas_na_roleta(uuid, date, date) to authenticated;
