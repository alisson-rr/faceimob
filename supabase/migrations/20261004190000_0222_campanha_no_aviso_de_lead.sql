-- =============================================================================
-- 0222 — a campanha do lead nos avisos de lead novo
--
-- Pedido de 04/10/2026: "na notificação de lead apareça a campanha do lead".
-- O aviso dizia só a origem ("meta · está na fila da roleta"). Agora leva a
-- campanha (`campaign_name`, senão `utm_campaign`) quando houver:
--   · admin e sócio: "Meta · Solar do Bosque · foi para Fulano";
--   · corretor que recebe: "Solar do Bosque · Você tem até 14:05 para iniciar…".
-- =============================================================================

create or replace function public.leads_avisa_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead   public.leads;
  v_origem text;
  v_dono   text;
  v_camp   text;
begin
  if auth.uid() is not null then
    return null;
  end if;

  select * into v_lead from public.leads where id = new.id;
  if not found then
    return null;
  end if;

  select label into v_origem from public.lead_sources where id = v_lead.source_id;
  v_origem := coalesce(v_origem, nullif(v_lead.utm_source, ''), 'Origem não informada');
  select full_name into v_dono from public.profiles where id = v_lead.assigned_to;
  -- 0222: a campanha do lead no aviso.
  v_camp := nullif(btrim(coalesce(v_lead.campaign_name, v_lead.utm_campaign, '')), '');

  insert into public.notifications (profile_id, kind, title, body, link)
  select distinct p.id,
         'lead_new_admin',
         'Novo lead: ' || coalesce(nullif(v_lead.full_name, ''), 'sem nome'),
         v_origem || coalesce(' · ' || v_camp, '') || ' · ' || case when v_dono is not null then 'foi para ' || v_dono
                                   else 'está na fila da roleta' end,
         '/leads?lead=' || v_lead.id
    from public.user_roles ur
    join public.profiles p on p.id = ur.profile_id
   where ur.role in ('admin', 'partner')
     and p.status = 'active'
     and p.id is distinct from v_lead.assigned_to
     and coalesce((select pp.enabled from public.push_preferences pp
                    where pp.profile_id = p.id and pp.category = 'lead_geral'), true);

  return null;
exception when others then
  -- Aviso não pode derrubar a chegada do lead.
  raise warning 'leads_avisa_admin: aviso do lead % não saiu: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.leads_avisa_admin() from public, anon, authenticated;

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
