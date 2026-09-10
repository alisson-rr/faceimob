-- =============================================================================
-- 0058 · Rateio de VGV: duas saídas erradas do automático
--
-- O rateio é o número que define comissão e pontuação no game. Ele é calculado
-- só no banco (`recalc_deal_shares`, chamado pelo gatilho
-- `deal_participants_resplit`) e, desde a 0019/0023, nenhuma tela pode chamá-lo.
-- Por isso os dois defeitos abaixo não têm conserto possível no front.
--
-- 1. `recalc_deal_shares` saía ANTES de zerar gerente e diretor quando o
--    negócio ficava sem corretor nenhum. O `return` estava no topo, junto com a
--    guarda da divisão por zero: tirar o último corretor de um negócio deixava
--    o gestor com o `share_pct` que ele tivesse — a única linha com percentual,
--    num negócio sem corretor. Zerar gestor não depende de haver corretor:
--    "gerente e diretor acompanham o negócio mas não dividem VGV" vale sempre.
--
-- 2. `deal_participants_autofill` escolhia a equipe do corretor com `limit 1`
--    SEM `order by`. Corretor em duas equipes ativas creditava gerente e
--    diretor de forma imprevisível — e o Postgres não promete ordem estável
--    entre execuções. Passa a valer a filiação mais recente (`joined_at`, com
--    `created_at` e `id` como desempate), que é a resposta que a operação daria:
--    o corretor pertence à equipe em que entrou por último.
--
-- **Nenhum dos dois está disparado na homologação hoje** (02/09/2026: zero
-- corretores em duas equipes ativas, zero gestores com `share_pct` diferente de
-- 0). São correções de caminho, não de dado — e por isso a migration não faz
-- UPDATE em nada: só troca as duas funções.
--
-- Asserts: `supabase/tests/58_pipeline_rateio.sql`.
-- =============================================================================

create or replace function public.recalc_deal_shares(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
  v_share numeric(6,3);
  v_first uuid;
begin
  -- Gerente e diretor acompanham o negócio mas não dividem VGV. Fica ANTES do
  -- `return` da guarda: sem corretor o rateio não existe, e mesmo assim ninguém
  -- pode continuar com percentual.
  update public.deal_participants
     set share_pct = 0
   where deal_id = p_deal_id
     and role in ('manager', 'director')
     and share_pct is distinct from 0;

  select count(*) into v_count
  from public.deal_participants
  where deal_id = p_deal_id and role = 'broker';

  if v_count = 0 then
    return;
  end if;

  v_share := round(100.0 / v_count, 3);

  update public.deal_participants
     set share_pct = v_share
   where deal_id = p_deal_id and role = 'broker';

  -- Ajuste do arredondamento (ex.: 3 corretores -> 33.333 x3 = 99.999).
  select id into v_first
  from public.deal_participants
  where deal_id = p_deal_id and role = 'broker'
  order by created_at, id
  limit 1;

  update public.deal_participants
     set share_pct = share_pct + (
       100 - (select sum(share_pct) from public.deal_participants
              where deal_id = p_deal_id and role = 'broker')
     )
   where id = v_first;
end;
$$;

create or replace function public.deal_participants_autofill()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_manager  uuid;
  v_director uuid;
begin
  if new.role = 'broker' then
    -- `order by` obrigatório junto do `limit 1`: sem ele, corretor em duas
    -- equipes ativas creditava gerente e diretor de forma imprevisível.
    -- A filiação mais recente ganha; `created_at` e `id` só desempatam.
    select t.manager_id, t.director_id into v_manager, v_director
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.profile_id = new.profile_id and tm.left_at is null
    order by tm.joined_at desc nulls last, tm.created_at desc, tm.id desc
    limit 1;

    if v_manager is not null and v_manager is distinct from new.profile_id then
      insert into public.deal_participants (deal_id, profile_id, role, auto_added)
      values (new.deal_id, v_manager, 'manager', true)
      on conflict (deal_id, profile_id, role) do nothing;
    end if;

    if v_director is not null and v_director is distinct from new.profile_id then
      insert into public.deal_participants (deal_id, profile_id, role, auto_added)
      values (new.deal_id, v_director, 'director', true)
      on conflict (deal_id, profile_id, role) do nothing;
    end if;
  end if;

  return null;
end;
$$;
