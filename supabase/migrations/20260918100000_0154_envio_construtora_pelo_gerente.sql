-- =============================================================================
-- 0154 · Envio à construtora pelo gerente, e e-mail da construtora externa
--        opcional
--
-- Pedido do cliente em 17/09/2026:
--   · "Enviar à construtora" sai do cartão da CCA e vira ação do GERENTE, na
--     conferência dos documentos, só para construtora de fluxo externo;
--   · o e-mail da construtora externa deixa de ser obrigatório no cadastro.
--
-- Consequência combinada com o dono: construtora externa SEM e-mail não recebe
-- nada automático. A aprovação do gerente segue igual (caso na CCA, negócio em
-- "Em análise"); só o dossiê não entra na fila — ele vai à mão. Com e-mail,
-- nada muda: a aprovação continua enfileirando o dossiê sozinha.
--
-- Quatro peças:
--   1. sai o CHECK `developers_external_needs_email` (0003). Nenhum dado é
--      reescrito; o formato continua cobrado por `developers_submission_email_format`.
--   2. `submit_deal_for_analysis` (corpo da 0150) só enfileira quando há e-mail.
--      Sem isto, a 1ª aprovação de um negócio dessa construtora estourava o
--      NOT NULL de `developer_submissions.to_email` e o gerente recebia o erro
--      cru — a conferência inteira voltava atrás.
--   3. `enqueue_developer_submission`: o envio manual passa por RPC. O gerente
--      não tem `cca.review` (é o que `developer_submissions_write` exige desde a
--      0044), e abrir a policy da tabela a ele deixaria gravar qualquer
--      destinatário com QUALQUER `document_ids` — inclusive documento de outro
--      negócio, que o worker assina e anexa sem conferir o dono. A RPC cobra o
--      mesmo "quem" e o mesmo "quando" da conferência (gerente do negócio ou
--      admin; documentação aprovada; construtora externa COM e-mail) e confere
--      que cada documento é vigente e deste negócio. Quem tem `cca.review` segue
--      podendo o que já podia pela tabela, inclusive o envio avulso a
--      construtora interna.
--   4. O aviso de dossiê que desistiu (0083) apontava para /cca, onde o envio
--      não existe mais: passa a apontar para /pipeline, onde o gerente reenvia
--      pela conferência do negócio.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. E-mail opcional na construtora externa
-- -----------------------------------------------------------------------------
alter table public.developers drop constraint if exists developers_external_needs_email;

comment on column public.developers.submission_email is
  'Destinatário do dossiê no fluxo externo. Opcional (0154): sem ele, a aprovação do gerente não enfileira o dossiê e o envio é feito fora do sistema.';

