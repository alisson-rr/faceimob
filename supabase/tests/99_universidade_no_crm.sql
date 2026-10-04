-- =============================================================================
-- 0221 — Universidade no CRM: visualização e conclusão com XP só na 1ª vez.
-- =============================================================================
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
  cor uuid := '00000000-0000-0000-0000-000002210001';
  v_sec uuid; v_aula uuid; v_off uuid;
  r jsonb;
  v_msg text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (cor, 'cor@u221.test', '{"full_name":"Corretor 221"}');
  insert into site.university_sections (title) values ('Seção 221') returning id into v_sec;
  insert into site.university_videos (section_id, title, video_url) values (v_sec, 'Aula 221', 'https://youtu.be/x') returning id into v_aula;
  insert into site.university_videos (section_id, title, active) values (v_sec, 'Oculta 221', false) returning id into v_off;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.ok(public.universidade_registrar_visualizacao(v_aula) = 1, 'conta a visualização');
  perform pg_temp.ok(public.universidade_registrar_visualizacao(v_off) = 0, 'aula oculta não conta');
  r := public.universidade_concluir_aula(v_aula);
  perform pg_temp.ok((r ->> 'primeira')::boolean and (r ->> 'experiencia')::int = 50 and (r ->> 'nivel')::int = 1,
    'primeira conclusão dá +50 XP (' || r::text || ')');
  r := public.universidade_concluir_aula(v_aula);
  perform pg_temp.ok(not (r ->> 'primeira')::boolean and (r ->> 'experiencia')::int = 50, 'concluir de novo não soma XP');
  perform pg_temp.ok((select count(*) from site.university_watched where user_id = cor and completed_at is not null) = 1,
    'o progresso fica com o corretor');
  begin
    perform public.universidade_concluir_aula(v_off);
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.ok(v_msg = 'Aula não encontrada.', 'aula oculta não conclui');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.universidade_concluir_aula(uuid)', 'execute'),
    'anon não conclui aula');
end;
$$;

rollback;
