-- =============================================================================
-- 0196 — aniversariante do dia (sem expor data), parabéns uma vez por dia e a
-- contagem de conferências do gerente.
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
  ani uuid := '00000000-0000-0000-0000-000001960001';
  out_ uuid := '00000000-0000-0000-0000-000001960002';
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (ani,'ani@a196.test','{"full_name":"Bruna Aniversário"}'),
    (out_,'out@a196.test','{"full_name":"Carlos Outro"}');
  update public.profiles set birth_date = (public.current_work_date() - interval '30 years')::date, nickname = 'Bru' where id = ani;
  update public.profiles set birth_date = (public.current_work_date() - interval '30 years' + interval '1 day')::date where id = out_;

  perform set_config('request.jwt.claims', json_build_object('sub', out_, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.ok((select count(*) from public.aniversariantes_de_hoje() where profile_id = ani) = 1, 'a equipe vê quem faz aniversário hoje');
  perform pg_temp.ok((select count(*) from public.aniversariantes_de_hoje() where profile_id = out_) = 0, 'quem não faz aniversário hoje não aparece');
  perform pg_temp.ok((select nome from public.aniversariantes_de_hoje() where profile_id = ani) = 'Bru', 'aparece o apelido');
  perform pg_temp.ok(public.minhas_conferencias_pendentes() = 0, 'gerente sem conferência pendente vê zero');
  reset role;

  perform public.parabenizar_aniversariantes();
  perform public.parabenizar_aniversariantes();
  perform pg_temp.ok((select count(*) from public.notifications where profile_id = ani and kind = 'aniversario') = 2,
    'parabéns no sino e no WhatsApp, uma vez só no dia');
  perform pg_temp.ok((select count(*) from public.notifications where profile_id = out_ and kind = 'aniversario') = 0,
    'quem não faz aniversário não recebe');
end;
$$;

rollback;
