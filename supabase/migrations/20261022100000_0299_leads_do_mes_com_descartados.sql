-- =============================================================================
-- 0299 · Leads do mês contam os perdidos e descartados
--
-- Pedido de 22/10/2026: "insira nesta relação de leads os descartados também
-- para sabermos o total de leads no mês, tanto geral quanto individual,
-- equipes e diretoria".
--
-- Causa: `close_lead` (0234) limpa `assigned_to` ao perder ou descartar — o
-- lead some da base do corretor, como pedido em 06/10 —, e com isso some da
-- contagem de leads do corretor, da equipe e da diretoria. Os cartões
-- "Leads · hoje/semana/mês" ainda contavam no navegador sobre a lista, que
-- para em 1.000 linhas.
--
--   1. `leads.ultimo_corretor_id`: quem tinha o lead quando foi encerrado.
--      `close_lead` grava; os já encerrados saem da última passagem da roleta
--      (`lead_assignments`). `assigned_to` continua nulo: o lead encerrado não
--      volta para a base do corretor.
--   2. Dono para contar = `coalesce(assigned_to, ultimo_corretor_id)`, em
--      `equipes_por_diretoria`, no funil (`funil_de_vendas`) e na RPC nova
--      `leads_recebidos`, que conta no banco os cartões da tela de Leads.
-- =============================================================================

-- 1. Quem tinha o lead ------------------------------------------------------------
alter table public.leads
  add column if not exists ultimo_corretor_id uuid references public.profiles(id) on delete set null;

comment on column public.leads.ultimo_corretor_id is
  'Corretor que tinha o lead quando ele foi perdido ou descartado (0299). Só para contar o lead recebido; a base do corretor segue por assigned_to.';

alter table public.leads disable trigger leads_set_updated_at;
update public.leads l
   set ultimo_corretor_id = a.profile_id
  from (select distinct on (la.lead_id) la.lead_id, la.profile_id
          from public.lead_assignments la
         order by la.lead_id, la.assigned_at desc) a
 where a.lead_id = l.id
   and l.assigned_to is null
   and l.ultimo_corretor_id is null
   and l.status in ('lost', 'discarded');
alter table public.leads enable trigger leads_set_updated_at;

create index if not exists leads_ultimo_corretor_idx
  on public.leads (ultimo_corretor_id) where ultimo_corretor_id is not null;

create or replace function public.close_lead(
  p_lead_id uuid,
  p_status public.lead_status,
  p_reason text
)
returns public.leads
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_lead   public.leads;
  v_before public.lead_status;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_status not in ('lost', 'discarded') then
    raise exception 'Encerrar um lead aceita só "perdido" ou "descartado".'
      using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'O motivo é obrigatório para encerrar um lead.'
      using errcode = 'P0001';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  if not public.can_write_lead(p_lead_id) then
    raise exception 'Sem permissão para encerrar este lead.' using errcode = '42501';
  end if;

  if v_lead.converted_deal_id is not null then
    raise exception 'Este lead já virou negócio: encerre o negócio no Pipeline.'
      using errcode = 'P0001';
  end if;

  if v_lead.status in ('lost', 'discarded') then
    raise exception 'Este lead já está encerrado.' using errcode = 'P0001';
  end if;

  v_before := v_lead.status;

  -- A trava de atendimento morre junto: o lead encerrado não pode continuar
  -- correndo contra o relógio de ninguém.
  update public.lead_assignments
     set released_at = now(), release_reason = 'manual'
   where lead_id = p_lead_id and released_at is null;

  update public.leads
     set status           = p_status,
         lost_reason      = v_reason,
         -- Mantém a correção da 0226: a constraint só aceita `lost_at` no
         -- status perdido; descartado guarda o motivo, mas não essa data.
         lost_at          = case when p_status = 'lost' then now() end,
         attend_deadline  = null,
         -- Sai da conta de `overdue_lead_count` porque o status deixa de ser
         -- de operação; zerar o prazo aqui é o que impede o lead encerrado de
         -- reaparecer como atrasado se algum dia voltar.
         next_action_at   = null,
         -- 0234: limpa o vínculo com o corretor. Sem isso, o lead perdido
         -- continuava aparecendo na base do corretor como se ainda fosse dele.
         assigned_to      = null,
         -- 0299: guarda quem tinha o lead, para contar o lead recebido.
         ultimo_corretor_id = coalesce(v_lead.assigned_to, v_lead.ultimo_corretor_id),
         last_activity_at = now()
   where id = p_lead_id
  returning * into v_lead;

  -- O gatilho `leads_log_changes` (0005) já grava um `status_changed` sempre que
  -- `leads.status` muda. Repetir o mesmo evento aqui gravava DOIS: a aba
  -- Histórico mostrava a linha duplicada e o relatório "quantos perdemos por
  -- preço" — a razão de a lista de motivos ser fixa — contava em dobro. O que
  -- só existe aqui é o MOTIVO, então ele entra como evento próprio, sem
  -- reescrever o log do gatilho (que é imutável por contrato).
  insert into public.lead_events (lead_id, actor_id, kind, from_value, to_value, detail)
  values (p_lead_id, auth.uid(), 'closed', v_before::text, p_status::text,
          jsonb_build_object('reason', v_reason));

  return v_lead;
end;
$$;

