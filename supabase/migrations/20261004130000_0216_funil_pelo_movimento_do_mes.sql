-- =============================================================================
-- 0216 — Funil de Vendas pelo que se MOVEU no mês, e o histórico do Status 2
--
-- Reclamação de 04/10/2026: o funil mostrava 82 leads e 331 docs. "Docs" era
-- todo negócio do mês-base — inclusive as propostas que viraram o mês —, então
-- a conta não fechava. Agora:
--   · Docs enviadas = negócio que entrou na esteira do CCA no mês, ou cujo
--     Status 2 passou a Esteira Ágil, Retorno à Esteira ou Análise Externa no mês;
--   · Docs aprovadas = Status 2 que passou a Aprov. Total ou Aprov. Cond. no mês;
--   · Leads e Vendas seguem como estavam (entrada no mês; venda do mês-base).
--
-- Para saber QUANDO o Status 2 mudou, cada troca passa a ficar em
-- `deal_status_history`. O passado vem dos avisos de movimentação já enviados
-- (`cca_move_emails`, que guardam o Status 2 e a hora) e da data da última troca
-- que a 0214 começou a gravar. Movimento antigo sem aviso não tem registro: o
-- mês corrente fica completo a partir de hoje.
-- =============================================================================

create table if not exists public.deal_status_history (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references public.deals(id) on delete cascade,
  from_status text,
  to_status   text,
  changed_at  timestamptz not null default now(),
  actor_id    uuid references public.profiles(id) on delete set null
);

create index if not exists deal_status_history_changed_idx on public.deal_status_history (changed_at);
create index if not exists deal_status_history_deal_idx on public.deal_status_history (deal_id, changed_at desc);

comment on table public.deal_status_history is
  'Cada troca de Status 2 de um negócio (0216): base do Funil de Vendas por movimento no mês.';

alter table public.deal_status_history enable row level security;
drop policy if exists deal_status_history_select on public.deal_status_history;
create policy deal_status_history_select on public.deal_status_history
  for select to authenticated using (public.can_see_deal(deal_id));
revoke all on public.deal_status_history from anon, authenticated;
grant select on public.deal_status_history to authenticated;
grant all on public.deal_status_history to service_role;

create or replace function public.deals_registra_status2()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status_detail is not null then
      insert into public.deal_status_history (deal_id, from_status, to_status, actor_id)
      values (new.id, null, new.status_detail, auth.uid());
    end if;
  elsif new.status_detail is distinct from old.status_detail then
    insert into public.deal_status_history (deal_id, from_status, to_status, actor_id)
    values (new.id, old.status_detail, new.status_detail, auth.uid());
  end if;
  return null;
end;
$$;

revoke all on function public.deals_registra_status2() from public, anon, authenticated;

drop trigger if exists deals_registra_status2 on public.deals;
create trigger deals_registra_status2
  after insert or update of status_detail on public.deals
  for each row execute function public.deals_registra_status2();

-- Passado: um registro por negócio, Status 2 e minuto dos avisos já enviados.
insert into public.deal_status_history (deal_id, to_status, changed_at)
select distinct on (e.deal_id, e.detalhes ->> 'status2', date_trunc('minute', e.created_at))
       e.deal_id, e.detalhes ->> 'status2', e.created_at
  from public.cca_move_emails e
 where e.source = 'pipeline'
   and coalesce(e.detalhes ->> 'status2', '') <> ''
   and exists (select 1 from public.deals d where d.id = e.deal_id)
 order by e.deal_id, e.detalhes ->> 'status2', date_trunc('minute', e.created_at), e.created_at;

-- E a última troca que a 0214 já gravou, quando o aviso não a cobriu.
insert into public.deal_status_history (deal_id, to_status, changed_at)
select d.id, d.status_detail, d.status_detail_changed_at
  from public.deals d
 where d.status_detail_changed_at is not null
   and d.status_detail is not null
   and not exists (
     select 1 from public.deal_status_history h
      where h.deal_id = d.id
        and public.status2_chave(h.to_status) = public.status2_chave(d.status_detail)
        and h.changed_at between d.status_detail_changed_at - interval '5 minutes'
                             and d.status_detail_changed_at + interval '5 minutes');

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

  select coalesce(array_agg(distinct t.director_id), '{}')
    into v_permitidas
    from public.teams t
   where t.active and t.director_id is not null
     and (v_admin or auth.uid() in (t.manager_id, t.director_id));

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
         where t.active and t.director_id = p_diretor
        union
        select t.manager_id from public.teams t
         where t.active and t.director_id = p_diretor and t.manager_id is not null
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

comment on function public.funil_de_vendas(date, uuid) is
  'Funil do mês (0216): leads que entraram, docs enviadas e aprovadas no mês (pelo histórico do Status 2 e pela entrada na esteira do CCA) e vendas do mês-base; da imobiliária e de uma diretoria, mais os aprovados parados há mais de 3 dias.';
