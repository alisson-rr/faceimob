-- =============================================================================
-- 0111 · O administrador volta a cadastrar negócio já EM ANÁLISE — e o negócio
--         continua sem poder NASCER VENDIDO
--
-- A REGRESSÃO, medida. A 0110 §4 passou a chamar `deal_stage_document_block` no
-- INSERT (linhas 313-318) para a faixa de etapas de ~:102. O efeito que ela
-- declarou era um: ninguém cria negócio já em "Fechado". O efeito que ela teve
-- foi outro, mais largo: criar negócio em "Em Análise", "Aprovado" ou
-- "Contrato" passou a ser recusado para TODO MUNDO, administrador e sócio
-- inclusive. O caso real que quebrou é de cadastro, não de venda — migrar um
-- negócio que veio de fora e corrigir um cadastro torto.
--
-- POR QUE AS DUAS CHECAGENS NÃO PODEM SER TRATADAS IGUAL NO NASCIMENTO. A
-- função herdou de `deals_guard_stage` (0028:109-126) duas exigências
-- diferentes, e no INSERT nenhuma das duas é um portão: as duas são um veto.
--   · `requires_document` conta `deal_documents` de um negócio que AINDA NÃO
--     EXISTE — a contagem é zero por construção, não por falta de documento.
--     Pior: `requires_document` é dado configurável (o administrador liga o
--     flag em qualquer etapa). Ligá-lo em "Proposta" proibiria, para sempre e
--     para todos, criar negócio em "Proposta", sem nenhum caminho que
--     satisfizesse a exigência. A própria frase da regra diz o que ela guarda:
--     "antes do AVANÇO". Documento se anexa a negócio que já existe.
--   · A CONFERÊNCIA (`document_review_status = 'approved'`) é fronteira de
--     verdade: guarda a entrada na faixa do CCA. No INSERT ela também é
--     inatingível — `deals_guard_document_review` (0110 §3) obriga o campo a
--     nascer 'draft' —, mas aí a recusa é INTENCIONAL: quem entra no CCA passou
--     pelo gerente.
--
-- A FRONTEIRA ESCOLHIDA, que não é nem (a) nem (b) inteiras:
--   1. `requires_document` SAI do nascimento, para todos. `p_deal_id` nulo
--      passa a significar "negócio ainda não existe" dentro de
--      `deal_stage_document_block`, e a segunda exigência não se aplica. No
--      UPDATE nada muda: o chamador de lá continua passando `new.id`.
--   2. A CONFERÊNCIA CONTINUA valendo no nascimento para quem não é
--      administrador nem sócio. Gerente, diretor e CCA têm a casa de
--      "Em Análise" na matriz (0101:273-278) e continuam recusados: criar o
--      negócio já lá seria exatamente o desvio da conferência.
--   3. O ADMINISTRADOR (e o sócio, por `is_admin()` desde a 0097) ganha a
--      exceção. É a MESMA exceção que a própria 0110 §4 já dava para endireitar
--      `outcome` e `closed_at` à mão: correção manual é de administrador.
--   4. O BURACO ORIGINAL — "nascer vendido" — passa a ser dito pelo DESFECHO da
--      etapa, e não pela lista de códigos: etapa com `outcome = 'won'` sem a
--      conferência aprovada recusa o INSERT, SEM exceção de papel. Isso é mais
--      apertado que a 0110, que falava em quatro códigos fixos: uma etapa nova
--      com `outcome = 'won'` e código fora da lista (ou com
--      `requires_document = false`) passava pelas duas checagens dela e nascia
--      `won`. Agora não passa.
--
-- QUEM MUDA DE COMPORTAMENTO, exatamente: só administrador e sócio, e só nas
-- etapas de desfecho 'open' da faixa do CCA. Corretor, gerente, diretor e CCA
-- veem o mesmo de antes. "Fechado" continua fechado para todos. O escape
-- `current_user in ('postgres','service_role')` (import do Bubble, seeds, RPCs
-- `security definer`) segue intocado, no mesmo lugar.
--
-- FALHA FECHADA NO LUGAR DE PRIVILÉGIO. `deals_guard_status_columns` lê
-- `pipeline_stages` como o usuário — ela não pode ser `security definer`, senão
-- `current_user` seria sempre o dono e o escape liberaria todo mundo. Se a
-- política `pipeline_stages_select` (0003:231, hoje `using (true)`) algum dia
-- deixar de liberar geral, a linha da etapa sumiria da consulta e o desfecho
-- viria nulo — a trava passaria a deixar passar. Por isso a etapa não
-- encontrada agora RECUSA em vez de seguir.
--
-- ponytail: `deal_stage_document_block` continua SEM `security definer`. Marcar
-- só ela seria falsa sensação de segurança — os dois `select` em
-- `pipeline_stages` que decidem etapa inicial e desfecho moram em
-- `deals_guard_status_columns`, que não pode ser `security definer`, e a
-- exposição é a mesma nos três pontos. Evoluir quando `pipeline_stages_select`
-- deixar de ser `using (true)`: aí os três leem a etapa por uma função leitora
-- única, de uma vez.
--
-- Idempotente: só `create or replace`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A exigência de documento não vale no nascimento
-- -----------------------------------------------------------------------------
-- Mesma assinatura, mesmas mensagens (os asserts de `tests/12_document_review`
-- leem o texto) e mesmo comportamento no UPDATE. A única diferença: `p_deal_id`
-- nulo é o nascimento, e negócio que não existe não tem onde pendurar anexo.
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
    -- `p_deal_id is not null` = negócio já existe (chamada do UPDATE). No
    -- INSERT a contagem seria zero por construção, e recusaria toda criação em
    -- etapa com o flag ligado — inclusive numa etapa que o administrador
    -- marcasse amanhã em Admin · Permissões.
    when p_deal_id is not null
         and coalesce(s.requires_document, false)
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

