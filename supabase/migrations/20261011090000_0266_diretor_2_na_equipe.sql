-- =============================================================================
-- 0266 · Diretor 2 na equipe: dois diretores, venda e meta meio a meio
--
-- Pedido de 11/10/2026: a equipe do gerente Victor que é dividida entre os
-- diretores Fabio e Archimedes. Colocar o corretor e o gerente duas vezes, em
-- duas equipes, não dividia: o sistema guarda um diretor por corretor (o da
-- equipe mais recente). Decisão do cliente: 50/50 fixo, meia venda para cada,
-- meta da equipe pela metade para cada.
--
--  * `teams.co_director_id`: o Diretor 2. Só admin/sócio grava (um diretor que
--    editasse a própria equipe poderia abrir a equipe para outro).
--  * Visibilidade: `auth_led_team_ids` inclui o Diretor 2 — toda a RLS que sai
--    de `auth_visible_profiles()` passa a mostrar a equipe aos dois.
--  * `equipe_diretores`: (equipe, diretor, peso) — peso 1 com um diretor, 0,5
--    para cada com dois. Fonte do rateio entre diretores no banco; o front lê
--    o mesmo campo pela pessoa (`co_director_id`).
--  * Negócio: o autopreenchimento põe os dois diretores; a sugestão do
--    formulário (`lideranca_dos_corretores`) devolve o Diretor 2.
--  * Resumo da diretoria: vendas e VGV com o peso (meia venda); o funil abre
--    para o Diretor 2 com a equipe inteira (é fluxo, não placar).
-- =============================================================================

alter table public.teams
  add column if not exists co_director_id uuid references public.profiles(id) on delete set null;

alter table public.teams drop constraint if exists teams_co_director_distinto;
alter table public.teams add constraint teams_co_director_distinto
  check (co_director_id is null or co_director_id is distinct from director_id);

create index if not exists teams_co_director_idx on public.teams (co_director_id) where active and co_director_id is not null;

comment on column public.teams.co_director_id is
  'Diretor 2 (0266): vê a equipe como o diretor; venda, VGV e meta da equipe dividem 50/50 entre os dois.';

-- Só admin/sócio define o Diretor 2.
create or replace function public.teams_co_director_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.co_director_id is distinct from (case when tg_op = 'UPDATE' then old.co_director_id end)
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Só administrador e sócio definem o Diretor 2 da equipe.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.teams_co_director_guard() from public, anon, authenticated;

drop trigger if exists teams_co_director_guard on public.teams;
create trigger teams_co_director_guard
  before insert or update of co_director_id on public.teams
  for each row execute function public.teams_co_director_guard();

-- -----------------------------------------------------------------------------
-- Peso de cada diretor na equipe.
-- -----------------------------------------------------------------------------
create or replace view public.equipe_diretores
with (security_invoker = true) as
  select t.id as team_id, t.director_id, (case when t.co_director_id is null then 1.0 else 0.5 end)::numeric as peso
    from public.teams t where t.director_id is not null
  union all
  select t.id, t.co_director_id, (case when t.director_id is null then 1.0 else 0.5 end)::numeric
    from public.teams t where t.co_director_id is not null;

comment on view public.equipe_diretores is
  'Diretores de cada equipe com o peso no rateio (0266): 1 com um diretor, 0,5 para cada com Diretor 2.';
revoke all on public.equipe_diretores from anon;
grant select on public.equipe_diretores to authenticated;

-- -----------------------------------------------------------------------------
-- Visibilidade
-- -----------------------------------------------------------------------------
create or replace function public.auth_led_team_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id
  from public.teams t
  where t.active
    and (t.manager_id = auth.uid() or t.director_id = auth.uid() or t.co_director_id = auth.uid());
$$;

-- -----------------------------------------------------------------------------
-- Negócio: os dois diretores entram sozinhos.
-- -----------------------------------------------------------------------------
create or replace function public.deal_participants_autofill()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_manager  uuid;
  v_director uuid;
  v_co       uuid;
