\echo 'acesso do CCA ao formulário de análise'

do $$
begin
  if not exists (
    select 1
    from public.role_permissions
    where role = 'cca'
      and permission = 'menu.pipeline'
      and allowed
  ) then
    raise exception 'FALHOU: papel CCA continua bloqueado fora do formulário de análise';
  end if;
end
$$;

\echo 'acesso do CCA ao formulário de análise ok'
