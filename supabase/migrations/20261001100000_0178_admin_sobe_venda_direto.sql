-- =============================================================================
-- 0178 — administrador sobe a venda direto; a etapa escolhida junto com o
--        Status 2 conta como etapa do Status 2
--
-- Pedido do cliente em 01/10/2026 (cliente RODRIGO MACHADO GROSS): ao editar um
-- negócio e escolher Etapa "Contrato" + Status 2 "04. EM CONTRATO", o
-- administrador recebia "A documentação precisa ser aprovada pelo gerente antes
-- de entrar no CCA.".
--
-- Causa: desde a 0171 a ficha manda a etapa do Status 2 junto com o Status 2.
-- `deals_ab_status_stage` (0164) só marcava "etapa veio do Status 2" quando ELA
-- trocava a etapa; com a etapa já igual, a marca não era posta e
-- `deals_guard_stage` cobrava a conferência como se fosse uma movimentação de
-- etapa à mão — para todo mundo, administrador inclusive.
--
-- Duas correções:
--   1. A etapa igual à do Status 2 também recebe a marca. É a mesma troca que o
--      Status 2 sozinho faria, e quem a autoriza é a matriz do Status 2 (0164).
--   2. Administrador e sócio (`is_admin()`) não são cobrados da conferência ao
--      mover a etapa: "libere o adm para subir diretamente se quiser". A
--      matriz de etapas segue valendo para os outros papéis.
-- Mesma assinatura e mesmos gatilhos da 0164; só `create or replace`.
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
  end if;

  return new;
end;
$$;

revoke all on function public.deals_ab_status_stage() from public, anon, authenticated;

create or replace function public.deals_guard_stage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_block   text;
  v_outcome deal_outcome;
  v_do_status boolean;
begin
  if new.stage_id is distinct from old.stage_id then
    -- Etapa que veio do Status 2 (0164): a troca já passou pela matriz do
    -- Status 2, que é quem manda agora.
    v_do_status := coalesce(current_setting('faceimob.stage_from_status', true), '') = new.id::text;

    if auth.uid() is not null and not v_do_status then
      if not public.can_exit_stage(old.stage_id) then
        raise exception 'Seu papel não pode tirar um negócio deste estágio.'
          using errcode = '42501';
      end if;
      if not public.can_enter_stage(new.stage_id) then
        raise exception 'Seu papel não pode mover um negócio para este estágio.'
          using errcode = '42501';
      end if;
    end if;

    -- Administrador e sócio sobem o negócio sem a conferência do gerente (0178).
    if not v_do_status and not public.is_admin() then
      v_block := public.deal_stage_document_block(
        new.id, new.stage_id, new.document_review_status);
      if v_block is not null then
        raise exception '%', v_block using errcode = 'P0001';
      end if;
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
