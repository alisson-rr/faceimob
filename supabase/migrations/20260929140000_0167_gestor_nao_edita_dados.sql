-- =============================================================================
-- 0167 — gestor muda situação e equipe, não os dados da pessoa
--
-- Pedido de 29/09/2026: "o diretor pediu para mover seus corretores entre as
-- equipes dele e inativar se sair, mas não quero que ele edite os dados dos
-- usuários". Mover já é `team_members` (policy `team_members_manage`, 0044) e
-- inativar é a edge `provision-broker-user` (status + bloqueio da entrada). O
-- que faltava fechar é a linha de `profiles`.
--
-- O ramo do gestor (`manages_profile`) do `profiles_guard_admin_columns` (0061)
-- barrava só e-mail e bypass de IP: nome, telefone, CPF, CRECI, endereço e foto
-- passavam. Agora o gestor — gerente ou diretor — muda só:
--   · `status` (suspender/reativar quem lidera; desligar segue do admin, porque
--     `terminated_at` continua fora da lista);
--   · as datas do crachá, que são operação da equipe e não dado pessoal.
-- `updated_at` é do gatilho `set_updated_at`.
--
-- E um defeito junto: `manages_profile(self)` é verdadeiro para quem lidera a
-- própria equipe (0075), então o gestor caía neste ramo ao editar a PRÓPRIA
-- ficha e podia mudar o próprio `status`. A própria linha agora vai sempre para
-- o ramo do próprio usuário: dados de contato sim, campos administrativos não.
-- =============================================================================
create or replace function public.profiles_guard_admin_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- O que o gestor pode mudar na linha de quem lidera.
  v_do_gestor constant text[] := array['status', 'badge_requested_at', 'badge_delivered_at', 'updated_at'];
begin
  if public.is_admin() then
    return new;
  end if;

  -- Edge function com service role: dona do e-mail de acesso e da inativação
  -- (`provision-broker-user`), nada além disso.
  if auth.role() = 'service_role' then
    if new.bypass_ip_check is distinct from old.bypass_ip_check then
      raise exception 'Somente o administrador libera a validação de IP.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id is distinct from auth.uid() and public.manages_profile(new.id) then
    if (to_jsonb(new) - v_do_gestor) is distinct from (to_jsonb(old) - v_do_gestor) then
      raise exception 'Só o administrador altera os dados do colaborador; o gestor muda a situação, o crachá e a equipe.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- O próprio usuário só edita dados de contato.
  if new.status          is distinct from old.status
  or new.bypass_ip_check is distinct from old.bypass_ip_check
  or new.email           is distinct from old.email
  or new.terminated_at   is distinct from old.terminated_at
  or new.hired_at        is distinct from old.hired_at then
    raise exception 'Campos administrativos do perfil só podem ser alterados pelo administrador.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.profiles_guard_admin_columns() is
  'Colunas de profiles por papel (0167): admin tudo; service_role tudo menos bypass de IP; gestor de OUTRA pessoa só '
  'status e crachá; o próprio usuário só contato. Mover de equipe é move_team_member; inativar é provision-broker-user.';

-- =============================================================================
-- Mover uma pessoa entre equipes que o gestor lidera, numa operação só.
--
-- Pela tabela não dava: a policy `team_members_manage` (0128) exige, no insert,
-- que a pessoa seja visível (`auth_visible_profiles()`), e ela deixa de ser no
-- instante em que o vínculo antigo fecha. O diretor tirava o corretor da equipe
-- A e ficava recusado ao pô-lo na B — as duas dele. Aqui as duas pontas são
-- conferidas ANTES: a equipe de hoje e a de destino têm de ser lideradas por
-- quem chama (ou quem chama é admin). Quem lidera equipe não é movido por aqui:
-- tirar o gerente da equipe que ele lidera o esconderia do próprio diretor.
-- =============================================================================
create or replace function public.move_team_member(p_profile_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_atual uuid;
begin
  if auth.uid() is null then
    raise exception 'Sessão obrigatória.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.teams t where t.id = p_team_id and t.active) then
    raise exception 'Equipe de destino inexistente ou desativada.' using errcode = 'P0001';
  end if;

  select tm.team_id into v_atual
    from public.team_members tm
   where tm.profile_id = p_profile_id and tm.left_at is null;

  if v_atual = p_team_id then
    return;
  end if;

  if not public.is_admin() then
    if not public.has_permission('teams.manage')
       or p_team_id not in (select public.auth_led_team_ids())
       or (v_atual is not null and v_atual not in (select public.auth_led_team_ids()))
       or (v_atual is null and p_profile_id not in (select public.auth_visible_profiles())) then
      raise exception 'Você só move pessoas entre equipes que lidera.' using errcode = '42501';
    end if;
    if exists (select 1 from public.teams t where t.active and t.manager_id = p_profile_id) then
      raise exception 'Quem lidera uma equipe só é movido pelo administrador.' using errcode = '42501';
    end if;
  end if;

  update public.team_members
     set left_at = current_date
   where profile_id = p_profile_id and left_at is null;

  insert into public.team_members (team_id, profile_id) values (p_team_id, p_profile_id);
end;
$$;

comment on function public.move_team_member(uuid, uuid) is
  'Troca a equipe de uma pessoa numa operação (0167): admin, ou gestor com teams.manage que lidera a equipe de hoje e a de destino.';

revoke all on function public.move_team_member(uuid, uuid) from public, anon;
grant execute on function public.move_team_member(uuid, uuid) to authenticated, service_role;
