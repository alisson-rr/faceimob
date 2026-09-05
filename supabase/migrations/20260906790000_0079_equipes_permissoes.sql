-- =============================================================================
-- 0079 — Equipes e permissões: a hierarquia deixa de mentir, e trocar papel
--        deixa rastro.
--
-- Cinco defeitos medidos na homologação, todos da mesma família ("a tela diz
-- uma coisa, o banco faz outra"):
--
-- 1. O DIRETOR NÃO ENXERGAVA O GERENTE DA PRÓPRIA EQUIPE.
--    `auth_visible_profiles()` alcançava só quem está em `team_members` das
--    equipes lideradas. Nada no SCHEMA obriga o gerente a ser membro da equipe
--    que ele lidera — quem faz isso é o front (`createTeamForManager`) e o
--    seed. Bastava uma equipe criada por outro caminho para o diretor abrir
--    /equipes e ler "Gerentes (0)", com todo card de corretor marcado
--    "Sem gerente" e "Vincular em massa" sem ninguém para vincular. Pior: como
--    `goals_write` do diretor exige `profile_id in auth_visible_profiles()`,
--    ele não conseguia sequer gravar a meta do próprio gerente.
--    Correção: o gerente das equipes que EU lidero entra no conjunto visível.
--    Isso é a hierarquia que o schema já afirma (`teams.director_id`), não um
--    alargamento — e não muda nada para admin, sócio, gerente ou corretor.
--
-- 2. NINGUÉM SUBIA A HIERARQUIA — e por isso TODO corretor lia "Sem gerente"
--    no próprio card. Ele lê `teams` (a policy `teams_select` é `true`), então
--    conhece o id do gerente e do diretor, mas `profiles_select` não o deixa
--    ler o NOME dessas duas pessoas. A saída NÃO é abrir `profiles`: a tabela
--    guarda cpf, address e birth_date, e RLS é por linha — abrir a linha do
--    diretor para 30 corretores entregaria o CPF dele junto. Em vez disso,
--    uma view com nome e avatar de quem lidera ou dirige equipe ativa. É o
--    mínimo para a tela escrever "↑ Fulano" em vez de uma informação falsa.
--
-- 3. TROCA DE PAPEL NÃO DEIXAVA RASTRO. O `delete` de `user_roles` não escreve
--    em lugar nenhum: "quem tirou o papel de diretor de fulano, e quando" era
--    irrecuperável. `access_provision_log` só registra e-mail de acesso.
--
-- 4. A AUDITORIA SE APAGA NO DESLIGAMENTO. `access_provision_log.actor_id` é
--    `on delete set null`: apagada a conta de quem provisionou, some "quem".
--    O e-mail do alvo já era guardado como texto; o do ator não. Some também a
--    recusa: o 403 da edge function não registrava nada, e é a única tentativa
--    que vale a pena auditar.
--
-- O que esta migration NÃO faz, de propósito:
--   · não cria índice único em `teams(manager_id) where active` — a suíte E2E
--     provisiona DUAS equipes ativas para o mesmo gerente (`ensureTeam` alfa e
--     beta em `e2e/support/users.ts`), e o índice quebraria o preparo de todos
--     os specs. A saída pela tela ("Desativar equipe", em /equipes) fecha o
--     beco sem exigir a mudança de fixture;
--   · não mexe em `teams_select` (`true` para todo autenticado) nem tira
--     `partner` do ramo aberto de `auth_visible_profiles()`: o mesmo predicado
--     gate `leads`, `checkins`, `tasks`, `visits` e `daily_entries`, e o sócio
--     tem `menu.leads`/`menu.pipeline` concedidos. Estreitar ali é decisão de
--     produto, não de implementação.
--
-- Idempotente: `create or replace`, `create table if not exists`,
-- `drop policy if exists` + `create`, `add column if not exists` e
-- `alter constraint` por drop/add condicional.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. auth_visible_profiles — o diretor enxerga o gerente das equipes que dirige
--
-- Um ramo a mais, e só ele. Para gerente o novo ramo devolve ele mesmo (já
-- estava no conjunto pelo `select auth.uid()`), para corretor devolve vazio, e
-- para admin/sócio nada muda. O único conjunto que cresce é o do diretor, com
-- exatamente as pessoas que ele já administra pelo `teams.director_id`.
-- -----------------------------------------------------------------------------
create or replace function public.auth_visible_profiles()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
  from public.profiles p
  where public.has_any_role('admin', 'partner')

  union

  select auth.uid()
  where auth.uid() is not null

  union

  select tm.profile_id
  from public.team_members tm
  where tm.left_at is null
    and tm.team_id in (select public.auth_led_team_ids())

  union

  -- Gerente das equipes que eu lidero/dirijo. Sem isto, um gerente que não
  -- fosse MEMBRO da própria equipe ficava invisível para o diretor dela.
  select t.manager_id
  from public.teams t
  where t.manager_id is not null
    and t.id in (select public.auth_led_team_ids());
$$;

comment on function public.auth_visible_profiles is
  'Perfis visíveis ao usuário corrente segundo a hierarquia: admin/sócio veem tudo; todos veem a si mesmos; quem lidera equipe ativa vê os membros abertos dela E o gerente dela. Usar em RLS como: owner_id in (select public.auth_visible_profiles()).';

-- -----------------------------------------------------------------------------
-- 2. team_leader_names — nome de quem lidera, sem abrir a ficha
--
-- Só id, nome e avatar, e só de quem é gerente ou diretor de equipe ATIVA. É o
-- que a tela precisa para resolver "↑ Fulano" no card do corretor e o par
-- Gerente/Diretor em "Meu Perfil". Nome de quem lidera equipe é informação de
-- organograma; cpf, endereço e nascimento continuam onde estavam, atrás de
-- `profiles_select`.
--
-- A view roda com os privilégios do dono (`security_invoker` fica em `false`,
-- o padrão), então ela ATRAVESSA `profiles_select` de propósito — é a razão de
-- existir. Por isso a lista de colunas é fechada aqui e não em quem consulta.
-- -----------------------------------------------------------------------------
drop view if exists public.team_leader_names;
create view public.team_leader_names as
  select p.id, p.full_name, p.avatar_url
  from public.profiles p
  where exists (
    select 1
    from public.teams t
    where t.active
      and (t.manager_id = p.id or t.director_id = p.id)
  );

comment on view public.team_leader_names is
  'Nome e avatar de quem é gerente ou diretor de equipe ativa, legível por qualquer autenticado. Existe porque auth_visible_profiles() não sobe a hierarquia: o corretor lê teams (policy aberta) e conhece o id do gerente, mas não a linha de profiles dele. Expõe SOMENTE id, full_name e avatar_url — nunca cpf, endereço ou nascimento.';

revoke all on public.team_leader_names from anon;
grant select on public.team_leader_names to authenticated;

-- -----------------------------------------------------------------------------
-- 3. role_change_log — quem trocou o papel de quem
--
-- `access_provision_log` é do domínio de acesso (e-mail de login) e o `check`
-- dela só aceita create/reset. Papel é outro domínio e outra pergunta.
--
-- Os e-mails vão como TEXTO, não só como fk: as duas fks são `on delete set
-- null` (senão apagar uma conta seria impossível), e a pergunta "quem tirou o
-- papel de fulano" costuma ser feita DEPOIS de fulano sair da empresa.
-- -----------------------------------------------------------------------------
create table if not exists public.role_change_log (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid references public.profiles(id) on delete set null,
  profile_email text,
  actor_id      uuid references public.profiles(id) on delete set null,
  actor_email   text,
  roles_before  app_role[] not null default '{}',
  roles_after   app_role[] not null default '{}',
  created_at    timestamptz not null default now()
);

comment on table public.role_change_log is
  'Trilha de troca de papel: conjunto antes e depois, quem mudou e quando. Escrita só por set_profile_roles(). Guarda os e-mails como texto porque as fks são on delete set null.';

create index if not exists role_change_log_profile_idx
  on public.role_change_log (profile_id, created_at desc);

alter table public.role_change_log enable row level security;

drop policy if exists role_change_log_admin_read on public.role_change_log;
create policy role_change_log_admin_read on public.role_change_log
  for select to authenticated
  using (public.is_admin());

-- A 0023 concede tabela nova a `anon` por default privileges; aqui não faz
-- sentido e o RLS já negaria — revogar deixa a intenção escrita.
revoke all on public.role_change_log from anon;
grant select on public.role_change_log to authenticated;

-- -----------------------------------------------------------------------------
-- 4. set_profile_roles — o rastro que faltava
--
-- Única mudança de comportamento: toda troca que MUDA alguma coisa escreve uma
-- linha em `role_change_log`. Conjunto idêntico não gera linha (a ficha salva o
-- formulário inteiro a cada clique em Salvar; registrar isso seria ruído, não
-- auditoria).
--
-- NÃO há guarda nova de "pelo menos um administrador" porque ela JÁ EXISTE, e
-- num lugar melhor: o gatilho `user_roles_guard_last_admin` recusa a saída do
-- último admin em DELETE e em UPDATE, venha a chamada desta RPC ou de um PATCH
-- direto em /user_roles (asserts em supabase/tests/23_equipes_permissoes.sql).
-- Repeti-la aqui só duplicaria a regra em dois lugares. O que a ficha dizia e
-- continua verdade: o banco não deixa a empresa sem administrador.
-- O assert desta migration está em supabase/tests/79_equipes_permissoes.sql.
-- -----------------------------------------------------------------------------
create or replace function public.set_profile_roles(p_profile_id uuid, p_roles app_role[])
returns app_role[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_roles  app_role[] := (
    select array_agg(distinct r) from unnest(coalesce(p_roles, '{}'::app_role[])) as r
  );
  v_before app_role[];
  v_after  app_role[];
begin
  if not public.is_admin() then
    raise exception 'Somente o administrador altera funções.' using errcode = '42501';
  end if;

  if v_roles is null or cardinality(v_roles) = 0 then
    raise exception 'Escolha ao menos uma função para o colaborador.';
  end if;

  select array_agg(role order by role) into v_before
    from public.user_roles where profile_id = p_profile_id;

  if p_profile_id = auth.uid() and not ('admin' = any(v_roles)) then
    raise exception 'Você não pode remover a sua própria função de administrador.';
  end if;

  -- Insere antes de apagar: em nenhum instante o perfil fica sem papel.
  insert into public.user_roles (profile_id, role, granted_by)
  select p_profile_id, r, auth.uid()
    from unnest(v_roles) as r
  on conflict (profile_id, role) do nothing;

  delete from public.user_roles
   where profile_id = p_profile_id
     and role <> all(v_roles);

  select array_agg(role order by role) into v_after
    from public.user_roles where profile_id = p_profile_id;

  if coalesce(v_before, '{}'::app_role[]) is distinct from coalesce(v_after, '{}'::app_role[]) then
    insert into public.role_change_log
      (profile_id, profile_email, actor_id, actor_email, roles_before, roles_after)
    values (
      p_profile_id,
      (select email::text from public.profiles where id = p_profile_id),
      auth.uid(),
      (select email::text from public.profiles where id = auth.uid()),
      coalesce(v_before, '{}'::app_role[]),
      coalesce(v_after, '{}'::app_role[])
    );
  end if;

  return v_after;
end;
$$;

comment on function public.set_profile_roles is
  'Substitui o conjunto de papéis de um perfil (só admin). Recusa conjunto vazio e o admin rebaixar a si mesmo; a saída do ÚLTIMO administrador é recusada pelo gatilho user_roles_guard_last_admin, que também cobre o PATCH direto na tabela. Toda mudança efetiva deixa linha em role_change_log.';

-- -----------------------------------------------------------------------------
-- 5. access_provision_log — o rastro sobrevive ao desligamento, e a recusa
--    também é auditada
--
-- `actor_email` guarda quem provisionou como TEXTO: `actor_id` é `on delete
-- set null` e as duas linhas que existiam na homologação já estavam com
-- actor_id/profile_id nulos porque as contas foram removidas.
--
-- `action` ganha três valores:
--   · 'denied'   — o 403 da edge function (alguém sem papel batendo no endpoint
--                  de provisionamento) é a tentativa que mais interessa auditar
--                  e era a única que não deixava rastro;
--   · 'revoked'  — a entrada foi bloqueada no Auth (`ban_duration`). Até aqui
--                  desligar alguém marcava `profiles.status = 'terminated'` e a
--                  CONTA continuava entrando: a pessoa saía da empresa e seguia
--                  lendo os próprios leads e o diário da equipe. Bloquear era
--                  "tarefa do painel do Supabase", isto é, de ninguém;
--   · 'restored' — a volta do bloqueio, que é o que torna a decisão reversível.
-- -----------------------------------------------------------------------------
alter table public.access_provision_log
  add column if not exists actor_email text;

comment on column public.access_provision_log.actor_email is
  'E-mail de quem provisionou, como texto: actor_id é on delete set null e some quando a conta é apagada.';

alter table public.access_provision_log
  drop constraint if exists access_provision_log_action_check;
alter table public.access_provision_log
  add constraint access_provision_log_action_check
  check (action in ('create', 'reset', 'denied', 'revoked', 'restored'));

-- =============================================================================
-- Nota para quem lê depois: a tela que fecha o outro lado destes defeitos é
-- `src/pages/Equipes.tsx` (resolução de nome pela view, botão "Desativar
-- equipe", lápis para o gerente) e `src/components/BrokerEditModal.tsx`
-- (desligamento definitivo, guarda de conjunto de papéis vazio).
-- =============================================================================
