-- =============================================================================
-- Fila global do CCA, reativação segura de OFF e regra temporal de perda
-- =============================================================================

-- O ranking precisa ser calculado ANTES do filtro do corretor. Se filtrarmos
-- primeiro, o negócio mais antigo de cada corretor seria sempre o número 1.
create or replace function public.my_cca_queue_position()
returns table(deal_id uuid, deal_code text, client_name text,
              queue_position integer, submitted_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  with ranked as (
    select c.deal_id, c.submitted_at,
           row_number() over (order by c.submitted_at asc nulls last, c.id) as position
      from public.cca_cases c
     where c.status not in ('approved', 'rejected', 'cancelled')
  )
  select r.deal_id, d.code,
         coalesce(dc.full_name, d.code, 'Cliente não informado'),
         r.position::integer, r.submitted_at
    from ranked r
    join public.deals d on d.id = r.deal_id
    left join public.deal_clients dc on dc.deal_id = d.id and dc.ordinal = 1
   where exists (
     select 1 from public.deal_participants dp
      where dp.deal_id = r.deal_id and dp.profile_id = auth.uid() and dp.role = 'broker'
   )
   order by r.position;
$$;
revoke all on function public.my_cca_queue_position() from public, anon;
grant execute on function public.my_cca_queue_position() to authenticated;
comment on function public.my_cca_queue_position() is
  'Posição GLOBAL dos dossiês do corretor entre todos os casos ativos do CCA.';

-- Movimentos internos já usam `faceimob.cca_move` para não duplicar avisos.
-- A reativação também troca a conferência para rascunho e precisa respeitar o
-- mesmo silêncio: antigos responsáveis perderam o controle depois do OFF.
create or replace function public.notify_document_review_directors()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_client text;
  v_label text;
  v_kind text;
begin
  if auth.uid() is null
     or new.document_review_status is not distinct from old.document_review_status
     or coalesce(current_setting('faceimob.cca_move', true), '') = 'on' then
    return null;
  end if;
  v_label := case new.document_review_status
    when 'pending' then 'Análise enviada para conferência'
    when 'approved' then 'Documentação aprovada pela liderança'
    when 'returned' then 'Documentação devolvida pela liderança'
    else 'Conferência documental atualizada' end;
  v_kind := case new.document_review_status
    when 'pending' then 'document_review_requested'
    when 'approved' then 'document_review_approved'
    when 'returned' then 'document_review_returned'
    else 'document_review_changed' end;
  select c.full_name into v_client from public.deal_clients c
   where c.deal_id = new.id and c.ordinal = 1;
  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct dp.profile_id, v_kind,
         v_label || ': ' || coalesce(v_client, new.code, 'negócio'),
         case when new.document_review_reason is not null
              then left(new.document_review_reason, 2000) end,
         '/pipeline', 'in_app'::public.notification_channel
    from public.deal_participants dp
    join public.profiles p on p.id = dp.profile_id and p.status = 'active'
   where dp.deal_id = new.id and dp.role = 'director'
     and dp.profile_id <> auth.uid();
  return null;
end;
$$;
revoke all on function public.notify_document_review_directors() from public, anon, authenticated;

-- Exceção vinculada ao UUID da linha e só à transação. Não se desliga trigger
-- da tabela: ALTER TABLE abriria uma janela global para outras gravações.
create or replace function public.deals_guard_closed_month()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_period date := coalesce(new.month_base, old.month_base);
  v_reactivation text := coalesce(current_setting('faceimob.reactivate_deal', true), '');
begin
  if public.is_admin() or v_reactivation = new.id::text then return new; end if;
  if exists (select 1 from public.closed_months cm where cm.period = v_period) then
    raise exception 'O mês % está fechado. Fale com o administrador para reabrir.',
      to_char(v_period, 'MM/YYYY') using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.reactivate_deal(p_deal_id uuid, p_broker_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_deal public.deals;
  v_actor uuid := auth.uid();
  v_current_month date;
  v_initial_stage uuid;
  v_incomplete text;
  v_target_broker uuid;
  v_actor_name text;
  v_broker_name text;
  v_client_name text;
  v_is_admin boolean;
  v_is_leader boolean;
  v_is_broker_only boolean;
begin
  if v_actor is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;

  v_is_admin := public.has_any_role('admin', 'partner');
  v_is_leader := public.has_any_role('manager', 'director');
  v_is_broker_only := public.has_role('broker') and not v_is_admin and not v_is_leader;
  if not (v_is_admin or v_is_leader or v_is_broker_only) then
    raise exception 'Seu perfil não pode reativar propostas.' using errcode = '42501';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Negócio não encontrado.' using errcode = 'P0002'; end if;
  if public.deal_status_bare(v_deal.status_detail) <> 'OFF' then
    raise exception 'Somente propostas com Status 2 OFF podem ser reativadas.' using errcode = 'P0001';
  end if;

  v_current_month := public.month_start(coalesce(public.current_season_month(), current_date));
  if v_deal.month_base >= v_current_month then
    raise exception 'Só é possível reativar OFF de mês anterior ao vigente (%).',
      to_char(v_current_month, 'MM/YYYY') using errcode = 'P0001';
  end if;

  -- Impede que uma função SECURITY DEFINER seja usada para adivinhar UUID de
  -- proposta fora do escopo da liderança.
  if not v_is_admin and not exists (
    select 1 from public.deal_participants dp
     where dp.deal_id = p_deal_id and dp.profile_id = v_actor
  ) then
    raise exception 'Esta proposta não pertence à sua equipe.' using errcode = '42501';
  end if;

  if v_is_broker_only then
    if not exists (
      select 1 from public.deal_participants dp
       where dp.deal_id = p_deal_id and dp.profile_id = v_actor and dp.role = 'broker'
    ) then
      raise exception 'Você só pode reativar propostas que eram suas.' using errcode = '42501';
    end if;
    v_target_broker := v_actor;
  else
    if p_broker_id is null then
      raise exception 'Escolha o corretor que receberá a proposta.' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.profiles p
       where p.id = p_broker_id and p.status = 'active'
         and exists (select 1 from public.user_roles ur
                      where ur.profile_id = p.id and ur.role = 'broker')
    ) then
      raise exception 'O corretor escolhido não existe ou está inativo.' using errcode = 'P0002';
    end if;
    if not v_is_admin and not exists (
      select 1 from public.team_members tm
      join public.teams t on t.id = tm.team_id and t.active
       where tm.profile_id = p_broker_id and tm.left_at is null
         and (t.manager_id = v_actor or t.director_id = v_actor)
    ) then
      raise exception 'Escolha um corretor da sua equipe.' using errcode = '42501';
    end if;
    v_target_broker := p_broker_id;
  end if;

  select id into v_initial_stage from public.pipeline_stages
   where active and is_initial limit 1;
  if v_initial_stage is null then
    raise exception 'A etapa inicial do Pipeline não está cadastrada.' using errcode = 'P0003';
  end if;
  select s.value into v_incomplete from public.deal_statuses s
   where s.active and public.deal_status_bare(s.value) = 'INCOMPLETO'
   order by s.position, s.id limit 1;
  if v_incomplete is null then
    raise exception 'O Status 2 INCOMPLETO não está cadastrado.' using errcode = 'P0003';
  end if;

  -- Silencia avisos automáticos da antiga equipe. Depois é criado um aviso
  -- específico somente para administradores.
  perform set_config('faceimob.reactivate_deal', p_deal_id::text, true);
  perform set_config('faceimob.cca_move', 'on', true);

  update public.cca_cases
     set status = 'cancelled', decided_at = now(),
         decision_notes = 'Caso encerrado automaticamente pela reativação comercial.'
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
         review_esteira = null
   where id = p_deal_id;

  delete from public.deal_participants where deal_id = p_deal_id;
  insert into public.deal_participants (deal_id, profile_id, role, share_pct, auto_added)
  values (p_deal_id, v_target_broker, 'broker', 100, false);
  -- deal_participants_autofill inclui gerente e diretor da equipe ativa.

  insert into public.deal_history (deal_id, actor_id, kind, from_value, to_value, detail)
  values (p_deal_id, v_actor, 'reactivated', v_deal.status_detail, v_incomplete,
    jsonb_build_object('old_month', to_char(v_deal.month_base, 'MM/YYYY'),
                       'new_month', to_char(v_current_month, 'MM/YYYY'),
                       'broker_id', v_target_broker));

  perform set_config('faceimob.cca_move', '', true);
  select full_name into v_actor_name from public.profiles where id = v_actor;
  select full_name into v_broker_name from public.profiles where id = v_target_broker;
  select full_name into v_client_name from public.deal_clients
   where deal_id = p_deal_id and ordinal = 1;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct ur.profile_id, 'deal_status_changed',
         'Proposta reativada: ' || coalesce(v_client_name, v_deal.code),
         left(format('%s reativou o OFF de %s para %s no mês %s.',
           coalesce(v_actor_name, 'Alguém'), to_char(v_deal.month_base, 'MM/YYYY'),
           coalesce(v_broker_name, 'corretor não identificado'),
           to_char(v_current_month, 'MM/YYYY')), 2000),
         '/pipeline?negocio=' || p_deal_id, 'in_app'::public.notification_channel
    from public.user_roles ur
    join public.profiles p on p.id = ur.profile_id and p.status = 'active'
   where ur.role = 'admin';

  return jsonb_build_object('deal_id', p_deal_id, 'reactivated', true,
    'new_month', to_char(v_current_month, 'MM/YYYY'), 'broker_id', v_target_broker);
end;
$$;
revoke all on function public.reactivate_deal(uuid, uuid) from public, anon;
grant execute on function public.reactivate_deal(uuid, uuid) to authenticated;
comment on function public.reactivate_deal(uuid, uuid) is
  'Reativa OFF anterior no mês vigente como INCOMPLETO, refaz a liderança atual e avisa só administradores.';

-- Regra vale inclusive para admin/CCA, evitando classificação no mês errado.
create or replace function public.deals_guard_queda_distrato_month()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_status text := public.deal_status_bare(new.status_detail);
  v_current_month date := public.month_start(coalesce(public.current_season_month(), current_date));
begin
  if v_status = 'QUEDA' and new.month_base <> v_current_month then
    raise exception 'QUEDA só pode ser marcada no mês vigente (%).',
      to_char(v_current_month, 'MM/YYYY') using errcode = 'P0001';
  end if;
  if v_status = 'DISTRATO' and new.month_base >= v_current_month then
    raise exception 'DISTRATO só pode ser marcado em mês anterior ao vigente (%).',
      to_char(v_current_month, 'MM/YYYY') using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists deals_guard_queda_distrato_month on public.deals;
create trigger deals_guard_queda_distrato_month
before insert or update of status_detail, month_base on public.deals
for each row execute function public.deals_guard_queda_distrato_month();
comment on function public.deals_guard_queda_distrato_month() is
  'QUEDA somente no mês vigente; DISTRATO somente em qualquer mês anterior.';
