-- =============================================================================
-- 0211 — roleta nasce com 10 minutos para "Atender", cada uma com o seu prazo.
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
  g1 uuid; g2 uuid;
begin
  insert into public.distribution_groups (name, slug) values ('Roleta 211', 'roleta-211') returning id into g1;
  perform pg_temp.ok((select attend_timeout_seconds from public.distribution_groups where id = g1) = 600,
    'roleta nova nasce com 10 min');
  perform pg_temp.ok(public.effective_attend_timeout(g1) = 600, 'o prazo efetivo é o da roleta');

  insert into public.distribution_groups (name, slug, attend_timeout_seconds) values ('Roleta 211b', 'roleta-211b', 900)
  returning id into g2;
  perform pg_temp.ok(public.effective_attend_timeout(g2) = 900, 'cada roleta pode ter o seu prazo');
  -- Outros arquivos da bateria criam roleta com 300 s de propósito; o que a
  -- 0211 garante é o padrão das colunas.
  perform pg_temp.ok((select column_default from information_schema.columns
                       where table_schema = 'public' and table_name = 'automation_settings'
                         and column_name = 'attend_timeout_seconds') = '600',
    'o prazo geral também nasce com 10 min');
end;
$$;

rollback;
