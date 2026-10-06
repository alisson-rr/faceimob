-- =============================================================================
-- 0233 — Salvar a ficha não "altera o VGV" de negócio com VGV ou desconto vazio
--
-- Reclamação de 06/10/2026: negócio em INCOMPLETO, alterar informações e salvar
-- dava "Sem permissão para editar o VGV deste negócio". Negócio antigo/importado
-- tem `vgv_gross` ou `discount_amount` nulo; a ficha mostra 0 e devolve 0 no
-- salvar, e `0 is distinct from null` contava como edição de valor — barrando
-- quem está sem "Editar VGV" (`deals.edit_value`) em Admin · Permissões. Vazio
-- e zero passam a ser o mesmo valor para a trava; mudar o número de verdade
-- continua barrado para quem não tem a permissão.
-- =============================================================================

create or replace function public.deals_guard_value()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (coalesce(new.vgv_gross, 0) is distinct from coalesce(old.vgv_gross, 0)
      or coalesce(new.discount_amount, 0) is distinct from coalesce(old.discount_amount, 0))
     and not public.has_permission('deals.edit_value') then
    raise exception 'Sem permissão para editar o VGV deste negócio.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.deals_guard_value() from public, anon, authenticated;

comment on function public.deals_guard_value() is
  'Só quem tem deals.edit_value muda vgv_gross e discount_amount; nulo e zero são o mesmo valor (0233).';
