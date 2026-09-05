\set ON_ERROR_STOP on

-- =============================================================================
-- 19 · SDR: modelo padrão (0040) e o que a RLS deixa cada papel escrever.
--
-- A tela do SDR esconde os controles de escrita para quem a policy recusa
-- (director/manager/partner só leem). Este arquivo prova o contrato que a tela
-- espelha: UPDATE/DELETE barrado pelo `using` casa ZERO linhas e não levanta
-- erro — por isso o front pede `.select("id")` e trata vazio como recusa.
-- =============================================================================

create or replace function pg_temp.check19(cond boolean, label text)
returns void
language plpgsql
as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FALHOU: %', label;
  end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  sdr_id      uuid := '00000000-0000-0000-0000-00000000f401';
  director_id uuid := '00000000-0000-0000-0000-00000000f402';
  agent_id    uuid;
  source_id   uuid;
  list_id     uuid;
  n           int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (sdr_id,      'sdr@t19.test',      '{"full_name":"SDR T19"}'),
    (director_id, 'director@t19.test', '{"full_name":"Diretor T19"}')
  on conflict do nothing;
  insert into public.user_roles (profile_id, role) values
    (sdr_id, 'sdr'), (director_id, 'director')
  on conflict do nothing;

  -- 0040: agente sem modelo nasce com o default que a OpenAI conhece.
  insert into public.sdr_agents (name, role) values ('Agente T19', 'qualifier')
  returning id into agent_id;
  perform pg_temp.check19(
    (select model from public.sdr_agents where id = agent_id) = 'gpt-4o-mini',
    'default de sdr_agents.model é gpt-4o-mini');
  perform pg_temp.check19(
    not exists (select 1 from public.sdr_agents where model = 'claude-sonnet-5'),
    'nenhum agente ficou com claude-sonnet-5 depois da 0040');

  insert into public.lead_sources (code, label) values ('origem_t19', 'Origem T19')
  returning id into source_id;
  insert into public.remarketing_lists (name) values ('Lista T19')
  returning id into list_id;

  -- Diretor: lê tudo, não escreve nada — e a recusa é silenciosa (0 linhas).
  perform set_config('request.jwt.claims',
    json_build_object('sub', director_id::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  perform pg_temp.check19(
    exists (select 1 from public.sdr_agents where id = agent_id),
    'diretor enxerga o agente');

  update public.sdr_agents set system_prompt = 'alterado pelo diretor' where id = agent_id;
  get diagnostics n = row_count;
  perform pg_temp.check19(n = 0, 'diretor não altera agente (UPDATE casa 0 linhas, sem erro)');

  delete from public.sdr_agents where id = agent_id;
  get diagnostics n = row_count;
  perform pg_temp.check19(n = 0, 'diretor não exclui agente (DELETE casa 0 linhas)');

  delete from public.lead_sources where id = source_id;
  get diagnostics n = row_count;
  perform pg_temp.check19(n = 0, 'diretor não exclui origem');

  delete from public.remarketing_lists where id = list_id;
  get diagnostics n = row_count;
  perform pg_temp.check19(n = 0, 'diretor não exclui lista de remarketing');

  -- SDR: administra agentes, origens e listas.
  perform set_config('request.jwt.claims',
    json_build_object('sub', sdr_id::text, 'role', 'authenticated')::text, false);

  update public.sdr_agents set handoff_to_agent_id = null, system_prompt = 'alterado pelo sdr'
   where id = agent_id;
  get diagnostics n = row_count;
  perform pg_temp.check19(n = 1, 'sdr edita agente');

  update public.lead_sources set label = 'Origem T19 editada', sdr_agent_id = agent_id
   where id = source_id;
  get diagnostics n = row_count;
  perform pg_temp.check19(n = 1, 'sdr edita origem existente (vínculo de agente)');

  delete from public.remarketing_lists where id = list_id;
  get diagnostics n = row_count;
  perform pg_temp.check19(n = 1, 'sdr exclui lista de remarketing');

  reset role;
  perform pg_temp.check19(
    (select system_prompt from public.sdr_agents where id = agent_id) = 'alterado pelo sdr',
    'a edição do sdr persistiu e a do diretor não');
end;
$$;

\echo 'SDR (0040 e escrita por papel) ok'
