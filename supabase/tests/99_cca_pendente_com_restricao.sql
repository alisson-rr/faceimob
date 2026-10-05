-- =============================================================================
-- 0225 — coluna PENDENTE C/ RESTRIÇÃO no quadro da CCA e INCOMPLETO liberado.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_col public.cca_stages;
  v_pend int;
begin
  select * into v_col from public.cca_stages where name = 'PENDENTE C/ RESTRIÇÃO';
  if v_col.id is null or not v_col.active or v_col.status <> 'pending_documents' then
    raise exception 'FALHOU: coluna PENDENTE C/ RESTRIÇÃO ausente ou com mecânica errada (%)', v_col;
  end if;
  if v_col.deal_status_id is distinct from (select id from public.deal_statuses
      where public.deal_status_bare(value) = 'PENDENTE C/ RESTRIÇÃO' order by active desc limit 1) then
    raise exception 'FALHOU: a coluna não grava o Status 2 PENDENTE C/ RESTRIÇÃO';
  end if;
  select position into v_pend from public.cca_stages where active and public.cca_stage_name_key(name) = 'PENDENTE' limit 1;
  if v_col.position <> v_pend + 1 then
    raise exception 'FALHOU: a coluna devia vir logo depois de PENDENTE (% vs %)', v_col.position, v_pend;
  end if;
  -- O seed de teste insere "Enviado à Construtora" depois das migrations, na
  -- posição 3; por isso a conferência é da ordem, não de posição única.
  if (select position from public.cca_stages where active and public.cca_stage_name_key(name) = 'RETORNO A ESTEIRA AGIL' limit 1)
     <= v_col.position then
    raise exception 'FALHOU: RETORNO À ESTEIRA ÁGIL devia vir depois da coluna nova';
  end if;
  raise notice '  ok  coluna PENDENTE C/ RESTRIÇÃO logo depois de PENDENTE, com pendência';

  if not exists (select 1 from public.deal_status_permissions p join public.deal_statuses s on s.id = p.status_id
                  where public.deal_status_bare(s.value) = 'INCOMPLETO' and p.role = 'cca' and p.can_enter and p.can_exit) then
    raise exception 'FALHOU: CCA não entra/sai de INCOMPLETO';
  end if;
  raise notice '  ok  CCA entra e sai de INCOMPLETO';
end;
$$;

rollback;
