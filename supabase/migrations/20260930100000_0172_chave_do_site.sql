-- =============================================================================
-- 0172 — chave do servidor do site: só o schema `site`
--
-- Decisão do cliente em 30/09/2026: o servidor do site (Vercel) não recebe a
-- service role, que abre o banco inteiro, CRM incluído. Recebe um token com o
-- papel `site_server`, que:
--   · lê e grava todas as tabelas de `site` (policy explícita por tabela, sem
--     BYPASSRLS);
--   · lê e grava os objetos dos cinco buckets do site;
--   · não tem grant nenhum em `public`, `auth` nem nos outros buckets;
--   · para nome e e-mail de perfil do CRM (editores de documentos do suporte),
--     chama duas funções estreitas de `site`, em vez da API admin do Auth.
--
-- O token é assinado na VPS com o JWT_SECRET (deploy/README.md). O PostgREST
-- (`authenticator`) e o Storage (`supabase_storage_admin`) precisam poder
-- assumir o papel. Revogar: apagar o token da Vercel e trocar o JWT_SECRET, ou
-- `revoke site_server from authenticator`.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'site_server') then
    create role site_server nologin noinherit;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant site_server to authenticator;
  end if;
  if exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    grant site_server to supabase_storage_admin;
  end if;
end
$$;

grant usage on schema site to site_server;
grant select, insert, update, delete on all tables in schema site to site_server;
grant usage, select on all sequences in schema site to site_server;
grant execute on all functions in schema site to site_server;
alter default privileges in schema site grant select, insert, update, delete on tables to site_server;
alter default privileges in schema site grant usage, select on sequences to site_server;

-- Uma policy por tabela, para o papel ver tudo de `site` sem BYPASSRLS (que
-- valeria para o banco inteiro).
do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'site' and c.relkind in ('r', 'p')
  loop
    execute format('drop policy if exists "site_server: tudo" on site.%I', r.relname);
    execute format(
      'create policy "site_server: tudo" on site.%I for all to site_server using (true) with check (true)',
      r.relname);
  end loop;
end
$$;

-- Storage: só os buckets do site. O dono das tabelas de storage é o próprio
-- Storage; se o `postgres` da instalação não puder repassar o grant, o deploy
-- não cai por isso: fica o aviso, e o upload do site acusa na prévia.
do $$
begin
  grant usage on schema storage to site_server;
  grant select on storage.buckets to site_server;
  grant select, insert, update, delete on storage.objects to site_server;
exception when insufficient_privilege then
  raise warning '0172: sem permissão para dar acesso ao Storage a site_server: %', sqlerrm;
end
$$;

drop policy if exists "site_server: buckets do site" on storage.objects;
create policy "site_server: buckets do site" on storage.objects
  for all to site_server
  using (bucket_id in ('property-images', 'property-docs', 'campaign-images', 'blog-images', 'support-docs'))
  with check (bucket_id in ('property-images', 'property-docs', 'campaign-images', 'blog-images', 'support-docs'));

drop policy if exists "site_server: buckets do site" on storage.buckets;
create policy "site_server: buckets do site" on storage.buckets
  for select to site_server
  using (id in ('property-images', 'property-docs', 'campaign-images', 'blog-images', 'support-docs'));

-- -----------------------------------------------------------------------------
-- Perfis do CRM para o site: só id, nome e e-mail, só pelo servidor do site.
-- -----------------------------------------------------------------------------
create or replace function site.crm_perfis(p_ids uuid[])
returns table (id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.full_name, p.email
    from public.profiles p
   where p.id = any(p_ids);
$$;

create or replace function site.crm_perfil_por_email(p_email text)
returns table (id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.full_name, p.email
    from public.profiles p
   where lower(p.email) = lower(trim(p_email))
   limit 1;
$$;

revoke all on function site.crm_perfis(uuid[]) from public, anon, authenticated;
revoke all on function site.crm_perfil_por_email(text) from public, anon, authenticated;
grant execute on function site.crm_perfis(uuid[]) to site_server, service_role;
grant execute on function site.crm_perfil_por_email(text) to site_server, service_role;

comment on function site.crm_perfis(uuid[]) is
  'Nome e e-mail de perfis do CRM para o servidor do site (editores do suporte). Só site_server (0172).';
comment on function site.crm_perfil_por_email(text) is
  'Perfil do CRM pelo e-mail, para o servidor do site adicionar editor do suporte. Só site_server (0172).';