comment on function public.deal_stage_document_block(uuid, uuid, text) is
  'Motivo pelo qual a etapa recusa o negócio, ou nulo. Fonte única das duas exigências: deals_guard_stage a chama no UPDATE com o id do negócio e deals_guard_status_columns no INSERT com nulo — no nascimento só a conferência é cobrada, porque documento se anexa a negócio que já existe (0111).';

-- -----------------------------------------------------------------------------
-- 2. O INSERT: conferência para quem não é administrador, desfecho para todos
-- -----------------------------------------------------------------------------
-- Mesma função da 0101/0102/0110 (`create or replace`, mesma assinatura, mesmo
-- gatilho `before insert or update`): migration aplicada não se reescreve. As
-- regras (1), (2) e (3) abaixo continuam sendo as de lá, palavra por palavra —
-- só o bloco documental do INSERT muda.
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
    -- A etapa INICIAL é nascimento, não movimentação (0101). O desfecho da
    -- etapa vem no MESMO select — é a mesma linha que a regra (3) usa.
    select coalesce(s.is_initial, false), s.outcome
      into v_inicial, v_etapa_outcome
      from public.pipeline_stages s where s.id = new.stage_id;

    -- `outcome` é NOT NULL na tabela e a FK garante a linha: nulo aqui só se a
    -- etapa não estiver VISÍVEL para quem insere. Recusar é a falha fechada —
    -- sem isto, uma política mais apertada em `pipeline_stages` desligaria a
    -- trava de desfecho em silêncio (0111).
    if v_etapa_outcome is null then
      raise exception 'Etapa do negócio não encontrada.'
        using errcode = 'P0001';
    end if;

    if not coalesce(v_inicial, false)
       and not public.can_enter_stage(new.stage_id) then
      raise exception 'Seu papel não pode criar um negócio nesta etapa.'
        using errcode = '42501',
              hint = 'Matriz de etapas, em Admin · Permissões → Etapas.';
    end if;

    -- (1.b) NASCER VENDIDO — o buraco que a 0110 fechou e que continua fechado,
    -- agora dito pelo DESFECHO da etapa e não por uma lista de códigos: é
    -- `outcome = 'won'` que vira venda no placar (0060) e no VGV. SEM exceção
    -- de papel — administrador e sócio inclusive —, e na prática sem saída pela
    -- API do usuário, porque `deals_guard_document_review` (0110 §3) obriga a
    -- conferência a nascer 'draft'. Registrar venda passa pelo funil.
    if v_etapa_outcome = 'won'
       and coalesce(new.document_review_status, 'draft') <> 'approved' then
      raise exception
        'Um negócio não nasce vendido: a documentação precisa ser aprovada pelo gerente antes do fechamento.'
        using errcode = 'P0001',
              hint = 'Crie o negócio em uma etapa aberta, envie a documentação para a conferência e mova para "Fechado" depois da aprovação.';
    end if;

    -- (1.c) A FAIXA DO CCA continua cobrando a conferência de quem não é
    -- administrador — gerente, diretor e CCA têm a casa de "Em Análise" na
    -- matriz e criar o negócio já lá seria o desvio da conferência. O
    -- administrador e o sócio passam: migrar negócio que veio de fora e
    -- corrigir cadastro é a mesma correção manual que a 0110 já lhes deu em
    -- `outcome` e `closed_at`. `null::uuid` = nascimento (§1 desta migration):
    -- só a conferência é cobrada, nunca `requires_document`.
    if not public.is_admin() then
      v_block := public.deal_stage_document_block(
        null::uuid, new.stage_id, new.document_review_status);
      if v_block is not null then
        raise exception '%', v_block using errcode = 'P0001',
          hint = 'Crie o negócio em uma etapa aberta e envie a documentação para a conferência do gerente.';
      end if;
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
    -- nunca viu um INSERT (0102). `v_etapa_outcome` já veio do select da regra
    -- (1): é a mesma linha, e lê-la duas vezes só dava duas chances de divergir.
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
  'Etapa pela matriz stage_permissions no INSERT e no UPDATE; no INSERT nenhuma etapa de outcome=won aceita negócio sem a conferência aprovada (nem de admin) e a faixa do CCA cobra a conferência de quem não é admin/sócio (0111); OFF e DISTRATO só com deals.mark_off_distrato; outcome e closed_at derivados da etapa — no INSERT para todos e, no UPDATE sem troca de etapa, recusados a quem não é admin/sócio. O resto do Status 2 é livre. postgres e service_role passam; valor igual não conta como escrita.';
