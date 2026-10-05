-- =============================================================================
-- 0228 — reenvio na pendência, VGV que ninguém mexeu, ordem das colunas pela CCA
--
-- Reclamações de 05/10/2026:
--   1. "Não há permissão de alterar o VGV deste negócio" ao enviar ao gerente
--      sem mexer no valor: salvar o negócio regrava o VGV, `deals_sync_discount`
--      (0159) recalcula `discount_pct` a partir do desconto em R$ e, nos negócios
--      antigos, o percentual guardado não batia — o guarda via "mudança" de
--      VGV. O percentual é derivado: o guarda passa a olhar só o VGV e o desconto
--      em R$. Quem muda o percentual muda o R$ junto, e esse continua barrado.
--   2. "A documentação deste negócio já foi aprovada" ao devolver ao CCA um
--      negócio em PENDENTE: o reenvio só é barrado enquanto o caso está em
--      análise na CCA.
--   3. A CCA reordena as colunas do quadro (só a ordem).
-- =============================================================================

create or replace function public.deals_guard_value()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.vgv_gross is distinct from old.vgv_gross
      or new.discount_amount is distinct from old.discount_amount)
     and not public.has_permission('deals.edit_value') then
    raise exception 'Sem permissão para editar o VGV deste negócio.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.submit_deal_for_manager_review(
  p_deal_id uuid,
  p_message text,
  p_esteira text default 'agil'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal     public.deals;
  v_previous text;
  v_missing  text;
  v_message  text := btrim(coalesce(p_message, ''));
  v_esteira  text := coalesce(p_esteira, 'agil');
  v_texto    text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if v_esteira not in ('agil', 'virar') then
    raise exception 'Esteira de envio desconhecida: use "agil" ou "virar".' using errcode = 'P0001';
  end if;

  if v_message = '' then
    raise exception 'Escreva a mensagem do envio: ela fica registrada no negócio e avisa a equipe.'
      using errcode = 'P0001';
  end if;

  if length(v_message) > 4000 then
    raise exception 'Mensagem longa demais (máx. 4000 caracteres).' using errcode = 'P0001';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  -- 0164: corretor, gerente ou diretor do negócio (era só o corretor).
  if not public.is_admin() and not exists (
    select 1 from public.deal_participants dp
    where dp.deal_id = p_deal_id
      and dp.profile_id = auth.uid()
      and dp.role in ('broker', 'manager', 'director')
  ) then
    raise exception 'Somente corretor, gerente ou diretor do negócio pode enviar para análise.'
      using errcode = '42501';
  end if;

  if v_deal.document_review_status = 'pending' then
    raise exception 'A documentação já aguarda conferência do gerente.'
      using errcode = 'P0001';
  end if;

  if v_esteira = 'virar' then
    if not exists (
      select 1 from public.cca_cases c
      where c.deal_id = p_deal_id
        and (c.status = 'approved'
             or (c.status = 'pending_documents' and v_deal.review_esteira = 'virar'))
    ) then
      raise exception 'A análise p/ virar negócio é o 2º envio: só vale para negócio com crédito aprovado na CCA.'
        using errcode = 'P0001';
    end if;
  -- 0228: aprovado pelo gerente só barra o reenvio enquanto a CCA ainda está
  -- analisando. Devolvido em pendência (ou sem caso aberto), o corretor anexa
  -- e reenvia — antes recebia "já foi aprovada" e o negócio travava.
  elsif v_deal.document_review_status = 'approved'
        and exists (select 1 from public.cca_cases c
                     where c.deal_id = p_deal_id
                       and c.status in ('under_review', 'sent_to_agency', 'sent_to_developer')) then
    raise exception 'O negócio está em análise na CCA: aguarde a decisão ou a devolução em pendência para reenviar.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.deal_participants dp
    where dp.deal_id = p_deal_id and dp.role = 'manager'
  ) then
    raise exception 'Vincule ao menos um gerente ao negócio antes de enviar.'
      using errcode = 'P0001';
  end if;

  if v_deal.developer_id is null then
    raise exception 'Defina a construtora na aba Detalhes antes de enviar ao gerente.'
      using errcode = 'P0001';
  end if;

  select string_agg(dt.label, ', ' order by dt.sort_order) into v_missing
  from public.document_types dt
  where dt.active and dt.required_for_conversion
    and not exists (
      select 1 from public.deal_documents dd
      where dd.deal_id = p_deal_id
        and dd.document_type_id = dt.id
        and dd.superseded_at is null
    );

  if v_missing is not null then
    raise exception 'Faltam documentos obrigatórios: %', v_missing using errcode = 'P0001';
  end if;

  v_previous := v_deal.document_review_status;
  v_texto := case v_esteira
               when 'virar' then 'ENVIO ANÁLISE P/ VIRAR NEGÓCIO: '
               else 'ENVIO ESTEIRA ÁGIL: '
             end || v_message;

  update public.deals
  set document_review_status = 'pending',
      document_review_requested_at = now(),
      document_review_requested_by = auth.uid(),
      document_reviewed_at = null,
      document_reviewed_by = null,
      document_review_reason = null,
      review_esteira = v_esteira
  where id = p_deal_id;

  insert into public.deal_history
    (deal_id, actor_id, kind, from_value, to_value)
  values
    (p_deal_id, auth.uid(), 'document_review_requested', v_previous, 'pending');

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, auth.uid(), 'comment', v_texto);

  insert into public.deal_history (deal_id, actor_id, kind, detail)
  values (p_deal_id, auth.uid(), 'esteira_sent', jsonb_build_object('esteira', v_esteira));

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct dp.profile_id,
         'document_review_requested',
         'Documentos para conferir: ' || v_deal.code,
         left(v_texto, 2000),
         '/pipeline',
         'in_app'::notification_channel
  from public.deal_participants dp
  where dp.deal_id = p_deal_id and dp.role = 'manager';

  return jsonb_build_object('status', 'pending', 'esteira', v_esteira);
