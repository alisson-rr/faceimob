-- =============================================================================
-- 0277 · Reativar OFF/Distrato/Queda pela aba Negócio e mudar a construtora de
--        um negócio que virou negócio
--
-- Pedido de 14/10/2026.
--
-- 1. `reativar_negocio`: gerente, diretor, sócio e administrador reativam um
--    negócio em OFF, DISTRATO ou QUEDA. Ele volta para INCOMPLETO no mês atual,
--    na etapa inicial, e o motivo da reativação é obrigatório. A `reactivate_deal`
--    (0236) segue como está para a lista do Pipeline: ela só cobre OFF de mês
--    anterior. As duas pedem o corretor: quem reativa escolhe a quem o negócio vai,
--    porque o corretor antigo pode não ser o mesmo que está pegando de volta.
--
-- 2. `mudar_construtora_do_negocio`: com o Status 2 em VIROU NEGÓCIO, troca a
--    construtora e o empreendimento (ambos obrigatórios, mais o comentário) e
--    devolve o negócio à CCA em ANÁLISE P/ VIRAR NEGÓCIO para uma nova virada,
--    marcado com `construtora_trocada_em` (a CCA mostra o selo "Troca construtora").
-- =============================================================================

alter table public.deals add column if not exists construtora_trocada_em timestamptz;
comment on column public.deals.construtora_trocada_em is
  'Quando a construtora foi trocada depois de virar negócio (0277). Dá o selo "Troca construtora" enquanto o caso não vira negócio de novo.';

create or replace function public.reativar_negocio(p_deal_id uuid, p_motivo text, p_broker_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor         uuid := auth.uid();
  v_deal          public.deals;
  v_motivo        text := btrim(coalesce(p_motivo, ''));
  v_atual         text;
  v_current_month date;
  v_initial_stage uuid;
  v_incomplete    text;
  v_client        text;
  v_actor_name    text;
  v_broker_name   text;
begin
  if v_actor is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;

  if not (public.is_admin() or public.has_any_role('admin', 'partner', 'manager', 'director')) then
    raise exception 'Só gerente, diretor, sócio e administrador reativam um negócio encerrado.'
      using errcode = '42501';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found or not public.can_edit_deal(p_deal_id) then
    raise exception 'Negócio não encontrado ou fora do seu acesso.' using errcode = '42501';
  end if;

  v_atual := public.deal_status_bare(v_deal.status_detail);
  if v_atual not in ('OFF', 'DISTRATO', 'QUEDA') then
    raise exception 'Só negócio em OFF, Distrato ou Queda pode ser reativado.' using errcode = 'P0001';
  end if;

  if length(v_motivo) < 5 then
    raise exception 'Escreva o motivo da reativação (pelo menos 5 caracteres).' using errcode = 'P0001';
  end if;
  if length(v_motivo) > 2000 then
    raise exception 'Motivo longo demais (máx. 2000 caracteres).' using errcode = 'P0001';
  end if;

  -- Quem reativa escolhe o corretor: o antigo pode já não ser quem pega o negócio de volta.
  if p_broker_id is null then
    raise exception 'Escolha o corretor que receberá o negócio.' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles p
     where p.id = p_broker_id and p.status = 'active'
       and exists (select 1 from public.user_roles ur where ur.profile_id = p.id and ur.role = 'broker')
  ) then
    raise exception 'O corretor escolhido não existe ou está inativo.' using errcode = 'P0002';
  end if;
  if not public.is_admin() and not public.has_any_role('admin', 'partner') and not exists (
    select 1 from public.team_members tm
      join public.teams t on t.id = tm.team_id and t.active
     where tm.profile_id = p_broker_id and tm.left_at is null
       and (t.manager_id = v_actor or t.director_id = v_actor)
  ) then
    raise exception 'Escolha um corretor da sua equipe.' using errcode = '42501';
  end if;

  v_current_month := public.month_start(coalesce(public.current_season_month(), current_date));

  select id into v_initial_stage from public.pipeline_stages where active and is_initial limit 1;
  if v_initial_stage is null then
    raise exception 'A etapa inicial do Pipeline não está cadastrada.' using errcode = 'P0003';
  end if;
  select s.value into v_incomplete from public.deal_statuses s
   where s.active and public.deal_status_bare(s.value) = 'INCOMPLETO'
   order by s.position, s.id limit 1;
  if v_incomplete is null then
    raise exception 'O Status 2 INCOMPLETO não está cadastrado.' using errcode = 'P0003';
  end if;

  -- Mesmas exceções da `reactivate_deal`, presas a esta linha e a esta transação:
  -- o mês-base antigo pode estar fechado e os avisos da esteira já não valem.
  perform set_config('faceimob.reactivate_deal', p_deal_id::text, true);
  perform set_config('faceimob.cca_move', 'on', true);
  perform set_config('faceimob.status_note', v_motivo, true);

  update public.cca_cases
     set status = 'cancelled', decided_at = now(),
         decision_notes = 'Caso encerrado automaticamente pela reativação do negócio.'
   where deal_id = p_deal_id and status not in ('approved', 'rejected', 'cancelled');

  update public.deals
     set outcome = 'open', month_base = v_current_month,
         stage_id = v_initial_stage, stage_entered_at = now(),
         status_detail = v_incomplete, lost_reason = null, closed_at = null,
         document_review_status = 'draft',
         document_review_requested_at = null,
         document_review_requested_by = null,
         document_reviewed_at = null,
         document_reviewed_by = null,
         document_review_reason = null,
         review_esteira = null,
         construtora_trocada_em = null
   where id = p_deal_id;

  -- A equipe é refeita a partir do corretor escolhido: `deal_participants_autofill`
  -- traz o gerente e o diretor da equipe ativa dele.
  delete from public.deal_participants where deal_id = p_deal_id;
  insert into public.deal_participants (deal_id, profile_id, role, share_pct, auto_added)
  values (p_deal_id, p_broker_id, 'broker', 100, false);

  insert into public.deal_history (deal_id, actor_id, kind, from_value, to_value, detail)
  values (p_deal_id, v_actor, 'reactivated', v_deal.status_detail, v_incomplete,
          jsonb_build_object('old_month', to_char(v_deal.month_base, 'MM/YYYY'),
                             'new_month', to_char(v_current_month, 'MM/YYYY'),
                             'broker_id', p_broker_id,
                             'motivo', v_motivo));
  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, v_actor, 'comment', 'REATIVAÇÃO (' || v_atual || '): ' || v_motivo);

  perform set_config('faceimob.cca_move', '', true);

  select full_name into v_actor_name from public.profiles where id = v_actor;
  select full_name into v_broker_name from public.profiles where id = p_broker_id;
  select full_name into v_client from public.deal_clients where deal_id = p_deal_id and ordinal = 1;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct ur.profile_id, 'deal_status_changed',
         'Negócio reativado: ' || coalesce(v_client, v_deal.code),
         left(format('%s reativou o %s de %s para %s como INCOMPLETO em %s. Motivo: %s',
           coalesce(v_actor_name, 'Alguém'), v_atual, to_char(v_deal.month_base, 'MM/YYYY'),
           coalesce(v_broker_name, 'corretor não identificado'),
           to_char(v_current_month, 'MM/YYYY'), v_motivo), 2000),
         '/pipeline?negocio=' || p_deal_id, 'in_app'::public.notification_channel
    from public.user_roles ur
    join public.profiles p on p.id = ur.profile_id and p.status = 'active'
   where ur.role = 'admin' and ur.profile_id <> v_actor;

  return jsonb_build_object('deal_id', p_deal_id, 'reactivated', true,
                            'new_month', to_char(v_current_month, 'MM/YYYY'), 'broker_id', p_broker_id, 'status', v_incomplete);
