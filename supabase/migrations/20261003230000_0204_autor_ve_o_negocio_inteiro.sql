-- =============================================================================
-- 0204 — quem criou o negócio vê o negócio inteiro
--
-- Reclamação de 03/10/2026: uma corretora via no Pipeline um negócio "sem
-- nome" (Cliente não informado, sem corretor). `deals_select` deixa o AUTOR ver
-- o negócio (`created_by`), mas cliente, participantes, documentos e histórico
-- usam `auth_visible_deal_ids()`, que só olhava participação. Quem cadastrou o
-- negócio para outro corretor via o cartão e nada dentro dele.
--
-- A regra passa a valer igual nas duas pontas: `auth_visible_deal_ids()`
-- inclui os negócios que a pessoa criou. Um lugar só, e todas as policies que
-- já a usam (clientes, participantes, documentos, histórico, CCA, envios)
-- acompanham.
-- =============================================================================

create or replace function public.auth_visible_deal_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select dp.deal_id
    from public.deal_participants dp
   where dp.profile_id in (select public.auth_visible_profiles())
  union
  select d.id from public.deals d where d.created_by = auth.uid();
$$;

comment on function public.auth_visible_deal_ids() is
  'Negócios que o usuário enxerga por participante ou por ter criado — a metade por conjunto de can_see_deal. Usada nas policies para a regra rodar uma vez por consulta (0126, 0204).';

create index if not exists deals_created_by_idx on public.deals (created_by);
