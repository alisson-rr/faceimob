-- =============================================================================
-- 0198 — fila em formação, para o admin
--
-- Pedido do cliente em 03/10/2026: "deixe o adm ver a fila sendo formada
-- antes da entrega nos leads". A fila do motor (distribution_queue_interna,
-- 0148) só existe depois do horário de distribuição do turno: antes disso ela
-- é vazia, e o admin não via quem já bateu ponto nem em que ordem vai receber.
--
-- Esta função mostra, por grupo ativo, todo corretor em check-in hoje:
--   - na_fila      → já está na fila do motor (distribuição aberta);
--   - aguardando   → bateu ponto, a distribuição do turno ainda não abriu;
--   - bloqueado    → leads atrasados acima do limite: o motor não o chama.
-- A ordem é a do motor (fim da última vez, last_turn_at, nulos primeiro):
-- primeiro quem já está na fila, depois quem aguarda a abertura do turno —
-- antes da abertura, todos aguardam e a lista é a ordem em que vão receber.
-- Só admin e sócio (is_admin); só leitura.
-- =============================================================================

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
                                  order by (k.sit = 'aguardando'), k.ultima_vez asc nulls first, k.p_id))::int
    end,
    k.sit,
    k.entrou,
    to_char(k.abre, 'HH24:MI'),
    k.ultima_vez,
    k.atrasos::int
  from classificados k
  order by k.g_name, (k.sit = 'bloqueado'), (k.sit = 'aguardando'), k.ultima_vez asc nulls first, k.p_id;
end;
$$;

revoke all on function public.fila_em_formacao() from public, anon;
grant execute on function public.fila_em_formacao() to authenticated;
comment on function public.fila_em_formacao() is
  'Admin: por grupo ativo, quem está em check-in hoje, na ordem em que vai receber (a do motor), com a situação na_fila / aguardando (distribuição ainda não abriu) / bloqueado (leads atrasados). Só leitura (0198).';
