-- Status 2 tem permissão própria; automações autorizadas continuam pela
-- identidade postgres das RPCs SECURITY DEFINER, como a trava do Status 1.
insert into public.permissions (code, label, category, description) values
  ('deals.edit_status_detail', 'Alterar Status 2', 'pipeline',
   'Alterar manualmente o Status 2. A visualização permanece; a CCA segue sua permissão própria.')
on conflict (code) do nothing;
insert into public.role_permissions (role, permission, allowed)
select r, 'deals.edit_status_detail', true
from unnest(array['broker','manager','director','cca']::public.app_role[]) r
on conflict (role, permission) do nothing;

create or replace function public.deals_guard_status_detail()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('postgres', 'service_role') or public.is_admin() then return new; end if;
  if tg_op = 'UPDATE' and new.status_detail is not distinct from old.status_detail then return new; end if;
  if tg_op = 'INSERT' and (new.status_detail is null or public.deal_status_bare(new.status_detail) = 'PROPOSTA') then return new; end if;
  if not public.has_permission('deals.edit_status_detail') then
    raise exception 'Seu perfil não pode alterar o Status 2.' using errcode = '42501',
      hint = 'Permissão Alterar Status 2, em Administração → Permissões → Funcionalidades.';
  end if;
  return new;
end;
$$;
revoke all on function public.deals_guard_status_detail() from public, anon, authenticated;
create trigger deals_guard_status_detail before insert or update of status_detail on public.deals
  for each row execute function public.deals_guard_status_detail();

-- A mesma fila/worker Brevo, com controles independentes para Pipeline e CCA.
alter table public.automation_settings add column pipeline_move_email boolean not null default false;
alter table public.cca_move_emails add column source text not null default 'cca'
  check (source in ('cca', 'pipeline'));

create or replace function public.deals_queue_status_email()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_message text;
  v_actor text;
  v_client text;
  v_status1 text;
  v_status2 text;
begin
  if new.status_group_id is not distinct from old.status_group_id
     and new.status_detail is not distinct from old.status_detail then return null; end if;
  -- A ação da CCA já possui aviso/e-mail e respeita "Avisar o comercial".
  if coalesce(current_setting('faceimob.cca_move', true), '') = 'on' then return null; end if;
  if not coalesce((select pipeline_move_email from public.automation_settings where id), false) then return null; end if;
  select full_name into v_actor from public.profiles where id = auth.uid();
  select full_name into v_client from public.deal_clients where deal_id = new.id and ordinal = 1;
  select label into v_status1 from public.deal_status_groups where id = new.status_group_id;
  select label into v_status2 from public.deal_statuses where value = new.status_detail;
  v_status2 := coalesce(v_status2, public.deal_status_bare(new.status_detail), 'Sem Status 2');
  v_message := concat_ws(E'\n',
    case when new.status_group_id is distinct from old.status_group_id then
      'Status 1: ' || coalesce((select label from public.deal_status_groups where id = old.status_group_id), 'Sem Status 1')
        || ' → ' || coalesce(v_status1, 'Sem Status 1') end,
    case when new.status_detail is distinct from old.status_detail then
      'Status 2: ' || coalesce(public.deal_status_bare(old.status_detail), 'Sem Status 2') || ' → ' || v_status2 end);
  insert into public.cca_move_emails
    (deal_id, profile_id, to_email, deal_code, client_name, stage_name, actor_name, message, source)
  select distinct on (lower(btrim(p.email::text))) new.id, p.id, btrim(p.email::text),
    new.code, v_client, concat_ws(' · ', v_status1, v_status2), coalesce(v_actor, 'Sistema'), v_message, 'pipeline'
  from public.deal_participants dp join public.profiles p on p.id = dp.profile_id
  where dp.deal_id = new.id and dp.role in ('broker', 'manager', 'director')
    and p.status = 'active'
    and btrim(p.email::text) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    and p.email::text !~* '@sem-email\.local$'
  order by lower(btrim(p.email::text)), p.id;
  return null;
end;
$$;
revoke all on function public.deals_queue_status_email() from public, anon, authenticated;
create trigger deals_queue_status_email after update on public.deals
  for each row execute function public.deals_queue_status_email();

create or replace function public.dispatch_pending_cca_emails()
returns void language plpgsql security definer set search_path = public, private, extensions, pg_temp as $$
declare v_url text; v_key text;
begin
  update public.cca_move_emails e set status = 'expired',
    last_error = case when e.created_at < now() - interval '24 hours'
      then 'Não saiu em 24 h: descartado para não chegar fora de hora.'
      else 'Envio desligado em Admin → Integrações: descartado.' end
  where e.status in ('queued','sending','failed') and e.attempts < 5
    and (e.created_at < now() - interval '24 hours' or not coalesce(
      (select case e.source when 'pipeline' then s.pipeline_move_email else s.cca_move_email end
       from public.automation_settings s where s.id), false));
  if not exists (select 1 from public.cca_move_emails e where e.attempts < 5
    and (e.status = 'queued' or (e.status in ('failed','sending') and e.updated_at < now() - interval '10 minutes'))) then return; end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return; end if;
  select secret into v_url from private.integration_credentials where provider = 'supabase' and label = 'functions_url' and active;
  select secret into v_key from private.integration_credentials where provider = 'supabase' and label = 'service_role_key' and active;
  if v_url is null or v_key is null then
    raise warning 'dispatch_pending_cca_emails: configure functions_url e service_role_key em Integrações.';
    return;
  end if;
  perform net.http_post(url := rtrim(v_url, '/') || '/cca-email-dispatch',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key), body := '{}'::jsonb);
end;
$$;
