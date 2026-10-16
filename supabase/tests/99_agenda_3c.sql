\set ON_ERROR_STOP on
-- Cenários reversíveis; a prova concorrente de duas sessões usa o mesmo trigger.
begin;
set local request.jwt.claims = '{"role":"service_role"}';

create or replace function pg_temp.agenda_assert(got anyelement, want anyelement, label text)
returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FALHOU: % | esperado=% obtido=%', label, want, got; end if;
  raise notice 'ok %', label;
end;
$$;

do $$
declare
  a uuid := '00000000-0000-0000-0000-000000028401';
  b uuid := '00000000-0000-0000-0000-000000028402';
  outsider uuid := '00000000-0000-0000-0000-000000028403';
  inactive uuid := '00000000-0000-0000-0000-000000028404';
  actor uuid := '00000000-0000-0000-0000-000000028405';
  g uuid := '00000000-0000-0000-0000-0000000284a1';
  lead_a uuid := '00000000-0000-0000-0000-0000000284b1';
  lead_b uuid := '00000000-0000-0000-0000-0000000284b2';
  lead_out uuid := '00000000-0000-0000-0000-0000000284b3';
  lead_queue uuid := '00000000-0000-0000-0000-0000000284b4';
  cfg jsonb;
  data jsonb;
  res jsonb;
  win jsonb;
  visit_id uuid;
  adjacent_id uuid;
  manual_id uuid;
  legacy_id uuid;
  old_overlap_id uuid;
  day date := date '2025-01-04'; -- Sabado no passado, sem regra de expediente.
  nine timestamptz;
  started timestamptz;
  denied boolean;
  advisory_before bigint;
