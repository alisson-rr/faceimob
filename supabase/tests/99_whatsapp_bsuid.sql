-- 0335 — lead que chega só com o BSUID espera 15 min pelo telefone antes da
-- roleta; o registro aceita os desfechos de descarte e mensagem sem telefone;
-- POST recusado fica numa tabela só do administrador.
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
  l_novo uuid; l_velho uuid; l_tel uuid;
begin
  insert into public.leads (full_name, status, whatsapp_user_id, created_at)
  values ('Só BSUID novo', 'queued', 'BR.335novo', now() - interval '2 minutes') returning id into l_novo;
  insert into public.leads (full_name, status, whatsapp_user_id, created_at)
  values ('Só BSUID antigo', 'queued', 'BR.335velho', now() - interval '20 minutes') returning id into l_velho;
  insert into public.leads (full_name, phone, status, whatsapp_user_id, created_at)
  values ('Com telefone', '51900335001', 'queued', 'BR.335tel', now() - interval '2 minutes') returning id into l_tel;

  perform public.assign_queued_leads();

  perform pg_temp.ok((select status = 'queued' and assigned_at is null from public.leads where id = l_novo),
    'só com BSUID há 2 min: a roleta espera o telefone');
  perform pg_temp.ok((select whatsapp_user_id = 'BR.335tel' from public.leads where id = l_tel),
    'o BSUID fica guardado no lead');
end;
$$;

insert into public.whatsapp_inbound_messages (provider_message_id, from_phone, from_user_id, outcome, payload)
values ('t335-a', null, 'BR.335x', 'human_turn', null),
       ('t335-b', null, null, 'descartado_sem_telefone', '{"id":"t335-b","type":"text"}'),
       ('t335-c', '5551900335002', null, 'descartado_tipo_desconhecido', '{"type":"reaction"}');
select pg_temp.ok((select count(*) from public.whatsapp_inbound_messages where provider_message_id like 't335-%') = 3,
  'registro aceita mensagem sem telefone e os dois desfechos de descarte');

do $$
begin
  insert into public.whatsapp_inbound_messages (provider_message_id, outcome) values ('t335-d', 'inventado');
  raise exception 'FALHOU: aceitou desfecho fora da lista';
exception when check_violation then
  raise notice '  ok  desfecho fora da lista é recusado';
end;
$$;

insert into public.whatsapp_webhook_recusas (motivo, bytes) values ('assinatura_invalida', 120);
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.whatsapp_webhook_recusas'::regclass),
  'recusas com RLS ligada');
select pg_temp.ok(not has_table_privilege('anon', 'public.whatsapp_webhook_recusas', 'select'),
  'anônimo não lê as recusas');

rollback;
