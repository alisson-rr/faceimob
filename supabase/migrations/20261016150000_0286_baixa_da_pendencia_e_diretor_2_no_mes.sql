-- =============================================================================
-- 0286 · Baixa da pendência do contrato + Diretor 2 nos negócios do mês vigente
--
-- Pedido de 16/10/2026:
--   1. O selo "Pendência no contrato" (0243) liga ao sair de VIROU NEGÓCIO COM
--      PENDÊNCIAS para EM CONTRATO e nunca desligava. Agora o CCA (ou o admin)
--      dá baixa: o selo some, a baixa fica no histórico e a equipe do negócio
--      é avisada. Vale também em mês fechado, por uma exceção estreita: a única
--      mudança aceita é o selo passar de ligado para desligado.
--   2. Equipe com Diretor 2 (0266): a meia venda só valia para negócio criado
--      depois da divisão da equipe, porque só esses têm os dois diretores. O
--      mês vigente ficava com tudo para o Diretor 1 e nada para o Diretor 2.
--      Os negócios do mês vigente (e de meses ainda abertos à frente) ganham o
--      Diretor 2; meses fechados não mudam.
-- =============================================================================

-- 1. Exceção da baixa na trava de mês fechado (cópia da 0237 + a cláusula nova)
create or replace function public.deals_guard_closed_month()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period date := coalesce(new.month_base, old.month_base);
  v_reactivation text := coalesce(current_setting('faceimob.reactivate_deal', true), '');
  v_current_month date := public.month_start(
    coalesce(public.current_season_month(), current_date)
  );
begin
  if public.is_admin() or v_reactivation = new.id::text then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and coalesce(current_setting('faceimob.cca_move', true), '') = 'on'
     and public.has_permission('deals.mark_distrato')
     and new.month_base is not distinct from old.month_base
     and new.month_base < v_current_month
     and public.deal_status_bare(new.status_detail) = 'DISTRATO' then
    return new;
  end if;

  -- Baixa da pendência (0286): só por `baixar_pendencia_contrato`, e só o selo
  -- de ligado para desligado. Coluna gerada (`vgv_net`) chega nula no BEFORE e
  -- não é escrita por ninguém: fica fora da comparação.
  if tg_op = 'UPDATE'
     and coalesce(current_setting('faceimob.baixa_pendencia', true), '') = new.id::text
     and old.contract_has_pending_issue and not new.contract_has_pending_issue
     and not exists (
       select 1
         from jsonb_each(to_jsonb(new)) n
         join jsonb_each(to_jsonb(old)) o using (key)
        where n.value is distinct from o.value
          and n.key not in ('contract_has_pending_issue', 'updated_at')
          and n.key not in (select a.attname from pg_attribute a
                             where a.attrelid = 'public.deals'::regclass and a.attgenerated <> '')
     ) then
    return new;
  end if;

  if exists (select 1 from public.closed_months cm where cm.period = v_period) then
    raise exception 'O mês % está fechado. Fale com o administrador para reabrir.',
      to_char(v_period, 'MM/YYYY') using errcode = 'P0001';
  end if;

  return new;
end;
$$;
revoke all on function public.deals_guard_closed_month()
  from public, anon, authenticated;

comment on function public.deals_guard_closed_month() is
  'Congela meses fechados; permite reativação autorizada, DISTRATO anterior via movimento da CCA e a baixa da pendência do contrato (0286), sem trocar o mês-base.';

-- 2. Baixa da pendência -----------------------------------------------------------
create or replace function public.baixar_pendencia_contrato(p_deal_id uuid, p_comentario text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ator uuid := auth.uid();
  v_comentario text := nullif(btrim(coalesce(p_comentario, '')), '');
  v_deal public.deals;
  v_nome text;
begin
  if v_ator is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if not (public.is_admin() or public.has_role('cca')) then
    raise exception 'Só o CCA ou o administrador dá baixa na pendência do contrato.' using errcode = '42501';
  end if;
  if length(v_comentario) > 500 then
    raise exception 'Comentário longo demais (máx. 500).' using errcode = 'P0001';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;
  if not v_deal.contract_has_pending_issue then
    raise exception 'Este negócio não tem pendência no contrato.' using errcode = 'P0001';
  end if;

  perform set_config('faceimob.baixa_pendencia', p_deal_id::text, true);
  update public.deals set contract_has_pending_issue = false where id = p_deal_id;
  perform set_config('faceimob.baixa_pendencia', '', true);

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, v_ator, 'contract_pending_cleared', v_comentario);

  select full_name into v_nome from public.profiles where id = v_ator;
  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select dp.profile_id,
         'contract_pending_cleared',
         format('Pendência do contrato baixada: %s', v_deal.code),
         format('%s deu baixa na pendência do contrato.%s', coalesce(v_nome, 'O CCA'),
                coalesce(' ' || v_comentario, '')),
         '/pipeline?negocio=' || p_deal_id,
         'in_app'
    from (select distinct profile_id from public.deal_participants where deal_id = p_deal_id) dp
    join public.profiles p on p.id = dp.profile_id and p.status = 'active'
   where dp.profile_id <> v_ator;
end;
$$;
revoke all on function public.baixar_pendencia_contrato(uuid, text) from public, anon;
grant execute on function public.baixar_pendencia_contrato(uuid, text) to authenticated;
comment on function public.baixar_pendencia_contrato(uuid, text) is
  'CCA/admin desliga o selo "Pendência no contrato", registra no histórico e avisa corretor, gerente e diretor do negócio (0286).';

-- 3. Diretor 2 nos negócios do mês vigente -------------------------------------
-- Só negócio da mesma diretoria: o Diretor 1 da equipe dividida já está nele.
-- Mês fechado fica como está (`deals_guard_closed_month` também barraria).
insert into public.deal_participants (deal_id, profile_id, role, auto_added)
select alvo.deal_id, alvo.co_director_id, 'director', true
  from (
    select distinct d.id as deal_id, t.co_director_id
      from public.deals d
      join public.deal_participants b on b.deal_id = d.id and b.role = 'broker'
      join public.team_members tm on tm.profile_id = b.profile_id and tm.left_at is null
      join public.teams t on t.id = tm.team_id and t.active and t.co_director_id is not null
     where d.month_base >= public.month_start(coalesce(public.current_season_month(), current_date))
       and not exists (select 1 from public.closed_months cm where cm.period = d.month_base)
       and exists (select 1 from public.deal_participants x
                    where x.deal_id = d.id and x.role = 'director' and x.profile_id = t.director_id)
  ) alvo
on conflict (deal_id, profile_id, role) do nothing;
