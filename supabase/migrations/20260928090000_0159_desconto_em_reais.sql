-- Desconto do negócio em R$ (pedido do cliente em 28/09/2026).
--
-- Até aqui o desconto era percentual (`discount_pct`) e o líquido saía dele.
-- O cliente digita o desconto em reais, e converter R$ → % na tela perdia
-- centavos: `discount_pct` é numeric(5,2), então R$ 1.234,56 sobre R$ 250.000
-- virava 0,49% e o líquido saía R$ 9 diferente do digitado.
--
-- O que muda:
--   · `discount_amount` (R$) passa a ser o dado digitado, e `vgv_net` sai dele:
--     `vgv_gross - discount_amount`.
--   · `discount_pct` FICA, derivado: a importação (`scripts/import`), os seeds e
--     os asserts ainda escrevem percentual. O gatilho `deals_sync_discount`
--     mantém os dois coerentes — quem escreve R$ recalcula o %, quem escreve %
--     (e não mexeu no R$) recalcula o R$.
--   · Nenhum líquido muda: o backfill grava `vgv_gross - vgv_net` ANTES de
--     trocar a fórmula, que é exatamente o desconto que o líquido de hoje já
--     aplica, sem arredondar de novo.
--   · `deals_guard_value` passa a vigiar o R$ também. Sem isso, quem não tem
--     `deals.edit_value` mudaria o líquido pelo campo novo.

alter table public.deals
  add column if not exists discount_amount numeric(14,2) not null default 0;

-- Backfill com os gatilhos de atualização e de mês fechado desligados, pelo
-- mesmo motivo da 0149: a migration não tem `auth.uid()`, e um mês fechado
-- derrubaria o comando inteiro. Nenhum outro gatilho age aqui — etapa, valor
-- bruto, percentual e desfecho não mudam.
do $$
begin
  alter table public.deals disable trigger deals_set_updated_at;
  alter table public.deals disable trigger deals_guard_closed_month;

  update public.deals
     set discount_amount = coalesce(vgv_gross, 0) - vgv_net
   where discount_pct <> 0
     and coalesce(vgv_gross, 0) - vgv_net <> 0;

  alter table public.deals enable trigger deals_set_updated_at;
  alter table public.deals enable trigger deals_guard_closed_month;
end
$$;

alter table public.deals
  add constraint deals_discount_amount_range
  check (discount_amount >= 0 and discount_amount <= coalesce(vgv_gross, 0));

-- Coluna gerada não troca de expressão no Postgres 15 (`SET EXPRESSION` é do
-- 17): sai e volta. Nenhuma view, índice ou gatilho `update of` depende dela —
-- as funções que a leem são plpgsql/sql sem `begin atomic`, resolvidas na hora.
alter table public.deals drop column vgv_net;
alter table public.deals
  add column vgv_net numeric(14,2)
  generated always as (round(coalesce(vgv_gross, 0) - discount_amount, 2)) stored;

comment on column public.deals.discount_amount is
  'Desconto em R$ — o valor digitado. vgv_net = vgv_gross - discount_amount (0159).';
comment on column public.deals.discount_pct is
  'Derivado de discount_amount (deals_sync_discount). Mantido para quem ainda escreve percentual (0159).';

create or replace function public.deals_sync_discount()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_gross numeric := coalesce(new.vgv_gross, 0);
  v_amount_changed boolean := tg_op = 'INSERT' or new.discount_amount is distinct from old.discount_amount;
  v_pct_changed boolean := tg_op = 'INSERT' or new.discount_pct is distinct from old.discount_pct;
begin
  if tg_op = 'INSERT' and new.discount_amount = 0 and new.discount_pct <> 0 then
    -- Quem ainda cria em percentual (importação, seeds).
    new.discount_amount := round(v_gross * new.discount_pct / 100, 2);
  elsif not v_amount_changed and v_pct_changed and tg_op = 'UPDATE' then
    new.discount_amount := round(v_gross * new.discount_pct / 100, 2);
  end if;

  -- O percentual acompanha o R$ (informativo). Bruto zero não tem percentual.
  new.discount_pct := case
    when v_gross > 0 then least(round(new.discount_amount / v_gross * 100, 2), 100)
    else 0
  end;
  return new;
end;
$$;

-- Função de gatilho: ninguém a chama direto (superfície anônima, 0019).
revoke all on function public.deals_sync_discount() from public, anon, authenticated;

-- `deals_aa_…` para rodar antes de `deals_guard_value` (gatilhos BEFORE da
-- mesma tabela disparam em ordem alfabética): o guarda vê o par já coerente.
drop trigger if exists deals_aa_sync_discount on public.deals;
create trigger deals_aa_sync_discount
  before insert or update of vgv_gross, discount_amount, discount_pct on public.deals
  for each row execute function public.deals_sync_discount();

create or replace function public.deals_guard_value()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.vgv_gross is distinct from old.vgv_gross
      or new.discount_amount is distinct from old.discount_amount
      or new.discount_pct is distinct from old.discount_pct)
     and not public.has_permission('deals.edit_value') then
    raise exception 'Sem permissão para editar o VGV deste negócio.' using errcode = '42501';
  end if;
  return new;
end;
$$;
