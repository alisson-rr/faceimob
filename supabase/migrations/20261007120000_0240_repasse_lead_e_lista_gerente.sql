-- =============================================================================
-- 0240 · Repasse entre corretores e lista de ligação para gerente
-- =============================================================================

-- Diretório mínimo para o seletor de repasse. Um corretor precisa enxergar os
-- colegas mesmo que `profiles_select` mostre só o próprio perfil; nenhum dado
-- pessoal além do nome e da equipe sai daqui. Para a liderança, mantém-se o
-- recorte hierárquico usado nos demais filtros.
create or replace function public.lead_reassignment_brokers()
returns table(profile_id uuid, full_name text, team_id uuid, team_name text,
              manager_id uuid, director_id uuid)
language sql stable security definer set search_path = public, pg_temp
as $$
  select p.id, p.full_name, equipe.team_id, equipe.team_name,
         equipe.manager_id, equipe.director_id
    from public.profiles p
    left join lateral (
      select t.id as team_id, t.name as team_name, t.manager_id, t.director_id
        from public.team_members tm
        join public.teams t on t.id = tm.team_id and t.active
       where tm.profile_id = p.id and tm.left_at is null
       order by tm.joined_at desc, tm.id desc
       limit 1
    ) equipe on true
   where auth.uid() is not null
     and p.status = 'active'
     and exists (select 1 from public.user_roles ur
                  where ur.profile_id = p.id and ur.role = 'broker')
     and (
       (public.has_permission('leads.reassign')
         and p.id in (select public.auth_visible_profiles()))
       or (not public.has_permission('leads.reassign') and public.has_role('broker'))
     )
   order by p.full_name, p.id;
$$;
revoke all on function public.lead_reassignment_brokers() from public, anon;
grant execute on function public.lead_reassignment_brokers() to authenticated;
comment on function public.lead_reassignment_brokers() is
  'Nomes/equipes elegíveis no repasse: hierarquia para gestores e diretório de corretores ativos para o corretor.';

-- O corretor pode repassar apenas um lead que está na mão dele para outro
-- corretor ativo da Faceimob. A liderança continua usando a permissão e o
-- alcance já existentes. A passagem fecha a atribuição anterior, cria a nova e
-- portanto tira o lead da contagem/lista do corretor de origem.
create or replace function public.reassign_lead(p_lead_id uuid, p_target uuid)
returns public.leads
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_lead public.leads;
  v_timeout int;
  v_actor uuid := auth.uid();
  v_previous_owner uuid;
  v_by_permission boolean;
  v_by_owner boolean;
begin
  if v_actor is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;
  v_previous_owner := v_lead.assigned_to;

  v_by_permission := public.has_permission('leads.reassign');
  v_by_owner := coalesce(v_lead.assigned_to = v_actor, false) and public.has_role('broker');
  if not (v_by_permission or v_by_owner) then
    raise exception 'Você só pode repassar leads que estão com você.' using errcode = '42501';
  end if;
  if v_by_owner and not v_by_permission
     and v_lead.status not in ('assigned', 'attending', 'in_progress') then
    raise exception 'Este lead já foi encerrado ou saiu da sua carteira.' using errcode = 'P0001';
  end if;

  if p_target = v_previous_owner then
    raise exception 'Escolha outro corretor para receber o lead.' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles p
     where p.id = p_target and p.status = 'active'
       and exists (select 1 from public.user_roles ur
                    where ur.profile_id = p.id and ur.role = 'broker')
  ) then
    raise exception 'O corretor escolhido não existe ou está inativo.' using errcode = 'P0002';
  end if;

  -- Gestor continua limitado à hierarquia. O dono do lead pode escolher outro
  -- corretor ativo porque este é um repasse voluntário entre colegas.
  if v_by_permission and not v_by_owner
     and not (public.is_admin() or public.manages_profile(p_target)) then
    raise exception 'Sem permissão para realocar para este corretor.' using errcode = '42501';
  end if;
  if v_by_permission and not v_by_owner and not coalesce(
       case when v_lead.assigned_to is null
            then public.has_permission('leads.view_queue')
            else v_lead.assigned_to in (select public.auth_visible_profiles())
       end, false) then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  update public.lead_assignments
     set released_at = now(), release_reason = 'reassigned'
   where lead_id = p_lead_id and released_at is null;

  v_timeout := public.effective_attend_timeout(v_lead.distribution_group_id);
  insert into public.lead_assignments (lead_id, profile_id, group_id, sequence, deadline)
  select p_lead_id, p_target, v_lead.distribution_group_id,
         coalesce(max(la.sequence), 0) + 1,
         now() + make_interval(secs => v_timeout)
    from public.lead_assignments la where la.lead_id = p_lead_id;

  update public.leads
     set status = 'assigned', assigned_to = p_target, assigned_at = now(),
         attend_deadline = now() + make_interval(secs => v_timeout),
         last_activity_at = now()
   where id = p_lead_id
  returning * into v_lead;

  insert into public.lead_events (lead_id, actor_id, kind, from_value, to_value, detail)
  values (p_lead_id, v_actor, 'reassigned', v_previous_owner::text, p_target::text,
          jsonb_build_object('manual', true, 'by_owner', v_by_owner));
  return v_lead;
end;
$$;
revoke all on function public.reassign_lead(uuid, uuid) from public, anon;
grant execute on function public.reassign_lead(uuid, uuid) to authenticated;
comment on function public.reassign_lead(uuid, uuid) is
  'Gestores realocam dentro do alcance; corretor repassa o próprio lead a outro corretor ativo.';

-- A função já usa SECURITY INVOKER: o gerente recebe somente os leads que a
-- RLS da equipe dele permite. O embaralhamento continua no cliente antes de
-- gerar PDF/Excel, evitando blocos da mesma campanha.
insert into public.role_permissions (role, permission, allowed)
values ('manager', 'leads.call_list', true)
on conflict (role, permission) do update set allowed = excluded.allowed;

update public.permissions
   set description = 'Baixar em PDF ou Excel uma lista embaralhada de leads antigos visíveis ao líder, sem negócio convertido.'
 where code = 'leads.call_list';
