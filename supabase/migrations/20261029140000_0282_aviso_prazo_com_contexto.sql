-- 0282 — Aviso de prazo identifica o lead e explica a ação necessária.
-- Produzido apenas pela liberação real no banco, nunca por comparar listas.

create or replace function public.notify_lead_timeout()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_notify boolean;
  v_nome   text;
  v_titulo text;
  v_corpo  text;
  v_final_telefone text;
begin
  if new.release_reason is distinct from 'timeout' or new.released_at is null
     or old.released_at is not null then
    return null;
  end if;

  select notify_on_timeout into v_notify from public.automation_settings where id;
  if not coalesce(v_notify, true) then
    return null;
  end if;

  select coalesce(nullif(btrim(l.full_name), ''), 'Lead sem nome'),
         nullif(right(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g'), 4), '')
    into v_nome, v_final_telefone
    from public.leads l where l.id = new.lead_id;

  v_titulo := 'Prazo encerrado: ' || coalesce(v_nome, 'Lead sem nome');
  v_corpo := format('%s%s — recebido em %s; prazo encerrado em %s. O atendimento não foi iniciado no prazo e o lead voltou à distribuição. Não tente atendê-lo novamente: confira os contatos em Aguardando atendimento que ainda estão com você.',
    coalesce(v_nome, 'Lead sem nome'),
    case when v_final_telefone is null then '' else ' (telefone final ' || v_final_telefone || ')' end,
    to_char(new.assigned_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
    to_char(new.released_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'));

  -- DUAS linhas, uma por canal, como na 0011. A `in_app` é o que o sino mostra;
  -- a `whatsapp` é o que o `notify-dispatch` entrega. Gravar só a primeira
  -- deixaria o item 10 da ata de 14/07 (avisar POR WHATSAPP que o lead se
  -- perdeu) sem produtor nenhum. Duas linhas não duplicam a caixa do corretor —
  -- a policy expõe só `in_app` ao cliente.
  insert into public.notifications (profile_id, kind, title, body, link, channel)
  values
    (new.profile_id, 'lead_lost_timeout', v_titulo, v_corpo, '/leads', 'in_app'),
    (new.profile_id, 'lead_lost_timeout', v_titulo, v_corpo, '/leads', 'whatsapp');

  return null;
end;
$$;

comment on function public.notify_lead_timeout() is
  'Aviso confirmado de prazo: nome, final do telefone, recebimento e encerramento em São Paulo, com orientação. Só na primeira liberação por timeout; não confunde repasse manual ou desaparecimento da lista com perda de lead. Mantém canais, configuração e link /leads.';
