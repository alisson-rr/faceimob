-- =============================================================================
-- 0316 — reativar um lead perdido/descartado direto para um corretor.
-- =============================================================================
-- Pedido de 03/11/2026: "preciso devolver um lead descartado a um corretor".
-- O repasse (`reassign_lead`) não servia: o lead encerrado não tem dono nem
-- está na fila, então a checagem de visibilidade o recusava, e o check da 0005
-- (`lost_at` só em lead perdido) barraria a troca de status do perdido.
--
-- Mesmas regras do repasse pela liderança: permissão `leads.reassign`, e o
-- corretor escolhido precisa estar ao alcance (admin ou gestor dele). Sai como
-- repasse manual: sem cronômetro e fora da contagem da fila (0275).

create or replace function public.reativar_lead(p_lead_id uuid, p_target uuid)
returns public.leads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead   public.leads;
  v_hours  int;
  v_actor  uuid := auth.uid();
  v_ultimo uuid;
begin
  if v_actor is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  if not public.has_permission('leads.reassign') then
    raise exception 'Sem permissão para reativar leads.' using errcode = '42501';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead não encontrado.' using errcode = 'P0002'; end if;

  if v_lead.status not in ('lost', 'discarded') or v_lead.converted_deal_id is not null then
    raise exception 'Só lead perdido ou descartado pode ser reativado.' using errcode = 'P0001';
  end if;

  -- Fora do admin, só o lead que passou por alguém do alcance de quem reativa.
  select la.profile_id into v_ultimo
    from public.lead_assignments la where la.lead_id = p_lead_id
   order by la.sequence desc limit 1;
  if not public.is_admin()
     and not coalesce(v_ultimo in (select public.auth_visible_profiles()), false) then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = p_target and p.status = 'active'
      and exists (select 1 from public.user_roles ur where ur.profile_id = p.id and ur.role = 'broker')
  ) then raise exception 'O corretor escolhido não existe ou está inativo.' using errcode = 'P0002'; end if;
  if not (public.is_admin() or public.manages_profile(p_target)) then
    raise exception 'Sem permissão para entregar a este corretor.' using errcode = '42501';
  end if;

  update public.lead_assignments set released_at = now(), release_reason = 'reassigned'
   where lead_id = p_lead_id and released_at is null;

  insert into public.lead_assignments
    (lead_id, profile_id, group_id, sequence, deadline, responded_at, counts_for_queue)
  select p_lead_id, p_target, v_lead.distribution_group_id,
         coalesce(max(la.sequence), 0) + 1, now(), now(), false
    from public.lead_assignments la where la.lead_id = p_lead_id;

  select s.no_response_hours into v_hours from public.automation_settings s where s.id;

  -- Status e `lost_at` na mesma linha: o check da 0005 os amarra.
  update public.leads
     set status = 'assigned', assigned_to = p_target, assigned_at = now(),
         attend_deadline = null,
         lost_reason = null, lost_at = null,
         next_action_at = now() + make_interval(hours => coalesce(v_hours, 24)),
         last_activity_at = now()
   where id = p_lead_id returning * into v_lead;

  insert into public.lead_events (lead_id, actor_id, kind, to_value, detail)
  values (p_lead_id, v_actor, 'reactivated', p_target::text,
          jsonb_build_object('manual', true, 'no_countdown', true,
                             'actor_name', public.profile_display_name(v_actor),
                             'to_name', public.profile_display_name(p_target)));
  return v_lead;
end;
$$;

revoke all on function public.reativar_lead(uuid, uuid) from public, anon;
grant execute on function public.reativar_lead(uuid, uuid) to authenticated;
comment on function public.reativar_lead(uuid, uuid) is
  'Reativa lead perdido/descartado direto para um corretor, como repasse manual da liderança (0316).';