-- 2. Funil: leads do recorte pelo dono para contar --------------------------------
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
       and (r.membros is null or coalesce(l.assigned_to, l.ultimo_corretor_id) = any (r.membros))
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

-- 3. Equipes por diretoria: leads pelo dono para contar ---------------------------
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
  legado       numeric,
  proposta     numeric,
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
           g.code as grupo,
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
           sum(n.peso) filter (where n.grupo = 'LEGADO') as legado,
           sum(n.peso) filter (where n.grupo = 'PROPOSTA') as proposta,
           sum(n.peso) filter (where n.st in ('VIROU NEGÓCIO', 'VIROU NEGOCIO', 'NEGÓCIO', 'NEGOCIO',
                                              'NEGÓCIO FECHADO', 'NEGOCIO FECHADO')) as negocio,
           sum(n.peso * n.peso_diretor) filter (where n.venda) as vendas,
           sum(n.vgv_net * n.parte_vgv * n.peso_diretor) filter (where n.venda) as vgv,
           sum(n.peso) filter (where n.st = 'OFF' or n.st like 'OFF %') as off
      from negocios n
     group by n.director_id, n.profile_id
  ),
  leads_do_mes as (
    select coalesce(l.assigned_to, l.ultimo_corretor_id) as profile_id, count(*) as total
      from public.leads l
     where coalesce(l.assigned_to, l.ultimo_corretor_id) in (select m.profile_id from membros m)
       and l.created_at >= v_inicio and l.created_at < v_fim
     group by 1
  )
  select m.director_id,
         coalesce(nullif(btrim(pd.nickname), ''), pd.full_name, 'Sem diretoria'),
         m.team_id,
         m.team_name,
         coalesce(nullif(btrim(pm.nickname), ''), pm.full_name),
         m.profile_id,
         coalesce(nullif(btrim(pc.nickname), ''), pc.full_name),
         coalesce(lm.total, 0)::numeric,
         coalesce(pc2.legado, 0)::numeric,
         coalesce(pc2.proposta, 0)::numeric,
         coalesce(pc2.negocio, 0)::numeric,
         round(coalesce(pc2.vendas, 0), 4)::numeric,
         round(coalesce(pc2.vgv, 0), 2)::numeric,
         coalesce(pc2.off, 0)::numeric
    from membros m
    join public.profiles pc on pc.id = m.profile_id and pc.status = 'active'
    left join public.profiles pd on pd.id = m.director_id
    left join public.profiles pm on pm.id = m.manager_id
    left join por_corretor pc2 on pc2.profile_id = m.profile_id and pc2.director_id is not distinct from m.director_id
    left join leads_do_mes lm on lm.profile_id = m.profile_id;
end;
$$;

revoke all on function public.equipes_por_diretoria(date) from public, anon;
grant execute on function public.equipes_por_diretoria(date) to authenticated;
comment on function public.equipes_por_diretoria(date) is
  'Diretorias → equipes → corretores com Leads, Legado, Proposta, Negócio, Vendas, VGV e Off do mês (0291/0297). Vendas e VGV com o peso do diretor no negócio (0295).';

-- 4. Cartões "Leads · hoje / semana / mês" contados no banco ------------------------
-- `p_corretor` nulo = todos os que a pessoa enxerga; `p_sem_corretor` = só a
-- fila (lead que nunca teve dono). Conta perdidos e descartados pelo dono para
-- contar. A base importada da Leadfy (0188) chega com a data original e não é
-- lead recebido: fica fora, como na tela.
create or replace function public.leads_recebidos(p_corretor uuid default null, p_sem_corretor boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lider  boolean := public.is_admin()
                      or public.has_any_role('director', 'manager', 'cca', 'sdr', 'marketing');
  v_hoje   timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
  v_semana timestamptz := (date_trunc('week', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
  v_mes    timestamptz := (date_trunc('month', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
  v_out    jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada.' using errcode = '28000';
  end if;
  if p_corretor is not null and not (public.is_admin() or p_corretor in (select public.auth_visible_profiles())) then
    raise exception 'Corretor fora do seu alcance.' using errcode = '42501';
  end if;
  if p_sem_corretor and not (v_lider or public.has_permission('leads.view_queue')) then
    raise exception 'A fila é da liderança.' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'hoje',   count(*) filter (where x.created_at >= v_hoje),
           'semana', count(*) filter (where x.created_at >= v_semana),
           'mes',    count(*) filter (where x.created_at >= v_mes))
    into v_out
    from (
      select l.created_at, coalesce(l.assigned_to, l.ultimo_corretor_id) as dono
        from public.leads l
       where l.created_at >= least(v_mes, v_semana)
         and coalesce(l.external_id, '') not like 'leadfy:%'
    ) x
   where case
           when p_sem_corretor then x.dono is null
           when p_corretor is not null then x.dono = p_corretor
           when v_lider then x.dono is null or x.dono in (select public.auth_visible_profiles())
           else x.dono in (select public.auth_visible_profiles())
         end;
  return v_out;
end;
$$;

revoke all on function public.leads_recebidos(uuid, boolean) from public, anon;
grant execute on function public.leads_recebidos(uuid, boolean) to authenticated;
comment on function public.leads_recebidos(uuid, boolean) is
  'Leads recebidos hoje, na semana e no mês (fuso de São Paulo), com perdidos e descartados pelo último corretor (0299).';
