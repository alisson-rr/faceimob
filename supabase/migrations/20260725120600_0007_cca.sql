-- =============================================================================
-- 0007 · CCA e envio para construtora
--
-- "O fluxo para as construtoras diferencia-se entre interno (analisado pelo CCA
--  da empresa) e externo (documentos enviados por e-mail automaticamente);
--  o sistema deve processar ambos os fluxos, com a automação de e-mails para
--  externos contendo os anexos do card."
--
-- Um mesmo negócio segue por um dos dois caminhos conforme developers.flow.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- cca_cases — a esteira interna de análise de crédito.
-- Um caso por negócio: reanálise reabre o mesmo caso, mantendo o histórico.
-- -----------------------------------------------------------------------------
create table public.cca_cases (
  id             uuid primary key default gen_random_uuid(),
  deal_id        uuid not null unique references public.deals(id) on delete cascade,
  status         cca_status not null default 'pending_documents',
  analyst_id     uuid references public.profiles(id) on delete set null,
  agency_name    text,
  submitted_at   timestamptz,
  decided_at     timestamptz,
  decision_notes text,
  -- Pendências abertas para o corretor resolver, em texto livre por item.
  pending_items  jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint cca_cases_decision_consistency
    check (status not in ('approved','rejected') or decided_at is not null)
);

create index cca_cases_status_idx  on public.cca_cases (status);
create index cca_cases_analyst_idx on public.cca_cases (analyst_id) where analyst_id is not null;

create trigger cca_cases_set_updated_at
  before update on public.cca_cases
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- cca_case_events — trilha de auditoria da análise, separada de deal_history
-- porque o CCA precisa consultar a própria esteira sem o ruído do funil
-- comercial.
-- -----------------------------------------------------------------------------
create table public.cca_case_events (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.cca_cases(id) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  kind       text not null,
  from_value text,
  to_value   text,
  detail     jsonb,
  created_at timestamptz not null default now()
);

create index cca_case_events_case_idx on public.cca_case_events (case_id, created_at desc);

-- -----------------------------------------------------------------------------
-- developer_submissions — fila de envio para construtora externa.
--
-- É uma fila, não um "envie agora": a edge function consome, tenta, e registra
-- falha com contador de tentativas. Sem isso, uma indisponibilidade do SMTP
-- perderia o envio silenciosamente.
-- -----------------------------------------------------------------------------
create table public.developer_submissions (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references public.deals(id) on delete cascade,
  developer_id  uuid not null references public.developers(id) on delete restrict,
  to_email      extensions.citext not null,
  cc_emails     text[],
  subject       text not null,
  body          text,
  -- Snapshot dos documentos enviados: o que foi anexado naquele envio, mesmo
  -- que o documento seja substituído depois.
  document_ids  uuid[] not null default '{}',
  status        text not null default 'queued'
                check (status in ('queued','sending','sent','failed','cancelled')),
  attempts      int not null default 0,
  last_error    text,
  sent_at       timestamptz,
  requested_by  uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index developer_submissions_pending_idx
  on public.developer_submissions (created_at)
  where status in ('queued','failed');

create trigger developer_submissions_set_updated_at
  before update on public.developer_submissions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Envio do negócio para análise. Decide o caminho pelo fluxo da construtora.
-- -----------------------------------------------------------------------------
create or replace function public.submit_deal_for_analysis(p_deal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal      public.deals;
  v_dev       public.developers;
  v_docs      uuid[];
  v_client    text;
  v_case_id   uuid;
  v_sub_id    uuid;
begin
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  if not public.can_edit_deal(p_deal_id) then
    raise exception 'Sem permissão sobre este negócio.' using errcode = '42501';
  end if;

  if v_deal.developer_id is null then
    raise exception 'Defina a construtora antes de enviar para análise.'
      using errcode = 'P0001';
  end if;

  select * into v_dev from public.developers where id = v_deal.developer_id;

  -- Documentos vigentes do negócio.
  select coalesce(array_agg(d.id order by d.created_at), '{}')
    into v_docs
  from public.deal_documents d
  where d.deal_id = p_deal_id and d.superseded_at is null;

  if array_length(v_docs, 1) is null then
    raise exception 'Nenhum documento anexado ao negócio.' using errcode = 'P0001';
  end if;

  -- Todo documento marcado como obrigatório precisa estar presente.
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
    insert into public.cca_cases (deal_id, status, submitted_at)
    values (p_deal_id, 'under_review', now())
    on conflict (deal_id) do update
      set status = 'under_review', submitted_at = now(), decided_at = null
    returning id into v_case_id;

    insert into public.cca_case_events (case_id, actor_id, kind, to_value)
    values (v_case_id, auth.uid(), 'submitted', 'under_review');

    return jsonb_build_object('flow', 'internal', 'case_id', v_case_id);
  else
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

    return jsonb_build_object('flow', 'external', 'submission_id', v_sub_id);
  end if;
end;
$$;

-- Espelha a decisão do CCA no histórico do negócio.
create or replace function public.cca_cases_log()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    insert into public.cca_case_events (case_id, actor_id, kind, from_value, to_value)
    values (new.id, auth.uid(), 'status_changed', old.status::text, new.status::text);

    insert into public.deal_history (deal_id, actor_id, kind, from_value, to_value)
    values (new.deal_id, auth.uid(), 'cca_status_changed',
            old.status::text, new.status::text);
  end if;
  return new;
end;
$$;

create trigger cca_cases_log
  after update on public.cca_cases
  for each row execute function public.cca_cases_log();

-- =============================================================================
-- RLS
--
-- O CCA enxerga toda a esteira; o comercial enxerga apenas os casos dos
-- próprios negócios. Foi exatamente a falta desse recorte que fez o Rafael
-- receber notificação de CCA sem ter o papel.
-- =============================================================================

alter table public.cca_cases             enable row level security;
alter table public.cca_case_events       enable row level security;
alter table public.developer_submissions enable row level security;

create policy cca_cases_select on public.cca_cases
  for select to authenticated
  using (public.has_any_role('admin','cca') or public.can_see_deal(deal_id));

-- Só o CCA (e admin) decide. O comercial acompanha, não altera.
create policy cca_cases_write on public.cca_cases
  for all to authenticated
  using (public.has_any_role('admin','cca'))
  with check (public.has_any_role('admin','cca'));

create policy cca_case_events_select on public.cca_case_events
  for select to authenticated
  using (
    public.has_any_role('admin','cca')
    or exists (
      select 1 from public.cca_cases c
      where c.id = cca_case_events.case_id and public.can_see_deal(c.deal_id)
    )
  );

create policy developer_submissions_select on public.developer_submissions
  for select to authenticated
  using (public.has_any_role('admin','cca') or public.can_see_deal(deal_id));

create policy developer_submissions_write on public.developer_submissions
  for all to authenticated
  using (public.has_any_role('admin','cca'))
  with check (public.has_any_role('admin','cca'));

revoke all on function public.submit_deal_for_analysis(uuid) from public, anon;
grant execute on function public.submit_deal_for_analysis(uuid) to authenticated, service_role;
