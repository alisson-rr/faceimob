-- =============================================================================
-- 0044 — Permissões de funcionalidade passam a ser lidas pelo banco
--
-- A aba "Funcionalidades" de Admin · Permissões grava em `role_permissions`
-- doze códigos que o seed cadastrou (`leads.reassign`, `cca.review`, ...), mas
-- só `reports.view_finance` tinha leitor (o `can()` do front). Os outros onze
-- eram dado morto: o admin desligava "Realocar leads" para o gerente, o switch
-- ficava cinza, e o gerente continuava realocando — a RPC e as policies
-- decidiam por papel cru (`is_admin()`, `has_any_role('admin','cca')`,
-- `manages_profile()`), nunca pela matriz.
--
-- Esta migration faz sete desses códigos valerem onde a trava é de verdade —
-- na RPC ou na policy, via `has_permission(code)`. Esconder botão é
-- conveniência da tela; quem barra é o banco. Os que ficam de fora continuam
-- rotulados "ainda sem efeito" ou "aplicada na tela" pelo mapa
-- `src/lib/featurePermissions.ts`: `deals.view_all` e `deals.edit_value`
-- (mudariam `can_see_deal`/a edição de VGV para todo participante — decisão de
-- produto), `game.close_season` (a RPC vive na 0035, desta mesma rodada),
-- `users.manage_roles` (a 0046 concentra a troca de papel em
-- `set_profile_roles`, admin-only; a guarda tem de ir lá, não na policy que a
-- RPC atravessa) e `reports.view_finance` (lido pela tela).
--
-- Nada muda no deploy: cada policy/RPC recebe `has_permission` no lugar do
-- papel cru E as concessões que reproduzem exatamente o conjunto de papéis que
-- passava antes entram aqui com `on conflict do nothing` (a única diferença em
-- relação ao seed é `marketing` em `leads.view_queue`, que `leads_select` já
-- liberava). A partir daqui a matriz é editável pela tela — que é o requisito.
--
-- `has_permission()` curto-circuita em `is_admin()`, então admin não precisa
-- de linha e não pode se trancar fora.
--
-- Também: `allowed_ips` ganha leitura para quem tem `menu.admin_allowed_ips`.
-- A tela de permissões deixava conceder o menu ao sócio, mas a única policy da
-- tabela era `is_admin()` para tudo: o sócio abria a tela e via "Lista (0)" com
-- seis faixas no banco. Conceder o menu passa a significar leitura; escrita
-- continua exclusiva do admin.
--
-- Isso afrouxa de propósito a decisão da 0004 ("só admin enxerga a lista"), e o
-- efeito é imediato: `role_permissions` já tem ('partner','menu.admin_allowed_ips')
-- no remoto, então o sócio passa a ler as faixas assim que esta migration for
-- aplicada. A alternativa — um código próprio para a leitura — recria o botão
-- morto (menu concedido, tela vazia), que é o que o critério proíbe. Escolhido:
-- um switch só, com a tela dizendo o que ele faz. `src/lib/featurePermissions.ts`
-- trata `menu.admin_allowed_ips` como exceção e a aba Menu mostra "Aplicada no
-- banco" com a frase inteira ao lado, para o admin não achar que soma só um link.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Catálogo e concessões iniciais (o seed é opcional; a migration é a fonte)
-- -----------------------------------------------------------------------------
insert into public.permissions (code, label, category, description) values
  ('leads.view_queue',      'Ver fila de leads',           'leads',    'Enxergar leads ainda não atribuídos'),
  ('leads.reassign',        'Realocar leads',              'leads',    'Mover lead entre corretores'),
  ('leads.delete',          'Excluir leads',               'leads',    null),
  ('deals.view_all',        'Ver todos os negócios',       'negocios', 'Ignorar o recorte por equipe'),
  ('deals.edit_value',      'Editar VGV',                  'negocios', null),
  ('deals.delete',          'Excluir negócios',            'negocios', null),
  ('cca.review',            'Analisar crédito',            'cca',      'Movimentar a esteira do CCA'),
  ('reports.view_finance',  'Ver dados financeiros',       'relatorios', 'Aportes, custos e VGV consolidado'),
  ('teams.manage',          'Gerenciar equipes',           'equipes',  'Incluir e desligar integrantes'),
  ('users.manage_roles',    'Gerenciar papéis',            'usuarios', null),
  ('settings.integrations', 'Gerenciar integrações',       'config',   'Tokens de API'),
  ('game.close_season',     'Encerrar temporada',          'jogo',     null)
