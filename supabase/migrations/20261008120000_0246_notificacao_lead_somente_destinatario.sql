-- 0246 · Liderança recebe aviso de lead somente quando for a destinatária.
--
-- Um usuário pode acumular os papéis admin/sócio e gerente/diretor. O aviso
-- global `lead_new_admin` selecionava pelo primeiro papel e, por isso, a
-- liderança recebia a chegada de todos os leads. O aviso pessoal
-- `lead_assigned` continua intocado: ele nasce para `new.profile_id`, isto é,
-- somente quando a roleta realmente chega à vez daquela pessoa.

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
  v_camp := nullif(btrim(coalesce(v_lead.campaign_name, v_lead.utm_campaign, '')), '');

  insert into public.notifications (profile_id, kind, title, body, link)
  select distinct p.id,
         'lead_new_admin',
         'Novo lead: ' || coalesce(nullif(v_lead.full_name, ''), 'sem nome'),
         v_origem || coalesce(' · ' || v_camp, '') || ' · ' ||
           case when v_dono is not null then 'foi para ' || v_dono
                else 'está na fila da roleta' end,
         '/leads?lead=' || v_lead.id
    from public.user_roles ur
    join public.profiles p on p.id = ur.profile_id
   where ur.role in ('admin', 'partner')
     and p.status = 'active'
     and p.id is distinct from v_lead.assigned_to
     -- Acumular admin/sócio não transforma gerente ou diretor em observador de
     -- toda a roleta. Eles recebem `lead_assigned` quando forem o alvo real.
     and not exists (
       select 1
         from public.user_roles lider
        where lider.profile_id = p.id
          and lider.role in ('manager', 'director')
     )
     and coalesce((select pp.enabled from public.push_preferences pp
                    where pp.profile_id = p.id and pp.category = 'lead_geral'), true);

  return null;
exception when others then
  -- O aviso nunca pode impedir a entrada do lead.
  raise warning 'leads_avisa_admin: aviso do lead % não saiu: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.leads_avisa_admin() from public, anon, authenticated;
comment on function public.leads_avisa_admin() is
  'Avisa admin/sócio sem papel de gerente/diretor sobre a chegada global. Liderança recebe somente o lead atribuído à própria vez.';

-- Segunda proteção no ponto único de gravação: `lead_unattended` também era
-- espalhado a toda a liderança quando um lead esgotava as voltas. Admin segue
-- responsável pela bandeja global; gerente/diretor só recebe eventos pessoais.
create or replace function public.notifications_restrict_global_lead_alerts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind in ('lead_new_admin', 'lead_unattended')
     and exists (
       select 1
         from public.user_roles ur
        where ur.profile_id = new.profile_id
          and ur.role in ('manager', 'director')
     ) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.notifications_restrict_global_lead_alerts()
  from public, anon, authenticated;
drop trigger if exists notifications_restrict_global_lead_alerts on public.notifications;
create trigger notifications_restrict_global_lead_alerts
  before insert on public.notifications
  for each row execute function public.notifications_restrict_global_lead_alerts();

comment on function public.notifications_restrict_global_lead_alerts() is
  'Impede avisos globais de lead para gerente/diretor; avisos pessoais como lead_assigned e lead_timeout permanecem.';
