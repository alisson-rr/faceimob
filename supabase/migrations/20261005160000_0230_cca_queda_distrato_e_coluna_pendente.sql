-- =============================================================================
-- 0230 — CCA marca QUEDA e DISTRATO; a coluna PENDENTE volta ao quadro
--
-- Pedidos de 05/10/2026:
--   1. A CCA encerra propostas por QUEDA e por DISTRATO. QUEDA ela já colocava
--      (matriz do Status 2, 0164); DISTRATO era só de admin e sócio, pela
--      permissão `deals.mark_off_distrato`, que também dá OFF. Entra a
--      permissão `deals.mark_distrato`, só do distrato, ligada para a CCA e
--      editável em Admin · Permissões. OFF continua de admin e sócio.
--   2. "O estágio PENDENTE sumiu" (CCA): garante uma coluna PENDENTE ativa no
--      quadro, logo antes de PENDENTE C/ RESTRIÇÃO. Reativa a que existir;
--      cria só se não houver nenhuma. Coluna já ativa: nada muda.
-- =============================================================================

-- 1. Permissão própria do distrato.
insert into public.permissions (code, label, category, description) values
  ('deals.mark_distrato', 'Marcar distrato', 'pipeline',
   'Encerrar o negócio por DISTRATO. OFF continua em "Marcar OFF e distrato".')
on conflict (code) do nothing;
insert into public.role_permissions (role, permission, allowed)
values ('cca', 'deals.mark_distrato', true)
on conflict (role, permission) do update set allowed = true;

-- A matriz do Status 2 também precisa deixar a CCA entrar em DISTRATO e QUEDA.
insert into public.deal_status_permissions (status_id, role, can_enter, can_exit)
select s.id, 'cca', true, false
  from public.deal_statuses s
 where public.deal_status_bare(s.value) in ('DISTRATO', 'QUEDA')
on conflict (status_id, role) do update set can_enter = true, updated_at = now();

-- Corpo da 0208; só a regra (2) muda.
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
  -- 0230: DISTRATO também passa com `deals.mark_distrato` (a CCA); OFF segue
  -- só com `deals.mark_off_distrato`.
  if ((v_novo_status and public.deal_status_bare(new.status_detail) ~ '^OFF\M')
      or (v_novo_motivo and public.deal_status_bare(new.lost_reason) ~ '^OFF\M'))
     and not public.has_permission('deals.mark_off_distrato') then
    raise exception
      'Só administrador e sócio marcam OFF. Os outros motivos de encerramento continuam sendo seus.'
      using errcode = '42501',
            hint = 'Permissão deals.mark_off_distrato, em Admin · Permissões.';
  end if;
  if ((v_novo_status and public.deal_status_bare(new.status_detail) ~ '^DISTRATO\M')
      or (v_novo_motivo and public.deal_status_bare(new.lost_reason) ~ '^DISTRATO\M'))
     and not (public.has_permission('deals.mark_off_distrato')
              or public.has_permission('deals.mark_distrato')) then
    raise exception
      'Só administrador, sócio e CCA marcam distrato. Os outros motivos de encerramento continuam sendo seus.'
      using errcode = '42501',
            hint = 'Permissão deals.mark_distrato, em Admin · Permissões.';
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

comment on function public.deals_guard_status_columns() is
  'Etapa pela matriz stage_permissions; etapa que veio do Status 2 passa pela matriz do Status 2 (0208); OFF só com deals.mark_off_distrato e DISTRATO com ela ou deals.mark_distrato (0230); outcome e closed_at derivados da etapa. postgres e service_role passam; valor igual não conta como escrita.';

revoke all on function public.deals_guard_status_columns() from public, anon, authenticated;

-- 2. A coluna PENDENTE de volta, ativa.
do $$
declare
  v_id     uuid;
  v_status uuid;
begin
  if exists (select 1 from public.cca_stages
              where active and public.cca_stage_name_key(name) = 'PENDENTE') then
    return;
  end if;

  select id into v_status from public.deal_statuses
   where public.deal_status_bare(value) = 'PENDENTE'
   order by active desc limit 1;

  select id into v_id from public.cca_stages
   where public.cca_stage_name_key(name) = 'PENDENTE'
   order by position limit 1;

  if v_id is null then
    insert into public.cca_stages (name, color, position, status, active, deal_status_id)
    values ('PENDENTE', 'danger', 0, 'pending_documents', true, v_status)
    returning id into v_id;
  else
    update public.cca_stages
       set active = true, status = 'pending_documents',
           deal_status_id = coalesce(deal_status_id, v_status)
     where id = v_id;
  end if;

  -- Logo antes de PENDENTE C/ RESTRIÇÃO (ou no começo, sem ela), e o quadro
  -- renumerado na mesma ordem.
  update public.cca_stages
     set position = coalesce((select min(position) from public.cca_stages
                               where active and id <> v_id
                                 and public.cca_stage_name_key(name) = public.cca_stage_name_key('PENDENTE C/ RESTRIÇÃO')), 1)
   where id = v_id;
  with ordem as (
    select id, row_number() over (order by position, (id <> v_id), name) as nova
      from public.cca_stages
     where active and position < 100
  )
  update public.cca_stages s set position = o.nova
    from ordem o
   where s.id = o.id and s.position is distinct from o.nova;
end;
$$;
