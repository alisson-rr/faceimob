-- -----------------------------------------------------------------------------
-- 0053 — papel EFETIVO decide quem escreve negócio e quem entra no rateio
--
-- O QUE ESTAVA ABERTO
--
-- A 0048 afirma: "Papel sem correspondência (partner, sdr, marketing) não chega
-- aqui: `deals_insert` recusa". É FALSO — conferido na homologação:
--
--   1. `handle_new_auth_user` (0002) insere 'broker' para TODO perfil novo e
--      nunca o retira: um SDR é {sdr, broker};
--   2. `deals_insert` tem WITH CHECK
--      `has_any_role(admin, director, manager, broker, cca)` — o 'broker' de
--      cadastro faz o SDR, o marketing e o sócio passarem;
--   3. `role_permissions` concede `menu.pipeline` a 'broker', então eles ainda
--      chegam à tela e ao botão "Adicionar negócio" (o `canWrite` de
--      `Pipeline.tsx` espelhava o mesmo `includes('broker')`);
--   4. o early-return do gatilho só excluía ('admin','cca') e o lookup casava
--      `role in ('director','manager','broker')` — o 'broker' de cadastro do SDR
--      era escolhido e ele entrava em `deal_participants` como CORRETOR, com
--      100% do rateio (`recalc_deal_shares` divide entre brokers) e os pontos de
--      'venda' (`deals_award_points`). `saveLegacyDeal` não salva: a limpeza
--      dela só apaga linhas de 'broker' quando o formulário trouxe um corretor.
--
-- POR QUE NÃO BASTA TIRAR O SDR DO GATILHO
--
-- Só ampliar o early-return criaria um defeito novo: sem linha em
-- `deal_participants`, `can_edit_deal()` devolve falso, e `deal_clients_insert`
-- exige exatamente `can_edit_deal(deal_id)`. O SDR gravaria o negócio e levaria
-- 42501 no cliente logo em seguida — negócio órfão, sem nome, e um toast de erro
-- no meio do fluxo. Quem some do rateio precisa sumir também da porta de
-- entrada; senão a correção troca roubo de comissão por gravação pela metade.
--
-- A CORREÇÃO: um papel efetivo só, nos dois lugares
--
-- `auth_effective_role()` devolve o papel de maior precedência do perfil, na
-- MESMA ordem de `rolePriority` (`src/integrations/supabase/newSchema.ts`) — o
-- papel concedido à mão ganha do 'broker' automático do cadastro. Com ele:
--
--   · `deals_insert` passa a exigir papel efetivo de escrita. SDR, marketing e
--     sócio ficam em somente leitura no pipeline — que é o que `role_permissions`
--     (nem `sdr` nem `marketing` têm `menu.pipeline` próprio) e o selo "Somente
--     leitura" da tela já diziam. A porta do SDR para um negócio continua sendo
--     `convert_lead_to_deal`, que é SECURITY DEFINER e não passa por esta policy.
--   · o gatilho só inscreve quem tem correspondência em `deal_participants`
--     (`deal_participants_role_check` aceita broker/manager/director). Vale como
--     defesa em profundidade: mesmo que a policy afrouxe um dia, ninguém entra
--     no rateio por um papel que o cadastro concede sozinho.
--
-- `nulls first` no `order by` é a trava para o futuro: papel novo no enum e
-- ausente do array vira o efetivo e é reprovado nas duas listas. Um papel que
-- ninguém classificou falha fechado — nunca vira corretor por omissão, que é
-- como este defeito nasceu.
--
-- Consequência deliberada (herdada da 0048): quem tem papel supervisor e TAMBÉM
-- atende precisa se escolher em "Corretor 1" no formulário, ato explícito que
-- entra no rateio como qualquer corretor. E quem for {broker, sdr} de verdade
-- perde a criação manual: o cadastro concede 'broker' a todos, então esse par é
-- indistinguível de um SDR comum. O caminho é o admin retirar o papel de SDR em
-- Permissões — decisão visível, no lugar do rateio silencioso de antes.
--
-- Idempotente: `create or replace` e `alter policy`.
-- -----------------------------------------------------------------------------

create or replace function public.auth_effective_role(p_profile uuid)
returns app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ur.role
    from public.user_roles ur
   where ur.profile_id = p_profile
   order by array_position(
     array['admin', 'director', 'manager', 'cca',
           'sdr', 'marketing', 'partner', 'broker']::app_role[],
     ur.role) nulls first
   limit 1;
$$;

comment on function public.auth_effective_role(uuid) is
  'Papel de maior precedência do perfil, na mesma ordem de rolePriority/primaryRole no front: o papel concedido à mão ganha do broker que handle_new_auth_user dá a todo cadastro. Papel novo e não classificado ordena antes de tudo (nulls first) para falhar fechado.';

-- Recebe um perfil qualquer, então não fica exposto ao anônimo por RPC.
revoke all on function public.auth_effective_role(uuid) from public, anon;
grant execute on function public.auth_effective_role(uuid) to authenticated, service_role;

-- ── Porta de entrada: quem cadastra negócio ─────────────────────────────────

alter policy deals_insert on public.deals
  with check (
    public.auth_effective_role(auth.uid())
      in ('admin', 'director', 'manager', 'broker', 'cca')
  );

-- ── Participante de quem criou ──────────────────────────────────────────────

create or replace function public.deals_add_creator_participant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_who  uuid := coalesce(new.created_by, auth.uid());
  v_role app_role;
begin
  if new.lead_id is not null then
    return null;   -- veio de convert_lead_to_deal, que cuida do participante
  end if;

  if v_who is null then
    return null;   -- criado por service_role sem contexto de usuário
  end if;

  -- `created_by` e não `auth.uid()`: o autor nem sempre é quem está na sessão
  -- (seed e importação gravam em nome de outra pessoa).
  v_role := public.auth_effective_role(v_who);

  -- Sem correspondência em `deal_participants` (admin, cca, sdr, marketing,
  -- partner, ou papel novo ainda não classificado): o autor não participa.
  -- `can_edit_deal` já aceita admin e CCA por `has_permission('cca.review')`, e
  -- os demais não chegam a criar negócio manual desde a policy acima.
  if v_role is null or v_role not in ('director', 'manager', 'broker') then
    return null;
  end if;

  insert into public.deal_participants (deal_id, profile_id, role)
  values (new.id, v_who, v_role::text)
  on conflict (deal_id, profile_id, role) do nothing;

  return null;
end;
$$;

comment on function public.deals_add_creator_participant() is
  'Dá ao autor do negócio manual uma linha em deal_participants com o papel efetivo dele (auth_effective_role). Quem não tem correspondência lá — admin, cca, sdr, marketing, partner — não participa: fixar broker punha no rateio de VGV e nos pontos de venda quem só cadastrou.';
