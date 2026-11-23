-- =============================================================================
-- 0355 · Status 2 na criação: o corretor escolhe (pedido de 23/11/2026)
--
-- Desde a 0352 o Status 2 é obrigatório, mas o corretor sem a permissão
-- "Alterar Status 2" só podia criar com PROPOSTA ou em branco, e a ficha
-- trancava o campo: o negócio não saía (caso do Valmir).
-- Agora, na CRIAÇÃO, INCOMPLETO (o padrão de quem só salva) passa direto e os
-- demais seguem a matriz de quem coloca cada Status 2 (`deal_status_move_block`).
-- A permissão de alterar continua valendo para toda troca depois de criado.
-- =============================================================================

create or replace function public.deals_guard_status_detail()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_block text;
begin
  if current_user in ('postgres', 'service_role') or public.is_admin() then return new; end if;
  if tg_op = 'UPDATE' and public.deal_status_bare(new.status_detail) is not distinct from public.deal_status_bare(old.status_detail) then
    return new;
  end if;
  if tg_op = 'INSERT' and (new.status_detail is null
                           or public.deal_status_bare(new.status_detail) in ('PROPOSTA', 'INCOMPLETO')) then
    return new;
  end if;
  -- 0355: na criação quem escolhe é quem cria; vale a matriz de quem coloca
  -- cada Status 2 (abaixo), não a permissão de alterar.
  if tg_op = 'UPDATE' and not public.has_permission('deals.edit_status_detail') then
    raise exception 'Seu perfil não pode alterar o Status 2.' using errcode = '42501',
      hint = 'Permissão Alterar Status 2, em Administração → Permissões → Funcionalidades.';
  end if;

  v_block := public.deal_status_move_block(case when tg_op = 'UPDATE' then old.status_detail end, new.status_detail);
  if v_block is not null then
    raise exception '%', v_block using errcode = '42501';
  end if;

  -- 0226: encerrar pelo diálogo de perda já traz a observação em `lost_reason`.
  if exists (select 1 from public.deal_statuses s
              where public.deal_status_bare(s.value) = public.deal_status_bare(new.status_detail)
                and s.requires_note)
     and not (nullif(btrim(coalesce(new.lost_reason, '')), '') is not null
              and (tg_op = 'INSERT' or new.lost_reason is distinct from old.lost_reason)) then
    raise exception 'Este Status 2 pede uma observação: mova o negócio pelo Pipeline.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.deals_guard_status_detail() from public, anon, authenticated;
