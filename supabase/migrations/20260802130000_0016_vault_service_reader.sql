-- =============================================================================
-- 0016 — Porta de leitura do cofre para as edge functions
--
-- `private.get_integration_secret()` existe desde a 0011 e é inalcançável pelo
-- PostgREST: o schema `private` não está nos schemas expostos (não há `[api]
-- schemas` no config.toml, então vale o padrão `public, graphql_public`). Isso
-- é o desenho certo para o browser — e também impedia a edge function, que fala
-- com o banco pelo mesmo PostgREST, de ler o cofre.
--
-- Resultado: o cofre estava desconectado nas duas pontas. A tela resolve a
-- ponta da escrita; esta função resolve a da leitura, sem afrouxar nada — quem
-- tem a service role já tem acesso total ao banco, então expor a leitura só a
-- ela não aumenta a superfície.
--
-- Dupla trava, de propósito, por ser cofre:
--   1. `grant execute` só para service_role — anon/authenticated levam
--      permission denied do próprio Postgres;
--   2. checagem explícita de `auth.role()`, que sobrevive a alguém conceder
--      execute por engano numa migration futura.
-- =============================================================================

create or replace function public.get_integration_secret(p_provider text, p_label text)
returns text
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Somente a service role lê o cofre.' using errcode = '42501';
  end if;

  return private.get_integration_secret(p_provider, p_label);
end;
$$;

revoke all on function public.get_integration_secret(text, text) from public, anon, authenticated;
grant execute on function public.get_integration_secret(text, text) to service_role;

comment on function public.get_integration_secret(text, text) is
  'Leitura do cofre para edge functions. Exclusiva de service_role; nunca chamar do browser.';

-- -----------------------------------------------------------------------------
-- Item de menu da tela de integrações (mesmo mecanismo da 0015).
--
-- Sem concessão a nenhum papel: a tela é do admin, que passa por `is_admin()`.
-- Um papel só chega aqui se o próprio admin conceder — e ainda assim
-- `list_integrations()` e `set_integration_secret()` recusam quem não é admin,
-- então o menu liberado por engano não vaza credencial.
-- -----------------------------------------------------------------------------
insert into public.permissions (code, label, category, description) values
  ('menu.admin_integrations', 'Admin · Integrações', 'menu', 'Cofre de tokens de API')
on conflict (code) do nothing;
