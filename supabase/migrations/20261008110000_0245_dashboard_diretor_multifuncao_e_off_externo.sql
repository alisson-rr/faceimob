-- 0245 · Dashboard paginado, líder multifunção e OFF para análise externa.
--
-- 1. O payload único do Dashboard da imobiliária concentrava todo o histórico
--    em um JSON. Em produção a chamada falha antes de a tela receber qualquer
--    dado. Os negócios passam a sair em linhas pagináveis; o payload mantém só
--    metadados e pessoas.
-- 2. Quando o corretor também é gerente/diretor da própria equipe, o autofill
--    antigo pulava os dois papéis. O envio à Esteira Ágil então dizia que não
--    havia gerente, embora fosse a mesma pessoa.
-- 3. A reativação pode terminar em INCOMPLETO (fluxo interno) ou diretamente
--    em ANÁLISE EXTERNA (construtora externa), sempre no mês vigente.

create or replace function public.deal_participants_autofill()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_manager  uuid;
  v_director uuid;
begin
  if new.role = 'broker' then
    select t.manager_id, t.director_id into v_manager, v_director
      from public.team_members tm
      join public.teams t on t.id = tm.team_id and t.active
     where tm.profile_id = new.profile_id and tm.left_at is null
     order by tm.joined_at desc nulls last, tm.created_at desc, tm.id desc
     limit 1;

    -- A chave inclui `role`: a mesma pessoa pode legitimamente ser corretor,
    -- gerente e diretor do negócio sem duplicar rateio ou comissão.
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
  end if;
  return null;
end;
$$;
revoke all on function public.deal_participants_autofill() from public, anon, authenticated;

-- Corrige somente o caso já existente em que o próprio corretor é o líder.
-- Não troca a liderança histórica de nenhum outro negócio.
with membros as (
  select distinct on (tm.profile_id) tm.profile_id, t.manager_id, t.director_id
    from public.team_members tm
    join public.teams t on t.id = tm.team_id and t.active
   where tm.left_at is null
   order by tm.profile_id, tm.joined_at desc nulls last, tm.created_at desc, tm.id desc
)
insert into public.deal_participants (deal_id, profile_id, role, auto_added)
select dp.deal_id, dp.profile_id, papel.role, true
  from public.deal_participants dp
  join membros m on m.profile_id = dp.profile_id
 cross join lateral (
   values
     ('manager'::text, m.manager_id = dp.profile_id),
     ('director'::text, m.director_id = dp.profile_id)
 ) papel(role, pertence)
 where dp.role = 'broker' and papel.pertence
on conflict (deal_id, profile_id, role) do nothing;

