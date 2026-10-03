-- =============================================================================
-- 0205 — batida de CPF com o último comentário e o distrato à parte
--
-- Pedido do cliente em 03/10/2026, para o popup que agora abre ao sair do
-- campo CPF:
--   · ativo     → corretor, gerente e o último comentário do histórico (com
--                 data e hora), para o corretor falar com o gerente do fifty;
--   · OFF/QUEDA → "já existe no Pipeline, quer retomar?": assume o negócio
--                 com tudo (dados, histórico, documentos) e segue nele;
--   · DISTRATO  → só avisa: já foi contabilizado em mês anterior e retomar é
--                 com o gerente. `assumir_negocio_do_cpf` passa a recusá-lo.
--
-- `negocio_do_cpf` ganha colunas (situação 'distrato', último comentário e a
-- hora dele): troca de assinatura, por isso drop + create, com os grants.
-- =============================================================================

create or replace function public.negocio_em_distrato(p_deal public.deals)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select public.deal_status_bare(p_deal.status_detail) ~ '^DISTRATO\M'
      or exists (select 1 from public.deal_status_groups g
                  where g.id = p_deal.status_group_id and g.code = 'DISTRATO');
$$;

revoke all on function public.negocio_em_distrato(public.deals) from public, anon;
grant execute on function public.negocio_em_distrato(public.deals) to authenticated, service_role;

drop function if exists public.negocio_do_cpf(text);

create function public.negocio_do_cpf(p_cpf text)
returns table (
  deal_id              uuid,
  codigo               text,
  cliente              text,
  situacao             text,
  status2              text,
  corretor             text,
  gerente              text,
  ultimo_comentario    text,
  ultimo_comentario_em timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cpf text := public.cpf_digitos(p_cpf);
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  -- Os mesmos papéis que criam negócio (`deals_insert`).
  if public.auth_effective_role(auth.uid()) is null
     or public.auth_effective_role(auth.uid()) not in ('admin', 'director', 'manager', 'broker', 'cca') then
    raise exception 'Seu perfil não cadastra negócio.' using errcode = '42501';
  end if;
  if length(v_cpf) <> 11 then
    return;
  end if;

  return query
  select d.id,
         d.code,
         c.full_name,
         case when public.negocio_em_distrato(d) then 'distrato'
              when public.negocio_encerrado(d) then 'encerrado'
              else 'ativo' end,
         d.status_detail,
         (select p.full_name from public.deal_participants dp
            join public.profiles p on p.id = dp.profile_id
           where dp.deal_id = d.id and dp.role = 'broker'
           order by dp.ordinal, dp.created_at limit 1),
         (select p.full_name from public.deal_participants dp
            join public.profiles p on p.id = dp.profile_id
           where dp.deal_id = d.id and dp.role = 'manager'
           order by dp.ordinal, dp.created_at limit 1),
         h.to_value,
         h.created_at
    from public.deal_clients c
    join public.deals d on d.id = c.deal_id
    left join lateral (
      select hh.to_value, hh.created_at from public.deal_history hh
       where hh.deal_id = d.id and hh.kind = 'comment'
       order by hh.created_at desc limit 1
    ) h on true
   where public.cpf_digitos(c.cpf) = v_cpf
     and length(public.cpf_digitos(c.cpf)) = 11
   -- Havendo repetidos antigos, o ativo responde primeiro: é ele que trava.
   order by public.negocio_encerrado(d), d.created_at desc
   limit 1;
end;
$$;

revoke all on function public.negocio_do_cpf(text) from public, anon;
grant execute on function public.negocio_do_cpf(text) to authenticated, service_role;
comment on function public.negocio_do_cpf(text) is
  'Batida de CPF (0179, 0205): o negócio que já tem o CPF, com situação (ativo/encerrado/distrato), Status 2, corretor, gerente e o último comentário com a hora.';

create or replace function public.assumir_negocio_do_cpf(p_deal_id uuid, p_comentario text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal       public.deals;
  v_comentario text := btrim(coalesce(p_comentario, ''));
  v_etapa      uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if public.auth_effective_role(auth.uid()) is null
     or public.auth_effective_role(auth.uid()) not in ('admin', 'director', 'manager', 'broker', 'cca') then
    raise exception 'Seu perfil não cadastra negócio.' using errcode = '42501';
  end if;
  if length(v_comentario) < 5 then
    raise exception 'Escreva o comentário para assumir o negócio.' using errcode = 'P0001';
  end if;
  if length(v_comentario) > 2000 then
    raise exception 'Comentário longo demais (máx. 2000 caracteres).' using errcode = 'P0001';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;
  if not public.negocio_encerrado(v_deal) then
    raise exception 'Este negócio está ativo: fale com o gerente para verificar o andamento.'
      using errcode = 'P0001';
  end if;
  -- 0205: distrato já foi contabilizado num mês anterior; retomar é com o gerente.
  if public.negocio_em_distrato(v_deal) then
    raise exception 'Este negócio está em distrato e já foi contabilizado em mês anterior: para retomar, fale com o seu gerente.'
      using errcode = 'P0001';
  end if;

  select id into v_etapa from public.pipeline_stages where code = 'proposal';
  if v_etapa is null then
    select id into v_etapa from public.pipeline_stages where is_initial order by position limit 1;
  end if;

  -- Reabre como negócio novo do corretor que assumiu: PROPOSTA, mês corrente,
  -- conferência do zero. A etapa acompanha o Status 2 (mesma marca da 0164):
  -- quem autoriza a reabertura é esta função, não a matriz de etapas do corretor.
  perform set_config('faceimob.stage_from_status', p_deal_id::text, true);
  update public.deals
     set status_detail = 'PROPOSTA',
         status_group_id = public.deal_status_group_for('PROPOSTA', 'open', null),
         outcome = 'open',
         closed_at = null,
         lost_reason = null,
         stage_id = coalesce(v_etapa, stage_id),
         month_base = public.month_start(current_date),
         document_review_status = 'draft',
         document_review_requested_at = null,
         document_review_requested_by = null,
         document_reviewed_at = null,
         document_reviewed_by = null,
         document_review_reason = null,
         review_esteira = null
   where id = p_deal_id;

  delete from public.deal_participants
   where deal_id = p_deal_id and role in ('broker', 'manager', 'director');
  -- O gatilho `deal_participants_autofill` põe o gerente e o diretor da equipe.
  insert into public.deal_participants (deal_id, profile_id, role, ordinal)
  values (p_deal_id, auth.uid(), 'broker', 1);

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, auth.uid(), 'comment', 'NEGÓCIO ASSUMIDO NA BATIDA DE CPF: ' || v_comentario);

  return p_deal_id;
end;
$$;