on conflict (code) do nothing;

-- Reproduz quem passava nas policies/RPCs antes desta migration.
insert into public.role_permissions (role, permission, allowed)
select r.role, p.code, true
from (values
  ('director'::app_role, 'leads.view_queue'),
  ('director',           'leads.reassign'),
  ('director',           'deals.view_all'),
  ('director',           'deals.edit_value'),
  ('director',           'reports.view_finance'),
  ('director',           'teams.manage'),

  ('manager',            'leads.view_queue'),
  ('manager',            'leads.reassign'),
  ('manager',            'deals.edit_value'),
  ('manager',            'teams.manage'),

  -- `leads_select` já mostrava a fila ao marketing; o seed não tinha a linha.
  ('marketing',          'leads.view_queue'),
  ('marketing',          'reports.view_finance'),

  ('cca',                'cca.review'),
  ('cca',                'deals.view_all'),

  ('partner',            'deals.view_all'),
  ('partner',            'reports.view_finance')
) as r(role, permission)
join public.permissions p on p.code = r.permission
on conflict (role, permission) do nothing;

-- -----------------------------------------------------------------------------
-- 2. leads.view_queue — fila (lead sem dono) visível E editável pela matriz
--
-- `leads_update` (redefinida na 0041 desta mesma rodada) decidia a fila por
-- papel cru. Trocar só o SELECT abriria a divergência que o critério proíbe:
-- conceder "Ver fila de leads" ao SDR faria o lead sem dono aparecer na tela de
-- Leads (a lista sai direto do RLS) e todo UPDATE casar 0 linhas — o falso
-- sucesso que a 0041 foi corrigir. As duas policies voltam a ler o MESMO
-- predicado; a 0041 continua dona do resto (`can_see_lead`, eventos, anexos).
-- -----------------------------------------------------------------------------
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated
  using (
    assigned_to in (select public.auth_visible_profiles())
    or (assigned_to is null and public.has_permission('leads.view_queue'))
  );

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
  for update to authenticated
  using (
    assigned_to = auth.uid()
    or public.is_admin()
    or public.manages_profile(assigned_to)
    or (assigned_to is null and public.has_permission('leads.view_queue'))
  )
  with check (
    assigned_to = auth.uid()
    or public.is_admin()
    or public.manages_profile(assigned_to)
    or (assigned_to is null and public.has_permission('leads.view_queue'))
  );

-- -----------------------------------------------------------------------------
-- 3. leads.reassign — a RPC exige a permissão além de liderar a equipe do
--    destino. Corpo copiado da 0005; a diferença é o primeiro `if`.
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
  if not found then
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

