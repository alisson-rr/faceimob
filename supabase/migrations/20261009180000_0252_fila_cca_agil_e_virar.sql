-- =============================================================================
-- 0252 · Fila do CCA: Esteira Ágil e Análise p/ virar negócio, cada uma na sua
--
-- Pedido de 09/10/2026: "verifique se a fila de esteira ágil e análise para
-- virar negócio está correta, sem alteração na fila ao chegar". A 0239 só
-- calculava a fila da Esteira Ágil: quem estava em ANÁLISE P/ VIRAR NEGÓCIO não
-- via posição nenhuma. Agora são duas filas independentes, cada uma em ordem de
-- chegada (`submitted_at`, desempate pelo id do caso). Chegar à fila de virar
-- não mexe na posição de ninguém da Esteira Ágil, e vice-versa; quem chega
-- entra no fim da sua fila. O recorte do mês vigente e a visibilidade pela
-- hierarquia continuam os da 0239.
-- =============================================================================

drop function if exists public.my_cca_queue_position();
create or replace function public.my_cca_queue_position()
returns table(deal_id uuid, deal_code text, client_name text,
              queue_position integer, submitted_at timestamptz, fila text)
language sql stable security definer set search_path = public, pg_temp
as $$
select r.deal_id, d.code,
       coalesce(dc.full_name, d.code, 'Cliente não informado'),
       r.position::integer, r.submitted_at, r.fila
from (
  select c.deal_id, c.submitted_at, f.fila,
         row_number() over (partition by f.fila order by c.submitted_at asc nulls last, c.id) as position
    from public.cca_cases c
    join public.deals d on d.id = c.deal_id
    cross join lateral (
      select case public.cca_stage_name_key(d.status_detail)
               when 'ESTEIRA AGIL' then 'agil'
               when 'ANALISE P/ VIRAR NEGOCIO' then 'virar'
             end as fila
    ) f
   where c.status not in ('approved', 'rejected', 'cancelled')
     and f.fila is not null
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
order by r.fila, r.position;
$$;
revoke all on function public.my_cca_queue_position() from public, anon;
grant execute on function public.my_cca_queue_position() to authenticated;
comment on function public.my_cca_queue_position() is
'Posição por chegada em duas filas independentes (agil = Esteira Ágil, virar = Análise p/ virar negócio), só casos enviados no mês vigente; resposta recortada pela hierarquia (0252).';
