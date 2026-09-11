-- =============================================================================
-- 0110 · O negócio NASCE dentro da conferência documental, e `closed_at` deixa
--        de ser campo livre no UPDATE
--
-- O FURO QUE A RODADA ANTERIOR ABRIU, medido. A 0102 fez o INSERT derivar
-- `outcome` da etapa — regra certa, e é o mesmo que o UPDATE sempre fez. O
-- efeito colateral que ela não declarou: um negócio criado DIRETO na etapa
-- "Fechado" passou a nascer `outcome = 'won'` com `closed_at` preenchido SEM
-- ter passado pela conferência documental. Antes ele ao menos nascia `open` e
-- só virava venda ao ser MOVIDO para lá — e aí `deals_guard_stage` cobrava a
-- aprovação do gerente.
--
-- POR QUE A COBRANÇA NUNCA CHEGOU NO INSERT. As exigências documentais vivem em
-- `deals_guard_stage` (0006:435 → 0020 → 0028:82), que é `before UPDATE`:
--   · etapa em ('under_analysis','approved','contract','closed') exige
--     `document_review_status = 'approved'`;
--   · etapa com `requires_document` exige ao menos um documento vigente.
-- Gatilho de UPDATE não vê INSERT. `POST /rest/v1/deals {"stage_id":<fechado>}`
-- pulava as duas — e, desde a 0102, saía de lá como venda fechada.
--
-- O QUE ESTA MIGRATION FAZ:
--   (1) A dupla exigência sai de dentro de `deals_guard_stage` e vira
--       `deal_stage_document_block()`, que devolve o MOTIVO ou nulo. Uma regra,
--       um texto, dois chamadores: o gatilho de UPDATE e o de INSERT. Sem isso
--       seriam duas cópias da mesma condição, que é como a matriz de etapas
--       ficou com duas respostas na 0100.
--   (2) `deals_guard_status_columns` (0101/0102, já `before insert or update`)
--       passa a chamar a mesma função no INSERT. Nascer em "Em análise",
--       "Aprovado", "Contrato" ou "Fechado" cobra o que mover para lá cobra.
--   (3) `deals_guard_document_review` (0028) passa a valer no INSERT também:
--       sem isso a regra (2) seria teatro — bastava mandar
--       `{"document_review_status":"approved"}` no mesmo POST, porque a trava
--       da conferência também era só `before update`.
--   (4) `deals.closed_at` ganha, no UPDATE, o MESMO critério que a 0102 deu a
--       `outcome`: etapa parada + valor novo + quem não é admin → recusa. Sem
--       isso, quem edita o negócio muda a data de fechamento por PATCH direto e
--       desloca o negócio na janela da temporada (0060:202 e 0060:542 leem
--       `closed_at::date` entre `period_start` e `period_end`). Não cria venda
--       falsa — `outcome` já é derivado —, mas torce o ranking.
--
-- CONSEQUÊNCIA DECLARADA, que a 0102 não tinha: **ninguém mais cria um negócio
-- já em "Fechado" pela API do usuário — nem o administrador.** É proposital, e é
-- a mesma régua que já valia para o MOVER: as checagens documentais de
-- `deals_guard_stage` nunca tiveram exceção para admin. Registrar uma venda
-- passa pelo funil: cria em etapa aberta, envia para a conferência, o gerente
-- aprova, aí a etapa "Fechado" aceita. `src/integrations/supabase/newSchema.ts`
-- (`saveLegacyDeal`) avisa isso ANTES de gravar, em vez de deixar o 42501/P0001
-- estourar no fim de um formulário de ~40 campos.
--
-- O ESCAPE É O MESMO DA 0100/0101/0102 e continua intocado:
-- `current_user in ('postgres','service_role')`. Ele cobre o import do Bubble
-- (0096 e `scripts/import/03-negocios.mjs`, que grava pela REST com a chave de
-- serviço), os seeds `010`–`060`, os asserts de `supabase/tests` e TODA função
-- `security definer` — `convert_lead_to_deal` (que cria na etapa inicial),
-- `submit_deal_for_analysis`, `review_deal_documents`,
-- `cca_cases_sync_esteira_label`, `close_month_and_season`. Por isso estas
-- funções continuam NÃO podendo ser `security definer`: dentro delas
-- `current_user` seria sempre o dono e o gatilho não travaria ninguém.
--
-- CRIAÇÃO NORMAL DE NEGÓCIO CONFERIDA: a etapa inicial é `incomplete`
-- (`supabase/seed.sql`), com `requires_document = false` e fora da lista de
-- etapas que exigem conferência — `deal_stage_document_block` devolve nulo e o
-- corretor continua criando negócio como sempre. É o que os asserts 03, 22 e a
-- seção 3 do 98 cobram.
--
-- ponytail: no INSERT, `closed_at` continua sendo aceito como veio (0102) em vez
-- de ser sempre `now()`. Depois de (2) a única etapa de desfecho em que um
-- negócio ainda pode nascer pela mão do usuário é "Perdido", e o ranking só
-- soma `outcome = 'won'` — então é data torta sem efeito no placar. Evoluir
-- quando algum relatório passar a somar negócio perdido por janela de data.
--
-- Idempotente: só `create or replace` e `drop trigger if exists`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A exigência documental, escrita uma vez só
-- -----------------------------------------------------------------------------
-- Devolve o MOTIVO da recusa, ou nulo quando a etapa aceita o negócio. Devolver
-- texto em vez de levantar exceção deixa cada gatilho escolher o `errcode` e o
-- contexto ("antes do avanço" no UPDATE, "ao criar" no INSERT) sem duplicar a
-- condição.
--
-- **Sem `security definer`, de propósito.** Ela é chamada dos dois lados e
-- herda o contexto de quem chama: de `deals_guard_stage` (que É `security
-- definer`) enxerga `deal_documents` inteiro, como sempre enxergou; de
-- `deals_guard_status_columns` (que não é, e não pode ser, por causa do escape)
-- roda como o usuário. No INSERT isso não muda resposta nenhuma — o negócio
-- ainda não existe, então não há documento vigente para contar — e, se a RLS
-- escondesse alguma linha, a contagem só ficaria MENOR: a falha é fechada.
create or replace function public.deal_stage_document_block(
  p_deal_id       uuid,
  p_stage_id      uuid,
  p_review_status text
)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    -- Mesma lista da 0028: a faixa que começa no CCA.
    when s.code in ('under_analysis', 'approved', 'contract', 'closed')
         and coalesce(p_review_status, 'draft') <> 'approved'
      then 'A documentação precisa ser aprovada pelo gerente antes de entrar no CCA.'
    when coalesce(s.requires_document, false)
         and not exists (
           select 1
             from public.deal_documents d
            where d.deal_id = p_deal_id
              and d.superseded_at is null
         )
      then 'O estágio exige ao menos um documento anexado antes do avanço.'
  end
  from public.pipeline_stages s
  where s.id = p_stage_id;
