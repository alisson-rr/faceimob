-- =============================================================================
-- 0224 — CCA comenta em qualquer negócio que ela enxerga
--
-- Reclamação de 05/10/2026 (Thayse, CCA): "Não foi possível adicionar o
-- comentário — Negócio fora da sua visibilidade." Desde a 0141 o CCA enxerga
-- os negócios pelo ramo `has_role('cca')` das policies (`deals_select`), mas
-- `add_deal_comment` ainda checava só `can_see_deal`, que exige participação
-- na hierarquia. Ela via o negócio e o comentário era recusado.
--
-- Agora a RPC aceita exatamente quem `deals_select` deixa ver: admin/sócio,
-- CCA e a hierarquia (`auth_visible_deal_ids`, que já contém `can_see_deal`).
-- Fora disso continua recusado.
-- =============================================================================

create or replace function public.add_deal_comment(p_deal_id uuid, p_body text)
returns public.deal_history
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.deal_history;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if not (public.can_read_all()
          or public.has_role('cca')
          or public.can_see_deal(p_deal_id)
          or p_deal_id in (select public.auth_visible_deal_ids())) then
    raise exception 'Negócio fora da sua visibilidade.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Comentário vazio.' using errcode = 'P0001';
  end if;
  if length(p_body) > 4000 then
    raise exception 'Comentário longo demais (máx. 4000).' using errcode = 'P0001';
  end if;

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, auth.uid(), 'comment', btrim(p_body))
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.add_deal_comment(uuid, text) from public, anon;
grant execute on function public.add_deal_comment(uuid, text) to authenticated;

comment on function public.add_deal_comment is
  'Comentário manual no histórico do negócio. Aceita quem deals_select deixa ver (admin/sócio, CCA, hierarquia) (0224).';
