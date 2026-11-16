-- =============================================================================
-- 0340 · Lista de ligação: ordem estável para buscar em partes
--
-- 16/11/2026: o PostgREST devolve no máximo 1.000 linhas por chamada, e a
-- lista de outubro com DDD 51 passa disso — o arquivo saía cortado (o botão
-- antigo já cortava). O front passa a buscar de 1.000 em 1.000; para as
-- partes não se repetirem nem pularem ninguém, a ordem precisa ser a mesma em
-- toda chamada: sai o random() daqui (o front já intercala as campanhas).
--
-- E (pedido do Douglas, 16/11): escolher mês e DDD é só de administrador e
-- sócio. Gerente e diretor seguem com a lista do ano até o mês passado,
-- sortida. A regra de quem entra fica numa função interna, sem grant.
-- =============================================================================

create or replace function public.lista_de_ligacao_base(p_inicio date, p_fim date, p_ddd text)
returns table (campanha text, cliente text, telefone text, criado_em timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ddd text := nullif(regexp_replace(coalesce(p_ddd, ''), '\D', '', 'g'), '');
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  -- Período vazio (janeiro na versão sem argumentos) devolve lista vazia.
  if p_inicio is null or p_fim is null or p_fim < p_inicio then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;
  if v_ddd is not null and length(v_ddd) <> 2 then
    raise exception 'DDD precisa ter 2 dígitos.' using errcode = '22023';
  end if;

  return query
  with base as (
    select l.id as lead_id,
           coalesce(nullif(btrim(l.campaign_name), ''), nullif(btrim(l.utm_campaign), ''),
                    s.label, 'Sem campanha') as campanha_nome,
           l.full_name as cliente_nome,
           coalesce(nullif(btrim(l.phone), ''), nullif(btrim(l.phone_raw), '')) as telefone_numero,
           l.created_at as criado
      from public.leads l
      left join public.lead_sources s on s.id = l.source_id
     where l.created_at >= (p_inicio::timestamp at time zone 'America/Sao_Paulo')
       and l.created_at <  (p_fim::timestamp at time zone 'America/Sao_Paulo')
       and l.converted_deal_id is null
       and l.status <> 'converted'
       and coalesce(nullif(btrim(l.phone), ''), nullif(btrim(l.phone_raw), '')) is not null
  ), filtrada as (
    select b.* from base b
     where v_ddd is null
        or left(regexp_replace(regexp_replace(b.telefone_numero, '\D', '', 'g'), '^55(?=\d{10,11}$)', ''), 2) = v_ddd
  )
  select f.campanha_nome, f.cliente_nome, f.telefone_numero, f.criado
    from filtrada f
   order by f.criado, f.lead_id;
end;
$$;
revoke all on function public.lista_de_ligacao_base(date, date, text) from public, anon, authenticated;

-- Mês e DDD escolhidos: só administrador e sócio.
create or replace function public.lista_de_ligacao(p_inicio date, p_fim date, p_ddd text default null)
returns table (campanha text, cliente text, telefone text, criado_em timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if not public.is_admin() then
    raise exception 'Escolher mês e DDD é só do administrador.' using errcode = '42501';
  end if;
  return query select * from public.lista_de_ligacao_base(p_inicio, p_fim, p_ddd);
end;
$$;
revoke all on function public.lista_de_ligacao(date, date, text) from public, anon;
grant execute on function public.lista_de_ligacao(date, date, text) to authenticated, service_role;

-- Gerente e diretor (leads.call_list): ano corrente até o mês passado, como na 0307.
create or replace function public.lista_de_ligacao()
returns table (campanha text, cliente text, telefone text, criado_em timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if not public.has_permission('leads.call_list') then
    raise exception 'Seu perfil não extrai a lista de ligação.' using errcode = '42501';
  end if;
  return query select * from public.lista_de_ligacao_base(
    date_trunc('year', now() at time zone 'America/Sao_Paulo')::date,
    date_trunc('month', now() at time zone 'America/Sao_Paulo')::date,
    null);
end;
$$;
