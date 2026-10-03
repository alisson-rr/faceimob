-- =============================================================================
-- 0208 — encerrar o negócio segue o Status 2, não a matriz de etapa
--
-- Pedido do cliente em 03/10/2026: "permita dar OFF em qualquer proposta"; o
-- caso EMERSON travou com "Seu perfil não pode tirar um negócio de 'Em
-- Análise'", embora o Status 2 já fosse PENDENTE C/ RESTRIÇÃO.
--
-- Causa: o Status 2 manda na etapa (0164) só quando o status tem etapa ligada no
-- cadastro. PENDENTE C/ RESTRIÇÃO, OFF, QUEDA, REPROVADO e DISTRATO não têm, então
--   · o negócio ficou parado na etapa antiga ("Em Análise");
--   · "Encerrar negócio" grava Status 2 de desfecho + etapa de perda juntos, e
--     `deals_guard_stage` cobrava a matriz de ETAPA (`can_exit_stage` de "Em
--     Análise"), que o perfil não tem.
--
-- Agora a troca para a etapa de perda junto com um Status 2 de desfecho recebe
-- a mesma marca "etapa veio do Status 2" da 0178, e `deals_guard_status_columns`
-- (que repetia a matriz de etapa, 0101/0111) passa a respeitar a marca, como
-- `deals_guard_stage` já fazia. Corpo da 0111, mudando só a regra (1). Quem autoriza é a matriz do
-- Status 2 (`deals_guard_status_detail`) e, para OFF e distrato,
-- `deals.mark_off_distrato` (`deals_guard_status_columns`) — as duas seguem
-- valendo. Status com etapa ligada continua como na 0178.
-- =============================================================================

create or replace function public.deals_ab_status_stage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stage uuid;
begin
  if tg_op = 'UPDATE'
     and public.deal_status_bare(new.status_detail) is not distinct from public.deal_status_bare(old.status_detail) then
    return new;
  end if;
  if new.status_detail is null then
    return new;
  end if;

  select s.stage_id into v_stage
    from public.deal_statuses s
   where public.deal_status_bare(s.value) = public.deal_status_bare(new.status_detail)
   order by s.active desc
   limit 1;

  if v_stage is not null then
    new.stage_id := v_stage;
    -- Marca também quando a etapa já veio igual (a ficha manda as duas
    -- juntas desde a 0171): `deals_guard_stage` lê isto para não cobrar a
    -- matriz de ETAPA de uma troca que é do Status 2.
    perform set_config('faceimob.stage_from_status', coalesce(new.id::text, 'novo'), true);
  elsif public.deal_status_bare(new.status_detail) ~ '^(OFF|QUEDA|DISTRATO|REPROVADO)\M'
        and exists (select 1 from public.pipeline_stages p where p.id = new.stage_id and p.code = 'lost') then
    -- 0208: encerrar com motivo (Status 2 de desfecho + etapa de perda).
    perform set_config('faceimob.stage_from_status', coalesce(new.id::text, 'novo'), true);
  end if;

  return new;
end;
$$;

revoke all on function public.deals_ab_status_stage() from public, anon, authenticated;

create or replace function public.deals_guard_status_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- (1) ETAPA — a matriz `stage_permissions`, e nada além dela (0101). A etapa
  -- que veio do Status 2 (0164, 0178, 0208) é autorizada pela matriz do Status 2
  -- e por (2) abaixo, como em `deals_guard_stage`.
  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id
     and coalesce(current_setting('faceimob.stage_from_status', true), '') is distinct from new.id::text then
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
$function$;

revoke all on function public.deals_guard_status_columns() from public, anon, authenticated;