revoke all on function public.reassign_lead(uuid, uuid) from public, anon;
grant execute on function public.reassign_lead(uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. leads.delete / deals.delete — antes `is_admin()`; sem concessão, continua
--    só admin (curto-circuito). A tela ainda não tem o botão: o switch passa a
--    valer para quem chamar a API.
-- -----------------------------------------------------------------------------
drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads
  for delete to authenticated
  using (public.has_permission('leads.delete'));

drop policy if exists deals_delete on public.deals;
create policy deals_delete on public.deals
  for delete to authenticated
  using (public.has_permission('deals.delete'));

-- -----------------------------------------------------------------------------
-- 5. cca.review — mover e decidir casos, e editar o negócio em análise.
--    A configuração das etapas (`cca_stages_write`) e dos catálogos continua
--    pelo papel: não é "analisar crédito".
--
--    Alcance real, que a tela precisa declarar: o primeiro ramo de
--    `can_edit_deal` não olha `p_deal_id`, então quem tem a permissão edita
--    QUALQUER negócio, de qualquer equipe — era assim para o papel `cca`
--    (`has_any_role('admin','cca')`, igualmente irrestrito), e continua sendo,
--    só que agora concedível a qualquer papel pela matriz. Restringir ao caso
--    aberto (`exists (select 1 from cca_cases where deal_id = p_deal_id)`)
--    mudaria a regra de negócio: hoje o CCA edita antes de o caso existir.
-- -----------------------------------------------------------------------------
drop policy if exists cca_cases_write on public.cca_cases;
create policy cca_cases_write on public.cca_cases
  for all to authenticated
  using (public.has_permission('cca.review'))
  with check (public.has_permission('cca.review'));

drop policy if exists developer_submissions_write on public.developer_submissions;
create policy developer_submissions_write on public.developer_submissions
  for all to authenticated
  using (public.has_permission('cca.review'))
  with check (public.has_permission('cca.review'));

-- Corpo da 0006; `has_any_role('admin','cca')` vira a permissão. É o que
-- `deals_update`, `deal_documents_insert` e afins leem.
create or replace function public.can_edit_deal(p_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_permission('cca.review')
      or exists (
        select 1 from public.deal_participants dp
        where dp.deal_id = p_deal_id
          and (dp.profile_id = auth.uid() or public.manages_profile(dp.profile_id))
      );
$$;

-- -----------------------------------------------------------------------------
-- 6. teams.manage — a permissão é a capacidade; liderar a equipe é o escopo.
-- -----------------------------------------------------------------------------
drop policy if exists team_members_manage on public.team_members;
create policy team_members_manage on public.team_members
  for all to authenticated
  using (
    public.is_admin()
    or (public.has_permission('teams.manage')
        and team_id in (select public.auth_led_team_ids()))
  )
  with check (
    public.is_admin()
    or (public.has_permission('teams.manage')
        and team_id in (select public.auth_led_team_ids()))
  );

-- -----------------------------------------------------------------------------
-- 7. settings.integrations — cofre de credenciais. Corpos da 0011; muda só a
--    guarda. O segredo continua sem sair do banco (`get_integration_secret` é
--    do service_role e não muda).
-- -----------------------------------------------------------------------------
create or replace function public.list_integrations()
returns table (
  id         uuid,
  provider   text,
  label      text,
  active     boolean,
  has_secret boolean,
  config     jsonb,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not public.has_permission('settings.integrations') then
    raise exception 'Sem permissão para gerenciar integrações.' using errcode = '42501';
  end if;

  return query
  select c.id, c.provider, c.label, c.active,
         (c.secret is not null and c.secret <> ''),
         c.config, c.updated_at
  from private.integration_credentials c
  order by c.provider, c.label;
end;
$$;

create or replace function public.set_integration_secret(
  p_provider text,
  p_label    text,
  p_secret   text,
  p_config   jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.has_permission('settings.integrations') then
    raise exception 'Sem permissão para gerenciar integrações.' using errcode = '42501';
  end if;

  insert into private.integration_credentials (provider, label, secret, config, updated_by)
  values (p_provider, p_label, p_secret, coalesce(p_config, '{}'::jsonb), auth.uid())
  on conflict (provider, label) do update
    set secret     = excluded.secret,
        config     = excluded.config,
        active     = true,
        updated_by = auth.uid(),
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. allowed_ips — conceder o menu passa a significar leitura. `allowed_ips_admin`
--    (0004, `for all` com `is_admin()`) continua sendo a única porta de escrita;
--    policies permissivas somam, então o admin não perde nada.
-- -----------------------------------------------------------------------------
drop policy if exists allowed_ips_read on public.allowed_ips;
create policy allowed_ips_read on public.allowed_ips
  for select to authenticated
  using (public.has_permission('menu.admin_allowed_ips'));
