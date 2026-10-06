-- =============================================================================
-- 0219 — o servidor do site grava a origem das fotos importadas.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'site' and table_name = 'property_images' and column_name = 'source_url')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'site' and table_name = 'lote_imagens' and column_name = 'source_url') then
    raise exception 'FALHOU: site.property_images/lote_imagens sem source_url';
  end if;
  raise notice '  ok  fotos de imóvel e de lote têm a coluna de origem';
end;
$$;

rollback;
