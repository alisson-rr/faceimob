-- =============================================================================
-- 0204 — quem criou o negócio e não participa dele não o vê mais
--
-- Reclamação de 03/10/2026: uma corretora via no Pipeline um negócio "sem
-- nome" (cliente e corretor escondidos). Ela o havia criado, mas o negócio já
-- era de outro corretor: `deals_select` mostrava o cartão a quem criou
-- (`created_by`), e o resto (clientes, participantes) seguia a participação.
--
-- Regra do cliente: o negócio é de quem participa dele — corretor 1, ou
-- corretor 2 ou 3 dividindo a venda. Quem criou e não participa (o negócio foi
-- retomado por outro corretor depois de um OFF, ou foi cadastrado para outro)
-- não vê mais. A autoria continua valendo só no instante da criação, enquanto
-- o negócio ainda não tem corretor: é ela que deixa o `insert … returning` do
-- cadastro ler a linha recém-criada antes de os participantes entrarem.
-- =============================================================================

-- Negócios criados por quem pergunta que já têm corretor: para a autoria
-- deixar de valer. Avaliada uma vez por consulta (initPlan), como as da 0126.
create or replace function public.auth_criados_com_corretor()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct d.id
    from public.deals d
    join public.deal_participants dp on dp.deal_id = d.id and dp.role = 'broker'
   where d.created_by = auth.uid();
$$;

revoke all on function public.auth_criados_com_corretor() from public, anon;
grant execute on function public.auth_criados_com_corretor() to authenticated, service_role;
comment on function public.auth_criados_com_corretor() is
  'Negócios criados pelo usuário que já têm corretor: a autoria deixa de dar visibilidade (0204).';

alter policy deals_select on public.deals
  using ((created_by = (select auth.uid()) and id not in (select public.auth_criados_com_corretor()))
      or (select public.can_read_all())
      or (select public.has_role('cca'))
      or id in (select public.auth_visible_deal_ids()));

create index if not exists deals_created_by_idx on public.deals (created_by);
