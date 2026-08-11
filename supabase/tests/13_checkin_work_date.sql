\echo 'data operacional do check-in'

do $$
begin
  if public.current_work_date() is distinct from current_date then
    raise exception 'FALHOU: current_work_date divergiu da data usada por checkins';
  end if;

  if not has_function_privilege('authenticated', 'public.current_work_date()', 'execute') then
    raise exception 'FALHOU: frontend não consegue consultar current_work_date';
  end if;

  if has_function_privilege('anon', 'public.current_work_date()', 'execute') then
    raise exception 'FALHOU: current_work_date ficou exposta para anon';
  end if;
end
$$;

\echo 'data operacional do check-in ok'
