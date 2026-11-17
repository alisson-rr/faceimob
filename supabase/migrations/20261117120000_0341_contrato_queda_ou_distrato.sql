-- =============================================================================
-- 0341 · Contrato não vai para OFF: Queda ou Distrato, também pela equipe
--
-- Pedido do Douglas (17/11/2026): "Se em contrato não quero opção de OFF e sim
-- de distrato se for de mês anterior e queda se for do mês atual; OFF são para
-- propostas." Até aqui só o CCA encerrava contrato (`cca_close_contract`, 0248)
-- e a equipe tinha o OFF para tudo.
--
--  · `encerrar_contrato_aplicar` — o corpo de `cca_close_contract`, sem a
--    checagem de papel: uma regra só para QUEDA/DISTRATO (etapa, Status 2,
--    histórico, avisos e e-mails). Sem grant; só as duas portas abaixo chamam.
--  · `cca_close_contract` — igual para o CCA, agora chamando o corpo.
--  · `encerrar_contrato` — a porta da equipe (mesmas pessoas do OFF): a escolha
--    entre QUEDA e DISTRATO sai do mês do negócio, não de quem clica.
--  · `marcar_off` recusa negócio em contrato.
-- =============================================================================

create or replace function public.encerrar_contrato_aplicar(
  p_deal_id uuid,
  p_outcome text,
  p_reason text,
  p_origem text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal public.deals;
  v_target text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_current_month date := public.month_start(coalesce(public.current_season_month(), current_date));
  v_lost_stage uuid;
  v_client text;
  v_actor text;
begin
  if auth.uid() is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  if v_reason = '' then raise exception 'A justificativa é obrigatória.' using errcode = 'P0001'; end if;

  v_target := public.deal_status_bare(p_outcome);
  if v_target not in ('QUEDA', 'DISTRATO') then
    raise exception 'Escolha QUEDA ou DISTRATO.' using errcode = 'P0001';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Negócio não encontrado.' using errcode = 'P0002'; end if;
  if public.deal_status_bare(v_deal.status_detail) not in
     ('EM CONTRATO', 'ASSINADO', 'ASS. BANCO', 'RC EMITIDA') then
    raise exception 'Esta ação é exclusiva de contratos e negócios já assinados.' using errcode = 'P0001';
  end if;
  if v_target = 'QUEDA' and v_deal.month_base is distinct from v_current_month then
    raise exception 'QUEDA só pode ser marcada no mês vigente (%).', to_char(v_current_month, 'MM/YYYY') using errcode = 'P0001';
  end if;
  if v_target = 'DISTRATO' and v_deal.month_base >= v_current_month then
    raise exception 'DISTRATO só pode ser marcado em mês anterior a %.', to_char(v_current_month, 'MM/YYYY') using errcode = 'P0001';
  end if;

  select id into v_lost_stage from public.pipeline_stages where code = 'lost' and active limit 1;
  if v_lost_stage is null then raise exception 'A etapa Perdido não está configurada.' using errcode = 'P0001'; end if;

  perform set_config('faceimob.cca_move', 'on', true);
  perform set_config('faceimob.status_note', left(v_reason, 2000), true);
  update public.deals
     set stage_id = v_lost_stage,
         status_detail = case v_target when 'QUEDA' then '18. QUEDA' else '17. DISTRATO' end,
         lost_reason = (case v_target when 'QUEDA' then '18. QUEDA' else '17. DISTRATO' end)
                       || ' — ' || left(v_reason, 1800)
   where id = p_deal_id;

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, auth.uid(), 'comment', p_origem || ' — ' || v_target || ': ' || left(v_reason, 3900));

  select c.full_name into v_client from public.deal_clients c
   where c.deal_id = p_deal_id and c.ordinal = 1;
  select p.full_name into v_actor from public.profiles p where p.id = auth.uid();

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct q.profile_id, 'cca_status_changed',
         v_target || ': ' || coalesce(v_client, v_deal.code, 'negócio'),
         left(coalesce(v_actor, p_origem) || ' registrou ' || v_target || ': ' || v_reason, 2000),
         '/pipeline?negocio=' || p_deal_id, 'in_app'::public.notification_channel
    from (
      select dp.profile_id from public.deal_participants dp
       where dp.deal_id = p_deal_id and dp.role in ('broker', 'manager', 'director')
      union
      select ur.profile_id from public.user_roles ur where ur.role = 'cca'
    ) q
    join public.profiles p on p.id = q.profile_id and p.status = 'active'
   where q.profile_id is distinct from auth.uid();

  insert into public.cca_move_emails
    (deal_id, profile_id, to_email, deal_code, client_name, stage_name,
     actor_name, message, source, detalhes)
  select distinct on (lower(btrim(p.email::text)))
         p_deal_id, p.id, btrim(p.email::text), v_deal.code, v_client, v_target,
         coalesce(v_actor, p_origem), v_reason, 'cca',
         public.email_detalhes_do_negocio(p_deal_id)
           || jsonb_build_object('status2', v_target, 'observacao', v_reason)
    from (
      select dp.profile_id from public.deal_participants dp
       where dp.deal_id = p_deal_id and dp.role in ('broker', 'manager', 'director')
      union select auth.uid()
      union select ur.profile_id from public.user_roles ur where ur.role = 'cca'
    ) q
    join public.profiles p on p.id = q.profile_id and p.status = 'active'
   where coalesce((select s.cca_move_email from public.automation_settings s where s.id), false)
     and btrim(p.email::text) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     and p.email::text !~* '@sem-email\.local$'
   order by lower(btrim(p.email::text)), p.id;
