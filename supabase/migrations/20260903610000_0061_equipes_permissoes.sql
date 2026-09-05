-- =============================================================================
-- 0061 — Equipes e permissões: fechar o que a TELA escondia e o BANCO permitia
--
-- Seis defeitos com a mesma assinatura (mais um bloco de documentação): a
-- interface esconde o controle e o banco continua aceitando a chamada por API. Esconder botão é conveniência;
-- quem barra é a policy. Cada bloco abaixo move a regra para onde ela vale.
--
--  1. `teams_admin_write` era `has_any_role('admin','director')` sem recorte:
--     QUALQUER diretor renomeava ou trocava o diretor de QUALQUER equipe,
--     inclusive as que não dirige. A tela recorta por `inScope`; o banco não.
--  2. `profiles_manager_update` deixava o gerente alterar QUALQUER coluna do
--     subordinado — inclusive `profiles.email`, que passaria a divergir do
--     e-mail do Auth (a tela mostraria um login que não existe).
--  3. `goals_write` era `has_any_role('admin','director')` sem recorte: um
--     diretor gravava meta de perfil de qualquer diretoria.
--  4. `set_profile_roles` não contava admins: um admin podia remover o admin do
--     outro até sobrar zero. Com `enable_signup=false` e o provisionamento
--     exigindo admin, não haveria recuperação pela aplicação.
--  5. `deals.edit_value` era um switch decorativo — ninguém lia o código. Agora
--     um gatilho o lê ao mudar VGV. As concessões abaixo reproduzem EXATAMENTE
--     quem editava antes (todo participante), então nada muda no deploy: o que
--     muda é que desligar o switch passa a negar de verdade.
--  6. Três códigos do catálogo (`deals.view_all`, `users.manage_roles`,
--     `game.close_season`) nunca tiveram leitor e não vão ter: as decisões
--     correspondentes são por papel, no código. Apagá-los daqui não durava um
--     `db:reset` (o seed os reinsere depois das migrations), então o bloco 6
--     documenta por que ficam e a tela os marca "Ainda sem efeito".
--  7. Nenhuma migration semeava `stage_permissions`: um `db:reset` em banco
--     limpo deixava a matriz VAZIA e ninguém além do admin movia negócio. O
--     bloco 7 semeia a matriz vigente na homologação, com `do nothing` — banco
--     que já tem configuração não é tocado.
--
-- Mais: `access_provision_log`, para "quem provisionou o acesso de quem" deixar
-- rastro (não existe tabela de auditoria genérica neste schema).
--
-- Idempotente: só `create or replace`, `drop policy if exists` + `create`,
-- `create table if not exists` e inserts com `on conflict do nothing`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. teams — diretor manda na PRÓPRIA equipe
--
-- `director_id is null` continua alcançável: é como uma equipe recém-criada
-- (ou órfã) é adotada por um diretor. O `with check` só aceita o próprio id,
-- então adotar significa assumir — nunca passar a equipe para outro diretor.
-- Admin não é recortado.
-- -----------------------------------------------------------------------------
drop policy if exists teams_admin_write on public.teams;
create policy teams_admin_write on public.teams
  for all to authenticated
  using (
    public.is_admin()
    or (public.has_any_role('director') and (director_id = auth.uid() or director_id is null))
  )
  with check (
    public.is_admin()
    or (public.has_any_role('director') and director_id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- 2. profiles — e-mail de acesso tem um dono só
--
-- RLS trabalha por linha; restrição por coluna precisa de gatilho, e o gatilho
-- já existe desde a 0012. O ramo do gestor devolvia `new` conferindo apenas
-- `bypass_ip_check`: `email` passava. `profiles.email` é o espelho do e-mail do
-- Auth, e só a edge function `provision-broker-user` troca os dois juntos.
--
-- Por isso o `service_role` ganha passagem explícita AQUI e só aqui: ele é a
-- própria edge function, que é a dona do e-mail. `bypass_ip_check` continua
-- fora do alcance dela — a trava antifraude do check-in não se afrouxa por
-- conveniência (mesma decisão que `e2e/support/fixtures.ts` documenta).
-- -----------------------------------------------------------------------------
create or replace function public.profiles_guard_admin_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  -- Edge function com service role: dona do e-mail de acesso, nada além disso.
  if auth.role() = 'service_role' then
    if new.bypass_ip_check is distinct from old.bypass_ip_check then
      raise exception 'Somente o administrador libera a validação de IP.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Gestor pode desligar/suspender quem gerencia, mas nunca liberar o bypass
  -- de IP nem trocar o e-mail de acesso: o e-mail vive no Auth, e mudá-lo aqui
  -- só criaria um login que não existe.
  if public.manages_profile(new.id) then
    if new.bypass_ip_check is distinct from old.bypass_ip_check then
      raise exception 'Somente o administrador libera a validação de IP.'
        using errcode = '42501';
    end if;
    if new.email is distinct from old.email then
      raise exception 'Somente o administrador altera o e-mail de acesso.'
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

-- -----------------------------------------------------------------------------
-- 3. goals — diretor grava meta da própria diretoria
--
-- Meta global (`scope = 'global'`) continua aberta a diretor: é a meta da
-- empresa, e a tela (GlobalGoalCard) já a oferece a admin e diretor.
-- -----------------------------------------------------------------------------
drop policy if exists goals_write on public.goals;
create policy goals_write on public.goals
  for all to authenticated
  using (
    public.is_admin()
    or (public.has_any_role('director') and (
          scope = 'global'
          or (scope = 'team'    and team_id    in (select public.auth_led_team_ids()))
          or (scope = 'profile' and profile_id in (select public.auth_visible_profiles()))
       ))
  )
  with check (
    public.is_admin()
    or (public.has_any_role('director') and (
          scope = 'global'
          or (scope = 'team'    and team_id    in (select public.auth_led_team_ids()))
          or (scope = 'profile' and profile_id in (select public.auth_visible_profiles()))
       ))
  );

-- -----------------------------------------------------------------------------
-- 4. user_roles — a instalação não pode ficar sem administrador
--
-- `enable_signup` é falso e provisionar acesso exige admin: zero admins é uma
-- porta trancada por fora, sem chave dentro do app.
--
-- O guard vai no GATILHO, não em `set_profile_roles`. Pela RPC o buraco não
-- existe (ela exige `is_admin()` do chamador, então sempre sobra o chamador, e
-- tirar o próprio admin já era recusado desde a 0046). O buraco é a policy
-- `user_roles_admin_write`, que é `for all using is_admin() with check
-- is_admin()`: um admin apaga a própria linha de admin direto na tabela pela
-- API REST e a instalação fica sem nenhum.
--
-- `for all` inclui UPDATE, e `authenticated` tem esse privilégio na tabela.
-- Então DELETE não é a única porta: `PATCH /user_roles?profile_id=eq.<eu>&
-- role=eq.admin` com `{"role":"broker"}` TROCA a linha em vez de apagá-la, o
-- `with check is_admin()` ainda enxerga o papel antigo no snapshot do comando,
-- e o resultado é o mesmo — zero administradores. Por isso o gatilho é
-- `before delete or update`, e no ramo de UPDATE conta do mesmo jeito quando o
-- papel de admin está saindo da linha (`new.role is distinct from old.role`).
-- Mudar só o `profile_id` mantendo `role = 'admin'` passa: o papel continua
-- existindo, apenas em outra pessoa.
--
-- A exclusão do PERFIL continua possível: quando o `delete` vem em cascata de
-- `profiles`, a linha do perfil já não existe neste snapshot, e é assim que o
-- gatilho distingue "retirar o papel de alguém que fica" de "a pessoa saiu".
--
-- `raise exception` sem errcode = P0001, que `describeError` mostra como está —
-- a frase em pt-BR é justamente o que o admin precisa ler.
-- -----------------------------------------------------------------------------
create or replace function public.user_roles_guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Ramo explícito por TG_OP: em gatilho de DELETE o registro `new` não existe,
  -- e `or` no SQL não garante curto-circuito — ler `new.role` numa condição
  -- combinada estouraria "record new is not assigned yet".
  v_perde_o_papel boolean;
begin
  if tg_op = 'DELETE' then
    v_perde_o_papel := old.role = 'admin';
  else
    v_perde_o_papel := old.role = 'admin' and new.role is distinct from old.role;
  end if;

  if v_perde_o_papel
     and exists (select 1 from public.profiles where id = old.profile_id)
     and not exists (
       select 1 from public.user_roles
        where role = 'admin' and profile_id <> old.profile_id
     ) then
    raise exception 'Este é o último administrador; promova outro antes de retirar a função.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists user_roles_guard_last_admin on public.user_roles;
create trigger user_roles_guard_last_admin
  before delete or update on public.user_roles
  for each row execute function public.user_roles_guard_last_admin();

-- -----------------------------------------------------------------------------
-- 5. deals.edit_value — o switch passa a valer
--
-- `vgv_net` é coluna gerada; o que se digita é `vgv_gross` e `discount_pct`.
-- Gatilho, e não policy: `deals_update` é território de outras rodadas e
-- redefini-la aqui apagaria a regra de quem edita o negócio. O gatilho soma uma
-- condição de COLUNA sem mexer em quem alcança a linha.
--
-- As concessões reproduzem quem editava antes: todo participante do negócio
-- (corretor, gerente, diretor) e quem analisa crédito. Ou seja, no dia do
-- deploy ninguém perde nada — o que muda é que DESLIGAR passa a negar.
-- -----------------------------------------------------------------------------
create or replace function public.deals_guard_value()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.vgv_gross is distinct from old.vgv_gross
      or new.discount_pct is distinct from old.discount_pct)
     and not public.has_permission('deals.edit_value') then
    raise exception 'Sem permissão para editar o VGV deste negócio.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists deals_guard_value on public.deals;
create trigger deals_guard_value
  before update on public.deals
  for each row execute function public.deals_guard_value();

insert into public.role_permissions (role, permission, allowed)
select r.role, 'deals.edit_value', true
from (values ('broker'::app_role), ('manager'), ('director'), ('cca')) as r(role)
where exists (select 1 from public.permissions where code = 'deals.edit_value')
on conflict (role, permission) do nothing;

-- -----------------------------------------------------------------------------
-- 6. Os três códigos sem leitor — por que continuam no catálogo
--
-- `deals.view_all`   — o recorte é `can_see_deal`, por papel (diretor, sócio,
--                      CCA). Trocar isso por permissão mudaria a visibilidade
--                      de negócio, que é decisão de produto, não de matriz.
-- `users.manage_roles` — a 0046 concentrou a troca de papel em
--                      `set_profile_roles`, admin-only por construção.
-- `game.close_season` — a RPC decide sozinha, também admin-only.
--
-- Nenhum tem leitor e nenhum vai ter enquanto essas três decisões forem por
-- papel. A versão anterior desta migration apagava os três do catálogo — e a
-- exclusão não durava um `db:reset`: `supabase/seed.sql:145-158` reinsere os
-- três com `on conflict do nothing` e `seed.sql:164,175,179` reconcede
-- `deals.view_all`, e o seed roda DEPOIS de todas as migrations. O resultado
-- era pior que o problema: `supabase/tests/21_feature_permissions.sql` (12
-- códigos, sem seed) e `23_equipes_permissoes.sql` (0 códigos, com seed) não
-- podiam passar ao mesmo tempo, e `validate-schema.sh --all` ficava vermelho
-- nos dois sentidos.
--
-- Enquanto o seed for de outro dono, a honestidade vive na TELA: o mapa
-- `src/lib/featurePermissions.ts` marca os três com `enforcedBy: null` e a aba
-- Funcionalidades mostra "Ainda sem efeito" ao lado do switch, dizendo por que
-- ele não muda nada. Retirar os três do catálogo de verdade é um par: tirar do
-- seed E apagar numa migration posterior — está registrado como pendência.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 7. stage_permissions semeada — `db:reset` não pode nascer com matriz vazia
--
-- Sem estas linhas, `can_enter_stage()` nega tudo para quem não é admin em
-- banco recém-criado: ninguém move negócio e a causa não aparece em lugar
-- nenhum. É a matriz vigente na homologação (39 linhas). `do nothing`: banco
-- com configuração própria não é sobrescrito.
-- -----------------------------------------------------------------------------
insert into public.stage_permissions (stage_id, role, can_enter, can_exit)
select s.id, m.role::app_role, m.can_enter, m.can_exit
from (values
  ('lead',            'admin',    true,  true),
  ('lead',            'director', true,  true),
  ('lead',            'manager',  true,  true),
  ('lead',            'broker',   true,  true),
  ('incomplete',      'admin',    true,  true),
  ('incomplete',      'director', true,  true),
  ('incomplete',      'manager',  true,  true),
  ('incomplete',      'broker',   true,  true),
  ('proposal',        'admin',    true,  true),
  ('proposal',        'director', true,  true),
  ('proposal',        'manager',  true,  true),
  ('proposal',        'broker',   true,  true),
  ('visit_scheduled', 'admin',    true,  true),
  ('visit_scheduled', 'director', true,  true),
  ('visit_scheduled', 'manager',  true,  true),
  ('visit_scheduled', 'broker',   true,  true),
  ('under_analysis',  'admin',    true,  true),
  ('under_analysis',  'director', true,  true),
  ('under_analysis',  'manager',  true,  true),
  ('under_analysis',  'broker',   true,  true),
  ('under_analysis',  'cca',      true,  true),
  -- 0052: aprovar é do CCA e da diretoria; corretor e gerente entram por
  -- solicitação, não por arraste.
  ('approved',        'admin',    true,  true),
  ('approved',        'director', true,  true),
  ('approved',        'manager',  false, false),
  ('approved',        'broker',   false, false),
  ('approved',        'cca',      true,  true),
  ('contract',        'admin',    true,  true),
  ('contract',        'director', true,  true),
  ('contract',        'manager',  true,  true),
  ('contract',        'cca',      true,  true),
  ('closed',          'admin',    true,  true),
  ('closed',          'director', true,  true),
  ('closed',          'manager',  true,  true),
  ('closed',          'cca',      true,  true),
  ('lost',            'admin',    true,  true),
  ('lost',            'director', true,  true),
  ('lost',            'manager',  true,  true),
  ('lost',            'broker',   true,  true),
  ('lost',            'cca',      true,  true)
) as m(stage_code, role, can_enter, can_exit)
join public.pipeline_stages s on s.code = m.stage_code
on conflict (stage_id, role) do nothing;

-- -----------------------------------------------------------------------------
-- 8. access_provision_log — quem provisionou o acesso de quem
--
-- Não existe tabela de auditoria genérica neste schema (`lead_events`,
-- `deal_history` e `cca_case_events` são por domínio). Esta é a do domínio de
-- acesso: uma linha por criação ou troca de e-mail de login, escrita pela edge
-- function com service role. Leitura só de admin; escrita, nenhuma pela API —
-- o service role passa por cima do RLS, e é o único que deve escrever.
-- -----------------------------------------------------------------------------
create table if not exists public.access_provision_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references public.profiles(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  action     text not null check (action in ('create', 'reset')),
  email      text not null,
  created_at timestamptz not null default now()
);

comment on table public.access_provision_log is
  'Trilha de provisionamento de acesso: quem criou/trocou o e-mail de login de quem. Escrita só pela edge function provision-broker-user (service role).';

create index if not exists access_provision_log_profile_idx
  on public.access_provision_log (profile_id, created_at desc);

alter table public.access_provision_log enable row level security;

drop policy if exists access_provision_log_admin_read on public.access_provision_log;
create policy access_provision_log_admin_read on public.access_provision_log
  for select to authenticated
  using (public.is_admin());

-- A 0023 deixa `alter default privileges` concedendo tabela nova a `anon`
-- também; aqui isso não faz sentido e o RLS já negaria — revogar deixa a
-- intenção escrita.
revoke all on public.access_provision_log from anon;
grant select on public.access_provision_log to authenticated;
grant select, insert on public.access_provision_log to service_role;
