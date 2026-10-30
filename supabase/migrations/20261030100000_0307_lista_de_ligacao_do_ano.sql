-- =============================================================================
-- 0307 · Lista de ligação só com leads do ano corrente
--
-- Pedido de 30/10/2026: os gerentes reclamam que a lista exportada pela aba
-- Leads traz leads muito antigos. Passa a ser só do ano corrente (no fuso de
-- São Paulo) e antes do mês corrente, como já era. A planilha ganha a coluna
-- com o mês e o ano do lead, montada no front a partir de `criado_em`, que a
-- RPC já devolvia.
-- =============================================================================

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

  return query
  with base as (
    select l.id,
           coalesce(nullif(btrim(l.campaign_name), ''), nullif(btrim(l.utm_campaign), ''),
                    s.label, 'Sem campanha') as campanha_nome,
           l.full_name as cliente_nome,
           coalesce(nullif(btrim(l.phone), ''), nullif(btrim(l.phone_raw), '')) as telefone_numero,
           l.created_at as criado
      from public.leads l
      left join public.lead_sources s on s.id = l.source_id
     where l.created_at < (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
       -- 0307: só o ano corrente.
       and l.created_at >= (date_trunc('year', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
       and l.converted_deal_id is null
       and l.status <> 'converted'
       and coalesce(nullif(btrim(l.phone), ''), nullif(btrim(l.phone_raw), '')) is not null
  ), rodadas as (
    select b.*,
           row_number() over (
             partition by lower(b.campanha_nome)
             order by random()
           ) as rodada
      from base b
  )
  select r.campanha_nome, r.cliente_nome, r.telefone_numero, r.criado
    from rodadas r
   order by r.rodada,
            random();
end;
$$;