begin
  insert into auth.users (id,email,raw_user_meta_data) values
    (a,'agenda-a-0284@test.invalid','{"full_name":"Agenda A 0284"}'),
    (b,'agenda-b-0284@test.invalid','{"full_name":"Agenda B 0284"}'),
    (outsider,'agenda-out-0284@test.invalid','{"full_name":"Agenda Fora 0284"}'),
    (inactive,'agenda-inactive-0284@test.invalid','{"full_name":"Agenda Inativa 0284"}'),
    (actor,'agenda-actor-0284@test.invalid','{"full_name":"Integração 3C 0284"}');
  update public.profiles set status='suspended' where id=inactive;
  delete from public.user_roles where profile_id=actor;
  insert into public.distribution_groups(id,name,slug) values(g,'Grupo Agenda 0284','grupo-agenda-0284');
  insert into public.leads(id,full_name,phone_raw,status,assigned_to) values
    (lead_a,'Lead A Agenda 0284','51999992841','in_progress',a),
    (lead_b,'Lead B Agenda 0284','51999992842','in_progress',b),
    (lead_out,'Lead Fora Agenda 0284','51999992843','in_progress',outsider);
  insert into public.leads(id,full_name,phone_raw,distribution_group_id) values
    (lead_queue,'Lead Fila Agenda 0284','51999992844',g);
  cfg := jsonb_build_object('enabled',true,'integration_user_id',actor,'allowed_group_ids',jsonb_build_array(g),
    'default_group_id',g,'agenda_ids',jsonb_build_array(a,b,inactive),'outcomes',jsonb_build_array('agendado'));
  nine := (day + time '21:17') at time zone 'America/Sao_Paulo';
  -- Gerador de datas explícitas não depende do TimeZone da sessão de teste.
  win := jsonb_build_object('inicio',nine,'fim',nine+interval '3 hours','duracao_min',30);
  data := jsonb_build_object('lead_id',lead_a,'agenda_id',a,'inicio',nine,'fim',nine+interval '30 minutes',
    'tipo','visita','titulo','Visita 0284','observacao','Qualificação de teste','origem','3c');
  insert into private.integration_credentials(provider,label,secret,config)
    values('3c','api_token','test-only-agenda-0284',cfg)
    on conflict(provider,label) do update set secret=excluded.secret,config=excluded.config,active=true;

  update private.integration_credentials set config=cfg||'{"enabled":false}' where provider='3c' and label='api_token';
  select count(*) into advisory_before from pg_locks where pid=pg_backend_pid() and locktype='advisory';
  insert into public.visits(lead_id,broker_id,scheduled_at) values(lead_a,a,nine) returning id into manual_id;
  perform pg_temp.agenda_assert((select count(*) from pg_locks where pid=pg_backend_pid() and locktype='advisory'),advisory_before,
    'integração desativada não acrescenta advisory locks às visitas manuais');
  delete from public.visits where id=manual_id;
  update private.integration_credentials set config=cfg where provider='3c' and label='api_token';

  res := private.integracao_3c_agenda('agendas','{}',cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','200','catálogo disponível');
  perform pg_temp.agenda_assert(jsonb_array_length(res#>'{body,agendas}'),2,'catálogo exclui inativo e fora da allowlist');
  res := private.integracao_3c_agenda('agendas','{}',cfg-'agenda_ids',actor);
  perform pg_temp.agenda_assert(res#>>'{body,erro}','CONFIGURACAO_PENDENTE','sem agendas autorizadas a configuração fica pendente');
  res := private.integracao_3c_agenda('disponibilidade',win,cfg,actor);
  perform pg_temp.agenda_assert(jsonb_array_length(res#>'{body,horarios}'),12,'sem agenda_id lista todas as agendas ativas');
  res := private.integracao_3c_agenda('disponibilidade',win||jsonb_build_object('duracao_min',15),cfg,actor);
  perform pg_temp.agenda_assert(jsonb_array_length(res#>'{body,horarios}'),24,'cliente escolhe duração diferente sem configuração no FaceImob');
  res := private.integracao_3c_agenda('disponibilidade',win||jsonb_build_object('inicio',day||'T09:00:00'),cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','422','data sem fuso é recusada');
  res := private.integracao_3c_agenda('disponibilidade',win||jsonb_build_object('fim',nine+interval '30 days'),cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','200','cliente escolhe janela de30dias sem horizonte de negócio');
  res := private.integracao_3c_agenda('disponibilidade',win||jsonb_build_object('agenda_id',outsider),cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','404','agenda de fora não vaza');
  res := private.integracao_3c_agenda('criar_evento',data||jsonb_build_object('agenda_id',inactive),cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','404','agenda suspensa não recebe evento');
  res := private.integracao_3c_agenda('criar_evento',data||'{"titulo":42}',cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','422','título precisa ser texto no JSON');
  res := private.integracao_3c_agenda('criar_evento',data||'{"observacao":{}}',cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','422','observação precisa ser texto ou nula no JSON');

  res := private.integracao_3c_agenda('criar_evento',data,cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','201','evento noturno em sábado passado usa exatamente intervalo enviado');
  visit_id := (res#>>'{body,evento_id}')::uuid;
  perform pg_temp.agenda_assert((select created_by from public.visits where id=visit_id),actor,'visita identifica ator técnico');
  perform pg_temp.agenda_assert((select assigned_to from public.leads where id=lead_a),a,'agenda não redistribui lead');
  res := private.integracao_3c_agenda('criar_evento',data,cfg,actor);
  perform pg_temp.agenda_assert(res#>>'{body,erro}','HORARIO_OCUPADO','mesmo período devolve409');
  res := private.integracao_3c_agenda('criar_evento',data||jsonb_build_object('inicio',nine+interval '30 minutes','fim',nine+interval '1 hour'),cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','201','intervalos adjacentes são permitidos');
  adjacent_id := (res#>>'{body,evento_id}')::uuid;
  res := private.integracao_3c_agenda('criar_evento',data||jsonb_build_object('inicio',nine+interval '10 minutes','fim',nine+interval '40 minutes'),cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','409','hora fora de grade é recusada somente por conflito real');
  res := private.integracao_3c_agenda('criar_evento',data||jsonb_build_object('lead_id',lead_out),cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','404','lead fora de grupo e agenda não vaza');
  res := private.integracao_3c_agenda('criar_evento',data||jsonb_build_object('lead_id',lead_queue),cfg,actor);
  perform pg_temp.agenda_assert(res#>>'{body,erro}','AGUARDANDO_DISTRIBUICAO','lead de grupo autorizado sem dono aguarda distribuição');
  res := private.integracao_3c_agenda('criar_evento',data||jsonb_build_object('agenda_id',b),cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','422','não agenda em corretor diferente do dono');

  denied := false;
  begin
    insert into public.visits(lead_id,broker_id,scheduled_at,ends_at) values(lead_a,a,nine+interval '10 minutes',nine+interval '40 minutes');
  exception when exclusion_violation then denied:=true; end;
  perform pg_temp.agenda_assert(denied,true,'escrita manual também rejeita sobreposição SQLSTATE23P01');
  insert into public.visits(lead_id,broker_id,scheduled_at,ends_at) values(lead_a,a,nine+interval '1 hour',nine+interval '90 minutes') returning id into manual_id;
  perform pg_temp.agenda_assert((select ends_at from public.visits where id=manual_id),nine+interval '90 minutes','visita manual preserva fim explícito informado');
  denied:=false;
  begin update public.visits set ends_at=nine+interval '70 minutes' where id=adjacent_id;
  exception when exclusion_violation then denied:=true; end;
  perform pg_temp.agenda_assert(denied,true,'estender fim manual não invade visita seguinte');
  update public.visits set result='cancelled' where id=manual_id;
  res := private.integracao_3c_agenda('criar_evento',data||jsonb_build_object('inicio',nine+interval '1 hour','fim',nine+interval '90 minutes'),cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','201','cancelamento libera horário');
  denied:=false;
  begin update public.visits set result='scheduled' where id=manual_id;
  exception when exclusion_violation then denied:=true; end;
  perform pg_temp.agenda_assert(denied,true,'reativar visita não ignora ocupação atual');
  denied:=false;
  begin update public.visits set scheduled_at=nine+interval '10 minutes' where id=adjacent_id;
  exception when exclusion_violation then denied:=true; end;
  perform pg_temp.agenda_assert(denied,true,'reagendamento manual também verifica conflito');
  insert into public.visits(lead_id,broker_id,scheduled_at,ends_at) values(lead_b,b,nine,nine+interval '30 minutes');
  denied:=false;
  begin update public.visits set broker_id=b where id=visit_id;
  exception when exclusion_violation then denied:=true; end;
  perform pg_temp.agenda_assert(denied,true,'troca de corretor respeita agenda de destino');

  update public.leads set status='lost',lost_at=now() where id=lead_a;
  res := private.integracao_3c_agenda('criar_evento',data||jsonb_build_object('inicio',nine+interval '2 hours','fim',nine+interval '150 minutes'),cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','422','lead perdido não agenda');
  update public.leads set assigned_to=null,distribution_group_id=g where id=lead_a;
  res := private.integracao_3c_agenda('criar_evento',data||jsonb_build_object('inicio',nine+interval '2 hours','fim',nine+interval '150 minutes'),cfg,actor);
  perform pg_temp.agenda_assert(res#>>'{body,erro}','AGENDAMENTO_NAO_PERMITIDO','lead encerrado sem dono não é tratado como aguardando distribuição');
  perform pg_temp.agenda_assert((select status::text from public.leads where id=lead_a),'lost','lead encerrado sem dono continua encerrado');
  update public.leads set status='in_progress',lost_at=null,assigned_to=a,distribution_group_id=null where id=lead_a;

  -- Simula visitas anteriores à integração, inclusive sobrepostas, sem alterar histórico.
  update private.integration_credentials set config=cfg||'{"enabled":false}' where provider='3c' and label='api_token';
  insert into public.visits(lead_id,broker_id,scheduled_at) values(lead_a,a,nine+interval '1 day 1 hour') returning id into legacy_id;
  insert into public.visits(lead_id,broker_id,scheduled_at) values(lead_a,a,nine+interval '1 day 1 hour') returning id into old_overlap_id;
  update private.integration_credentials set config=cfg where provider='3c' and label='api_token';
  perform pg_temp.agenda_assert((select ends_at is null from public.visits where id=legacy_id),true,'fim legado continua nulo');
  res := private.integracao_3c_agenda('disponibilidade',win||jsonb_build_object('agenda_id',a,'inicio',nine+interval '1 day','fim',nine+interval '1 day 3 hours'),cfg,actor);
  perform pg_temp.agenda_assert(jsonb_array_length(res#>'{body,horarios}'),0,'legado sem fim bloqueia dia inteiro só do corretor');
  res := private.integracao_3c_agenda('criar_evento',data||jsonb_build_object('inicio',nine+interval '1 day','fim',nine+interval '1 day 30 minutes'),cfg,actor);
  perform pg_temp.agenda_assert(res#>>'{body,erro}','HORARIO_OCUPADO','reserva revalida bloqueio conservador do legado');
  update public.visits set notes='Atualização permitida' where id=legacy_id;
  update public.visits set result='completed',performed_at=now() where id=legacy_id;
  update public.visits set result='cancelled' where id=old_overlap_id;
  res := private.integracao_3c_agenda('disponibilidade',win||jsonb_build_object('agenda_id',a,'inicio',nine+interval '1 day','fim',nine+interval '1 day 3 hours'),cfg,actor);
  perform pg_temp.agenda_assert(jsonb_array_length(res#>'{body,horarios}'),6,'fechar legado conflitante é permitido e libera dia');
  insert into public.visits(lead_id,broker_id,scheduled_at) values(lead_out,outsider,nine);
  perform pg_temp.agenda_assert((select ends_at is null from public.visits where broker_id=outsider and scheduled_at=nine),true,'fora da integração mantém comportamento anterior');

  res := private.integracao_3c_agenda('criar_evento',data||jsonb_build_object(
    'inicio',nine+interval '2 days 17 minutes','fim',nine+interval '3 days 41 minutes'),cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','201','cliente escolhe horário sem grade e duração maior que24h');
  perform pg_temp.agenda_assert((select ends_at-scheduled_at from public.visits where id=(res#>>'{body,evento_id}')::uuid),
    interval '1 day 24 minutes','grava exatamente os dois instantes recebidos');
  insert into public.visits(lead_id,broker_id,scheduled_at) values(lead_a,a,nine+interval '4 days') returning id into manual_id;
  perform pg_temp.agenda_assert((select ends_at is null from public.visits where id=manual_id),true,'novo manual sem fim não recebe duração inferida');
  insert into public.visits(lead_id,broker_id,scheduled_at) values(lead_a,a,nine+interval '4 days 1 hour');
  perform pg_temp.agenda_assert((select count(*)::int from public.visits where broker_id=a and ends_at is null
    and scheduled_at in (nine+interval '4 days',nine+interval '4 days 1 hour')),2,'duas visitas manuais sem fim mantêm compatibilidade anterior');
  res := private.integracao_3c_agenda('criar_evento',data||jsonb_build_object(
    'inicio',nine+interval '4 days','fim',nine+interval '4 days 30 minutes'),cfg,actor);
  perform pg_temp.agenda_assert(res#>>'{body,erro}','HORARIO_OCUPADO','API respeita dia conservador de novo manual sem fim');
  denied:=false;
  begin insert into public.visits(lead_id,broker_id,scheduled_at) values(lead_a,a,nine+interval '2 hours');
  exception when exclusion_violation then denied:=true; end;
  perform pg_temp.agenda_assert(denied,true,'manual novo sem fim também respeita ocupaçãoAPI em qualquer hora do dia');
  res := private.integracao_3c_agenda('disponibilidade',win||'{"duracao_min":2147483647}',cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','200','INTMAX é duração técnica válida sem overflow');
  perform pg_temp.agenda_assert(jsonb_array_length(res#>'{body,horarios}'),0,'duração maior que janela retorna lista vazia');
  res := private.integracao_3c_agenda('disponibilidade',win||'{"duracao_min":2147483648}',cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','422','duração acimaINTMAX é recusada');
  res := private.integracao_3c_agenda('disponibilidade',win||'{"duracao_min":0}',cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','422','duração zero é recusada');
  res := private.integracao_3c_agenda('disponibilidade',win||'{"inicio":"2025-01-04T21:17-03:00"}',cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','200','timestamp ISO com minutos e fuso é válido');
  res := private.integracao_3c_agenda('disponibilidade',win||jsonb_build_object('fim',nine),cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','422','fim igual ao início é recusado');
  started:=clock_timestamp();
  res:=private.integracao_3c_agenda('disponibilidade',win||jsonb_build_object('fim',nine+interval '5 days 3 hours'),cfg,actor);
  perform pg_temp.agenda_assert(extract(epoch from clock_timestamp()-started)<1,true,'disponibilidade set based do cenário responde em menos de1s');
  started:=clock_timestamp();
  res:=private.integracao_3c_agenda('disponibilidade',win||jsonb_build_object('duracao_min',1,'fim',nine+interval '360 days'),cfg,actor);
  perform pg_temp.agenda_assert(res#>>'{body,erro}','PERIODO_INVALIDO','teto técnico recusa janela enorme sem gerar milhões de candidatos');
  perform pg_temp.agenda_assert(extract(epoch from clock_timestamp()-started)<1,true,'consulta extrema é recusada antes de gerar a grade');
  res:=private.integracao_3c_agenda('disponibilidade',win||jsonb_build_object('duracao_min',1),cfg,actor);
  perform pg_temp.agenda_assert(res->>'status','200','mesmas autorizações permitem consulta pequena com duração1min');
  perform pg_temp.agenda_assert(has_function_privilege('authenticated','private.integracao_3c_agenda(text,jsonb,jsonb,uuid)','EXECUTE'),false,'helper privado não é executável pelo navegador');
end;
$$;

rollback;
