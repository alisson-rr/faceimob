-- =============================================================================
-- 0368 · OFF a partir de "Internalizado" para corretor, gerente e diretor
--
-- Pedido do Douglas (27/11/2026): um diretor não conseguia dar OFF num negócio
-- Internalizado — a matriz de Status 2 só deixa a CCA tirar o negócio de
-- Internalizado. Exceção estreita, como as da 0243/0356: só o OFF (com motivo,
-- pelo `marcar_off`), só para corretor, gerente e diretor. O resto da função é
-- igual à 0356.
-- =============================================================================

create or replace function public.deal_status_move_block(p_from text, p_to text)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_from public.deal_statuses;
  v_to public.deal_statuses;
begin
  if public.is_admin() then return null; end if;
  if public.deal_status_bare(p_from) = 'REPROVADO' and public.deal_status_bare(p_to) = 'OFF' then return null; end if;
  if public.deal_status_bare(p_from) = 'ANÁLISE EXTERNA'
     and public.deal_status_bare(p_to) in ('APROV. TOTAL', 'APROV. COND.')
     and public.has_any_role('manager', 'director') then return null; end if;
  if public.deal_status_bare(p_from) = 'VIROU NEGÓCIO COM PENDÊNCIAS'
     and public.deal_status_bare(p_to) = 'EM CONTRATO'
     and public.has_any_role('broker', 'manager', 'director', 'cca') then return null; end if;
  -- 0368: OFF saindo de Internalizado, para corretor, gerente e diretor. O
  -- motivo é obrigatório no caminho do OFF (`marcar_off`); os outros movimentos
  -- saindo de Internalizado continuam só com a CCA, pela matriz.
  if public.status2_chave(p_from) = 'INTERNALIZADO'
     and public.deal_status_bare(p_to) = 'OFF'
     and public.has_any_role('broker', 'manager', 'director') then return null; end if;
  -- 0356: a CCA leva o aprovado para a análise de virar negócio pelo Pipeline.
  if public.status2_chave(p_from) in ('APROV. TOTAL', 'APROV. TOT. RESTRICAO', 'APROV. COND.', 'APROV. COND. RESTRICAO')
     and public.status2_chave(p_to) = 'ANALISE P/ VIRAR NEGOCIO'
     and public.has_role('cca') then return null; end if;

  select * into v_to from public.deal_statuses
   where public.deal_status_bare(value) = public.deal_status_bare(p_to)
   order by active desc limit 1;
  if not found then return 'Este Status 2 não está no cadastro.'; end if;
  select * into v_from from public.deal_statuses
   where public.deal_status_bare(value) = public.deal_status_bare(p_from)
   order by active desc limit 1;
  if v_from.id is not null and v_from.id <> v_to.id and not exists (
    select 1 from public.deal_status_permissions p where p.status_id = v_from.id
      and p.can_exit and public.has_any_role(p.role)
  ) then return format('Seu perfil não tira o negócio de "%s".', v_from.label); end if;
  if not exists (
    select 1 from public.deal_status_permissions p where p.status_id = v_to.id
      and p.can_enter and public.has_any_role(p.role)
  ) then return format('Seu perfil não coloca o negócio em "%s".', v_to.label); end if;
  return null;
end;
$$;

revoke all on function public.deal_status_move_block(text, text) from public, anon;
grant execute on function public.deal_status_move_block(text, text) to authenticated, service_role;
