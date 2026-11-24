-- =============================================================================
-- 0360 · Exportação 3C: mailing com lead_id (pedido do Douglas, 24/11/2026)
--
-- A 3C sobe um mailing com as colunas identificador, telefone, nome e lead_id.
-- Sem o lead_id o agente de voz não acha o lead certo no CRM (telefone repetido
-- em vários leads dá "lead ambíguo") e a ligação não é registrada.
--
-- Mesma base da lista de ligação (lead que não virou negócio, com telefone),
-- num período de/até escolhido. Telefone repetido sai uma vez só, com o lead
-- mais recente daquele número: ligar duas vezes para a mesma pessoa não ajuda.
-- Telefone no formato DDD + número (sem o 55), como a 3C pede.
-- Só administrador e sócio (`is_admin()`), como a lista sem limite.
-- =============================================================================

create or replace function public.exportacao_3c(p_inicio date, p_fim date)
returns jsonb
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
    raise exception 'A exportação 3C é só do administrador.' using errcode = '42501';
  end if;
  if p_inicio is null or p_fim is null or p_fim <= p_inicio then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;
  if p_fim > p_inicio + interval '3 years' then
    raise exception 'Período longo demais (máx. 3 anos).' using errcode = '22023';
  end if;

  return (
    with base as (
      select l.id,
             btrim(coalesce(l.full_name, '')) as nome,
             regexp_replace(coalesce(nullif(btrim(l.phone), ''), l.phone_raw), '\D', '', 'g') as digitos,
             l.created_at
        from public.leads l
       where l.created_at >= (p_inicio::timestamp at time zone 'America/Sao_Paulo')
         and l.created_at <  (p_fim::timestamp at time zone 'America/Sao_Paulo')
         and l.converted_deal_id is null
         and l.status <> 'converted'
         and coalesce(nullif(btrim(l.phone), ''), nullif(btrim(l.phone_raw), '')) is not null
    ), formatada as (
      select b.id, b.nome, b.created_at,
             case when b.digitos ~ '^55\d{10,11}$' then substr(b.digitos, 3) else b.digitos end as telefone
        from base b
    ), unica as (
      select distinct on (f.telefone) f.*
        from formatada f
       where f.telefone ~ '^\d{10,11}$'
       order by f.telefone, f.created_at desc, f.id
    )
    select coalesce(jsonb_agg(jsonb_build_object('lead_id', u.id, 'nome', u.nome, 'telefone', u.telefone)
                              order by u.created_at, u.id), '[]'::jsonb)
      from unica u
  );
end;
$$;
revoke all on function public.exportacao_3c(date, date) from public, anon;
grant execute on function public.exportacao_3c(date, date) to authenticated, service_role;
comment on function public.exportacao_3c(date, date) is
  'Mailing da 3C (identificador, telefone, nome, lead_id) do período, sem telefone repetido. Só admin e sócio (0360).';