$$;

-- `authenticated` MANTÉM o EXECUTE, ao contrário dos gatilhos:
-- `deals_guard_status_columns` roda como o usuário (não é `security definer`,
-- por causa do escape) e chamada de função dentro de plpgsql confere EXECUTE.
-- Tirar o privilégio de `authenticated` aqui quebraria todo INSERT de negócio.
-- Ela não expõe nada que a tela já não mostre: devolve um texto fixo a partir
-- de dois ids.
--
-- `anon` sai: o grant default do Supabase o incluiria, e a superfície anônima
-- são exatamente as RPCs do Diário (0019, cobrado por tests/06_anon_surface).
revoke execute on function public.deal_stage_document_block(uuid, uuid, text) from public, anon;
grant execute on function public.deal_stage_document_block(uuid, uuid, text) to authenticated, service_role;
comment on function public.deal_stage_document_block(uuid, uuid, text) is
  'Motivo pelo qual a etapa recusa o negócio (conferência não aprovada ou sem documento vigente), ou nulo. Fonte única das duas exigências: deals_guard_stage a chama no UPDATE e deals_guard_status_columns no INSERT (0110).';

-- -----------------------------------------------------------------------------
-- 2. `deals_guard_stage` passa a ler a regra em vez de guardá-la
-- -----------------------------------------------------------------------------
-- Mesma assinatura e mesmo comportamento da 0028 — inclusive as mensagens, que
-- os asserts 12/59/77 leem. Só as duas checagens saíram para a função acima.
create or replace function public.deals_guard_stage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_block   text;
  v_outcome deal_outcome;
