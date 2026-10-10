-- 0258 — RG e CNH num documento só, obrigatório; CNH fora do catálogo.
\set ON_ERROR_STOP on
begin;
do $$
begin
  if not exists (select 1 from public.document_types
                  where code = 'rg_cpf' and label = 'RG / CNH' and required_for_conversion and allows_multiple and active) then
    raise exception 'FALHOU: RG / CNH devia ser obrigatório e aceitar vários arquivos';
  end if;
  if exists (select 1 from public.document_types where code = 'cnh' and active) then
    raise exception 'FALHOU: CNH devia sair do catálogo';
  end if;
  raise notice '  ok  RG / CNH obrigatório e CNH inativo';
end;
$$;
rollback;
