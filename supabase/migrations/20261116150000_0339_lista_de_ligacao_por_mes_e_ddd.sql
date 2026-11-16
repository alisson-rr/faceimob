-- =============================================================================
-- 0339 · Lista de ligação: escolher o mês e o DDD
--
-- Pedido de 16/11/2026: extrair para o call center os leads de um mês
-- escolhido (não só "o ano até o mês passado") e só de um DDD (ex.: 51).
-- A regra de quem entra continua uma só: a versão com período e DDD é a
-- fonte; a versão sem argumentos (0307) passa a chamá-la com o período antigo.
-- =============================================================================

create or replace function public.lista_de_ligacao(p_inicio date, p_fim date, p_ddd text default null)
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
  if not public.has_permission('leads.call_list') then
    raise exception 'Seu perfil não extrai a lista de ligação.' using errcode = '42501';
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
    select coalesce(nullif(btrim(l.campaign_name), ''), nullif(btrim(l.utm_campaign), ''),
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
  ), rodadas as (
    select f.*,
           row_number() over (partition by lower(f.campanha_nome) order by random()) as rodada
      from filtrada f
  )
  select r.campanha_nome, r.cliente_nome, r.telefone_numero, r.criado
    from rodadas r
   order by r.rodada, random();
end;
$$;
revoke all on function public.lista_de_ligacao(date, date, text) from public, anon;
grant execute on function public.lista_de_ligacao(date, date, text) to authenticated, service_role;

-- 0307 continua igual para quem chama sem argumentos: ano corrente até o mês passado.
create or replace function public.lista_de_ligacao()
returns table (campanha text, cliente text, telefone text, criado_em timestamptz)
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select * from public.lista_de_ligacao(
    date_trunc('year', now() at time zone 'America/Sao_Paulo')::date,
    date_trunc('month', now() at time zone 'America/Sao_Paulo')::date,
    null);
$$;
