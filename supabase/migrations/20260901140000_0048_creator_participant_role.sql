-- -----------------------------------------------------------------------------
-- 0048 — o papel de quem cria o negócio vem de `user_roles`, não é 'broker' fixo
--
-- A 0012 criou `deals_add_creator_participant` para que o autor de um negócio
-- manual não nascesse fora de `can_see_deal()`/`can_edit_deal()` — as duas
-- dependem de haver linha em `deal_participants`. O papel gravado, porém, era
-- sempre `'broker'`.
--
-- Consequência: gerente, diretor ou admin que clica em "Adicionar negócio" vira
-- CORRETOR do negócio. Como `deal_participants.ordinal` tem default 1 (0025), a
-- linha cai no slot "Corretor 1" e reaparece com o nome dele na tela; como
-- `recalc_deal_shares` divide 100% só entre `role = 'broker'`, o gerente sozinho
-- fica com 100% do rateio de VGV; e como `deals_award_points` premia com 'venda'
-- todo `role = 'broker'`, os pontos do game vão para quem só cadastrou.
--
-- POR QUE A ORDEM É "SUPERVISOR PRIMEIRO"
--
-- `handle_new_auth_user` (0002) dá `broker` a TODO perfil novo: o papel extra é
-- concedido depois, mas o `broker` automático nunca é retirado. Hoje, no banco,
-- `controle@faceimob.com.br` é {admin, director, manager, broker} e
-- `dev.alisson.rosa@gmail.com` é {admin, broker}. Uma ordem que preferisse
-- `broker` resolveria 'broker' para praticamente todo mundo e esta migration
-- seria um no-op: o admin voltaria a ser "Corretor 1" com 100% do VGV.
--
-- Então o papel supervisor ganha do `broker` de cadastro, e admin/CCA saem antes
-- do lookup. A consequência é deliberada: gestor que também ATENDE precisa se
-- escolher em "Corretor 1" no formulário — ato explícito, que `saveLegacyDeal`
-- grava com o `ordinal` certo e que entra no rateio como qualquer corretor.
-- Sem isso o rateio dependeria de um papel que o cadastro concede sozinho.
--
-- Admin e CCA saem sem linha: `can_edit_deal` começa em
-- `has_permission('cca.review')`, que já passa para os dois. Papel sem
-- correspondência (`partner`, `sdr`, `marketing`) não chega aqui: `deals_insert`
-- recusa. Quem só é corretor continua entrando como corretor, com os 100%.
--
-- Idempotente: `create or replace`. O gatilho da 0012 continua o mesmo e aponta
-- para esta função.
-- -----------------------------------------------------------------------------
create or replace function public.deals_add_creator_participant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_who  uuid := coalesce(new.created_by, auth.uid());
  v_role text;
begin
  if new.lead_id is not null then
    return null;   -- veio de convert_lead_to_deal, que cuida do participante
  end if;

  if v_who is null then
    return null;   -- criado por service_role sem contexto de usuário
  end if;

  -- Antes do lookup: `can_edit_deal` já aceita admin e CCA por
  -- `has_permission('cca.review')`, e é o `broker` de cadastro que os faria
  -- cair em "Corretor 1" — o defeito que esta migration existe para tirar.
  if exists (
    select 1 from public.user_roles ur
     where ur.profile_id = v_who and ur.role in ('admin', 'cca')
  ) then
    return null;
  end if;

  -- Papel é N:N. Diretor > gerente > corretor porque o `broker` do cadastro é
  -- automático e o papel supervisor é concedido à mão: entre os dois, o que
  -- carrega intenção é o supervisor. Lido de `user_roles` direto (e não por
  -- `has_role()`) porque o participante é `created_by`, que nem sempre é
  -- `auth.uid()`.
  select ur.role::text
    into v_role
    from public.user_roles ur
   where ur.profile_id = v_who
     and ur.role in ('director', 'manager', 'broker')
   order by array_position(
     array['director', 'manager', 'broker']::app_role[], ur.role)
   limit 1;

  if v_role is null then
    return null;   -- nenhum papel operacional: nada a registrar
  end if;

  insert into public.deal_participants (deal_id, profile_id, role)
  values (new.id, v_who, v_role)
  on conflict (deal_id, profile_id, role) do nothing;

  return null;
end;
$$;

comment on function public.deals_add_creator_participant() is
  'Dá ao autor do negócio manual uma linha em deal_participants com o papel real dele (user_roles), supervisor antes de corretor; admin e CCA não participam. Fixar broker punha gerente, diretor e admin no rateio de VGV e nos pontos de venda.';
