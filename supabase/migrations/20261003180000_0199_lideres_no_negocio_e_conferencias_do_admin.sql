-- =============================================================================
-- 0199 — corretor vê gerente e diretor no negócio; admin sabe o que conferir
--
-- Pedido do cliente em 03/10/2026:
--   1. "Ao preencher proposta a sugestão de gerente e diretor não aparece":
--      a RLS de `profiles` entrega ao corretor só o próprio perfil, então os
--      campos Gerente e Diretor abriam vazios. `selectable_leaders()` devolve
--      id e nome de gerente e diretor ativos, e `lideranca_dos_corretores()` o
--      gerente e o diretor da equipe de cada corretor — a mesma regra do
--      gatilho `deal_participants_autofill` (filiação mais recente). Só ids e
--      nomes, o mesmo padrão de `selectable_brokers()` (0076).
--   2. "Aprovar a doc sendo admin caso o gerente esteja indisponível": o banco
--      já aceita (`review_deal_documents` libera is_admin). O que faltava era o
--      admin saber: o popup de entrada (0196) passa a contar para ele TODA
--      conferência pendente, com o atalho para o Pipeline filtrado.
-- =============================================================================

create or replace function public.selectable_leaders()
returns table (id uuid, full_name text, is_manager boolean, is_director boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id,
         p.full_name,
         exists (select 1 from public.user_roles ur where ur.profile_id = p.id and ur.role = 'manager'),
         exists (select 1 from public.user_roles ur where ur.profile_id = p.id and ur.role = 'director')
    from public.profiles p
   where (public.is_admin()
          or public.auth_effective_role(auth.uid()) = any (array['director', 'manager', 'broker', 'cca']::app_role[]))
     and p.status = 'active'
     and exists (select 1 from public.user_roles ur
                  where ur.profile_id = p.id and ur.role in ('manager', 'director'))
   order by p.full_name;
$$;

revoke all on function public.selectable_leaders() from public, anon;
grant execute on function public.selectable_leaders() to authenticated;
comment on function public.selectable_leaders() is
  'Gerentes e diretores ativos (só id, nome e papel) para os campos do negócio: o corretor não os enxerga pela RLS de profiles (0199).';

create or replace function public.lideranca_dos_corretores()
returns table (broker_id uuid, manager_id uuid, director_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct on (tm.profile_id) tm.profile_id, t.manager_id, t.director_id
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    join public.profiles p on p.id = tm.profile_id and p.status = 'active'
   where tm.left_at is null
     and (public.is_admin()
          or public.auth_effective_role(auth.uid()) = any (array['director', 'manager', 'broker', 'cca']::app_role[]))
   -- A filiação mais recente ganha: a mesma ordem de deal_participants_autofill.
   order by tm.profile_id, tm.joined_at desc nulls last, tm.created_at desc, tm.id desc;
$$;

revoke all on function public.lideranca_dos_corretores() from public, anon;
grant execute on function public.lideranca_dos_corretores() to authenticated;
comment on function public.lideranca_dos_corretores() is
  'Gerente e diretor da equipe de cada corretor ativo (só ids), para sugerir no negócio a quem não enxerga a equipe (0199).';


-- O popup de entrada do gerente (0196) conta, para o admin, toda conferência
-- pendente: é quem aprova quando o gerente está indisponível.
create or replace function public.minhas_conferencias_pendentes()
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
    from public.deals d
   where auth.uid() is not null
     and d.document_review_status = 'pending'
     and (public.is_admin()
          or exists (select 1 from public.deal_participants dp
                      where dp.deal_id = d.id and dp.role = 'manager' and dp.profile_id = auth.uid()));
$$;

revoke all on function public.minhas_conferencias_pendentes() from public, anon;
grant execute on function public.minhas_conferencias_pendentes() to authenticated;
comment on function public.minhas_conferencias_pendentes() is
  'Negócios em conferência documental (pending) em que quem pergunta é o gerente; para o admin, todos — ele aprova quando o gerente está indisponível (0196, 0199).';
