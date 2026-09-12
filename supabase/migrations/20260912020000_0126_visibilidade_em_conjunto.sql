-- =============================================================================
-- 0126 — Visibilidade de negócio e de lead calculada uma vez por consulta
--
-- Depois da carga do Bubble (12/09/2026: 7.579 negócios, 20.737 participantes,
-- 102.799 leads) o Pipeline e o Dashboard pararam de abrir: o PostgREST
-- cancelava por statement_timeout (8 s). A causa são as policies de SELECT que
-- chamam função por LINHA. `can_see_deal(deal_id)` consulta os papéis e remonta
-- `auth_visible_profiles()` a cada linha: 1 s por página de 1.000 negócios para
-- admin, 13 s para CCA, 3,9 s por página em `deal_participant_names()`.
--
-- A REGRA NÃO MUDA. `can_see_deal(d)` é `can_read_all() OR existe participante
-- de d em auth_visible_profiles()`. Aqui a mesma regra vira conjunto:
--   (select can_read_all())                        → InitPlan, uma vez
--   deal_id in (select auth_visible_deal_ids())    → subplano com hash, uma vez
-- Conferido antes de aplicar, comparando a lista visível pela expressão antiga
-- e pela nova para diretor, gerente, corretor, CCA, sócio, admin, suspenso e
-- quem não tem negócio: nenhuma divergência; negócios de 1,6–13 s para 11 ms.
--
-- `can_see_deal` continua para quem pergunta por UM negócio (add_deal_comment,
-- policy de storage). Toda visibilidade continua saindo de
-- auth_visible_profiles() — a função nova só a transforma em conjunto.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Conjuntos (SECURITY DEFINER, como as funções que substituem por linha: leem
--    deal_participants e sdr_conversations sem passar pela RLS delas, senão a
--    policy de deal_participants se chamaria em recursão)
-- -----------------------------------------------------------------------------
create or replace function public.auth_visible_deal_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct dp.deal_id
    from public.deal_participants dp
   where dp.profile_id in (select public.auth_visible_profiles());
$$;

comment on function public.auth_visible_deal_ids() is
  'Negócios que o usuário enxerga por participante — a metade por conjunto de can_see_deal. Usada nas policies para a regra rodar uma vez por consulta (0126).';

revoke all on function public.auth_visible_deal_ids() from public, anon;
grant execute on function public.auth_visible_deal_ids() to authenticated, service_role;

create or replace function public.sdr_conversation_lead_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.lead_id from public.sdr_conversations c where c.lead_id is not null;
$$;

comment on function public.sdr_conversation_lead_ids() is
  'Leads com conversa de SDR — a versão por conjunto de lead_in_sdr_conversation(id), para a policy leads_select_sdr (0126).';

revoke all on function public.sdr_conversation_lead_ids() from public, anon;
grant execute on function public.sdr_conversation_lead_ids() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Policies de SELECT: mesma regra, papel avaliado uma vez
-- -----------------------------------------------------------------------------
alter policy deals_select on public.deals
  using (created_by = (select auth.uid())
      or (select public.can_read_all())
      or (select public.has_role('cca'))
      or id in (select public.auth_visible_deal_ids()));

alter policy deal_participants_select on public.deal_participants
  using ((select public.can_read_all())
      or (select public.has_role('cca'))
      or deal_id in (select public.auth_visible_deal_ids()));

alter policy deal_clients_select on public.deal_clients
  using ((select public.can_read_all())
      or (select public.has_role('cca'))
      or deal_id in (select public.auth_visible_deal_ids()));

alter policy deal_documents_select on public.deal_documents
  using ((select public.can_read_all())
      or (select public.has_role('cca'))
      or deal_id in (select public.auth_visible_deal_ids()));

alter policy deal_history_select on public.deal_history
  using ((select public.can_read_all())
      or (select public.has_role('cca'))
      or deal_id in (select public.auth_visible_deal_ids()));

alter policy cca_cases_select on public.cca_cases
  using ((select public.has_any_role('admin', 'cca'))
      or (select public.can_read_all())
      or deal_id in (select public.auth_visible_deal_ids()));

alter policy developer_submissions_select on public.developer_submissions
  using ((select public.has_any_role('admin', 'cca'))
      or (select public.can_read_all())
      or deal_id in (select public.auth_visible_deal_ids()));

alter policy visits_select on public.visits
  using (broker_id in (select public.auth_visible_profiles())
      or (deal_id is not null
          and ((select public.can_read_all())
               or (select public.has_role('cca'))
               or deal_id in (select public.auth_visible_deal_ids()))));

alter policy leads_select on public.leads
  using (assigned_to in (select public.auth_visible_profiles())
      or (assigned_to is null and (select public.has_permission('leads.view_queue'))));

alter policy leads_select_sdr on public.leads
  using ((select public.has_any_role('admin', 'sdr', 'marketing'))
      and id in (select public.sdr_conversation_lead_ids()));

-- -----------------------------------------------------------------------------
-- 3. Nomes dos participantes: a tela pagina esta RPC; cada página recalculava
--    can_see_deal nas 20 mil linhas. `create or replace` mantém os grants.
-- -----------------------------------------------------------------------------
create or replace function public.deal_participant_names()
returns table(deal_id uuid, profile_id uuid, full_name text, role text, ordinal integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select dp.deal_id, dp.profile_id, p.full_name, dp.role, dp.ordinal
  from public.deal_participants dp
  join public.profiles p on p.id = dp.profile_id
  where auth.uid() is not null
    and ((select public.can_read_all())
         or (select public.has_role('cca'))
         or dp.deal_id in (select public.auth_visible_deal_ids()))
  order by dp.deal_id, dp.role, dp.ordinal;
$$;

-- -----------------------------------------------------------------------------
-- 4. A ordem em que o Pipeline pagina (listLegacyDeals): sem índice, cada página
--    ordenava a tabela inteira em disco.
-- -----------------------------------------------------------------------------
create index if not exists deals_created_at_id_idx
  on public.deals (created_at desc, id);

create index if not exists deal_participants_ordem_idx
  on public.deal_participants (ordinal, created_at, id);
