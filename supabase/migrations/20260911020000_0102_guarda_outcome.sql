-- =============================================================================
-- 0102 · `deals.outcome` volta a ser DERIVADO, e nunca escolhido pelo cliente
--
-- O FURO, medido. A trava da 0101 governa `stage_id`, `status_detail` e
-- `lost_reason` e deixou `outcome` sem guarda nenhuma. Um corretor autenticado,
-- com o próprio token, manda
--
--   PATCH /rest/v1/deals?id=eq.<uuid>
--   {"outcome":"won","closed_at":"2026-09-10T12:00:00Z"}
--
-- SEM tocar em `stage_id`. A policy `deals_update` (0012) autoriza pela LINHA e
-- não distingue coluna; `deals_guard_stage` só age quando a etapa muda; a 0101
-- só olha os dois rótulos de texto. O negócio fica parado em "Proposta" e passa
-- a valer como VENDA em `deals_award_points` (0060:305) e no VGV de
-- `src/pages/Resultados.tsx` (`dealCategory`: `outcome === 'won'` → venda).
-- O mesmo vale para o POST: `deals_guard_stage` é `before update`, então no
-- INSERT o `outcome` é literalmente o que o cliente digitou.
--
-- A 0101 argumentou que o enum `deal_outcome` é open/won/lost/cancelled e nunca
-- "OFF"/"DISTRATO". Verdade — e irrelevante: o problema não é o rótulo, é QUEM
-- decide o desfecho.
--
-- O DESENHO JÁ EXISTE, e é só terminá-lo. `deals_guard_stage`
-- (0006:422 → 0020 → 0028:129) faz `new.outcome := coalesce(v_outcome,
-- new.outcome)` a partir de `pipeline_stages.outcome` — que é `not null`
-- (0003:105) — e ajusta `closed_at` junto. Ou seja: numa troca de etapa o valor
-- mandado pelo cliente JÁ é descartado, para todo mundo, admin inclusive. Esta
-- migration só fecha os dois buracos que sobraram do mesmo desenho:
--
--   (a) INSERT — a derivação passa a valer no nascimento também. Não é
--       permissão nova: é a mesma regra que o UPDATE já aplica a todos. De
--       quebra corrige um desvio real — `saveLegacyDeal` cria negócio direto na
--       etapa `closed` quando o Status 2 é "VENDA" (`dealStageCodeFor`,
--       src/integrations/supabase/newSchema.ts) e o negócio nascia `open`.
--   (b) UPDATE SEM troca de etapa — aí não há derivação nenhuma que explique um
--       `outcome` novo, então ele é recusado para quem não é admin/sócio. O
--       administrador continua podendo corrigir à mão uma linha torta.
--
-- CAMINHOS LEGÍTIMOS CONFERIDOS UM A UM — nenhum passa `outcome` pelo token do
-- usuário, que é o erro que custou a rodada da 0100:
--   · `deals_guard_stage` — roda ANTES desta (gatilho BEFORE dispara em ordem
--     alfabética: `deals_guard_stage` < `deals_guard_status_columns`), então
--     quando a etapa muda o `new.outcome` que chega aqui É o derivado. A regra
--     (b) exige `stage_id` igual justamente para não brigar com ele.
--   · Frente inteira: `updateDeal` (src/components/pipeline/data.ts) e
--     `saveLegacyDeal` (newSchema.ts) — os seis chamadores (CcaMoveDialog,
--     LoseDealDialog, ReopenDealDialog, ScheduleVisitDialog, useDealActions ×2)
--     mandam `stage_id`, `status_detail` e `lost_reason`. `legacyDealFields` não
--     tem a chave `outcome`. Nenhum escreve `outcome`, nem `closed_at`.
--   · `close_month_and_season` (0021) e a reabertura de mês — `security
--     definer`, e nem tocam em `outcome` (movem `month_base`).
--   · `convert_lead_to_deal`, `submit_deal_for_analysis`,
--     `review_deal_documents`, `cca_cases_sync_esteira_label` — `security
--     definer`: dentro delas `current_user` é o dono, que cai no escape.
--   · Import do Bubble — `scripts/import/03-negocios.mjs` grava `outcome`
--     explícito pela API REST com `SUPABASE_SERVICE_ROLE_KEY`: `current_user` é
--     `service_role`, escape. (E ainda tira o `outcome` da etapa, linha 888.)
--   · Seeds 030/060 e os asserts de `supabase/tests` — rodam como `postgres`,
--     escape. Continuam podendo montar qualquer cenário.
--
-- O escape `current_user in ('postgres','service_role')` é o MESMO da 0100 e da
-- 0101, e por isso a função continua NÃO podendo ser `security definer`: dentro
-- dela `current_user` seria sempre o dono e o gatilho não travaria ninguém.
--
-- Idempotente: `create or replace` na mesma assinatura, sem DDL de tabela. O
-- gatilho da 0101 já é `before insert or update`, então não é recriado.
-- =============================================================================

