-- =============================================================================
-- 0295 · Empreendimento digitado na conversão · meia venda nas Diretorias
--
-- Pedidos de 19/10/2026:
--   1. "Ao converter lead em negócio deixe que o empreendimento seja digitado e
--      não em lista": `convert_lead_to_deal` recebe `p_project_name` e grava em
--      `deals.project_name` (texto livre da 0160). `project_id` continua ligado
--      quando o nome bate com um empreendimento cadastrado da construtora.
--   2. "Conte as meias vendas no funil de vendas e nas equipes": a venda de uma
--      diretoria pesa o que o diretor tem no negócio — meia quando o negócio
--      tem dois diretores (`peso_do_diretor_no_negocio`), a mesma regra do
--      Dashboard (`pesoDoDiretor`). Venda sem esse diretor no negócio (o
--      histórico de antes do Diretor 2) fica inteira, como na 0266.
--      Vale para Vendas e VGV de `equipes_por_diretoria` e para Vendas do
--      recorte de `funil_de_vendas`; a imobiliária inteira segue com 1.
-- =============================================================================

-- 1. Conversão com empreendimento digitado ---------------------------------------
drop function if exists public.convert_lead_to_deal(uuid, uuid, uuid, text, numeric);

create or replace function public.convert_lead_to_deal(
  p_lead_id      uuid,
  p_developer_id uuid,
  p_project_id   uuid default null,
  p_unit         text default null,
  p_vgv_gross    numeric default null,
  p_project_name text default null
)
returns public.deals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead    public.leads;
  v_stage   uuid;
  v_deal    public.deals;
  v_owner   uuid;
  v_nome    text := nullif(btrim(p_project_name), '');
  v_projeto uuid := p_project_id;
begin
  if char_length(v_nome) > 120 then
    raise exception 'O nome do empreendimento passa de 120 caracteres.' using errcode = '22023';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  if v_lead.converted_deal_id is not null then
    raise exception 'Lead já convertido no negócio %.', v_lead.converted_deal_id
      using errcode = 'P0001';
  end if;

  v_owner := coalesce(v_lead.assigned_to, auth.uid());

  if not (public.is_admin() or v_owner = auth.uid() or public.manages_profile(v_owner)) then
    raise exception 'Sem permissão para converter este lead.' using errcode = '42501';
  end if;

  select id into v_stage from public.pipeline_stages
  where is_initial and active limit 1;
  if v_stage is null then
    raise exception 'Nenhum estágio inicial configurado no pipeline.' using errcode = 'P0001';
  end if;

  -- Nome digitado que bate com o cadastro da construtora liga o vínculo; o
  -- nome é gravado sempre.
  if v_projeto is null and v_nome is not null and p_developer_id is not null then
    select dp.id into v_projeto
      from public.developer_projects dp
     where dp.developer_id = p_developer_id and lower(btrim(dp.name)) = lower(v_nome)
     limit 1;
  end if;

  insert into public.deals (lead_id, developer_id, project_id, project_name, unit, stage_id,
                            vgv_gross, lead_origin, created_by)
  values (p_lead_id, p_developer_id, v_projeto, v_nome, p_unit, v_stage,
          p_vgv_gross,
          coalesce((select ls.label from public.lead_sources ls where ls.id = v_lead.source_id),
                   v_lead.utm_source),
          auth.uid())
  returning * into v_deal;

  insert into public.deal_clients (deal_id, ordinal, full_name, phone, email, cpf)
  values (v_deal.id, 1, v_lead.full_name, v_lead.phone, v_lead.email, v_lead.document);

  insert into public.deal_participants (deal_id, profile_id, role)
  values (v_deal.id, v_owner, 'broker');

  insert into public.deal_documents (deal_id, document_type_id, storage_path,
                                     original_name, stored_name, mime_type,
                                     size_bytes, uploaded_by)
  select v_deal.id,
         coalesce(la.document_type_id,
                  (select dt.id from public.document_types dt where dt.code = 'outros' limit 1)),
         la.storage_path, la.original_name, la.stored_name, la.mime_type,
         la.size_bytes, la.uploaded_by
  from public.lead_attachments la
  where la.lead_id = p_lead_id
    and coalesce(la.document_type_id,
                 (select dt.id from public.document_types dt where dt.code = 'outros' limit 1))
        is not null;

  update public.leads
     set status = 'converted',
         converted_deal_id = v_deal.id,
         converted_at = now(),
         last_activity_at = now()
   where id = p_lead_id;

  insert into public.lead_events (lead_id, actor_id, kind, to_value)
  values (p_lead_id, auth.uid(), 'converted', v_deal.id::text);

  insert into public.deal_history (deal_id, actor_id, kind, detail)
  values (v_deal.id, auth.uid(), 'created', jsonb_build_object('from_lead', p_lead_id));

  select * into v_deal from public.deals where id = v_deal.id;
  return v_deal;
