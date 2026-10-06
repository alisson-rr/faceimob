-- =============================================================================
-- 0217 — os dados do e-mail trazem o último comentário do negócio.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000002170001';
  v_deal uuid;
  r jsonb;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (cor, 'cor@e217.test', '{"full_name":"Corretor 217"}');
  insert into public.deals (stage_id, created_by)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor) returning id into v_deal;
  insert into public.deal_history (deal_id, actor_id, kind, to_value, created_at) values
    (v_deal, cor, 'comment', 'primeiro', now() - interval '1 hour'),
    (v_deal, cor, 'comment', 'o mais novo', now());

  r := public.email_detalhes_do_negocio(v_deal);
  if r ->> 'ultimo_comentario' is distinct from 'o mais novo' or r ->> 'ultimo_comentario_autor' is distinct from 'Corretor 217' then
    raise exception 'FALHOU: último comentário no e-mail (%)', r;
  end if;
  raise notice '  ok  o e-mail recebe o último comentário e o autor';
end;
$$;

rollback;
