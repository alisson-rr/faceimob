-- =============================================================================
-- 0353 · Funil por etapas (Dashboard, pedido de 21/11/2026)
--
-- O funil novo do Dashboard, aprovado em simulação:
--   · Leads do mês — base, 100% (a mesma conta de `funil_de_vendas`).
--   · Documentos — Produção (Status 1 PROPOSTA) + Legado (Status 1 LEGADO) do
--     mês-base, discriminados por Status 2. Sem meta: vêm de um mês para o outro.
--   · Envios p/ análise — casos mandados à CCA no mês (`cca_cases.submitted_at`),
--     separados em negócios do mês e de outros meses. Meta: 10% dos leads.
--   · Aprovados — desses envios, os que estão aprovados (total, condicionado,
--     com restrição) ou já avançaram (contrato, agência, ágil, virou negócio…).
--     Meta: 40% dos envios.
--   · Negócios + Vendas — desses aprovados, os em contrato, assinatura ou que
--     viraram negócio. Meta: 50% dos aprovados.
-- As metas ficam na tela; o banco devolve as contagens e os itens de cada etapa.
-- Mesmo alcance de `funil_de_vendas` (0299): admin vê a imobiliária e escolhe a
-- diretoria; diretor e gerente abrem a própria.
-- =============================================================================

