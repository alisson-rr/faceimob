-- =============================================================================
-- 0128 · Gestor não amplia o próprio alcance pela API
--
-- Auditoria de visibilidade de 12/09/2026. Cada caso foi provado na homologação
-- (carga real) com o JWT do gestor, dentro de bloco DO desfeito por exceção —
-- nada ficou gravado:
--
--   1. team_members_manage (0044) conferia a capacidade (teams.manage) e a
--      equipe (team_id lidera), nunca QUEM entra. O gerente incluiu na própria
--      equipe um corretor sem equipe: leads visíveis 7.825 → 10.108, negócios
--      815 → 894 — e passou a editar os dois (manages_profile).
--   2. teams_admin_write (0068): o WITH CHECK do diretor só exigia
--      director_id = ele. Ele criou equipe com um corretor qualquer de gerente e
--      os leads visíveis foram de 30.021 a 32.304 — auth_visible_profiles()
--      inclui o gerente das equipes lideradas.
--   3. reassign_lead (0044) conferia o corretor de DESTINO, não o lead de
--      ORIGEM. O gerente puxou para a equipe dele um lead de outra: visível 0 → 1.
--
-- A regra, igual nas três: gestor só grava hierarquia e só move lead sobre gente
-- que ele JÁ enxerga. `auth_visible_profiles()` é a fonte de verdade da
-- visibilidade; as três travas passam por ela, não por uma cópia.
--
-- POR QUE NÃO "SÓ ADMIN", como a 0104 fez com a tela de Equipes:
--   · o diretor ainda cria equipe em /admin/daily-teams (menu.admin_daily_teams
--     é dele) — fechar `teams` quebraria a tela. O seletor de gerente dela lê
--     `profiles` pelo RLS, então só oferece quem a trava nova aceita;
--   · `teams.manage` segue com efeito (desligar integrante da própria equipe).
--     Virar código sem leitor não fecharia nada a mais: o que ampliava o
--     alcance era INCLUIR gente de fora.
--
-- SNAPSHOT. auth_visible_profiles() é STABLE e SECURITY DEFINER (não é expandida
-- em linha): no WITH CHECK ela lê a foto do início do comando. A filiação que
-- está sendo gravada não torna a pessoa visível a tempo de passar na própria
-- checagem, e o integrante sendo desligado ainda conta como visível. Os dois
-- lados estão provados em supabase/tests/99_hierarquia_escopo.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. team_members: incluir, reabrir ou mover só gente que o gestor já enxerga.
-- -----------------------------------------------------------------------------
alter policy team_members_manage on public.team_members
  using (
    public.is_admin()
    or (public.has_permission('teams.manage')
        and team_id in (select public.auth_led_team_ids())
        and profile_id in (select public.auth_visible_profiles()))
  )
  with check (
    public.is_admin()
    or (public.has_permission('teams.manage')
        and team_id in (select public.auth_led_team_ids())
        and profile_id in (select public.auth_visible_profiles()))
  );

update public.permissions
   set description = 'Desligar integrantes; incluir só quem já está no seu alcance'
 where code = 'teams.manage';

-- -----------------------------------------------------------------------------
-- 2. teams: o gerente que o diretor grava tem de estar no alcance dele.
--    O USING (quais equipes ele edita, e a órfã adotável da 0068) não muda.
--
-- ponytail: reativar equipe inativa SEM gerente devolve o alcance sobre as
-- filiações que ficaram abertas nela, sem checar quem são; hoje são 0 na
-- homologação, e "Desativar equipe" fecha as filiações antes de desativar.
-- Evoluir quando aparecer equipe inativa com filiação aberta.
-- -----------------------------------------------------------------------------
alter policy teams_admin_write on public.teams
  with check (
    public.is_admin()
    or (
      public.has_any_role('director')
      and director_id = auth.uid()
      and (manager_id is null or manager_id in (select public.auth_visible_profiles()))
    )
  );

-- -----------------------------------------------------------------------------
-- 3. reassign_lead: o lead de origem tem de estar no alcance de quem realoca.
--    Corpo copiado da 0044; a diferença é o `if` depois do `select ... for update`.
-- -----------------------------------------------------------------------------
create or replace function public.reassign_lead(p_lead_id uuid, p_target uuid)
returns public.leads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead    public.leads;
  v_timeout int;
begin
  if not public.has_permission('leads.reassign') then
    raise exception 'Sem permissão para realocar leads.' using errcode = '42501';
  end if;

  if not (public.is_admin() or public.manages_profile(p_target)) then
    raise exception 'Sem permissão para realocar para este corretor.' using errcode = '42501';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;

  -- Mesmo predicado da `leads_select`: dono no alcance, ou lead da fila para
  -- quem tem leads.view_queue. A função é SECURITY DEFINER e não passa pelo
  -- RLS, então sem isto bastava o id de um lead de outra equipe. Fora do
  -- alcance a resposta é a mesma de id inexistente: "sem permissão" confirmaria
  -- que o lead existe. `coalesce` porque `null in (...)` é null, e `if null`
  -- deixaria passar.
  if not found or not coalesce(
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
     set status           = 'assigned',
         assigned_to      = p_target,
         assigned_at      = now(),
         attend_deadline  = now() + make_interval(secs => v_timeout),
         last_activity_at = now()
   where id = p_lead_id
  returning * into v_lead;

  insert into public.lead_events (lead_id, actor_id, kind, to_value, detail)
  values (p_lead_id, auth.uid(), 'reassigned', p_target::text,
          jsonb_build_object('manual', true));

  return v_lead;
end;
$$;
