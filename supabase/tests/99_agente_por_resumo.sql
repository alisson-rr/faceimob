-- 0261 — agente guarda resumo e respostas a coletar; conversa guarda o coletado.
\set ON_ERROR_STOP on
begin;
do $$
declare
  v_agent uuid;
begin
  insert into public.sdr_agents (name, system_prompt, brief, collect_fields)
    values ('Agente 261', 'p', 'Entrevista candidatos', array['Nome', 'CRECI']) returning id into v_agent;
  if (select collect_fields from public.sdr_agents where id = v_agent) <> array['Nome', 'CRECI'] then
    raise exception 'FALHOU: respostas a coletar não ficaram no agente';
  end if;
  raise notice '  ok  agente guarda resumo e respostas a coletar';

  begin
    update public.sdr_agents set collect_fields = array_fill('x'::text, array[31]) where id = v_agent;
    raise exception 'FALHOU: mais de 30 respostas devia ser recusado';
  exception when check_violation then
    raise notice '  ok  mais de 30 respostas é recusado';
  end;
end;
$$;
rollback;
