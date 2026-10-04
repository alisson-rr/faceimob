-- =============================================================================
-- 0215 — "Análise externa" sem passar pela análise do gerente
--
-- Pedido de 04/10/2026: "análise externa: libere da análise do gerente". Até
-- aqui só a CCA colocava um negócio em ANÁLISE EXTERNA (semente da 0164), então
-- a equipe precisava mandar para a esteira — a conferência do gerente — para
-- chegar lá. A análise externa é feita fora da casa; a conferência do gerente
-- serve à esteira do CCA próprio. Agora corretor, gerente e diretor colocam o
-- negócio em ANÁLISE EXTERNA direto. Quem tira continua como estava.
--
-- É linha da matriz do Status 2: o admin segue podendo mudar em Pipeline →
-- Status 2 → Permissões.
-- =============================================================================

insert into public.deal_status_permissions (status_id, role, can_enter, can_exit)
select s.id, r.role, true, false
  from public.deal_statuses s
 cross join (values ('broker'::public.app_role), ('manager'), ('director')) as r(role)
 where public.deal_status_bare(s.value) = 'ANÁLISE EXTERNA'
on conflict (status_id, role) do update
   set can_enter = true, updated_at = now();
