-- =============================================================================
-- 0177 — e-mail de movimentação com o Status 2 em evidência
--
-- Pedido do cliente em 30/09/2026 (modelo aprovado): assunto
-- "STATUS 2 | CLIENTE | CPF | EMPREENDIMENTO | CORRETOR 1 | GERENTE 1 |
-- CORRETOR 2 | GERENTE 2" e corpo com o Status 2 em destaque, os dados do
-- negócio, a observação e o logo. Vale para o e-mail do Pipeline e o da CCA.
--
-- · `email_detalhes_do_negocio`: os dados do negócio num JSON só, para a fila
--   e para o envio (a edge chama para as linhas da CCA, que não os gravam);
-- · `cca_move_emails.detalhes`: o retrato na hora da troca (Pipeline);
-- · `move_deal_status` passa a observação ao gatilho do e-mail por
--   `faceimob.status_note` — a linha do histórico nasce depois da troca, tarde
--   demais para o e-mail. O resto das duas funções é o da 0164 e da 0157.
-- =============================================================================

alter table public.cca_move_emails add column if not exists detalhes jsonb;

create or replace function public.email_detalhes_do_negocio(p_deal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with d as (select * from public.deals where id = p_deal_id),
  gente as (
    select dp.role, pr.full_name,
           row_number() over (partition by dp.role order by dp.ordinal, dp.created_at, dp.id) as n
      from public.deal_participants dp
      join public.profiles pr on pr.id = dp.profile_id
     where dp.deal_id = p_deal_id and dp.role in ('broker', 'manager')
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'codigo', d.code,
    'cliente', (select full_name from public.deal_clients where deal_id = d.id order by ordinal limit 1),
    'cpf', (select cpf from public.deal_clients where deal_id = d.id order by ordinal limit 1),
    'empreendimento', coalesce(nullif(btrim(d.project_name), ''),
                               (select name from public.developer_projects where id = d.project_id)),
    'construtora', (select name from public.developers where id = d.developer_id),
    'status1', (select label from public.deal_status_groups where id = d.status_group_id),
    'status2', coalesce((select label from public.deal_statuses where value = d.status_detail),
                        public.deal_status_bare(d.status_detail)),
    'status2_tom', (select tone from public.deal_statuses where value = d.status_detail),
    'corretor1', (select full_name from gente where role = 'broker' and n = 1),
    'corretor2', (select full_name from gente where role = 'broker' and n = 2),
    'gerente1', (select full_name from gente where role = 'manager' and n = 1),
    'gerente2', (select full_name from gente where role = 'manager' and n = 2),
    'quando', to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI')
  ))
  from d;
$$;

revoke all on function public.email_detalhes_do_negocio(uuid) from public, anon, authenticated;
grant execute on function public.email_detalhes_do_negocio(uuid) to service_role;

comment on function public.email_detalhes_do_negocio(uuid) is
  'Dados do negócio para o e-mail de movimentação (cliente, CPF, empreendimento, corretores, gerentes, status). Só service_role e gatilhos (0177).';

