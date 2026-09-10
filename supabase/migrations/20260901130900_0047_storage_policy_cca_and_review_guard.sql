-- =============================================================================
-- 0047 — Dois buracos na esteira de crédito (auditoria de 01/09, grupo cca)
--
-- 1. O analista de CCA lista todo documento e não baixa nenhum.
--
--    `deal_documents_select` (0006) libera a tabela para `has_role('cca')`, mas a
--    policy do bucket `deal-documents` (0012) só aceita `can_see_deal()`. O CCA
--    não participa de negócio nenhum e não lidera equipe, então `can_see_deal`
--    é falso em 100% dos casos: a aba Anexos mostra a lista inteira e o botão
--    "Baixar" falha em todas — justamente para o perfil a quem o download foi
--    feito. A policy do bucket passa a espelhar a da tabela.
--
--    O bloco tolera o harness (sem schema storage) como a 0012, mas não exige
--    `storage.foldername`: esta policy não usa a função, e assim o harness cria
--    a policy no stub e o teste 14 consegue exercitá-la.
--
-- 2. "Aprovar e enviar ao CCA" quebra e desfaz a aprovação sem construtora.
--
--    `review_deal_documents` (0028) grava a aprovação e, na mesma transação,
--    chama `submit_deal_for_analysis`, que exige `developer_id`. O modal deixa
--    salvar negócio sem construtora (`deals.developer_id` é nullable, e a etapa
--    "incompleto" existe para isso), então o corretor anexa tudo, envia, e é o
--    GERENTE quem recebe "Defina a construtora…" com a transação inteira
--    desfeita. A checagem vai para o passo anterior: `submit_deal_for_manager_
--    review` recusa o ENVIO sem construtora, e quem corrige é o corretor, na
--    própria aba Detalhes, antes de o gerente perder tempo. A guarda em
--    `submit_deal_for_analysis` continua como rede de segurança.
--
--    Corpo copiado da 0028; a diferença é o bloco `if v_deal.developer_id is null`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Policy do bucket deal-documents alinhada à da tabela
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage do Supabase ausente - policy de bucket ignorada (ambiente de teste)';
    return;
  end if;

  execute 'drop policy if exists deal_documents_storage on storage.objects';
  execute $p$
    create policy deal_documents_storage on storage.objects
      for all to authenticated
      using (
        bucket_id = 'deal-documents'
        and (
          public.has_role('cca')
          or exists (
            select 1 from public.deal_documents d
            where d.storage_path = storage.objects.name
              and public.can_see_deal(d.deal_id)
          )
        )
      )
      with check (bucket_id = 'deal-documents')
  $p$;
exception
  when insufficient_privilege then
    raise notice 'sem privilégio para criar policies em storage.objects - aplicar pelo painel do Supabase';
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Envio ao gerente recusa negócio sem construtora
-- -----------------------------------------------------------------------------
create or replace function public.submit_deal_for_manager_review(p_deal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal     public.deals;
  v_previous text;
  v_missing  text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  if not public.is_admin() and not exists (
    select 1 from public.deal_participants dp
    where dp.deal_id = p_deal_id
      and dp.profile_id = auth.uid()
      and dp.role = 'broker'
  ) then
    raise exception 'Somente um corretor vinculado ao negócio pode solicitar a conferência.'
      using errcode = '42501';
  end if;

  if v_deal.document_review_status = 'pending' then
    raise exception 'A documentação já aguarda conferência do gerente.'
      using errcode = 'P0001';
  elsif v_deal.document_review_status = 'approved' then
    raise exception 'A documentação deste negócio já foi aprovada.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.deal_participants dp
    where dp.deal_id = p_deal_id and dp.role = 'manager'
  ) then
    raise exception 'Vincule ao menos um gerente ao negócio antes de enviar.'
      using errcode = 'P0001';
  end if;

  -- A aprovação do gerente entra no CCA na mesma transação e o CCA exige
  -- construtora; sem esta trava a falha só apareceria no clique do gerente.
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

  update public.deals
  set document_review_status = 'pending',
      document_review_requested_at = now(),
      document_review_requested_by = auth.uid(),
      document_reviewed_at = null,
      document_reviewed_by = null,
      document_review_reason = null
  where id = p_deal_id;

  insert into public.deal_history
    (deal_id, actor_id, kind, from_value, to_value)
  values
    (p_deal_id, auth.uid(), 'document_review_requested', v_previous, 'pending');

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct dp.profile_id,
         'document_review_requested',
         'Documentos para conferir: ' || v_deal.code,
         'Um corretor enviou a documentação deste negócio para sua conferência.',
         '/pipeline',
         'in_app'::notification_channel
  from public.deal_participants dp
  where dp.deal_id = p_deal_id and dp.role = 'manager';

  return jsonb_build_object('status', 'pending');
end;
$$;

-- `create or replace` preserva dono, grants e comment da 0028 (authenticated e
-- service_role executam; anon e public não). Reafirmado para não depender disso.
revoke all on function public.submit_deal_for_manager_review(uuid) from public, anon;
grant execute on function public.submit_deal_for_manager_review(uuid) to authenticated, service_role;