-- -----------------------------------------------------------------------------
-- 2. Entrada na CCA: só enfileira o dossiê quando a construtora tem e-mail
-- -----------------------------------------------------------------------------
-- Corpo da 0150; a única mudança é o `if v_dev.submission_email is not null`
-- em volta da fila e do evento "Enviado à construtora" do histórico — sem
-- e-mail nada foi enviado, e o histórico não pode afirmar que foi.
create or replace function public.submit_deal_for_analysis(p_deal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal           public.deals;
  v_dev            public.developers;
  v_docs           uuid[];
  v_client         text;
  v_case_id        uuid;
  v_sub_id         uuid;
  v_stage          uuid;
  v_analysis_stage uuid;
  v_analysis_pos   int;
  v_result         jsonb;
begin
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if auth.uid() is not null
     and not public.is_admin()
     and not exists (
       select 1 from public.deal_participants dp
       where dp.deal_id = p_deal_id
         and dp.profile_id = auth.uid()
         and dp.role = 'manager'
     ) then
    raise exception 'Somente um gerente vinculado ao negócio pode enviá-lo ao CCA.'
      using errcode = '42501';
  end if;

  if v_deal.document_review_status <> 'approved' then
    raise exception 'A documentação ainda não foi aprovada pelo gerente.'
      using errcode = 'P0001';
  end if;

  if v_deal.developer_id is null then
    raise exception 'Defina a construtora antes de enviar para análise.'
      using errcode = 'P0001';
  end if;

  select * into v_dev from public.developers where id = v_deal.developer_id;

  select coalesce(array_agg(d.id order by d.created_at), '{}') into v_docs
  from public.deal_documents d
  where d.deal_id = p_deal_id and d.superseded_at is null;

  if array_length(v_docs, 1) is null then
    raise exception 'Nenhum documento anexado ao negócio.' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.document_types dt
    where dt.active and dt.required_for_conversion
      and not exists (
        select 1 from public.deal_documents dd
        where dd.deal_id = p_deal_id
          and dd.document_type_id = dt.id
          and dd.superseded_at is null
      )
  ) then
    raise exception 'Faltam documentos obrigatórios: %',
      (select string_agg(dt.label, ', ' order by dt.sort_order)
       from public.document_types dt
       where dt.active and dt.required_for_conversion
         and not exists (
           select 1 from public.deal_documents dd
           where dd.deal_id = p_deal_id
             and dd.document_type_id = dt.id
             and dd.superseded_at is null
         ))
      using errcode = 'P0001';
  end if;

  select c.full_name into v_client
  from public.deal_clients c where c.deal_id = p_deal_id and c.ordinal = 1;

  if v_dev.flow = 'internal' then
    select id into v_stage from public.cca_stages
     where status = 'under_review' and active order by position limit 1;

    insert into public.cca_cases (deal_id, status, stage_id, submitted_at)
    values (p_deal_id, 'under_review', v_stage, now())
    on conflict (deal_id) do update
      set status = 'under_review',
          stage_id = coalesce(excluded.stage_id, cca_cases.stage_id),
          submitted_at = now(),
          decided_at = null
    returning id into v_case_id;

    insert into public.cca_case_events (case_id, actor_id, kind, to_value)
    values (v_case_id, auth.uid(), 'submitted', 'under_review');

    v_result := jsonb_build_object('flow', 'internal', 'case_id', v_case_id);
  else
    select id into v_stage from public.cca_stages
     where active and status in ('sent_to_developer', 'under_review')
     order by (status = 'sent_to_developer') desc, position
     limit 1;

    insert into public.cca_cases (deal_id, status, stage_id, submitted_at)
    values (p_deal_id, 'sent_to_developer', v_stage, now())
    on conflict (deal_id) do update
      set status = 'sent_to_developer',
          stage_id = coalesce(excluded.stage_id, cca_cases.stage_id),
          submitted_at = now(),
          decided_at = null
    returning id into v_case_id;

    insert into public.cca_case_events (case_id, actor_id, kind, to_value)
    values (v_case_id, auth.uid(), 'submitted', 'sent_to_developer');

    if v_dev.submission_email is not null then
      insert into public.developer_submissions
        (deal_id, developer_id, to_email, subject, body, document_ids, requested_by)
      values (
        p_deal_id,
        v_dev.id,
        v_dev.submission_email,
        format('[%s] Documentação - %s', v_deal.code, coalesce(v_client, 'cliente')),
        format('Segue documentação do negócio %s (unidade %s).',
               v_deal.code, coalesce(v_deal.unit, '-')),
        v_docs,
        auth.uid()
      )
      returning id into v_sub_id;

      insert into public.deal_history (deal_id, actor_id, kind, detail)
      values (p_deal_id, auth.uid(), 'sent_to_developer',
              jsonb_build_object('submission_id', v_sub_id, 'developer', v_dev.name));
    end if;

    -- `submission_id` nulo = construtora sem e-mail: o dossiê vai à mão.
    v_result := jsonb_build_object(
      'flow', 'external', 'submission_id', v_sub_id, 'case_id', v_case_id);
  end if;

  select id, position into v_analysis_stage, v_analysis_pos
  from public.pipeline_stages
  where code = 'under_analysis' and active;

  if v_analysis_stage is null then
    raise exception 'A etapa Em análise não está configurada.' using errcode = 'P0001';
  end if;

  if v_deal.outcome = 'open' and exists (
    select 1 from public.pipeline_stages s
    where s.id = v_deal.stage_id and s.position < v_analysis_pos
  ) then
    update public.deals set stage_id = v_analysis_stage where id = p_deal_id;
  end if;

  return v_result;