create or replace function public.move_deal_status(p_deal_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal  public.deals;
  v_to    public.deal_statuses;
  v_note  text := btrim(coalesce(p_note, ''));
  v_block text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found or not public.can_edit_deal(p_deal_id) then
    raise exception 'Negócio não encontrado ou fora do seu acesso.' using errcode = '42501';
  end if;

  if not public.has_permission('deals.edit_status_detail') then
    raise exception 'Seu perfil não pode alterar o Status 2.' using errcode = '42501';
  end if;

  select * into v_to from public.deal_statuses
   where public.deal_status_bare(value) = public.deal_status_bare(p_status) and active
   limit 1;
  if not found then
    raise exception 'Este Status 2 não está ativo no cadastro.' using errcode = 'P0001';
  end if;

  if public.deal_status_bare(v_to.value) is not distinct from public.deal_status_bare(v_deal.status_detail) then
    return;
  end if;

  -- A volta para a análise reabre a conferência e o caso da CCA: é o envio ao
  -- gerente, não uma troca de rótulo.
  if public.deal_status_bare(v_to.value) in ('ESTEIRA AGIL', 'RET. ESTEIRA AGIL', 'ANÁLISE P/ VIRAR NEGÓCIO') then
    raise exception 'Para voltar à análise, use "Enviar para análise": o envio ao gerente leva a observação.'
      using errcode = 'P0001';
  end if;

  -- Encerrar pede o motivo e passa pelo diálogo de perda.
  if public.deal_status_bare(v_to.value) in ('DISTRATO', 'QUEDA', 'REPROVADO', 'OFF') then
    raise exception 'Para encerrar o negócio, use "Perder negócio" com o motivo.' using errcode = 'P0001';
  end if;

  v_block := public.deal_status_move_block(v_deal.status_detail, v_to.value);
  if v_block is not null then
    raise exception '%', v_block using errcode = '42501';
  end if;

  if v_to.requires_note and v_note = '' then
    raise exception 'Escreva a observação para mover para "%".', v_to.label using errcode = 'P0001';
  end if;
  if length(v_note) > 2000 then
    raise exception 'Observação longa demais (máx. 2000 caracteres).' using errcode = 'P0001';
  end if;

  -- 0177: a observação vai para o e-mail de movimentação, que sai do gatilho
  -- desta mesma troca — antes da linha do histórico logo abaixo.
  perform set_config('faceimob.status_note', v_note, true);
  update public.deals set status_detail = v_to.value where id = p_deal_id;

  if v_note <> '' then
    insert into public.deal_history (deal_id, actor_id, kind, to_value)
    values (p_deal_id, auth.uid(), 'comment', v_to.label || ': ' || v_note);
  end if;
end;
$$;

revoke all on function public.move_deal_status(uuid, text, text) from public, anon;
grant execute on function public.move_deal_status(uuid, text, text) to authenticated, service_role;

create or replace function public.deals_queue_status_email()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_message text;
  v_actor text;
  v_client text;
  v_status1 text;
  v_status2 text;
begin
  if new.status_group_id is not distinct from old.status_group_id
     and new.status_detail is not distinct from old.status_detail then return null; end if;
  -- A ação da CCA já possui aviso/e-mail e respeita "Avisar o comercial".
  if coalesce(current_setting('faceimob.cca_move', true), '') = 'on' then return null; end if;
  if not coalesce((select pipeline_move_email from public.automation_settings where id), false) then return null; end if;
  select full_name into v_actor from public.profiles where id = auth.uid();
  select full_name into v_client from public.deal_clients where deal_id = new.id and ordinal = 1;
  select label into v_status1 from public.deal_status_groups where id = new.status_group_id;
  select label into v_status2 from public.deal_statuses where value = new.status_detail;
  v_status2 := coalesce(v_status2, public.deal_status_bare(new.status_detail), 'Sem Status 2');
  v_message := concat_ws(E'\n',
    case when new.status_group_id is distinct from old.status_group_id then
      'Status 1: ' || coalesce((select label from public.deal_status_groups where id = old.status_group_id), 'Sem Status 1')
        || ' → ' || coalesce(v_status1, 'Sem Status 1') end,
    case when new.status_detail is distinct from old.status_detail then
      'Status 2: ' || coalesce(public.deal_status_bare(old.status_detail), 'Sem Status 2') || ' → ' || v_status2 end);
  insert into public.cca_move_emails
    (deal_id, profile_id, to_email, deal_code, client_name, stage_name, actor_name, message, source, detalhes)
  select distinct on (lower(btrim(p.email::text))) new.id, p.id, btrim(p.email::text),
    new.code, v_client, concat_ws(' · ', v_status1, v_status2), coalesce(v_actor, 'Sistema'), v_message, 'pipeline',
    public.email_detalhes_do_negocio(new.id) || jsonb_strip_nulls(jsonb_build_object(
      'status2_antes', case when new.status_detail is distinct from old.status_detail
                            then coalesce((select label from public.deal_statuses where value = old.status_detail),
                                          public.deal_status_bare(old.status_detail)) end,
      'observacao', nullif(btrim(coalesce(current_setting('faceimob.status_note', true), '')), '')))
  from public.deal_participants dp join public.profiles p on p.id = dp.profile_id
  where dp.deal_id = new.id and dp.role in ('broker', 'manager', 'director')
    and p.status = 'active'
    and btrim(p.email::text) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    and p.email::text !~* '@sem-email\.local$'
  order by lower(btrim(p.email::text)), p.id;
  return null;
end;
$$;

revoke all on function public.deals_queue_status_email() from public, anon, authenticated;
