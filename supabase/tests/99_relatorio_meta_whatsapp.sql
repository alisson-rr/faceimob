-- 0336 — relatório da Meta pelo WhatsApp: quem recebe, o texto de ontem e a
-- porta fechada para quem não é service role.
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
  soc  uuid := '00000000-0000-0000-0000-000003360001';
  adm  uuid := '00000000-0000-0000-0000-000003360002';
  cor  uuid := '00000000-0000-0000-0000-000003360003';
  semf uuid := '00000000-0000-0000-0000-000003360004';
  v_txt text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (soc,  'soc@c336.test',  '{"full_name":"Sócia 336"}'),
    (adm,  'adm@c336.test',  '{"full_name":"Admin 336"}'),
    (cor,  'cor@c336.test',  '{"full_name":"Corretor 336"}'),
    (semf, 'semf@c336.test', '{"full_name":"Sócio sem fone 336"}');
  insert into public.user_roles (profile_id, role) values
    (soc, 'partner'), (adm, 'admin'), (cor, 'broker'), (semf, 'partner') on conflict do nothing;
  update public.profiles set phone = '(51) 99033-6001' where id = soc;
  update public.profiles set phone = '51990336002' where id = adm;
  update public.profiles set phone = '51990336003' where id = cor;
  update public.profiles set phone = null where id = semf;

  perform pg_temp.ok(exists (select 1 from public.relatorio_meta_destinatarios() where profile_id = soc and telefone = '5551990336001')
    and exists (select 1 from public.relatorio_meta_destinatarios() where profile_id = adm),
    'sócio e administrador com telefone recebem');
  perform pg_temp.ok(not exists (select 1 from public.relatorio_meta_destinatarios() where profile_id in (cor, semf)),
    'corretor e sócio sem telefone ficam de fora');
  perform pg_temp.ok(public.relatorio_meta_e_destinatario('5551990336001')
    and public.relatorio_meta_e_destinatario('51 9 9033-6001')
    and not public.relatorio_meta_e_destinatario('5551990336003'),
    'o webhook reconhece o telefone do destinatário (com e sem DDI)');

  update public.meta_ad_accounts set enabled = false;
  insert into public.meta_ad_accounts (act_id, name, enabled, is_prepay, prepay_available, cpl_limite)
  values ('act_3360001', 'Conta 0336', true, true, 791, 20);
  v_txt := public.meta_relatorio_whatsapp_texto();
  perform pg_temp.ok(v_txt like '🏢 Faceimob — Relatório de ontem (%'
    and v_txt like '%💳 Saldo: R$ 791,00%'
    and v_txt like '%💰 Gasto: R$ 0,00%'
    and v_txt like '%📝 Cadastros: 0 — CPL —%'
    and v_txt like '%Controle Faceimob',
    format('texto do relatório de ontem, mesmo sem gasto (%s)', left(v_txt, 120)));
end;
$$;

insert into public.whatsapp_inbound_messages (provider_message_id, from_phone, outcome)
values ('t336-a', '5551990336001', 'relatorio');
select pg_temp.ok(true, 'registro aceita o desfecho relatorio');

select pg_temp.ok(not has_function_privilege('authenticated', 'public.meta_relatorio_whatsapp_texto()', 'execute')
  and not has_function_privilege('authenticated', 'public.relatorio_meta_destinatarios()', 'execute')
  and not has_function_privilege('anon', 'public.dispatch_relatorio_meta_whatsapp()', 'execute'),
  'só a service role monta e dispara o relatório');
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.relatorio_meta_envios'::regclass),
  'envios com RLS ligada');

rollback;