begin
  if new.stage_id is distinct from old.stage_id then
    if auth.uid() is not null then
      if not public.can_exit_stage(old.stage_id) then
        raise exception 'Seu papel não pode tirar um negócio deste estágio.'
          using errcode = '42501';
      end if;
      if not public.can_enter_stage(new.stage_id) then
        raise exception 'Seu papel não pode mover um negócio para este estágio.'
          using errcode = '42501';
      end if;
    end if;

    v_block := public.deal_stage_document_block(
      new.id, new.stage_id, new.document_review_status);
    if v_block is not null then
      raise exception '%', v_block using errcode = 'P0001';
    end if;

    select s.outcome into v_outcome
      from public.pipeline_stages s where s.id = new.stage_id;

    new.stage_entered_at := now();
    new.outcome := coalesce(v_outcome, new.outcome);

    if new.outcome <> 'open' and new.closed_at is null then
      new.closed_at := now();
    elsif new.outcome = 'open' then
      new.closed_at := null;
    end if;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. A conferência documental também não NASCE aprovada
-- -----------------------------------------------------------------------------
-- Sem esta seção a regra da seção 4 seria contornável em uma chave: o mesmo
-- POST que escolhe `stage_id` escolheria `document_review_status = 'approved'`,
-- porque a trava da 0028 é `before update` e nunca viu um INSERT. Os campos de
-- decisão continuam sendo escritos só pelas RPCs do fluxo
-- (`submit_deal_for_analysis`, `review_deal_documents`), que são `security
-- definer` e caem no escape.
create or replace function public.deals_guard_document_review()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- O escape sobe para o topo (na 0028 ele era a última condição do `if`):
  -- mesmo efeito no UPDATE e é o que deixa seed, import e RPC criarem negócio
  -- com a conferência já resolvida.
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.document_review_status, 'draft') <> 'draft'
       or new.document_review_requested_at is not null
       or new.document_review_requested_by is not null
       or new.document_reviewed_at is not null
       or new.document_reviewed_by is not null
       or new.document_review_reason is not null then
      raise exception 'A conferência documental só pode ser alterada pelas ações próprias do fluxo.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if (
    new.document_review_status is distinct from old.document_review_status
    or new.document_review_requested_at is distinct from old.document_review_requested_at
    or new.document_review_requested_by is distinct from old.document_review_requested_by
    or new.document_reviewed_at is distinct from old.document_reviewed_at
    or new.document_reviewed_by is distinct from old.document_reviewed_by
    or new.document_review_reason is distinct from old.document_review_reason
  ) then
    raise exception 'A conferência documental só pode ser alterada pelas ações próprias do fluxo.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Recriado porque a 0028 o declarou `before update` e agora ele precisa do
-- INSERT. O NOME continua o mesmo e importa: gatilho BEFORE dispara em ordem
-- alfabética, e `deals_guard_document_review` vem ANTES de `deals_guard_stage` e
-- de `deals_guard_status_columns` — quem mentir a conferência no POST ouve isso
-- primeiro, e não "a documentação precisa ser aprovada".
drop trigger if exists deals_guard_document_review on public.deals;
create trigger deals_guard_document_review
  before insert or update on public.deals
  for each row execute function public.deals_guard_document_review();

revoke all on function public.deals_guard_document_review() from public, anon, authenticated;

comment on function public.deals_guard_document_review() is
  'Os campos da conferência documental só mudam pelas RPCs do fluxo — no UPDATE (0028) e, desde a 0110, no INSERT: negócio não nasce com a conferência aprovada. postgres e service_role passam.';