end;
$$;

revoke all on function public.reativar_negocio(uuid, text, uuid) from public, anon;
grant execute on function public.reativar_negocio(uuid, text, uuid) to authenticated, service_role;
comment on function public.reativar_negocio(uuid, text, uuid) is
  'Reativa OFF, DISTRATO ou QUEDA como INCOMPLETO no mês atual, para o corretor escolhido e com motivo obrigatório. Gerente, diretor, sócio e administrador (0277).';

-- -----------------------------------------------------------------------------

create or replace function public.mudar_construtora_do_negocio(
  p_deal_id uuid,
  p_developer_id uuid,
  p_project text,
  p_comentario text,
  p_project_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor      uuid := auth.uid();
  v_deal       public.deals;
  v_comment    text := btrim(coalesce(p_comentario, ''));
  v_project    text := btrim(coalesce(p_project, ''));
  v_project_id uuid := p_project_id;
  v_new_dev    text;
  v_old_dev    text;
  v_target     text;
  v_client     text;
begin
  if v_actor is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado ou fora do seu acesso.' using errcode = '42501';
  end if;
  if not (public.is_admin()
          or public.has_role('cca')
          or (public.has_any_role('broker', 'manager', 'director') and public.can_edit_deal(p_deal_id))) then
    raise exception 'Seu perfil não troca a construtora deste negócio.' using errcode = '42501';
  end if;

  if public.deal_status_bare(v_deal.status_detail) not in ('VIROU NEGÓCIO', 'VIROU NEGÓCIO COM PENDÊNCIAS') then
    raise exception 'A construtora só muda com o Status 2 em VIROU NEGÓCIO.' using errcode = 'P0001';
  end if;

  if length(v_comment) < 5 then
    raise exception 'Escreva o comentário da troca (pelo menos 5 caracteres).' using errcode = 'P0001';
  end if;
  if length(v_comment) > 2000 then
    raise exception 'Comentário longo demais (máx. 2000 caracteres).' using errcode = 'P0001';
  end if;
  if length(v_project) < 2 then
    raise exception 'Informe o empreendimento da nova construtora.' using errcode = 'P0001';
  end if;
  if length(v_project) > 120 then
    raise exception 'Nome do empreendimento longo demais (máx. 120 caracteres).' using errcode = 'P0001';
  end if;

  select d.name into v_new_dev from public.developers d where d.id = p_developer_id and d.active;
  if v_new_dev is null then
    raise exception 'A construtora escolhida não existe ou está inativa.' using errcode = 'P0002';
  end if;
  if p_developer_id is not distinct from v_deal.developer_id then
    raise exception 'Escolha uma construtora diferente da atual.' using errcode = 'P0001';
  end if;
  select d.name into v_old_dev from public.developers d where d.id = v_deal.developer_id;

  -- Empreendimento cadastrado vincula o id; o texto livre também vale (0160).
  if v_project_id is not null and not exists (
    select 1 from public.developer_projects pr where pr.id = v_project_id and pr.developer_id = p_developer_id
  ) then
    v_project_id := null;
  end if;
  if v_project_id is null then
    select pr.id into v_project_id from public.developer_projects pr
     where pr.developer_id = p_developer_id and lower(pr.name) = lower(v_project) limit 1;
  end if;

  select s.value into v_target from public.deal_statuses s
   where s.active and public.deal_status_bare(s.value) = 'ANÁLISE P/ VIRAR NEGÓCIO'
   order by s.position, s.id limit 1;
  if v_target is null then
    raise exception 'O Status 2 ANÁLISE P/ VIRAR NEGÓCIO não está ativo no cadastro.' using errcode = 'P0003';
  end if;

  perform set_config('faceimob.cca_move', 'on', true);
  perform set_config('faceimob.status_note', v_comment, true);

  update public.deals
     set developer_id = p_developer_id, project_id = v_project_id, project_name = v_project,
         unit = null, status_detail = v_target, review_esteira = 'virar',
         construtora_trocada_em = now()
   where id = p_deal_id;

  -- O caso volta a ser analisado: a CCA enxerga o cartão de novo na coluna do Status 2.
  -- Uma nova entrada (`submitted_at`) faz o gatilho `cca_cases_sync_esteira_label`
  -- escolher o Status 2 pelo `review_esteira` — "virar" dá ANÁLISE P/ VIRAR NEGÓCIO;
  -- sem isso ele cairia em ESTEIRA ÁGIL.
  update public.cca_cases
     set status = 'under_review', decided_at = null, submitted_at = now()
   where deal_id = p_deal_id;
  if not found then
    insert into public.cca_cases (deal_id, status, submitted_at) values (p_deal_id, 'under_review', now());
  end if;

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, v_actor, 'comment',
          'CONSTRUTORA ALTERADA: ' || coalesce(v_old_dev, 'sem construtora') || ' → ' || v_new_dev
          || ' (' || v_project || '). De volta à CCA para nova virada de negócio: ' || v_comment);

  perform set_config('faceimob.cca_move', '', true);

  select full_name into v_client from public.deal_clients where deal_id = p_deal_id and ordinal = 1;
  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct ur.profile_id, 'deal_status_changed',
         'Nova virada de negócio: ' || coalesce(v_client, v_deal.code),
         left(format('Construtora trocada de %s para %s (%s). %s',
           coalesce(v_old_dev, '—'), v_new_dev, v_project, v_comment), 2000),
         '/cca?negocio=' || p_deal_id, 'in_app'::public.notification_channel
    from public.user_roles ur
    join public.profiles p on p.id = ur.profile_id and p.status = 'active'
   where ur.role = 'cca' and ur.profile_id <> v_actor;

  return jsonb_build_object('deal_id', p_deal_id, 'developer', v_new_dev, 'project', v_project, 'status', v_target);
end;
$$;

revoke all on function public.mudar_construtora_do_negocio(uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.mudar_construtora_do_negocio(uuid, uuid, text, text, uuid) to authenticated, service_role;
comment on function public.mudar_construtora_do_negocio(uuid, uuid, text, text, uuid) is
  'Com o Status 2 em VIROU NEGÓCIO, troca construtora e empreendimento (obrigatórios, com comentário) e devolve o negócio à CCA em ANÁLISE P/ VIRAR NEGÓCIO (0277).';
