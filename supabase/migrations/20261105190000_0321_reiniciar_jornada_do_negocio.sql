-- =============================================================================
-- 0321 — reiniciar a jornada do negócio pela aba Negócio.
-- =============================================================================
-- Pedido de 04/11/2026: "gerentes tentam retomar negócios e não conseguem".
-- A `reativar_negocio` (0277) só aceitava OFF, Distrato e Queda, e só da
-- liderança. Para retomar um REPROVADO, um aprovado em outra construtora ou um
-- condicionado antigo, era preciso dar OFF e depois reativar. Agora:
--   · qualquer Status 2 reinicia, menos a venda (essa sai por Distrato/Queda);
--   · o corretor do negócio também reinicia, só para ele mesmo;
--   · segue igual: volta a INCOMPLETO no mês aberto, na etapa inicial, o caso
--     antigo do CCA é encerrado (libera o novo envio à Esteira Ágil) e o motivo
--     fica no histórico.
-- =============================================================================

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
  v_lider         boolean;
begin
  if v_actor is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;

  -- 0320: o corretor do negócio também reinicia — e só para ele mesmo.
  v_lider := public.is_admin() or public.has_any_role('admin', 'partner', 'manager', 'director');
  if not v_lider and not exists (
    select 1 from public.deal_participants dp
     where dp.deal_id = p_deal_id and dp.role = 'broker' and dp.profile_id = v_actor
  ) then
    raise exception 'Só o corretor do negócio e a liderança dele reiniciam a jornada.' using errcode = '42501';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found or not public.can_edit_deal(p_deal_id) then
    raise exception 'Negócio não encontrado ou fora do seu acesso.' using errcode = '42501';
  end if;

  -- 0320: qualquer ponto da jornada reinicia (reprovado, aprovado em outra
  -- construtora, condicionado antigo…), menos a venda — essa sai por distrato.
  v_atual := public.deal_status_bare(v_deal.status_detail);
  if (v_atual = 'INCOMPLETO' or v_deal.status_detail is null) and v_deal.outcome = 'open' then
    raise exception 'O negócio já está no começo da jornada: é só seguir.' using errcode = 'P0001';
  end if;
  if public.deal_counts_as_game_sale(v_deal.outcome, v_deal.status_group_id)
     or exists (select 1 from public.deal_status_groups g
                 where g.id = v_deal.status_group_id and g.code = 'POS_VENDA') then
    raise exception 'Negócio vendido não reinicia a jornada. Use Distrato ou Queda.' using errcode = 'P0001';
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
  if not v_lider and p_broker_id <> v_actor then
    raise exception 'O negócio volta para você mesmo.' using errcode = '42501';
  end if;
  if v_lider and not public.is_admin() and not public.has_any_role('admin', 'partner') and not exists (
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
  'Reinicia a jornada: qualquer Status 2 menos a venda volta a INCOMPLETO no mês aberto, com motivo obrigatório. Liderança escolhe o corretor; o corretor do negócio reinicia para si (0321).';