create or replace function public.funil_por_etapas(p_mes date, p_diretor uuid default null)
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
  v_leads      int;
  v_docs       jsonb;
  v_envios     jsonb;
  v_aprov      jsonb;
  v_vendas     jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada.' using errcode = '42501';
  end if;
  if p_mes is null then
    raise exception 'Informe o mês.' using errcode = '22023';
  end if;

  v_ini := v_mes::timestamp at time zone 'America/Sao_Paulo';
  v_fim := (v_mes + interval '1 month')::timestamp at time zone 'America/Sao_Paulo';

  select coalesce(array_agg(distinct d.diretor), '{}')
    into v_permitidas
    from public.teams t
    cross join lateral (values (t.director_id), (t.co_director_id)) d(diretor)
   where t.active and d.diretor is not null
     and (v_admin or auth.uid() in (t.manager_id, t.director_id, t.co_director_id));

  if p_diretor is null and not v_admin then
    if cardinality(v_permitidas) = 0 then
      raise exception 'O funil é da liderança.' using errcode = '42501';
    end if;
    p_diretor := case when auth.uid() = any (v_permitidas) then auth.uid() else v_permitidas[1] end;
  end if;
  if p_diretor is not null and not (p_diretor = any (v_permitidas)) then
    raise exception 'Diretoria fora do seu alcance.' using errcode = '42501';
  end if;

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

  select count(*)::int into v_leads
    from public.leads l
   where l.created_at >= v_ini and l.created_at < v_fim
     and (p_diretor is null or coalesce(l.assigned_to, l.ultimo_corretor_id) = any (v_membros));

  with
  doc as (
    select g.code as grupo,
           coalesce(nullif(s.label, ''), public.deal_status_bare(d.status_detail), 'Sem Status 2') as rotulo
      from public.deals d
      join public.deal_status_groups g on g.id = d.status_group_id and g.code in ('PROPOSTA', 'LEGADO')
      left join public.deal_statuses s on s.value = d.status_detail
     where d.month_base = v_mes
       and (p_diretor is null or exists (
             select 1 from public.deal_participants dp
              where dp.deal_id = d.id and dp.role = 'broker' and dp.profile_id = any (v_membros)))
  )
  select jsonb_build_object(
           'producao', coalesce((select jsonb_agg(jsonb_build_object('rotulo', rotulo, 'n', n) order by n desc, rotulo)
                                   from (select rotulo, count(*)::int n from doc where grupo = 'PROPOSTA' group by rotulo) x), '[]'),
           'legado',   coalesce((select jsonb_agg(jsonb_build_object('rotulo', rotulo, 'n', n) order by n desc, rotulo)
                                   from (select rotulo, count(*)::int n from doc where grupo = 'LEGADO' group by rotulo) x), '[]'))
    into v_docs;

  -- Envios do mês e onde cada um está agora: uma consulta só, sem tabela
  -- temporária (função `stable`).
  with
  envio as (
    select distinct on (d.id) d.id, d.month_base = v_mes as do_mes,
           public.status2_chave(d.status_detail) as chave,
           coalesce(nullif(s.label, ''), public.deal_status_bare(d.status_detail), 'Sem Status 2') as rotulo
      from public.cca_cases c
      join public.deals d on d.id = c.deal_id
      left join public.deal_statuses s on s.value = d.status_detail
     where c.submitted_at >= v_ini and c.submitted_at < v_fim
       and (p_diretor is null or exists (
             select 1 from public.deal_participants dp
              where dp.deal_id = d.id and dp.role = 'broker' and dp.profile_id = any (v_membros)))
  ),
  aprov as (
    select case when e.chave in ('APROV. TOTAL', 'APROV. TOT. RESTRICAO', 'APROV. COND.', 'APROV. COND. RESTRICAO')
                then e.rotulo else 'Já avançaram (contrato, agência, ágil…)' end as rotulo,
           case when e.chave in ('APROV. TOTAL', 'APROV. TOT. RESTRICAO', 'APROV. COND.', 'APROV. COND. RESTRICAO')
                then 0 else 1 end as ordem
      from envio e
     where e.chave in ('APROV. TOTAL', 'APROV. TOT. RESTRICAO', 'APROV. COND.', 'APROV. COND. RESTRICAO',
                       'APROV. AG. CONT.', 'EM PROCESSAMENTO', 'AG. RET. AGENCIA', 'ESTEIRA AGIL', 'RET. ESTEIRA AGIL',
                       'PENDENTE P/ VIRAR NEGOCIO', 'ANALISE P/ VIRAR NEGOCIO', 'INTERNALIZADO',
                       'VIROU NEGOCIO', 'VIROU NEGOCIO COM PENDENCIAS',
                       'EM CONTRATO', 'ASS. BANCO', 'ASSINADO', 'RC EMITIDA')
  ),
  venda as (
    select e.rotulo from envio e
     where e.chave in ('VIROU NEGOCIO', 'VIROU NEGOCIO COM PENDENCIAS', 'EM CONTRATO', 'ASS. BANCO', 'ASSINADO', 'RC EMITIDA')
  )
  select
    (select jsonb_build_object('total', count(*)::int,
                               'do_mes', count(*) filter (where do_mes)::int,
                               'outros_meses', count(*) filter (where not do_mes)::int) from envio),
    (select jsonb_build_object('total', count(*)::int,
                               'itens', coalesce((select jsonb_agg(jsonb_build_object('rotulo', rotulo, 'n', n) order by ordem, n desc, rotulo)
                                                    from (select rotulo, ordem, count(*)::int n from aprov group by 1, 2) x), '[]'))
       from aprov),
    (select jsonb_build_object('total', count(*)::int,
                               'itens', coalesce((select jsonb_agg(jsonb_build_object('rotulo', rotulo, 'n', n) order by n desc, rotulo)
                                                    from (select rotulo, count(*)::int n from venda group by 1) x), '[]'))
       from venda)
    into v_envios, v_aprov, v_vendas;

  return jsonb_build_object(
    'mes', v_mes,
    'diretor', p_diretor,
    'leads', v_leads,
    'documentos', v_docs,
    'envios', v_envios,
    'aprovados', v_aprov,
    'vendas', v_vendas,
    'diretorias', (
      select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'nome', pr.full_name) order by pr.full_name), '[]'::jsonb)
        from public.profiles pr where pr.id = any (v_permitidas)),
    'pode_ver_imob', v_admin);
end;
$$;

comment on function public.funil_por_etapas(date, uuid) is
  'Funil do Dashboard (0353): leads do mês, documentos (Produção + Legado por Status 2), envios à CCA no mês, aprovados e vendas desses envios. Mesmo alcance de funil_de_vendas.';

revoke all on function public.funil_por_etapas(date, uuid) from public, anon;
grant execute on function public.funil_por_etapas(date, uuid) to authenticated;
