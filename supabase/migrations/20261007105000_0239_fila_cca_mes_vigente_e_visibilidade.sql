-- =============================================================================
-- 0239 · Fila da Esteira Ágil do mês vigente, em ordem global de chegada
-- A posição é calculada entre todos os elegíveis antes do recorte hierárquico.
-- =============================================================================
drop function if exists public.my_cca_queue_position();
create or replace function public.my_cca_queue_position()
returns table(deal_id uuid, deal_code text, client_name text,
queue_position integer, submitted_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
select r.deal_id, d.code,
       coalesce(dc.full_name, d.code, 'Cliente não informado'),
       r.position::integer, r.submitted_at
from (
  select c.deal_id, c.submitted_at,
    row_number() over (order by c.submitted_at asc nulls last, c.id) as position
  from public.cca_cases c
  join public.deals d on d.id = c.deal_id
  where c.status not in ('approved', 'rejected', 'cancelled')
    and public.cca_stage_name_key(d.status_detail) = 'ESTEIRA AGIL'
    and c.submitted_at >= (
      public.month_start(coalesce(public.current_season_month(), current_date))::timestamp
      at time zone 'America/Sao_Paulo'
    )
    and c.submitted_at < (
      (public.month_start(coalesce(public.current_season_month(), current_date))
        + interval '1 month')::timestamp
      at time zone 'America/Sao_Paulo'
    )
) r
join public.deals d on d.id = r.deal_id
left join public.deal_clients dc on dc.deal_id = d.id and dc.ordinal = 1
where exists (
  select 1
    from public.deal_participants dp
   where dp.deal_id = r.deal_id
     and dp.role = 'broker'
     and dp.profile_id in (select public.auth_visible_profiles())
)
order by r.position;
$$;
revoke all on function public.my_cca_queue_position() from public, anon;
grant execute on function public.my_cca_queue_position() to authenticated;
comment on function public.my_cca_queue_position() is
'Posição global, por chegada, apenas dos casos enviados no mês vigente que continuam na Esteira Ágil; resposta recortada pela hierarquia.';
