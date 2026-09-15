-- =============================================================================
-- 0151 · Configuração da CCA só para admin e sócio; contador de envios por ids
--
-- Pedido do dono de 15/09/2026:
--   1. "Gerenciar estágios" (`cca_stages`) e "Tipos de documento"
--      (`document_types`) são configuração: escrevem só admin e sócio
--      (`is_admin()`, que responde sim para `partner` desde a 0097). Desde a
--      0059 as duas policies aceitavam `has_permission('cca.review')`, e o papel
--      `cca` criava, renomeava e apagava coluna e mexia no catálogo. A esteira
--      do dia a dia (mover, enviar, decidir) continua em `cca.review`.
--      Conferido na homologação em 15/09: nenhuma função do banco escreve nessas
--      duas tabelas e as edge functions não as tocam; os únicos caminhos de
--      escrita são os dois diálogos da tela da CCA. Só o papel `cca` tem
--      `cca.review` em `role_permissions`: é ele quem perde a escrita.
--   2. A tela da CCA carrega só o período filtrado e pede o contador só dos
--      negócios na tela: `cca_send_counts(p_deal_ids)` devolve só esses ids;
--      sem argumento, todos os casos, como na 0150. Uma função com default e não
--      duas sobrecargas: com as duas, a chamada sem argumento fica ambígua no
--      PostgREST.
--
-- Índice: nenhum. `deals` já tem `deals_created_at_id_idx` (index scan no
-- intervalo); em `cca_cases` os 30 dias por `submitted_at` são seq scan de 383
-- páginas em ~2 ms, ~10 ms com a RLS do CCA (7.560 casos, medido em 15/09).
-- =============================================================================

drop policy if exists cca_stages_write on public.cca_stages;
create policy cca_stages_write on public.cca_stages
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists document_types_write on public.document_types;
create policy document_types_write on public.document_types
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Contador de envios por CPF do titular, opcionalmente só de alguns negócios
-- -----------------------------------------------------------------------------
drop function if exists public.cca_send_counts();

-- Mesma contagem da 0150. A saída parte dos casos pedidos, e o histórico só é
-- lido para os negócios com o mesmo CPF deles, pelo `deal_history_deal_idx`:
-- filtrar só no fim ainda varria todo o `deal_history` (587 ms contra 134 ms
-- para os 188 casos de 30 dias na homologação, 15/09).
create function public.cca_send_counts(p_deal_ids uuid[] default null)
returns table(deal_id uuid, agil int, virar int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('cca.review') then
    raise exception 'Seu perfil não vê os envios da esteira do CCA.' using errcode = '42501';
  end if;

  return query
  with titular as (
    select d.id as negocio,
           coalesce(nullif(regexp_replace(coalesce(dc.cpf, ''), '\D', '', 'g'), ''), d.id::text) as chave
      from public.deals d
      left join public.deal_clients dc on dc.deal_id = d.id and dc.ordinal = 1
  ),
  alvo as (
    select c.deal_id as negocio, t.chave
      from public.cca_cases c
      join titular t on t.negocio = c.deal_id
     where p_deal_ids is null or c.deal_id = any (p_deal_ids)
  ),
  por_chave as (
    select t.chave,
           count(*) filter (where h.detail ->> 'esteira' = 'agil')::int  as n_agil,
           count(*) filter (where h.detail ->> 'esteira' = 'virar')::int as n_virar
      from titular t
      join public.deal_history h on h.deal_id = t.negocio and h.kind = 'esteira_sent'
     where t.chave in (select a.chave from alvo a)
     group by t.chave
  )
  select a.negocio, coalesce(pc.n_agil, 0), coalesce(pc.n_virar, 0)
    from alvo a
    left join por_chave pc on pc.chave = a.chave;
end;
$$;

comment on function public.cca_send_counts(uuid[]) is
  'Para cada negócio com caso na CCA (só os de p_deal_ids, quando vier), quantos envios ao gerente (agil e virar) têm todos os negócios do mesmo CPF de titular; sem CPF, só o próprio negócio. Exige cca.review (0150, 0151).';

revoke all on function public.cca_send_counts(uuid[]) from public, anon;
grant execute on function public.cca_send_counts(uuid[]) to authenticated, service_role;
