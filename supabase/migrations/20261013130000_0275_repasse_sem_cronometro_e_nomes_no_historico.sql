-- 0275 — Repasse de lead sem o cronômetro de 10 minutos + nomes no histórico.
--
-- Pedido (13/10/2026): quando um corretor repassa o lead, ele já fica com o
-- novo corretor SEM abrir a contagem de atendimento; se ninguém tratar, o lead
-- apenas fica atrasado (next_action_at vencido) em vez de voltar para a fila.
-- E o histórico precisa dizer quem repassou, de quem e para quem.

-- 1. Nome de um perfil, só para ids que o histórico já mostra --------------------
-- `profiles` é protegida por visibilidade: o corretor que recebeu o lead não
-- enxerga quem repassou. Esta função devolve só o nome (nada mais) e quem a
-- usa é `lead_history_names`, que parte de `lead_events` — já filtrada pela
-- RLS do chamador.
create or replace function public.profile_display_name(p_id uuid)
returns text
language sql stable security definer set search_path = public, pg_temp
as $$ select full_name from public.profiles where id = p_id $$;
revoke all on function public.profile_display_name(uuid) from public, anon;
grant execute on function public.profile_display_name(uuid) to authenticated;

create or replace function public.lead_history_names(p_lead_id uuid)
returns table(id uuid, full_name text)
language sql stable security invoker set search_path = public, pg_temp
as $$
  with ids as (
    select e.actor_id as pid from public.lead_events e where e.lead_id = p_lead_id
    union
    select e.from_value::uuid from public.lead_events e
     where e.lead_id = p_lead_id
       and e.from_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    union
    select e.to_value::uuid from public.lead_events e
     where e.lead_id = p_lead_id
       and e.to_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  select i.pid, public.profile_display_name(i.pid)
    from ids i where i.pid is not null
$$;
revoke all on function public.lead_history_names(uuid) from public, anon;
grant execute on function public.lead_history_names(uuid) to authenticated;
comment on function public.lead_history_names(uuid) is
  'Nomes de quem aparece no histórico do lead (ator, de, para). Invoker: só devolve ids de eventos que a RLS deixa o chamador ler.';

-- 2. Repasse sem cronômetro -----------------------------------------------------
create or replace function public.reassign_lead(p_lead_id uuid, p_target uuid)
returns public.leads
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_lead public.leads;
  v_hours int;
  v_actor uuid := auth.uid();
  v_previous_owner uuid;
  v_by_permission boolean;
  v_by_owner boolean;
begin
  if v_actor is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead não encontrado.' using errcode = 'P0002'; end if;
  v_previous_owner := v_lead.assigned_to;
  v_by_permission := public.has_permission('leads.reassign');
  v_by_owner := coalesce(v_lead.assigned_to = v_actor, false) and public.has_role('broker');
  if not (v_by_permission or v_by_owner) then
    raise exception 'Você só pode repassar leads que estão com você.' using errcode = '42501';
  end if;
  if v_by_owner and not v_by_permission and v_lead.status not in ('assigned', 'attending', 'in_progress') then
    raise exception 'Este lead já foi encerrado ou saiu da sua carteira.' using errcode = 'P0001';
  end if;
  if p_target = v_previous_owner then raise exception 'Escolha outro corretor para receber o lead.' using errcode = 'P0001'; end if;
  if not exists (
    select 1 from public.profiles p where p.id = p_target and p.status = 'active'
      and exists (select 1 from public.user_roles ur where ur.profile_id = p.id and ur.role = 'broker')
  ) then raise exception 'O corretor escolhido não existe ou está inativo.' using errcode = 'P0002'; end if;
  if v_by_permission and not v_by_owner and not (public.is_admin() or public.manages_profile(p_target)) then
    raise exception 'Sem permissão para realocar para este corretor.' using errcode = '42501';
  end if;
  if v_by_permission and not v_by_owner and not coalesce(
       case when v_lead.assigned_to is null then p_lead_id in (select public.auth_queue_lead_ids())
            else v_lead.assigned_to in (select public.auth_visible_profiles()) end, false) then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  update public.lead_assignments set released_at = now(), release_reason = 'reassigned'
   where lead_id = p_lead_id and released_at is null;

  -- Sem prazo de atendimento: `deadline` é NOT NULL, então vai "agora" e a
  -- linha já nasce respondida; quem manda no lead é `leads.attend_deadline`
  -- (nulo = nada o devolve à fila).
  insert into public.lead_assignments
    (lead_id, profile_id, group_id, sequence, deadline, responded_at, counts_for_queue)
  select p_lead_id, p_target, v_lead.distribution_group_id,
         coalesce(max(la.sequence), 0) + 1, now(), now(), false
    from public.lead_assignments la where la.lead_id = p_lead_id;

  -- "Atrasado" é next_action_at vencido (`overdue_lead_count`): mantém o
  -- próximo contato que ainda está no futuro; senão marca o padrão da empresa.
  select s.no_response_hours into v_hours from public.automation_settings s where s.id;

  update public.leads
     set status = 'assigned', assigned_to = p_target, assigned_at = now(),
         attend_deadline = null,
         next_action_at = case when next_action_at > now() then next_action_at
                               else now() + make_interval(hours => coalesce(v_hours, 24)) end,
         last_activity_at = now()
   where id = p_lead_id returning * into v_lead;

  -- Os nomes ficam no próprio evento: o histórico continua legível mesmo se o
  -- perfil sair da visibilidade de quem lê depois.
  insert into public.lead_events (lead_id, actor_id, kind, from_value, to_value, detail)
  values (p_lead_id, v_actor, 'reassigned', v_previous_owner::text, p_target::text,
          jsonb_build_object('manual', true, 'by_owner', v_by_owner, 'counts_for_queue', false,
                             'no_countdown', true,
                             'actor_name', public.profile_display_name(v_actor),
                             'from_name', public.profile_display_name(v_previous_owner),
                             'to_name', public.profile_display_name(p_target)));
  return v_lead;
end;
$$;
revoke all on function public.reassign_lead(uuid, uuid) from public, anon;
grant execute on function public.reassign_lead(uuid, uuid) to authenticated;
comment on function public.reassign_lead(uuid, uuid) is
  'Repasse manual (dono, gerente ou diretor): o lead vai direto ao novo corretor SEM cronômetro de atendimento (0275). Se ninguém tratar, só fica atrasado.';
