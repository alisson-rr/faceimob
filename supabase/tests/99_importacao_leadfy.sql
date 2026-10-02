-- =============================================================================
-- 0188 — importação da Leadfy: casa corretor, não duplica, arquiva o resto.
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
  adm uuid := '00000000-0000-0000-0000-000001880001';
  cor uuid := '00000000-0000-0000-0000-000001880002';
  cor2 uuid := '00000000-0000-0000-0000-000001880003';
  v jsonb;
  l public.leads;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (adm,'adm@i188.test','{"full_name":"Admin 188"}'),
    (cor,'cor@i188.test','{"full_name":"Márcio Antônio Torres"}'),
    (cor2,'cor2@i188.test','{"full_name":"Daiane Jardim de Cristo"}');
  insert into public.user_roles(profile_id,role) values (adm,'admin') on conflict do nothing;
  update public.automation_settings set leads_recomeco_em = now() - interval '1 minute';
  insert into public.leads(full_name, phone, email) values ('Ja Existe', '51988887777', 'ja@existe.test');

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform pg_temp.ok(
    (select profile_id from public.previa_corretores_leadfy(array['Marcio Antonio']) ) = cor,
    'nome curto da Leadfy casa com o perfil completo, sem acento');

  v := public.importar_leads_leadfy(jsonb_build_array(
    jsonb_build_object('id','a1','status','Em negociação','corretor','Daiane Jardim de Cristo','cliente','Ana','telefone','(51) 99999 0001','criado_em','2026-08-10T10:00:00-03:00','atividade','Primeiro contato'),
    jsonb_build_object('id','a2','status','Em negociação','corretor','Usuário Repique','cliente','Bia','telefone','51999990002','criado_em','2026-08-11T10:00:00-03:00'),
    jsonb_build_object('id','a3','status','Arquivado','corretor','Marcio Antonio','cliente','Caio','telefone','51999990003','motivo','Cliente sem interesse','criado_em','2026-01-05T10:00:00-03:00'),
    jsonb_build_object('id','a4','status','Arquivado','corretor','X','cliente','Duplicado','telefone','(51) 98888 7777'),
    jsonb_build_object('id','a5','status','Negócio fechado','corretor','Daiane Jardim de Cristo','cliente','Eva','email','eva@x.test','criado_em','2026-07-01T10:00:00-03:00'),
    jsonb_build_object('id','a1','status','Arquivado','cliente','Ana de novo','telefone','51999990009'),
    jsonb_build_object('status','Arquivado','cliente','Sem id')
  ));
  reset role;

  perform pg_temp.ok((v->>'inseridos')::int = 4 and (v->>'em_atendimento')::int = 1
    and (v->>'duplicados')::int = 2 and (v->>'invalidos')::int = 1, format('contagens do lote (%s)', v));

  select * into l from public.leads where external_id = 'leadfy:a1';
  perform pg_temp.ok(l.status = 'attending' and l.assigned_to = cor2 and l.assigned_at > now() - interval '1 minute',
    'em negociação com corretor do CRM vira atendimento dele, atribuído agora');
  select * into l from public.leads where external_id = 'leadfy:a2';
  perform pg_temp.ok(l.status = 'lost' and l.assigned_to is null and l.lost_reason like '%fora do CRM%',
    'em negociação sem corretor no CRM fica na base, arquivado');
  select * into l from public.leads where external_id = 'leadfy:a3';
  perform pg_temp.ok(l.status = 'lost' and l.assigned_to = cor and l.lost_reason = 'Leadfy: Cliente sem interesse'
    and l.created_at < '2026-02-01', 'arquivado guarda o corretor de origem, a data e o motivo');
  perform pg_temp.ok((select status from public.leads where external_id = 'leadfy:a5') = 'converted', 'negócio fechado vira convertido');
  perform pg_temp.ok(not exists (select 1 from public.leads where external_id = 'leadfy:a4'), 'telefone já no CRM não duplica');

  -- O corretor vê o lead em atendimento, não o arquivado antigo.
  perform set_config('request.jwt.claims', json_build_object('sub', cor2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.ok((select count(*) from public.leads where external_id like 'leadfy:%') = 1,
    'corretor vê só o lead em atendimento que é dele');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.ok((select count(*) from public.leads where external_id = 'leadfy:a3') = 0,
    'arquivado antigo não aparece para o corretor');
  begin
    perform public.importar_leads_leadfy('[]'::jsonb);
    raise exception 'FALHOU: corretor importou';
  exception when insufficient_privilege then
    raise notice '  ok  corretor não importa';
  end;
  reset role;
end
$$;

rollback;
