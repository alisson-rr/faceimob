-- =============================================================================
-- 0180 · Cor livre do Status 2 e avisos completos do Pipeline/CCA
--
-- A cor semântica (`tone`) continua como fallback para clientes antigos. O
-- hexadecimal é opcional e, quando preenchido, passa a ser a cor exibida.
--
-- Movimentos manuais de Status 2 avisam corretor, gerente e diretor ativos do
-- negócio. Movimentos feitos pela RPC da CCA já avisam corretor e gerente
-- (0155); o gatilho complementar abaixo inclui os diretores sem duplicar os
-- demais destinatários.
-- =============================================================================

alter table public.deal_statuses
  add column if not exists color text
  constraint deal_statuses_color_hex
  check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');

comment on column public.deal_statuses.color is
  'Cor livre #RRGGBB do Status 2. Nulo mantém a cor semântica de tone como fallback (0180).';

create or replace function public.push_category(p_kind text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_kind = 'lead_assigned' then 'lead_recebido'
    when p_kind in ('lead_lost_timeout', 'lead_no_response', 'lead_unattended', 'task_due')
      then 'lead_prazo'
    when p_kind in ('lead_comment', 'task_assigned', 'visit_scheduled',
                    'whatsapp_human_turn', 'whatsapp_unmatched')
      then 'lead_atividade'
    when p_kind in ('cca_pending', 'cca_status_changed', 'deal_status_changed', 'submission_failed',
                    'document_review_requested', 'document_review_approved', 'document_review_returned')
      then 'credito'
    when p_kind like 'lead\_%' then 'lead_atividade'
    when p_kind like 'cca\_%' or p_kind like 'document\_review\_%' then 'credito'
    else 'outros'
  end;
$$;

revoke all on function public.push_category(text) from public, anon;
grant execute on function public.push_category(text) to authenticated, service_role;

create or replace function public.notify_deal_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_name text;
  v_client     text;
  v_from       text;
  v_to         text;
begin
  if auth.uid() is null
     or new.status_detail is not distinct from old.status_detail
     or coalesce(current_setting('faceimob.cca_move', true), '') = 'on' then
    return null;
  end if;

  select p.full_name into v_actor_name
    from public.profiles p where p.id = auth.uid();
  select c.full_name into v_client
    from public.deal_clients c where c.deal_id = new.id and c.ordinal = 1;
  select s.label into v_from
    from public.deal_statuses s
   where public.deal_status_bare(s.value) = public.deal_status_bare(old.status_detail);
  select s.label into v_to
    from public.deal_statuses s
   where public.deal_status_bare(s.value) = public.deal_status_bare(new.status_detail);

  v_from := coalesce(v_from, public.deal_status_bare(old.status_detail), 'Sem Status 2');
  v_to := coalesce(v_to, public.deal_status_bare(new.status_detail), 'Sem Status 2');

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct dp.profile_id,
         'deal_status_changed',
         format('%s foi para %s', coalesce(v_client, new.code, 'Negócio'), v_to),
         left(format('%s mudou o Status 2 de "%s" para "%s".',
                     coalesce(v_actor_name, 'Alguém'), v_from, v_to), 2000),
         '/pipeline',
         'in_app'::public.notification_channel
    from public.deal_participants dp
    join public.profiles p on p.id = dp.profile_id and p.status = 'active'
   where dp.deal_id = new.id
     and dp.role in ('broker', 'manager', 'director')
     and dp.profile_id <> auth.uid();

  return null;
end;
$$;

comment on function public.notify_deal_status_changed() is
  'Avisa corretor, gerente e diretor ativos quando alguém move o Status 2 fora da ação da CCA (0180).';

revoke all on function public.notify_deal_status_changed() from public, anon, authenticated;

drop trigger if exists notify_deal_status_changed on public.deals;
create trigger notify_deal_status_changed
  after update of status_detail on public.deals
  for each row
  when (old.status_detail is distinct from new.status_detail)
  execute function public.notify_deal_status_changed();

-- As RPCs de conferência já avisam o gerente no envio e os corretores no
-- retorno/aprovação. O diretor é participante do mesmo negócio e precisa
-- acompanhar o movimento no app também.
create or replace function public.notify_document_review_directors()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client text;
  v_label  text;
  v_kind   text;
begin
  if auth.uid() is null
     or new.document_review_status is not distinct from old.document_review_status then
    return null;
  end if;

  v_label := case new.document_review_status
    when 'pending'  then 'Análise enviada para conferência'
    when 'approved' then 'Documentação aprovada pelo gerente'
    when 'returned' then 'Documentação devolvida pelo gerente'
    else 'Conferência documental atualizada'
  end;
  v_kind := case new.document_review_status
    when 'pending'  then 'document_review_requested'
    when 'approved' then 'document_review_approved'
    when 'returned' then 'document_review_returned'
    else 'document_review_changed'
  end;
  select c.full_name into v_client
    from public.deal_clients c where c.deal_id = new.id and c.ordinal = 1;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct dp.profile_id,
         v_kind,
         v_label || ': ' || coalesce(v_client, new.code, 'negócio'),
         case when new.document_review_reason is not null
              then left(new.document_review_reason, 2000)
              else null end,
         '/pipeline',
         'in_app'::public.notification_channel
    from public.deal_participants dp
    join public.profiles p on p.id = dp.profile_id and p.status = 'active'
   where dp.deal_id = new.id
     and dp.role = 'director'
     and dp.profile_id <> auth.uid();

  return null;
end;
$$;

revoke all on function public.notify_document_review_directors() from public, anon, authenticated;

drop trigger if exists notify_document_review_directors on public.deals;
create trigger notify_document_review_directors
  after update of document_review_status on public.deals
  for each row
  when (old.document_review_status is distinct from new.document_review_status)
  execute function public.notify_document_review_directors();

-- A RPC `move_cca_case` da 0155 cria o aviso de corretor/gerente depois do
-- UPDATE. Durante o UPDATE ela mantém `faceimob.cca_move=on`, sinal usado aqui
-- para incluir somente o diretor e não gerar aviso dobrado.
create or replace function public.notify_cca_director_move()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stage      public.cca_stages;
  v_actor_name text;
  v_code       text;
  v_client     text;
begin
  if auth.uid() is null
     or new.stage_id is not distinct from old.stage_id
     or coalesce(current_setting('faceimob.cca_move', true), '') <> 'on' then
    return null;
  end if;

  select * into v_stage from public.cca_stages where id = new.stage_id;
  if not found or not v_stage.notify_sales then return null; end if;

  select p.full_name into v_actor_name
    from public.profiles p where p.id = auth.uid();
  select d.code, c.full_name into v_code, v_client
    from public.deals d
    left join public.deal_clients c on c.deal_id = d.id and c.ordinal = 1
   where d.id = new.deal_id;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct dp.profile_id,
         'cca_status_changed',
         format('%s foi para %s', coalesce(v_client, v_code, 'Negócio'), v_stage.name),
         left(format('%s moveu a análise de crédito para "%s".',
                     coalesce(v_actor_name, 'Alguém'), v_stage.name), 2000),
         '/pipeline',
         'in_app'::public.notification_channel
    from public.deal_participants dp
    join public.profiles p on p.id = dp.profile_id and p.status = 'active'
   where dp.deal_id = new.deal_id
     and dp.role = 'director'
     and dp.profile_id <> auth.uid();

  return null;
end;
$$;

comment on function public.notify_cca_director_move() is
  'Completa o aviso de move_cca_case: inclui os diretores ativos quando a coluna avisa o comercial (0180).';

revoke all on function public.notify_cca_director_move() from public, anon, authenticated;

drop trigger if exists notify_cca_director_move on public.cca_cases;
create trigger notify_cca_director_move
  after update of stage_id on public.cca_cases
  for each row
  when (old.stage_id is distinct from new.stage_id)
  execute function public.notify_cca_director_move();

-- Mudanças de status do crédito que não passam por `move_cca_case` já avisam o
-- corretor pelo gatilho da 0150. Este complemento inclui os líderes.
create or replace function public.notify_cca_leaders_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_name text;
  v_code       text;
  v_client     text;
  v_label      text;
begin
  if auth.uid() is null
     or new.status is not distinct from old.status
     or coalesce(current_setting('faceimob.cca_move', true), '') = 'on' then
    return null;
  end if;

  select p.full_name into v_actor_name
    from public.profiles p where p.id = auth.uid();
  select d.code, c.full_name into v_code, v_client
    from public.deals d
    left join public.deal_clients c on c.deal_id = d.id and c.ordinal = 1
   where d.id = new.deal_id;
  select s.name into v_label from public.cca_stages s where s.id = new.stage_id;
  v_label := coalesce(v_label, new.status::text);

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct dp.profile_id,
         'cca_status_changed',
         format('%s foi para %s', coalesce(v_client, v_code, 'Negócio'), v_label),
         left(format('%s atualizou a análise de crédito para "%s".',
                     coalesce(v_actor_name, 'Alguém'), v_label), 2000),
         '/pipeline',
         'in_app'::public.notification_channel
    from public.deal_participants dp
    join public.profiles p on p.id = dp.profile_id and p.status = 'active'
   where dp.deal_id = new.deal_id
     and dp.role in ('manager', 'director')
     and dp.profile_id <> auth.uid();

  return null;
end;
$$;

revoke all on function public.notify_cca_leaders_status_changed() from public, anon, authenticated;

drop trigger if exists notify_cca_leaders_status_changed on public.cca_cases;
create trigger notify_cca_leaders_status_changed
  after update of status on public.cca_cases
  for each row
  when (old.status is distinct from new.status)
  execute function public.notify_cca_leaders_status_changed();

