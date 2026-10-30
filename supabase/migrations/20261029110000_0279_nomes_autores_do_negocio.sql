-- 0279 — nomes de autores sem liberar a ficha de profiles.
-- CCA não é participante comercial. A RPC anterior não nomeava seus eventos.
create or replace function public.deal_actor_names(p_deal_id uuid)
returns table(profile_id uuid, full_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.full_name
  from public.profiles p
  join (
    select dp.profile_id from public.deal_participants dp where dp.deal_id = p_deal_id
    union
    select h.actor_id from public.deal_history h where h.deal_id = p_deal_id
    union
    select e.actor_id from public.cca_case_events e
    join public.cca_cases c on c.id = e.case_id where c.deal_id = p_deal_id
  ) authors on authors.profile_id = p.id
  where auth.uid() is not null
    and (public.can_see_deal(p_deal_id) or public.has_role('cca'));
$$;

revoke all on function public.deal_actor_names(uuid) from public, anon;
grant execute on function public.deal_actor_names(uuid) to authenticated;

comment on function public.deal_actor_names(uuid) is
  'Somente id e nome de participantes e autores reais do negócio visível (can_see_deal ou CCA, como deal_history_select). Não amplia profiles_select nem aceita ids de pessoas.';

notify pgrst, 'reload schema';