begin
  if new.role = 'broker' then
    select t.manager_id, t.director_id, t.co_director_id into v_manager, v_director, v_co
      from public.team_members tm
      join public.teams t on t.id = tm.team_id and t.active
     where tm.profile_id = new.profile_id and tm.left_at is null
     order by tm.joined_at desc nulls last, tm.created_at desc, tm.id desc
     limit 1;

    if v_manager is not null then
      insert into public.deal_participants (deal_id, profile_id, role, auto_added)
      values (new.deal_id, v_manager, 'manager', true)
      on conflict (deal_id, profile_id, role) do nothing;
    end if;

    if v_director is not null then
      insert into public.deal_participants (deal_id, profile_id, role, auto_added)
      values (new.deal_id, v_director, 'director', true)
      on conflict (deal_id, profile_id, role) do nothing;
    end if;

    if v_co is not null then
      insert into public.deal_participants (deal_id, profile_id, role, auto_added)
      values (new.deal_id, v_co, 'director', true)
      on conflict (deal_id, profile_id, role) do nothing;
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.deal_participants_autofill() from public, anon, authenticated;

drop function if exists public.lideranca_dos_corretores();
create function public.lideranca_dos_corretores()
returns table (broker_id uuid, manager_id uuid, director_id uuid, co_director_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct on (tm.profile_id) tm.profile_id, t.manager_id, t.director_id, t.co_director_id
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    join public.profiles p on p.id = tm.profile_id and p.status = 'active'
   where tm.left_at is null
     and (public.is_admin()
          or public.auth_effective_role(auth.uid()) = any (array['director', 'manager', 'broker', 'cca']::app_role[]))
   order by tm.profile_id, tm.joined_at desc nulls last, tm.created_at desc, tm.id desc;
$$;
revoke all on function public.lideranca_dos_corretores() from public, anon;
grant execute on function public.lideranca_dos_corretores() to authenticated;
comment on function public.lideranca_dos_corretores() is
  'Gerente, diretor e Diretor 2 da equipe de cada corretor ativo (só ids), para sugerir no negócio (0199, 0266).';

-- -----------------------------------------------------------------------------
-- Resumo da diretoria: meia venda e meio VGV para cada diretor da equipe.
-- -----------------------------------------------------------------------------
drop function if exists public.resumo_da_diretoria(date);
create function public.resumo_da_diretoria(p_mes date)
returns table (
  director_id   uuid,
  director_name text,
  team_id       uuid,
  team_name     text,
  manager_name  text,
  vendas        numeric,
  vgv           numeric,
  total_vendas  numeric,
  total_vgv     numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with diretorias as (
    select distinct ed.director_id
      from public.teams t
      join public.equipe_diretores ed on ed.team_id = t.id
     where t.active
       and auth.uid() is not null
       and (public.is_admin() or auth.uid() in (t.manager_id, t.director_id, t.co_director_id))
  ),
  equipes as (
    select t.id, t.name, ed.director_id, ed.peso, t.manager_id
      from public.teams t
      join public.equipe_diretores ed on ed.team_id = t.id
      join diretorias d on d.director_id = ed.director_id
     where t.active
  ),
  vendas as (
    select distinct e.director_id, e.id as team_id, e.peso, dl.id as deal_id, dl.vgv_net
      from public.deals dl
      left join public.deal_status_groups g on g.id = dl.status_group_id
      join public.deal_participants dp on dp.deal_id = dl.id and dp.role = 'broker'
      join public.team_members tm on tm.profile_id = dp.profile_id and tm.left_at is null
      join equipes e on e.id = tm.team_id
     where dl.month_base = date_trunc('month', p_mes)::date
       and (dl.outcome = 'won' or (dl.outcome = 'open' and g.code = 'VENDA'))
  ),
  -- Um negócio conta uma vez por diretor, com o maior peso entre as equipes dele.
  por_diretor as (
    select v.director_id, v.deal_id, max(v.peso) as peso, max(coalesce(v.vgv_net, 0)) as vgv_net
      from vendas v group by v.director_id, v.deal_id
  ),
  totais as (
    select x.director_id, sum(x.peso) as n, sum(x.vgv_net * x.peso) as v
      from por_diretor x group by x.director_id
  )
  select e.director_id,
         dp.full_name,
         e.id,
         e.name,
         mp.full_name,
         (select coalesce(sum(v.peso), 0) from vendas v where v.team_id = e.id and v.director_id = e.director_id),
         (select coalesce(sum(coalesce(v.vgv_net, 0) * v.peso), 0) from vendas v where v.team_id = e.id and v.director_id = e.director_id),
         coalesce(tt.n, 0),
         coalesce(tt.v, 0)
    from equipes e
    join public.profiles dp on dp.id = e.director_id
    left join public.profiles mp on mp.id = e.manager_id and mp.status = 'active'
      and exists (select 1 from public.user_roles ur
                   where ur.profile_id = mp.id and ur.role in ('manager', 'director'))
    left join totais tt on tt.director_id = e.director_id
   order by dp.full_name, 7 desc, e.name;
$$;
revoke all on function public.resumo_da_diretoria(date) from public, anon;
grant execute on function public.resumo_da_diretoria(date) to authenticated;

-- -----------------------------------------------------------------------------
-- Funil (0216) e payload do Dashboard da imobiliária (0245) com o Diretor 2.
-- -----------------------------------------------------------------------------
create or replace function public.funil_de_vendas(p_mes date, p_diretor uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mes        date := date_trunc('month', p_mes)::date;
  v_ini        timestamptz;
  v_fim        timestamptz;
  v_admin      boolean := public.is_admin();
  v_permitidas uuid[];
  v_membros    uuid[];
  v_imob       jsonb;
  v_recorte    jsonb;
  v_parados    jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada.' using errcode = '42501';
  end if;
  if p_mes is null then
    raise exception 'Informe o mês.' using errcode = '22023';
  end if;

  -- Mês no fuso de São Paulo, como o resto da operação.
  v_ini := v_mes::timestamp at time zone 'America/Sao_Paulo';
  v_fim := (v_mes + interval '1 month')::timestamp at time zone 'America/Sao_Paulo';

  -- 0266: o Diretor 2 da equipe também abre a diretoria dela.
  select coalesce(array_agg(distinct d.diretor), '{}')
    into v_permitidas
    from public.teams t
    cross join lateral (values (t.director_id), (t.co_director_id)) d(diretor)
   where t.active and d.diretor is not null
     and (v_admin or auth.uid() in (t.manager_id, t.director_id, t.co_director_id));

  -- Sem diretoria escolhida, quem não é admin abre a própria (ou a primeira
  -- que lidera); quem não lidera nenhuma não tem funil.
  if p_diretor is null and not v_admin then
    if cardinality(v_permitidas) = 0 then
      raise exception 'O funil é da liderança.' using errcode = '42501';
    end if;
    p_diretor := case when auth.uid() = any (v_permitidas) then auth.uid() else v_permitidas[1] end;
  end if;
  if p_diretor is not null and not (p_diretor = any (v_permitidas)) then
    raise exception 'Diretoria fora do seu alcance.' using errcode = '42501';
  end if;

  -- Quem é da diretoria: corretores das equipes dela, gerentes e o diretor.
  if p_diretor is not null then
    select coalesce(array_agg(distinct x.pid), '{}') into v_membros
      from (
        select tm.profile_id as pid
          from public.teams t
          join public.team_members tm on tm.team_id = t.id and tm.left_at is null
         where t.active and p_diretor in (t.director_id, t.co_director_id)
        union
        select t.manager_id from public.teams t
         where t.active and p_diretor in (t.director_id, t.co_director_id) and t.manager_id is not null
        union
        select p_diretor
      ) x;
  end if;

  -- Os quatro números para um recorte (nulo = imobiliária inteira).
  with
  recortes as (
    select 'imob'::text as quem, null::uuid[] as membros
    union all
    select 'recorte', v_membros where p_diretor is not null
  ),
  leads_mes as (
    select r.quem, count(l.id)::int as n
      from recortes r
      left join public.leads l
        on l.created_at >= v_ini and l.created_at < v_fim
       and (r.membros is null or l.assigned_to = any (r.membros))
     group by r.quem
  ),
  -- Docs enviadas NO MÊS (04/10/2026: "têm que ser os movimentados no mês
  -- vigente, senão a conta não fecha"): entrada na esteira do CCA no mês, ou
  -- Status 2 que passou a Esteira Ágil, Retorno à Esteira ou Análise Externa
  -- no mês.
  docs as (
    select distinct r.quem, x.deal_id as id
      from recortes r
      join (
        select c.deal_id from public.cca_cases c
         where c.submitted_at >= v_ini and c.submitted_at < v_fim
        union
        select h.deal_id from public.deal_status_history h
         where h.changed_at >= v_ini and h.changed_at < v_fim
           and public.status2_chave(h.to_status) in ('ESTEIRA AGIL', 'RET. ESTEIRA AGIL', 'ANALISE EXTERNA')
      ) x on true
     where r.membros is null
        or exists (select 1 from public.deal_participants dp
                    where dp.deal_id = x.deal_id and dp.role = 'broker' and dp.profile_id = any (r.membros))
  ),
  -- Aprovadas NO MÊS: Status 2 que passou a Aprov. Total ou Aprov. Cond. no mês.
  aprovadas as (
    select distinct r.quem, h.deal_id as id
      from recortes r
      join public.deal_status_history h
        on h.changed_at >= v_ini and h.changed_at < v_fim
       and public.status2_chave(h.to_status) in ('APROV. TOTAL', 'APROV. COND.')
     where r.membros is null
        or exists (select 1 from public.deal_participants dp
                    where dp.deal_id = h.deal_id and dp.role = 'broker' and dp.profile_id = any (r.membros))
  ),
  -- Vendas do mês: as do mês-base (fechado, ou Status 1 VENDA em aberto — 0207).
  vendas as (
    select r.quem, d.id
      from recortes r
      join public.deals d on d.month_base = v_mes
      left join public.deal_status_groups g on g.id = d.status_group_id
     where (d.outcome = 'won' or (d.outcome = 'open' and g.code = 'VENDA'))
       and (r.membros is null
         or exists (select 1 from public.deal_participants dp
                     where dp.deal_id = d.id and dp.role = 'broker' and dp.profile_id = any (r.membros)))
  ),
  contas as (
    select r.quem,
           coalesce((select lm.n from leads_mes lm where lm.quem = r.quem), 0) as leads,
           (select count(*)::int from docs x where x.quem = r.quem) as docs,
           (select count(*)::int from aprovadas x where x.quem = r.quem) as aprovadas,
           (select count(*)::int from vendas x where x.quem = r.quem) as vendas
      from recortes r
  )
  select
    (select jsonb_build_object('leads', c.leads, 'docs', c.docs, 'aprovadas', c.aprovadas, 'vendas', c.vendas)
       from contas c where c.quem = 'imob'),
    (select jsonb_build_object('leads', c.leads, 'docs', c.docs, 'aprovadas', c.aprovadas, 'vendas', c.vendas)
       from contas c where c.quem = 'recorte')
    into v_imob, v_recorte;

  -- Parados há mais de 3 dias em aprovação ou "virou negócio", em qualquer mês.
  select coalesce(jsonb_agg(p order by p.desde), '[]'::jsonb) into v_parados
    from (
      select d.id as deal_id,
             d.code,
             (select c.full_name from public.deal_clients c where c.deal_id = d.id and c.ordinal = 1) as cliente,
             coalesce((select s.label from public.deal_statuses s where s.value = d.status_detail),
                      public.deal_status_bare(d.status_detail)) as status,
             coalesce(d.status_detail_changed_at, d.updated_at) as desde,
             (select pr.full_name from public.deal_participants dp
                join public.profiles pr on pr.id = dp.profile_id
               where dp.deal_id = d.id and dp.role = 'broker'
               order by dp.ordinal limit 1) as corretor
        from public.deals d
       where d.outcome = 'open'
         and public.status2_chave(d.status_detail) in ('APROV. TOTAL', 'APROV. COND.', 'VIROU NEGOCIO')
         and coalesce(d.status_detail_changed_at, d.updated_at) < now() - interval '3 days'
         and (case when p_diretor is null then v_admin
                   else exists (select 1 from public.deal_participants dp
                                 where dp.deal_id = d.id and dp.role = 'broker'
                                   and dp.profile_id = any (v_membros)) end)
       order by coalesce(d.status_detail_changed_at, d.updated_at)
       limit 300
    ) p;

  return jsonb_build_object(
    'mes', v_mes,
    'diretor', p_diretor,
    'imob', v_imob,
    'recorte', v_recorte,
    'parados', v_parados,
    'diretorias', (
      select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'nome', pr.full_name) order by pr.full_name), '[]'::jsonb)
        from public.profiles pr where pr.id = any (v_permitidas)),
    'pode_ver_imob', v_admin);
end;
$$;
revoke all on function public.funil_de_vendas(date, uuid) from public, anon;
grant execute on function public.funil_de_vendas(date, uuid) to authenticated;

create or replace function public.dashboard_imobiliaria_payload()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Sessão expirada.' using errcode = '28000'; end if;
  if not (public.is_admin() or public.has_role('director')) then
    raise exception 'Somente diretor ou administrador acessa o Dashboard da imobiliária.' using errcode = '42501';
  end if;

  with papeis as (
    select ur.profile_id, array_agg(ur.role order by ur.role::text) as roles
      from public.user_roles ur group by ur.profile_id
  ), membro_atual as (
    select distinct on (tm.profile_id) tm.profile_id, t.id as team_id, t.name as team_name,
           t.manager_id, t.director_id, t.co_director_id
      from public.team_members tm
      join public.teams t on t.id = tm.team_id
     where tm.left_at is null
     order by tm.profile_id, tm.joined_at desc nulls last, tm.created_at desc, tm.id desc
  ), pessoas as (
    select jsonb_build_object(
      'id', p.id, 'user_id', p.id, 'name', p.full_name, 'full_name', p.full_name,
      'email', p.email, 'phone', p.phone, 'avatar_url', p.avatar_url,
      'active', p.status = 'active', 'status', p.status,
      'roles', to_jsonb(coalesce(pa.roles, array['broker'::public.app_role])),
      'role', case
        when 'admin'::public.app_role = any(coalesce(pa.roles, '{}'::public.app_role[])) then 'admin'
        when 'director'::public.app_role = any(coalesce(pa.roles, '{}'::public.app_role[])) then 'director'
        when 'manager'::public.app_role = any(coalesce(pa.roles, '{}'::public.app_role[])) then 'manager'
        when 'cca'::public.app_role = any(coalesce(pa.roles, '{}'::public.app_role[])) then 'cca'
        when 'sdr'::public.app_role = any(coalesce(pa.roles, '{}'::public.app_role[])) then 'sdr'
        when 'marketing'::public.app_role = any(coalesce(pa.roles, '{}'::public.app_role[])) then 'marketing'
        when 'partner'::public.app_role = any(coalesce(pa.roles, '{}'::public.app_role[])) then 'partner'
        else 'broker' end,
      'team_id', ma.team_id, 'team', coalesce(ma.team_name, ''),
      'manager_id', ma.manager_id, 'director_id', ma.director_id, 'co_director_id', ma.co_director_id
    ) as row
      from public.profiles p
      left join papeis pa on pa.profile_id = p.id
      left join membro_atual ma on ma.profile_id = p.id
  )
  select jsonb_build_object(
    'deals', '[]'::jsonb,
    'people', coalesce((select jsonb_agg(p.row) from pessoas p), '[]'::jsonb),
    'activeMonth', to_char(coalesce(public.current_season_month(), current_date), 'MM/YYYY'),
    'leadsCount', (select count(*) from public.leads),
    'ccaCounts', '{}'::jsonb,
    'ccaDealIds', coalesce((select jsonb_agg(distinct c.deal_id) from public.cca_cases c), '[]'::jsonb),
    'closedMonths', coalesce((select jsonb_agg(to_char(cm.period, 'MM/YYYY') order by cm.period desc) from public.closed_months cm), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.dashboard_imobiliaria_payload() from public, anon;
grant execute on function public.dashboard_imobiliaria_payload() to authenticated;