end;
$$;

revoke all on function public.convert_lead_to_deal(uuid, uuid, uuid, text, numeric, text) from public, anon;
grant execute on function public.convert_lead_to_deal(uuid, uuid, uuid, text, numeric, text) to authenticated;

-- 2. Peso do diretor no negócio -----------------------------------------------------
create or replace function public.peso_do_diretor_no_negocio(p_deal_id uuid, p_diretor uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when p_diretor is not null
            and exists (select 1 from public.deal_participants dp
                         where dp.deal_id = p_deal_id and dp.role = 'director' and dp.profile_id = p_diretor)
           then 1.0 / (select count(*) from public.deal_participants dp
                        where dp.deal_id = p_deal_id and dp.role = 'director')
           else 1.0
         end;
$$;

revoke all on function public.peso_do_diretor_no_negocio(uuid, uuid) from public, anon, authenticated;
comment on function public.peso_do_diretor_no_negocio(uuid, uuid) is
  'Quanto da venda é da diretoria (0295): 1/n diretores do negócio quando o diretor está nele; 1 caso contrário (histórico de antes do Diretor 2).';

-- 3. Funil: vendas do recorte com o peso do diretor --------------------------------
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
  -- 0295: na diretoria, meia venda quando o negócio tem dois diretores.
  vendas as (
    select r.quem, d.id,
           case when r.quem = 'recorte' then public.peso_do_diretor_no_negocio(d.id, p_diretor) else 1.0 end as peso
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
           (select trim_scale(round(coalesce(sum(x.peso), 0), 2)) from vendas x where x.quem = r.quem) as vendas
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

-- 4. Equipes por diretoria: Vendas e VGV com o peso do diretor ----------------------
create or replace function public.equipes_por_diretoria(p_mes date default null)
returns table (
  diretor_id   uuid,
  diretor_nome text,
  equipe_id    uuid,
  equipe_nome  text,
  gerente_nome text,
  corretor_id  uuid,
  corretor_nome text,
  leads        numeric,
  visitas      numeric,
  agil         numeric,
  negocio      numeric,
  vendas       numeric,
  vgv          numeric,
  off          numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_mes    date := date_trunc('month', coalesce(p_mes, public.current_season_month(), current_date))::date;
  v_inicio timestamptz := (v_mes::timestamp at time zone 'America/Sao_Paulo');
  v_fim    timestamptz := ((v_mes + interval '1 month')::timestamp at time zone 'America/Sao_Paulo');
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada.' using errcode = '28000';
  end if;
  if not (public.is_admin() or public.has_role('director')) then
    raise exception 'Só administrador, sócio e diretor veem as equipes por diretoria.' using errcode = '42501';
  end if;

  return query
  with equipes as (
    select t.id, t.name, t.manager_id, ed.director_id
      from public.teams t
      join public.equipe_diretores ed on ed.team_id = t.id
     where t.active
       and (public.is_admin() or ed.director_id = auth.uid())
    union all
    -- Equipe ativa sem diretor: só o admin vê, em "Sem diretoria".
    select t.id, t.name, t.manager_id, null::uuid
      from public.teams t
     where t.active and public.is_admin()
       and t.director_id is null and t.co_director_id is null
  ),
  membros as (
    select e.director_id, e.id as team_id, e.name as team_name, e.manager_id, tm.profile_id
      from equipes e
      join public.team_members tm on tm.team_id = e.id and tm.left_at is null
  ),
  corretores_do_negocio as (
    select dp.deal_id, dp.profile_id, dp.share_pct,
           count(*) over (partition by dp.deal_id) as n
      from public.deal_participants dp
     where dp.role = 'broker'
  ),
  -- 0295: o mesmo corretor aparece uma vez por diretoria, e a venda pesa o
  -- que aquele diretor tem no negócio.
  negocios as (
    select dm.director_id,
           c.profile_id,
           1.0 / c.n as peso,
           public.peso_do_diretor_no_negocio(d.id, dm.director_id) as peso_diretor,
           coalesce(nullif(c.share_pct, 0) / 100.0, 1.0 / c.n) as parte_vgv,
           public.deal_status_bare(d.status_detail) as st,
           (d.outcome = 'won' or (d.outcome = 'open' and g.code = 'VENDA')) as venda,
           coalesce(d.vgv_net, 0) as vgv_net
      from public.deals d
      join corretores_do_negocio c on c.deal_id = d.id
      join (select distinct m.director_id, m.profile_id from membros m) dm on dm.profile_id = c.profile_id
      left join public.deal_status_groups g on g.id = d.status_group_id
     where d.month_base = v_mes
  ),
  por_corretor as (
    select n.director_id,
           n.profile_id,
           sum(n.peso) filter (where n.st in ('ESTEIRA AGIL', 'ESTEIRA ÁGIL')) as agil,
           sum(n.peso) filter (where n.st in ('VIROU NEGÓCIO', 'VIROU NEGOCIO', 'NEGÓCIO', 'NEGOCIO',
                                              'NEGÓCIO FECHADO', 'NEGOCIO FECHADO')) as negocio,
           sum(n.peso * n.peso_diretor) filter (where n.venda) as vendas,
           sum(n.vgv_net * n.parte_vgv * n.peso_diretor) filter (where n.venda) as vgv,
           sum(n.peso) filter (where n.st = 'OFF' or n.st like 'OFF %') as off
      from negocios n
     group by n.director_id, n.profile_id
  ),
  leads_do_mes as (
    select l.assigned_to as profile_id, count(*) as total
      from public.leads l
     where l.assigned_to in (select m.profile_id from membros m)
       and l.created_at >= v_inicio and l.created_at < v_fim
     group by l.assigned_to
  ),
  visitas_do_mes as (
    select v.broker_id as profile_id, count(*) as total
      from public.visits v
     where v.broker_id in (select m.profile_id from membros m)
       and v.scheduled_at >= v_inicio and v.scheduled_at < v_fim
     group by v.broker_id
  )
  select m.director_id,
         coalesce(nullif(btrim(pd.nickname), ''), pd.full_name, 'Sem diretoria'),
         m.team_id,
         m.team_name,
         coalesce(nullif(btrim(pm.nickname), ''), pm.full_name),
         m.profile_id,
         coalesce(nullif(btrim(pc.nickname), ''), pc.full_name),
         coalesce(lm.total, 0)::numeric,
         coalesce(vm.total, 0)::numeric,
         coalesce(pc2.agil, 0)::numeric,
         coalesce(pc2.negocio, 0)::numeric,
         round(coalesce(pc2.vendas, 0), 4)::numeric,
         round(coalesce(pc2.vgv, 0), 2)::numeric,
         coalesce(pc2.off, 0)::numeric
    from membros m
    join public.profiles pc on pc.id = m.profile_id and pc.status = 'active'
    left join public.profiles pd on pd.id = m.director_id
    left join public.profiles pm on pm.id = m.manager_id
    left join por_corretor pc2 on pc2.profile_id = m.profile_id and pc2.director_id is not distinct from m.director_id
    left join leads_do_mes lm on lm.profile_id = m.profile_id
    left join visitas_do_mes vm on vm.profile_id = m.profile_id;
end;
$$;

revoke all on function public.equipes_por_diretoria(date) from public, anon;
grant execute on function public.equipes_por_diretoria(date) to authenticated;
comment on function public.equipes_por_diretoria(date) is
  'Diretorias → equipes → corretores com Leads, Visitas, Ágil, Negócio, Vendas, VGV e Off do mês (0291). Vendas e VGV com o peso do diretor no negócio (0295).';