end;
$$;

comment on function public.submit_deal_for_analysis(uuid) is
  'Entrada do negócio aprovado pelo gerente na CCA. Construtora externa com e-mail enfileira o dossiê em developer_submissions; sem e-mail o caso entra igual e o dossiê não é enfileirado (0154).';

-- -----------------------------------------------------------------------------
-- 3. Envio manual do dossiê: gerente do negócio (ou quem tem cca.review)
-- -----------------------------------------------------------------------------
create or replace function public.enqueue_developer_submission(
  p_deal_id      uuid,
  p_to_email     text,
  p_cc_emails    text[],
  p_subject      text,
  p_body         text,
  p_document_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- O MESMO formato de `developers_submission_email_format` (0063) e do
  -- `isEmail` da tela: frouxo de propósito, a validação forte é a entrega.
  c_email   constant text := '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
  v_deal    public.deals;
  v_dev     public.developers;
  v_cca     boolean;
  v_to      text := btrim(coalesce(p_to_email, ''));
  v_cc      text[];
  v_subject text := btrim(coalesce(p_subject, ''));
  v_body    text := nullif(btrim(coalesce(p_body, '')), '');
  v_id      uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select * into v_deal from public.deals where id = p_deal_id;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  -- Quem confere os documentos (gerente do negócio; admin entra pelo
  -- `has_permission`) ou quem já gravava a fila pela policy da tabela.
  v_cca := public.has_permission('cca.review');
  if not v_cca and not exists (
    select 1 from public.deal_participants dp
    where dp.deal_id = p_deal_id
      and dp.profile_id = auth.uid()
      and dp.role = 'manager'
  ) then
    raise exception 'Somente o gerente do negócio envia o dossiê à construtora.'
      using errcode = '42501';
  end if;

  select * into v_dev from public.developers where id = v_deal.developer_id;
  if not found then
    raise exception 'Defina a construtora do negócio antes de enviar.' using errcode = 'P0001';
  end if;

  -- O gerente só envia para construtora externa. O envio avulso a construtora
  -- interna (contato pontual da obra) continua sendo do CCA, como na 0077.
  if v_dev.flow <> 'external' and not v_cca then
    raise exception 'Construtora de fluxo interno: a análise é do CCA da casa e não há dossiê a enviar.'
      using errcode = 'P0001';
  end if;

  -- O mesmo recorte da tela da conferência, cobrado aqui: antes da aprovação o
  -- dossiê sairia duas vezes (a aprovação enfileira sozinha), e construtora sem
  -- e-mail é o caso combinado de envio à mão — sem isto o gerente mandaria os
  -- documentos do cliente, pelo remetente da empresa, a um endereço livre.
  if not v_cca and v_deal.document_review_status <> 'approved' then
    raise exception 'Aprove a documentação antes de enviar: a aprovação já enfileira o dossiê.'
      using errcode = 'P0001';
  end if;

  if not v_cca and v_dev.submission_email is null then
    raise exception 'Construtora sem e-mail de envio: o dossiê vai à mão. Cadastre o e-mail em Construtoras para enviar pelo sistema.'
      using errcode = 'P0001';
  end if;

  if v_to !~ c_email then
    raise exception 'Destinatário inválido: use um e-mail no formato nome@dominio.com.'
      using errcode = 'P0001';
  end if;

  select array_agg(btrim(e)) into v_cc
  from unnest(coalesce(p_cc_emails, '{}'::text[])) e
  where btrim(coalesce(e, '')) <> '';

  if cardinality(v_cc) > 20 then
    raise exception 'Cópias demais (máx. 20).' using errcode = 'P0001';
  end if;

  if exists (select 1 from unnest(coalesce(v_cc, '{}'::text[])) e where e !~ c_email) then
    raise exception 'Cópia inválida: use e-mails no formato nome@dominio.com.' using errcode = 'P0001';
  end if;

  if v_subject = '' or length(v_subject) > 300 then
    raise exception 'Assunto obrigatório, com até 300 caracteres.' using errcode = 'P0001';
  end if;

  if length(v_body) > 10000 then
    raise exception 'Mensagem longa demais (máx. 10000 caracteres).' using errcode = 'P0001';
  end if;

  if coalesce(cardinality(p_document_ids), 0) = 0 then
    raise exception 'Selecione ao menos um documento.' using errcode = 'P0001';
  end if;

  -- Cada id tem de ser um documento VIGENTE deste negócio. Repetido, nulo ou de
  -- outro negócio deixa a contagem menor que a lista e cai aqui: o worker
  -- anexa o que a lista mandar, sem conferir de quem é.
  if (select count(*) from public.deal_documents d
       where d.id = any (p_document_ids)
         and d.deal_id = p_deal_id
         and d.superseded_at is null) <> cardinality(p_document_ids) then
    raise exception 'Algum documento escolhido não é vigente neste negócio: reabra o envio e escolha de novo.'
      using errcode = 'P0001';
  end if;

  insert into public.developer_submissions
    (deal_id, developer_id, to_email, cc_emails, subject, body, document_ids, requested_by)
  values
    (p_deal_id, v_dev.id, v_to, v_cc, v_subject, v_body, p_document_ids, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.enqueue_developer_submission(uuid, text, text[], text, text, uuid[]) is
  'Enfileira o dossiê do negócio para a construtora. Gerente do negócio: só construtora externa com e-mail e documentação aprovada; cca.review como já gravava pela tabela. Documentos têm de ser vigentes e do próprio negócio (0154).';

revoke all on function public.enqueue_developer_submission(uuid, text, text[], text, text, uuid[])
  from public, anon;
grant execute on function public.enqueue_developer_submission(uuid, text, text[], text, text, uuid[])
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Dossiê que desistiu: o aviso leva para onde o envio mora agora
-- -----------------------------------------------------------------------------
-- Corpo da 0083; muda só o `link` ('/cca' → '/pipeline'). O diálogo do envio
-- saiu do cartão da CCA e vive na conferência do negócio: quem pediu (agora o
-- gerente) abre o negócio e manda de novo; o admin conserta a credencial e
-- reenfileira pelo mesmo diálogo.
create or replace function public.notify_submission_gave_up()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  if new.status <> 'failed' or new.attempts < 5 or coalesce(old.attempts, 0) >= 5 then
    return null;
  end if;

  select d.code into v_code from public.deals d where d.id = new.deal_id;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select dest.profile_id,
         'submission_failed',
         format('Dossiê não saiu: %s', coalesce(v_code, 'negócio sem código')),
         format('Cinco tentativas de envio à construtora falharam. Último motivo: %s',
                coalesce(left(new.last_error, 200), 'não registrado')),
         '/pipeline',
         'in_app'
    from (
      -- O cast é necessário: em `UNION`, o ramo sem FROM entra como parâmetro
      -- de tipo desconhecido e o planejador não tem de onde deduzi-lo.
      select (new.requested_by)::uuid as profile_id where new.requested_by is not null
      union
      select ur.profile_id from public.user_roles ur where ur.role = 'admin'
    ) dest
   where exists (select 1 from public.profiles p where p.id = dest.profile_id and p.status = 'active');

  return null;
end;
$$;

revoke all on function public.notify_submission_gave_up() from public, anon, authenticated;

comment on function public.notify_submission_gave_up is
  'Avisa quem pediu o envio, e o admin, quando um dossiê estoura o teto de 5 tentativas. Link para /pipeline desde a 0154: o envio mora na conferência do negócio.';
