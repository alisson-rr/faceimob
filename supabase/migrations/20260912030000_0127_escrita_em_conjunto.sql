-- =============================================================================
-- 0127 — Policies `for all` que também filtram leitura, em conjunto
--
-- Policy `for all` vale para SELECT: o Postgres junta com OR a policy de
-- leitura e pode avaliar a função da escrita PRIMEIRO, linha a linha. Depois da
-- 0126, `deal_participants_write` (can_edit_deal por linha) ainda segurava cada
-- página de participantes do Pipeline em 8 s — no limite do statement_timeout.
--
-- Só o USING muda (é o que entra na leitura). O WITH CHECK das gravações fica
-- como está.
--
-- A REGRA NÃO MUDA. `can_edit_deal(d)` é `has_permission('cca.review')` OU um
-- participante de d que sou eu ou que `manages_profile` alcança. Quem não tem
-- `cca.review` não é admin (has_permission já inclui is_admin), então
-- `manages_profile(t)` se reduz a "t é membro aberto de equipe que eu lidero".
-- Conferido antes de aplicar, negócio a negócio (7.579), para admin, diretor,
-- gerente, corretor e CCA: nenhuma divergência.
-- =============================================================================

create or replace function public.auth_editable_deal_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct dp.deal_id
    from public.deal_participants dp
   where dp.profile_id = auth.uid()
      or dp.profile_id in (
        select tm.profile_id
          from public.team_members tm
         where tm.left_at is null
           and tm.team_id in (select public.auth_led_team_ids()));
$$;

comment on function public.auth_editable_deal_ids() is
  'Negócios que o usuário edita por participante (a metade por conjunto de can_edit_deal para quem não tem cca.review). Para a policy deal_participants_write rodar uma vez por consulta (0127).';

revoke all on function public.auth_editable_deal_ids() from public, anon;
grant execute on function public.auth_editable_deal_ids() to authenticated, service_role;

alter policy deal_participants_write on public.deal_participants
  using ((select public.has_permission('cca.review'))
      or deal_id in (select public.auth_editable_deal_ids()));

alter policy cca_cases_write on public.cca_cases
  using ((select public.has_permission('cca.review')));

alter policy import_bubble_map_admin on public.import_bubble_map
  using ((select public.is_admin()));
