-- =============================================================================
-- 0253 · Reenvio a partir de INCOMPLETO encerra o caso antigo da CCA
--
-- Pedido de 09/10/2026: o negócio foi mandado por engano para ANÁLISE EXTERNA,
-- voltou para INCOMPLETO para corrigir, e o envio à Esteira Ágil recusava "O
-- negócio está em análise na CCA". Em INCOMPLETO, reenviar encerra o caso
-- aberto (cancelado, com motivo e comentário no histórico) e segue o envio.
-- Fora de INCOMPLETO nada muda: caso em análise continua travando o reenvio.
-- =============================================================================

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

  -- 0253: INCOMPLETO é o "parei para corrigir". Enviado pela via errada (ex.:
  -- ANÁLISE EXTERNA no lugar da Esteira Ágil), o caso aberto na CCA prendia o
  -- negócio: o reenvio recusava "em análise na CCA" e ninguém tinha saída. Em
  -- INCOMPLETO o reenvio encerra o caso antigo (cancelado, com o motivo no
  -- histórico) e segue o fluxo normal da esteira escolhida.
  if public.deal_status_bare(v_deal.status_detail) = 'INCOMPLETO'
     and exists (select 1 from public.cca_cases c
                  where c.deal_id = p_deal_id
                    and c.status not in ('approved', 'rejected', 'cancelled')) then
    update public.cca_cases
       set status = 'cancelled', decided_at = now(),
           decision_notes = left('Reenviado pela ' || case v_esteira when 'virar' then 'análise p/ virar negócio' else 'Esteira Ágil' end
                                 || ' a partir de INCOMPLETO: ' || v_message, 2000)
     where deal_id = p_deal_id
       and status not in ('approved', 'rejected', 'cancelled');
    insert into public.deal_history (deal_id, actor_id, kind, to_value)
    values (p_deal_id, auth.uid(), 'comment',
            'Caso anterior na CCA encerrado: negócio reenviado a partir de INCOMPLETO.');
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