end;
$$;
revoke all on function public.encerrar_contrato_aplicar(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.cca_close_contract(p_deal_id uuid, p_outcome text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  if not (public.is_admin() or (public.has_role('cca') and public.has_permission('cca.review'))) then
    raise exception 'Só a equipe CCA encerra contratos por esta ação.' using errcode = '42501';
  end if;
  perform public.encerrar_contrato_aplicar(p_deal_id, p_outcome, p_reason, 'CCA');
end;
$$;

create or replace function public.encerrar_contrato(p_deal_id uuid, p_motivo text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal   public.deals;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_mes    date := public.month_start(coalesce(public.current_season_month(), current_date));
  v_alvo   text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found or not public.can_edit_deal(p_deal_id) then
    raise exception 'Negócio não encontrado ou fora do seu acesso.' using errcode = '42501';
  end if;
  if not public.has_permission('deals.edit_status_detail') then
    raise exception 'Seu perfil não pode alterar o Status 2.' using errcode = '42501';
  end if;
  if not (public.is_admin() or public.has_any_role('broker', 'manager', 'director')) then
    raise exception 'Seu perfil não encerra contrato.' using errcode = '42501';
  end if;
  if length(v_motivo) < 5 then
    raise exception 'Escreva o motivo (pelo menos 5 caracteres).' using errcode = 'P0001';
  end if;
  v_alvo := case when v_deal.month_base >= v_mes then 'QUEDA' else 'DISTRATO' end;
  perform public.encerrar_contrato_aplicar(p_deal_id, v_alvo, v_motivo, 'Equipe');
  return v_alvo;
end;
$$;
revoke all on function public.encerrar_contrato(uuid, text) from public, anon;
grant execute on function public.encerrar_contrato(uuid, text) to authenticated;

create or replace function public.marcar_off(p_deal_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal   public.deals;
  v_off    public.deal_statuses;
  v_motivo text := btrim(coalesce(p_motivo, ''));
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
  if not (public.is_admin() or public.has_any_role('broker', 'manager', 'director')) then
    raise exception 'Seu perfil não marca OFF.' using errcode = '42501';
  end if;

  if length(v_motivo) < 5 then
    raise exception 'Escreva o motivo do OFF (pelo menos 5 caracteres).' using errcode = 'P0001';
  end if;
  if length(v_motivo) > 2000 then
    raise exception 'Motivo longo demais (máx. 2000 caracteres).' using errcode = 'P0001';
  end if;

  select * into v_off from public.deal_statuses
   where public.deal_status_bare(value) = 'OFF' and active
   limit 1;
  if not found then
    raise exception 'OFF não está ativo no cadastro de Status 2.' using errcode = 'P0001';
  end if;

  if public.deal_status_bare(v_deal.status_detail) = 'OFF' then
    return;
  end if;

  -- 0341: OFF é de proposta. Contrato sai por QUEDA (mês vigente) ou DISTRATO
  -- (mês anterior), pelo `encerrar_contrato`.
  if public.deal_status_bare(v_deal.status_detail) in ('EM CONTRATO', 'ASSINADO', 'ASS. BANCO', 'RC EMITIDA') then
    raise exception 'Negócio em contrato não vai para OFF: use Queda (mês vigente) ou Distrato (mês anterior).' using errcode = 'P0001';
  end if;

  -- Mês fechado: o gatilho cobra de quem não é admin; esta frase só explica antes.
  if not public.is_admin() and exists (select 1 from public.closed_months cm where cm.period = v_deal.month_base) then
    raise exception 'O mês % está fechado. Fale com o administrador para reabrir.',
      to_char(v_deal.month_base, 'MM/YYYY') using errcode = 'P0001';
  end if;

  perform set_config('faceimob.status_note', v_motivo, true);
  update public.deals set status_detail = v_off.value where id = p_deal_id;

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, auth.uid(), 'comment', 'OFF: ' || v_motivo);
end;
$$;