-- -----------------------------------------------------------------------------
-- 4. O INSERT cobra a conferência, e `closed_at` ganha a guarda que faltou
-- -----------------------------------------------------------------------------
-- Mesma função da 0101/0102 (`create or replace`, mesma assinatura, mesmo
-- gatilho `before insert or update`): migration aplicada não se reescreve, e as
-- regras 1 a 3 abaixo continuam sendo as de lá, palavra por palavra.
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
  v_block         text;
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

    -- (1.b) CONFERÊNCIA DOCUMENTAL no nascimento — 0110.
    --
    -- A MESMA função que `deals_guard_stage` chama ao mover o negócio, e por
    -- isso a mesma frase. Vale para TODOS, admin e sócio inclusive, porque no
    -- UPDATE já vale para todos: as checagens documentais da 0028 nunca tiveram
    -- exceção de papel. A etapa inicial não é exceção aqui e não precisa ser —
    -- `incomplete` não exige documento nem conferência, então a função devolve
    -- nulo e a criação normal de negócio passa.
    v_block := public.deal_stage_document_block(
      new.id, new.stage_id, new.document_review_status);
    if v_block is not null then
      raise exception '%', v_block using errcode = 'P0001',
        hint = 'Crie o negócio em uma etapa aberta e envie a documentação para a conferência do gerente.';
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

  -- (3) DESFECHO ESTRUTURAL (`outcome`) e a DATA DE FECHAMENTO (`closed_at`) —
  -- vêm da ETAPA, não do cliente HTTP.
  if tg_op = 'INSERT' then
    -- Mesma derivação de `deals_guard_stage`, que é `before update` e por isso
    -- nunca viu um INSERT (0102).
    select s.outcome into v_etapa_outcome
      from public.pipeline_stages s where s.id = new.stage_id;
    new.outcome := coalesce(v_etapa_outcome, new.outcome);

    -- `deals_closed_consistency` (0006) exige `closed_at` sempre que o desfecho
    -- não é 'open'.
    if new.outcome <> 'open' and new.closed_at is null then
      new.closed_at := now();
    elsif new.outcome = 'open' then
      new.closed_at := null;
    end if;

  elsif (new.outcome is distinct from old.outcome
         or new.closed_at is distinct from old.closed_at)
        and new.stage_id is not distinct from old.stage_id
        and not public.is_admin() then
    -- Etapa parada e desfecho (ou data de fechamento) novo: não existe
    -- derivação que explique isso. `closed_at` entra aqui na 0110 pelo mesmo
    -- critério — quem o escreve é `deals_guard_stage`, junto com o `outcome`, e
    -- deslocá-lo à mão move o negócio de temporada no ranking (0060). Nenhum
    -- caminho da tela grava a coluna: `legacyDealFields` não tem a chave e os
    -- seis chamadores de `updateDeal` mandam etapa, Status 2 e motivo.
    -- `is_admin()` desde a 0097 é admin OU sócio — o administrador continua
    -- podendo endireitar à mão uma linha torta (import antigo, correção
    -- pontual). Quando a etapa MUDA, este ramo nem é avaliado: quem escreveu os
    -- dois valores foi `deals_guard_stage`.
    raise exception
      'O desfecho e a data de fechamento do negócio vêm da etapa. Mova o negócio para a etapa certa em vez de gravá-los.'
      using errcode = '42501',
            hint = 'Etapa "Fechado" fecha a venda; "Perdido" encerra. Correção manual é de administrador.';
  end if;

  return new;
end;
$$;

revoke all on function public.deals_guard_status_columns() from public, anon, authenticated;

comment on function public.deals_guard_status_columns() is
  'Etapa pela matriz stage_permissions no INSERT e no UPDATE; conferência documental exigida também no INSERT (0110, via deal_stage_document_block); OFF e DISTRATO só com deals.mark_off_distrato; outcome e closed_at derivados da etapa — no INSERT para todos e, no UPDATE sem troca de etapa, recusados a quem não é admin/sócio. O resto do Status 2 é livre. postgres e service_role passam; valor igual não conta como escrita.';
