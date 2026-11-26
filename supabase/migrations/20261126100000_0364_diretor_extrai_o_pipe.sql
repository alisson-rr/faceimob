-- =============================================================================
-- 0364 · Diretor extrai o próprio Pipeline em Excel (pedido de 26/11/2026)
--
-- A 0185 travou a planilha do Pipeline (`pipeline.export`) em admin e sócio.
-- Agora o diretor também extrai, no mesmo formato. Continua sendo o "pipe
-- dele": a planilha é montada no navegador com os negócios que o RLS entrega,
-- e o diretor só enxerga a própria hierarquia (`can_see_deal`, 0141).
-- Gerente e corretor seguem sem a planilha.
-- =============================================================================

alter table public.role_permissions
  drop constraint if exists role_permissions_exportacao_so_admin;
alter table public.role_permissions
  add constraint role_permissions_exportacao_so_admin
  check (not (permission = 'pipeline.export' and allowed and role not in ('admin', 'partner', 'director')));

insert into public.role_permissions (role, permission, allowed)
values ('director', 'pipeline.export', true)
on conflict (role, permission) do update set allowed = excluded.allowed;