end;
$$;

comment on function public.submit_deal_for_manager_review(uuid, text, text) is
  'Corretor, gerente ou diretor do negócio (0164) envia (reenvia na pendência, 0228) o dossiê ao gerente com mensagem obrigatória, pela esteira agil (1º envio) ou virar (2º envio, só com crédito aprovado na CCA). Grava comentário, evento esteira_sent e avisa os gerentes com a mensagem (0150).';

revoke all on function public.submit_deal_for_manager_review(uuid, text, text) from public, anon;
grant execute on function public.submit_deal_for_manager_review(uuid, text, text)
  to authenticated, service_role;

create or replace function public.reorder_cca_stages(p_stage_ids uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- 0228: a CCA também organiza a ordem (pedido de 05/10/2026); criar,
  -- renomear e apagar coluna continua só do admin (policy da 0151).
  if auth.uid() is null or not (public.is_admin() or public.has_role('cca')) then
    raise exception 'Só administrador, sócio e CCA organizam as colunas da CCA.' using errcode = '42501';
  end if;
  lock table public.cca_stages in share row exclusive mode;
  if p_stage_ids is null
     or cardinality(p_stage_ids) <> (select count(*) from public.cca_stages where active)
     or cardinality(p_stage_ids) <> (select count(distinct id) from unnest(p_stage_ids) id)
     or exists (select 1 from unnest(p_stage_ids) requested(id)
                 where not exists (select 1 from public.cca_stages s where s.id = requested.id and s.active)) then
    raise exception 'A lista de colunas mudou. Recarregue antes de reordenar.' using errcode = 'P0001';
  end if;
  update public.cca_stages s set position = ordered.pos::integer
    from unnest(p_stage_ids) with ordinality ordered(id, pos)
   where s.id = ordered.id;
end;
$$;
revoke all on function public.reorder_cca_stages(uuid[]) from public, anon;
grant execute on function public.reorder_cca_stages(uuid[]) to authenticated, service_role;

revoke all on function public.deals_guard_value() from public, anon, authenticated;
