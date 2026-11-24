-- 0360 — exportação 3C: só admin, período de/até, telefone sem 55 e sem repetição.
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000003600001';
  dir uuid := '00000000-0000-0000-0000-000003600002';
  v_novo uuid;
  v jsonb;
  v_ok boolean;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (adm,'adm@e360.test','{"full_name":"Admin 360"}'),
    (dir,'dir@e360.test','{"full_name":"Diretor 360"}');
  insert into public.user_roles(profile_id,role) values (adm,'admin'), (dir,'director') on conflict do nothing;

  insert into public.leads(full_name, phone, created_at) values
    ('Repetido Antigo 360', '5551988887777', '2021-02-01 12:00-03'),
    ('Fora do Periodo 360', '5551977776666', '2021-08-01 12:00-03');
  insert into public.leads(full_name, phone, created_at) values
    ('Repetido Novo 360', '5551988887777', '2021-03-01 12:00-03') returning id into v_novo;

  perform set_config('request.jwt.claims', json_build_object('sub', dir, 'role', 'authenticated')::text, true);
  begin
    perform public.exportacao_3c('2021-01-01', '2021-07-01');
    v_ok := true;
  exception when insufficient_privilege then v_ok := false;
  end;
  perform pg_temp.ok(not v_ok, 'diretor não exporta para a 3C');

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  v := public.exportacao_3c('2021-01-01', '2021-07-01');
  perform pg_temp.ok((select count(*) from jsonb_array_elements(v) e where e->>'nome' like '%360') = 1,
    'telefone repetido sai uma vez e o fora do período não entra');
  perform pg_temp.ok((select e->>'lead_id' from jsonb_array_elements(v) e where e->>'nome' like '%360') = v_novo::text,
    'fica o lead mais recente do número, com o lead_id');
  perform pg_temp.ok((select e->>'telefone' from jsonb_array_elements(v) e where e->>'nome' like '%360') = '51988887777',
    'telefone em DDD + número, sem o 55');
end
$$;

rollback;