create or replace function public.reactivate_deal_with_destination(
  p_deal_id uuid,
  p_broker_id uuid default null,
  p_destination text default 'incomplete'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_external text;
  v_destination text := lower(btrim(coalesce(p_destination, 'incomplete')));
begin
  if v_destination not in ('incomplete', 'external') then
    raise exception 'Destino inválido: escolha Incompleto ou Análise Externa.' using errcode = 'P0001';
  end if;

  -- A função original mantém todas as travas de mês, hierarquia e auditoria.
  v_result := public.reactivate_deal(p_deal_id, p_broker_id);

  if v_destination = 'external' then
    select s.value into v_external
      from public.deal_statuses s
     where s.active and public.deal_status_bare(s.value) = 'ANÁLISE EXTERNA'
     order by s.position, s.id
     limit 1;
    if v_external is null then
      raise exception 'O Status 2 ANÁLISE EXTERNA não está ativo no cadastro.' using errcode = 'P0003';
    end if;
    perform public.move_deal_status(p_deal_id, v_external, null);
    v_result := v_result || jsonb_build_object('destination', 'external', 'status', v_external);
  else
    v_result := v_result || jsonb_build_object('destination', 'incomplete', 'status', 'INCOMPLETO');
  end if;
  return v_result;
end;
$$;
revoke all on function public.reactivate_deal_with_destination(uuid, uuid, text) from public, anon;
grant execute on function public.reactivate_deal_with_destination(uuid, uuid, text) to authenticated;
comment on function public.reactivate_deal_with_destination(uuid, uuid, text) is
  'Reativa OFF histórico no mês vigente e permite escolher INCOMPLETO ou ANÁLISE EXTERNA sem afrouxar as travas de reactivate_deal.';

create or replace function public.dashboard_imobiliaria_deals()
returns table (deal jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with autorizado as (
    select 1
     where auth.uid() is not null
       and (public.is_admin() or public.has_role('director'))
  ), participantes as (
    select dp.deal_id,
           (array_agg(dp.profile_id order by dp.ordinal) filter (where dp.role = 'broker'))[1] as b1,
           (array_agg(dp.profile_id order by dp.ordinal) filter (where dp.role = 'broker'))[2] as b2,
           (array_agg(dp.profile_id order by dp.ordinal) filter (where dp.role = 'broker'))[3] as b3,
           (array_agg(dp.share_pct order by dp.ordinal) filter (where dp.role = 'broker'))[1] as bs1,
           (array_agg(dp.share_pct order by dp.ordinal) filter (where dp.role = 'broker'))[2] as bs2,
           (array_agg(dp.share_pct order by dp.ordinal) filter (where dp.role = 'broker'))[3] as bs3,
           (array_agg(dp.profile_id order by dp.ordinal) filter (where dp.role = 'manager'))[1] as m1,
           (array_agg(dp.profile_id order by dp.ordinal) filter (where dp.role = 'manager'))[2] as m2,
           (array_agg(dp.profile_id order by dp.ordinal) filter (where dp.role = 'manager'))[3] as m3,
           (array_agg(dp.profile_id order by dp.ordinal) filter (where dp.role = 'director'))[1] as d1,
           (array_agg(dp.profile_id order by dp.ordinal) filter (where dp.role = 'director'))[2] as d2
      from public.deal_participants dp
     group by dp.deal_id
  )
  select jsonb_build_object(
      'id', d.id, 'code', d.code,
      'client', coalesce(cli.full_name, 'Cliente não informado'),
      'developer', coalesce(dev.name, ''), 'developer_color', dev.color,
      'developer_id', d.developer_id, 'project', coalesce(d.project_name, proj.name, ''),
      'project_id', d.project_id, 'unit', coalesce(d.unit, ''),
      'status', coalesce(d.status_detail,
        case d.outcome when 'won' then 'VENDA' when 'lost' then upper(coalesce(d.lost_reason, 'PERDIDO')) else 'PROPOSTA' end),
      'status_detail', d.status_detail, 'status_group_id', d.status_group_id,
      'status_group_code', grp.code, 'lost_reason', d.lost_reason,
      'stage', coalesce(st.code, 'incomplete'), 'stage_id', d.stage_id,
      'stage_label', coalesce(st.label, 'Sem etapa'), 'stage_position', coalesce(st.position, 0),
      'outcome', d.outcome, 'lead_origin', d.lead_origin
    ) || jsonb_build_object(
      'month_base', to_char(d.month_base, 'MM/YYYY'),
      'broker1_id', pa.b1, 'broker2_id', pa.b2, 'broker3_id', pa.b3,
      'broker1_share', pa.bs1, 'broker2_share', pa.bs2, 'broker3_share', pa.bs3,
      'manager1_id', pa.m1, 'manager2_id', pa.m2, 'manager3_id', pa.m3,
      'director1_id', pa.d1, 'director2_id', pa.d2,
      'broker1', coalesce(pb1.full_name, ''), 'broker2', pb2.full_name, 'broker3', pb3.full_name,
      'broker1_name', pb1.full_name, 'broker2_name', pb2.full_name,
      'manager1', coalesce(pm1.full_name, ''), 'manager2', pm2.full_name, 'manager3', pm3.full_name,
      'manager1_name', pm1.full_name, 'manager2_name', pm2.full_name,
      'director1_name', pd1.full_name, 'director2_name', pd2.full_name,
      'deal_value', coalesce(d.vgv_net, 0), 'vgv_liquido', coalesce(d.vgv_net, 0),
      'active', d.outcome not in ('lost', 'cancelled'), 'created_at', d.created_at,
      'document_review_status', d.document_review_status,
      'document_review_requested_at', d.document_review_requested_at,
      'document_review_reason', d.document_review_reason,
      'contract_has_pending_issue', d.contract_has_pending_issue
    )
    from autorizado
    cross join public.deals d
    left join participantes pa on pa.deal_id = d.id
    left join lateral (
      select dc.full_name from public.deal_clients dc
       where dc.deal_id = d.id order by dc.ordinal, dc.id limit 1
    ) cli on true
    left join public.pipeline_stages st on st.id = d.stage_id
    left join public.developers dev on dev.id = d.developer_id
    left join public.developer_projects proj on proj.id = d.project_id
    left join public.deal_status_groups grp on grp.id = d.status_group_id
    left join public.profiles pb1 on pb1.id = pa.b1
    left join public.profiles pb2 on pb2.id = pa.b2
    left join public.profiles pb3 on pb3.id = pa.b3
    left join public.profiles pm1 on pm1.id = pa.m1
    left join public.profiles pm2 on pm2.id = pa.m2
    left join public.profiles pm3 on pm3.id = pa.m3
    left join public.profiles pd1 on pd1.id = pa.d1
    left join public.profiles pd2 on pd2.id = pa.d2
   order by d.created_at, d.id;
$$;
revoke all on function public.dashboard_imobiliaria_deals() from public, anon;
grant execute on function public.dashboard_imobiliaria_deals() to authenticated;

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
           t.manager_id, t.director_id
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
      'manager_id', ma.manager_id, 'director_id', ma.director_id
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

-- A RPC da 0244 declarava `email text`, mas `leads.email` é CITEXT. PL/pgSQL
-- só descobre a incompatibilidade ao executar a consulta — exatamente quando o
-- diretor abre o Dashboard da imobiliária. O cast explícito mantém o contrato
-- consumido pelo frontend e elimina a falha em runtime.
create or replace function public.dashboard_imobiliaria_leads(
  p_de timestamptz default null,
  p_ate timestamptz default null
)
returns table (
  id uuid, name text, phone text, whatsapp text, email text, source text,
  broker_id text, broker_name text, created_at timestamptz, status text, notes text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Sessão expirada.' using errcode = '28000'; end if;
  if not (public.is_admin() or public.has_role('director')) then
    raise exception 'Somente diretor ou administrador acessa os leads do Dashboard da imobiliária.' using errcode = '42501';
  end if;

  return query
  select l.id, l.full_name, coalesce(l.phone, ''), coalesce(l.phone, ''),
         coalesce(l.email::text, ''),
         coalesce(src.label, l.utm_source, ''), coalesce(l.assigned_to::text, ''), prof.full_name,
         l.created_at,
         case when l.status = 'converted' then 'converted'
              when l.status in ('lost', 'discarded') then 'lost'
              when l.funnel_stage = 'qualified' then 'qualified'
              when l.status in ('attending', 'in_progress') then 'contacted'
              else 'new' end,
         coalesce(l.notes, '')
    from public.leads l
    left join public.lead_sources src on src.id = l.source_id
    left join public.profiles prof on prof.id = l.assigned_to
   where (p_de is null or l.created_at >= p_de)
     and (p_ate is null or l.created_at < p_ate)
   order by l.created_at desc, l.id
   limit case when p_de is null and p_ate is null then 1000 else null end;
end;
$$;
revoke all on function public.dashboard_imobiliaria_leads(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.dashboard_imobiliaria_leads(timestamptz, timestamptz)
  to authenticated;

comment on function public.dashboard_imobiliaria_deals() is
  'Negócios pagináveis do Dashboard da imobiliária; somente diretor/admin e sem ampliar a RLS do Pipeline.';
comment on function public.dashboard_imobiliaria_payload() is
  'Metadados e pessoas do Dashboard da imobiliária; os negócios são paginados por dashboard_imobiliaria_deals.';
comment on function public.dashboard_imobiliaria_leads(timestamptz, timestamptz) is
  'Leads da imobiliária para diretor/admin, com e-mail CITEXT convertido ao contrato TEXT do frontend.';
