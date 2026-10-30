-- 0280 — Aviso pessoal de repasse sem prazo fictício.
-- Mantém reassign_lead (0275), roleta e permissões intactas.
-- lead_reassigned usa a categoria existente lead_atividade no push.
create or replace function public.notify_lead_assigned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead    public.leads;
  v_notify  boolean;
begin
  select notify_on_assign into v_notify from public.automation_settings where id;
  if not coalesce(v_notify, true) then
    return null;
  end if;

  select * into v_lead from public.leads where id = new.lead_id;

  -- 0275: repasse manual nasce respondido apenas para não abrir cronômetro.
  -- counts_for_queue=false sozinho também ocorre na afinidade: não basta.
  if not new.counts_for_queue and new.responded_at is not null then
    insert into public.notifications (profile_id, kind, title, body, link, channel)
    select new.profile_id, 'lead_reassigned',
           'Lead repassado: ' || coalesce(v_lead.full_name, 'sem nome'),
           coalesce(public.profile_display_name(auth.uid()), 'Um colega')
             || ' repassou este lead para você. Aguardando seu atendimento, sem cronômetro.'
             || coalesce(' Campanha: ' || nullif(btrim(coalesce(v_lead.campaign_name, v_lead.utm_campaign, '')), ''), ''),
           '/leads?lead=' || new.lead_id::text, canal::public.notification_channel
      from unnest(array['in_app', 'whatsapp']) as canais(canal);
    return null;
  end if;
  insert into public.notifications (profile_id, kind, title, body, link, channel)
  values (
    new.profile_id,
    'lead_assigned',
    'Novo lead: ' || coalesce(v_lead.full_name, 'sem nome'),
    -- 0222: a campanha do lead antes do prazo.
    coalesce(nullif(btrim(coalesce(v_lead.campaign_name, v_lead.utm_campaign, '')), '') || ' · ', '')
      || format('Você tem até %s para iniciar o atendimento.',
                to_char(new.deadline at time zone 'America/Sao_Paulo', 'HH24:MI')),
    '/leads?lead=' || new.lead_id::text,
    'in_app'
  );

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  values (
    new.profile_id,
    'lead_assigned',
    'Novo lead atribuído',
    format('%s acabou de cair para você. Atenda em até %s minutos.',
           coalesce(v_lead.full_name, 'Um lead'),
           greatest(1, round(extract(epoch from (new.deadline - now())) / 60))),
    '/leads?lead=' || new.lead_id::text,
    'whatsapp'
  );

  return null;
end;
$$;