create or replace function public.deals_guard_status_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_inicial       boolean;
  v_novo_status   boolean;
  v_novo_motivo   boolean;
  v_etapa_outcome deal_outcome;
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_novo_status := true;
    v_novo_motivo := true;
  else
    -- Valor igual não é escrita: `legacyDealFields`
    -- (src/integrations/supabase/newSchema.ts) reenvia `status_detail` e
    -- `lost_reason` em TODO salvamento do editor.
    v_novo_status := new.status_detail is distinct from old.status_detail;
    v_novo_motivo := new.lost_reason is distinct from old.lost_reason;
  end if;

  -- (1) ETAPA — a matriz `stage_permissions`, e nada além dela (0101).
  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then
    if not public.can_exit_stage(old.stage_id) then
      raise exception 'Seu papel não pode tirar um negócio desta etapa.'
        using errcode = '42501',
              hint = 'Matriz de etapas, em Admin · Permissões → Etapas.';
    end if;
    if not public.can_enter_stage(new.stage_id) then
      raise exception 'Seu papel não pode mover um negócio para esta etapa.'
        using errcode = '42501',
              hint = 'Matriz de etapas, em Admin · Permissões → Etapas.';
    end if;
  elsif tg_op = 'INSERT' then
    -- A etapa INICIAL é nascimento, não movimentação (0101).
    select coalesce(s.is_initial, false) into v_inicial
      from public.pipeline_stages s where s.id = new.stage_id;

    if not coalesce(v_inicial, false)
       and not public.can_enter_stage(new.stage_id) then
      raise exception 'Seu papel não pode criar um negócio nesta etapa.'
        using errcode = '42501',
              hint = 'Matriz de etapas, em Admin · Permissões → Etapas.';
    end if;
  end if;

  -- (2) DESFECHO ESCRITO — só OFF e DISTRATO, e só quando o valor MUDA para
  -- eles (0101). `deal_status_bare` é a mesma normalização de `bareStatus`
  -- (src/lib/dealStatus.ts); compara o INÍCIO do texto porque `lost_reason`
  -- guarda a concatenação do `LoseDealDialog` ("17. DISTRATO — cliente
  -- desistiu"), e `\M` impede "OFF" de casar dentro de "OFERTA".
  -- ponytail: sair de OFF/DISTRATO (reabrir o negócio) não é cobrado no banco —
  -- só `ReopenDealDialog` restringe, na tela; evoluir quando o cliente disser
  -- que apagar um distrato é a mesma decisão que marcá-lo.
  if ((v_novo_status and public.deal_status_bare(new.status_detail) ~ '^(OFF|DISTRATO)\M')
      or (v_novo_motivo and public.deal_status_bare(new.lost_reason) ~ '^(OFF|DISTRATO)\M'))
     and not public.has_permission('deals.mark_off_distrato') then
    raise exception
      'Só administrador e sócio marcam OFF e distrato. Os outros motivos de encerramento continuam sendo seus.'
      using errcode = '42501',
            hint = 'Permissão deals.mark_off_distrato, em Admin · Permissões.';
  end if;

  -- (3) DESFECHO ESTRUTURAL (`outcome`) — vem da ETAPA, não do cliente HTTP.
  --
  -- É `outcome` que decide venda: `deals_award_points` (0060) e `dealCategory`
  -- (src/components/dashboard/data.ts) leem ele, não o rótulo do Status 2. Sem
  -- esta seção o corretor marca a própria venda com um PATCH de uma chave só.
  if tg_op = 'INSERT' then
    -- Mesma derivação de `deals_guard_stage`, que é `before update` e por isso
    -- nunca viu um INSERT. Vale para TODOS — admin inclusive — porque no UPDATE
    -- já vale para todos: aqui não se tira poder de ninguém, se termina a regra.
    -- `pipeline_stages.outcome` é `not null`; o `coalesce` cobre só o caso de
    -- `stage_id` que não resolve linha nenhuma.
    select s.outcome into v_etapa_outcome
      from public.pipeline_stages s where s.id = new.stage_id;
    new.outcome := coalesce(v_etapa_outcome, new.outcome);

    -- `deals_closed_consistency` (0006) exige `closed_at` sempre que o desfecho
    -- não é 'open'. Sem ajustar aqui, derivar 'won'/'lost' no INSERT viraria
    -- 23514 em quem hoje cria negócio sem mandar data nenhuma.
    if new.outcome <> 'open' and new.closed_at is null then
      new.closed_at := now();
    elsif new.outcome = 'open' then
      new.closed_at := null;
    end if;

  elsif new.outcome is distinct from old.outcome
        and new.stage_id is not distinct from old.stage_id
        and not public.is_admin() then
    -- Etapa parada e desfecho novo: não existe derivação que explique isso.
    -- `is_admin()` desde a 0097 é admin OU sócio — o administrador continua
    -- podendo endireitar à mão uma linha torta (import antigo, correção
    -- pontual). Quando a etapa MUDA, este ramo nem é avaliado: quem escreveu o
    -- `new.outcome` foi `deals_guard_stage`, e o valor do cliente já morreu lá.
    raise exception
      'O desfecho do negócio vem da etapa. Mova o negócio para a etapa certa em vez de gravar o desfecho.'
      using errcode = '42501',
            hint = 'Etapa "Fechado" fecha a venda; "Perdido" encerra. Correção manual de desfecho é de administrador.';
  end if;

  return new;
end;
$$;

revoke all on function public.deals_guard_status_columns() from public, anon, authenticated;

comment on function public.deals_guard_status_columns() is
  'Etapa pela matriz stage_permissions (can_enter/can_exit) no INSERT e no UPDATE; OFF e DISTRATO só com deals.mark_off_distrato; e outcome DERIVADO da etapa — no INSERT para todos (0102, completando deals_guard_stage, que é before update) e, no UPDATE sem troca de etapa, recusado a quem não é admin/sócio. O resto do Status 2 é livre. postgres e service_role passam; valor igual não conta como escrita.';
