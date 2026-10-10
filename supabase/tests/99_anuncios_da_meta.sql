-- 0265 — anúncios da Meta: todo autenticado lê; ninguém do app escreve; a
-- sincronização sabe quais anúncios de leads ainda faltam.
\set ON_ERROR_STOP on
begin;
do $$
declare
  cor uuid := '00000000-0000-0000-0000-000002650001';
  v_n int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (cor, 'cor@a265.test', '{"full_name":"Corretor 265"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker') on conflict do nothing;
  insert into public.meta_anuncios (ad_id, nome, campanha_nome, ativo, copy) values ('265001', 'Motoboy', 'Motoboy', true, 'A CAIXA FORMALIZOU');
  insert into public.leads (full_name, phone, status, ad_id) values
    ('Lead 265 a', '51900265001', 'queued', '265001'),
    ('Lead 265 b', '51900265002', 'queued', '265002');

  if (select count(*) from public.meta_anuncios_faltando(50) f where f = '265002') <> 1
     or exists (select 1 from public.meta_anuncios_faltando(50) f where f = '265001') then
    raise exception 'FALHOU: só o anúncio ainda não buscado devia faltar';
  end if;
  raise notice '  ok  sincronização sabe qual anúncio de lead falta';

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.meta_anuncios where ad_id = '265001';
  begin
    insert into public.meta_anuncios (ad_id) values ('265003');
    raise exception 'FALHOU: corretor não pode gravar anúncio';
  exception when insufficient_privilege then
    null;
  end;
  reset role;
  if v_n <> 1 then raise exception 'FALHOU: corretor devia ler o anúncio'; end if;
  raise notice '  ok  corretor lê e não grava anúncio';
end;
$$;
rollback;
