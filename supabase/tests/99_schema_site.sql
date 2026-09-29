-- =============================================================================
-- 0169 — schema `site`: o papel do site sai do CRM.
--
-- admin do site = admin ou sócio ATIVO do CRM; corretor = qualquer perfil
-- ATIVO. Inativar no CRM fecha a área de membros. O público anônimo continua
-- lendo imóvel ativo e mandando lead, e não lê os leads.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.como(p_uid uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000016901', 'ana@v0169.test',  '{"full_name":"Ana Admin 0169"}'),
  ('00000000-0000-0000-0000-000000016902', 'sol@v0169.test',  '{"full_name":"Sol Sócia 0169"}'),
  ('00000000-0000-0000-0000-000000016903', 'caio@v0169.test', '{"full_name":"Caio Corretor 0169"}'),
  ('00000000-0000-0000-0000-000000016904', 'ina@v0169.test',  '{"full_name":"Ina Inativa 0169"}')
on conflict do nothing;
insert into public.user_roles (profile_id, role) values
  ('00000000-0000-0000-0000-000000016901', 'admin'),
  ('00000000-0000-0000-0000-000000016902', 'partner'),
  ('00000000-0000-0000-0000-000000016904', 'admin')
on conflict do nothing;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.profiles set status = 'suspended' where id = '00000000-0000-0000-0000-000000016904';

do $$
begin
  if not site.has_role('00000000-0000-0000-0000-000000016901', 'admin') then raise exception 'FALHOU: admin do CRM não é admin do site'; end if;
  if not site.has_role('00000000-0000-0000-0000-000000016902', 'admin') then raise exception 'FALHOU: sócio do CRM não é admin do site'; end if;
  if site.has_role('00000000-0000-0000-0000-000000016903', 'admin') then raise exception 'FALHOU: corretor virou admin do site'; end if;
  if not site.has_role('00000000-0000-0000-0000-000000016903', 'corretor') then raise exception 'FALHOU: corretor ativo sem área de membros'; end if;
  if site.has_role('00000000-0000-0000-0000-000000016904', 'corretor')
     or site.has_role('00000000-0000-0000-0000-000000016904', 'admin') then
    raise exception 'FALHOU: perfil inativo segue com acesso ao site';
  end if;
  raise notice '  ok  papel do site vem do CRM e inativar fecha o acesso';
end
$$;

insert into site.properties (code, slug, title, city, active)
values ('T0169', 'imovel-0169', 'Imóvel 0169', 'Porto Alegre', true);

-- Anônimo: lê imóvel ativo e manda lead, mas não lê lead.
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  if not exists (select 1 from site.properties where slug = 'imovel-0169') then
    raise exception 'FALHOU: anônimo não lê imóvel ativo';
  end if;
  insert into site.leads (name, phone, message) values ('Visitante', '51999990000', 'Quero saber mais');
  begin
    perform 1 from site.leads;
    raise exception 'FALHOU: anônimo leu leads';
  exception when insufficient_privilege then null;
  end;
  raise notice '  ok  anônimo lê imóvel e manda lead, sem ler leads';
end
$$;
reset role;

-- Corretor lê os links da área de membros; só admin lê os leads do site.
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-000000016903');
do $$
begin
  if exists (select 1 from site.leads) then raise exception 'FALHOU: corretor leu leads do site'; end if;
  raise notice '  ok  corretor não lê leads do site';
end
$$;
select pg_temp.como('00000000-0000-0000-0000-000000016901');
do $$
begin
  if not exists (select 1 from site.leads where name = 'Visitante') then raise exception 'FALHOU: admin não lê leads do site'; end if;
  raise notice '  ok  admin lê leads do site';
end
$$;

reset role;

-- Importação: só a service role; repetir não duplica; usuário vira o do CRM.
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-000000016901');
do $$
begin
  perform public.site_import_linhas('posts', '[]'::jsonb);
  raise exception 'FALHOU: admin logado importou sem ser service role';
exception when insufficient_privilege then
  raise notice '  ok  importação só pela service role';
end
$$;
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare
  r jsonb;
  v_sec uuid := gen_random_uuid();
  v_vid uuid := gen_random_uuid();
begin
  r := public.site_import_usuarios(jsonb_build_array(
    jsonb_build_object('id', '10000000-0000-0000-0000-000000016903', 'email', 'CAIO@v0169.test', 'full_name', 'Caio', 'papeis', array['corretor']),
    jsonb_build_object('id', '10000000-0000-0000-0000-000000016999', 'email', 'sem.par@v0169.test', 'full_name', 'Sem Par', 'papeis', array['corretor'])));
  if (r->>'sem_par')::int < 1 then raise exception 'FALHOU: usuário sem par não foi contado: %', r; end if;

  r := public.site_import_linhas('university_sections', jsonb_build_array(jsonb_build_object('id', v_sec, 'title', 'Seção 0169')));
  r := public.site_import_linhas('university_videos', jsonb_build_array(jsonb_build_object('id', v_vid, 'section_id', v_sec, 'title', 'Vídeo 0169', 'youtube_url', 'https://youtu.be/x')));
  r := public.site_import_linhas('university_watched', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'video_id', v_vid, 'user_id', '10000000-0000-0000-0000-000000016903'),
    jsonb_build_object('id', gen_random_uuid(), 'video_id', v_vid, 'user_id', '10000000-0000-0000-0000-000000016999')));
  if (r->>'gravadas')::int <> 1 or (r->>'sem_usuario')::int <> 1 then raise exception 'FALHOU: troca de usuário: %', r; end if;
  if not exists (select 1 from site.university_watched where user_id = '00000000-0000-0000-0000-000000016903') then
    raise exception 'FALHOU: progresso não ficou no perfil do CRM';
  end if;

  -- Repetir a mesma página não duplica e mantém o updated_at da origem.
  r := public.site_import_linhas('posts', jsonb_build_array(jsonb_build_object(
    'id', '20000000-0000-0000-0000-000000016901', 'slug', 'post-0169', 'title', 'Post', 'updated_at', '2026-01-01T00:00:00Z')));
  r := public.site_import_linhas('posts', jsonb_build_array(jsonb_build_object(
    'id', '20000000-0000-0000-0000-000000016901', 'slug', 'post-0169', 'title', 'Post revisto', 'updated_at', '2026-01-01T00:00:00Z')));
  if (select count(*) from site.posts where slug = 'post-0169') <> 1 then raise exception 'FALHOU: reimportar duplicou'; end if;
  if (select title from site.posts where slug = 'post-0169') <> 'Post revisto' then raise exception 'FALHOU: reimportar não atualizou'; end if;
  if (select updated_at from site.posts where slug = 'post-0169') <> '2026-01-01T00:00:00Z' then
    raise exception 'FALHOU: updated_at da origem trocado pelo gatilho';
  end if;

  begin
    perform public.site_import_linhas('mapa_usuarios', '[]'::jsonb);
    raise exception 'FALHOU: tabela fora da lista aceita';
  exception when sqlstate 'P0001' then null;
  end;
  raise notice '  ok  importação idempotente, troca o usuário e conta quem ficou sem par';
end
$$;

-- A ordem da cópia respeita as chaves estrangeiras entre as tabelas do site.
do $$
declare
  v_ordem text[] := public.site_import_tabelas();
  r record;
begin
  for r in
    select cl.relname as filha, pl.relname as pai
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_class pl on pl.oid = c.confrelid
      join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'site'
      join pg_namespace pn on pn.oid = pl.relnamespace and pn.nspname = 'site'
     where c.contype = 'f' and cl.relname <> pl.relname
  loop
    if array_position(v_ordem, r.pai) is not null and array_position(v_ordem, r.filha) is not null
       and array_position(v_ordem, r.pai) > array_position(v_ordem, r.filha) then
      raise exception 'FALHOU: % é copiada antes de %, de quem depende', r.filha, r.pai;
    end if;
  end loop;
  raise notice '  ok  ordem da cópia respeita as chaves estrangeiras';
end
$$;

rollback;
