-- =============================================================================
-- 0214 — Funil de Vendas do Dashboard
--
-- Pedido de 04/10/2026: funil simples de 4 camadas no mês, com o ideal de cada
-- passagem, comparado com a imobiliária inteira e com recorte por diretoria:
--   1. Leads             — leads que entraram no mês (100%);
--   2. Docs enviadas     — negócios do mês-base (toda proposta nasce da
--                          documentação enviada para análise); ideal 10% dos leads;
--   3. Docs aprovadas    — desses, os aprovados total ou condicionado, ou que já
--                          passaram da aprovação (virou negócio, RP, contrato,
--                          venda, distrato); ideal 40% das docs;
--   4. Vendas            — desses, os vendidos (fechado, ou Status 1 VENDA em
--                          aberto: a regra da 0207); ideal 50% das aprovadas.
-- Cada camada é parte da anterior, então o funil nunca "sobe".
--
-- E a lista de alerta: negócio parado há mais de 3 dias em APROV. TOTAL,
-- APROV. COND. ou VIROU NEGÓCIO. O banco não guardava quando o Status 2 mudou;
-- passa a guardar em `deals.status_detail_changed_at`. Até lá, os antigos usam
-- `updated_at` (a última edição), o que pode atrasar o alerta, nunca adiantá-lo.
--
-- Alcance: admin e sócio veem a imobiliária e qualquer diretoria; diretor e
-- gerente, só as diretorias das equipes que lideram (como `resumo_da_diretoria`);
-- sem escolher, abrem a própria.
-- O número da imobiliária volta a todos esses como total, sem nomes: é a régua
-- de comparação.
-- =============================================================================

alter table public.deals add column if not exists status_detail_changed_at timestamptz;
comment on column public.deals.status_detail_changed_at is
  'Quando o Status 2 mudou pela última vez (0214). Nulo nos negócios que não mudaram desde então.';

create or replace function public.deals_marca_status2()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.status_detail is distinct from old.status_detail then
    new.status_detail_changed_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.deals_marca_status2() from public, anon, authenticated;

drop trigger if exists deals_marca_status2 on public.deals;
create trigger deals_marca_status2
  before insert or update of status_detail on public.deals
  for each row execute function public.deals_marca_status2();

-- Rótulo do Status 2 sem número, sem acento, em caixa alta.
create or replace function public.status2_chave(p_status text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select translate(coalesce(public.deal_status_bare(p_status), ''),
                   'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC');
$$;

revoke all on function public.status2_chave(text) from public, anon;
grant execute on function public.status2_chave(text) to authenticated, service_role;

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
  negocios as (
    select r.quem, d.id, d.outcome, g.code as grupo, public.status2_chave(d.status_detail) as s2
      from recortes r
      join public.deals d on d.month_base = v_mes
      left join public.deal_status_groups g on g.id = d.status_group_id
     where r.membros is null
        or exists (select 1 from public.deal_participants dp
                    where dp.deal_id = d.id and dp.role = 'broker'
                      and dp.profile_id = any (r.membros))
  ),
  classes as (
    select n.quem,
           (n.outcome = 'won' or (n.outcome = 'open' and n.grupo = 'VENDA')) as venda,
           (n.outcome = 'won' or n.grupo in ('VENDA', 'DISTRATO')
            or n.s2 in ('APROV. TOTAL', 'APROV. COND.', 'APROV. AG. CONT.', 'VIROU NEGOCIO',
                        'PENDENTE P/ VIRAR NEGOCIO', 'ANALISE P/ VIRAR NEGOCIO',
                        'MUDAR CONSTRUTORA P/ NEGOCIO', 'ENVIO DE RP', 'RP APROVADO')) as aprovada
      from negocios n
  ),
  contas as (
    select r.quem,
           coalesce((select lm.n from leads_mes lm where lm.quem = r.quem), 0) as leads,
           (select count(*)::int from classes c where c.quem = r.quem) as docs,
           (select count(*)::int from classes c where c.quem = r.quem and (c.aprovada or c.venda)) as aprovadas,
           (select count(*)::int from classes c where c.quem = r.quem and c.venda) as vendas
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
  'Funil do mês (0214): leads, docs enviadas (negócios do mês-base), aprovadas e vendas, da imobiliária e de uma diretoria, mais os negócios parados há mais de 3 dias em aprovação/virou negócio. Admin vê tudo; diretor e gerente, as diretorias que lideram.';
