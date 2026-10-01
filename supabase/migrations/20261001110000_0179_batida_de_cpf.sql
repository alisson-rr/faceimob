-- =============================================================================
-- 0179 — batida de CPF: um CPF, um negócio
--
-- Pedido do cliente em 01/10/2026:
--   · CPF que já está num negócio ATIVO não cadastra de novo: o corretor vê com
--     quem o cliente está (Corretor X, Gerente Y) e reporta ao gerente dele;
--   · CPF cujo negócio está em OFF, QUEDA ou DISTRATO: o corretor que cadastra
--     ASSUME aquele negócio (vira o corretor, com os gerentes e diretores dele),
--     com comentário obrigatório. "Não cria outro CPF de forma alguma."
--
-- Três peças:
--   1. `negocio_do_cpf(cpf)` — a batida. `security definer` porque o corretor
--      não enxerga o negócio de outra equipe (RLS); devolve só o necessário
--      para a decisão: situação, Status 2 e os nomes do corretor e do gerente.
--   2. `assumir_negocio_do_cpf(deal, comentário)` — só para negócio encerrado.
--      Troca corretor, gerente e diretor pelo de quem assume (o gatilho
--      `deal_participants_autofill` põe os líderes da equipe), reabre em
--      PROPOSTA no mês corrente e registra o comentário no histórico.
--   3. Gatilho em `deal_clients`: CPF que já pertence a outro negócio é
--      recusado no banco, qualquer que seja a tela (criação, conversão de
--      lead, edição). Importação e seeds (`postgres`/`service_role`) passam.
--      CPFs repetidos que já existem continuam lá; a trava vale para gravações
--      novas e para troca de CPF.
-- =============================================================================

create or replace function public.cpf_digitos(p_cpf text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
$$;

revoke all on function public.cpf_digitos(text) from public, anon;
grant execute on function public.cpf_digitos(text) to authenticated, service_role;

create index if not exists deal_clients_cpf_digitos_idx
  on public.deal_clients (public.cpf_digitos(cpf))
  where length(public.cpf_digitos(cpf)) = 11;

-- Negócio encerrado para a batida: o desfecho é perda, ou o Status 2 / Status 1
-- é OFF, QUEDA ou DISTRATO.
create or replace function public.negocio_encerrado(p_deal public.deals)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select p_deal.outcome = 'lost'
      or public.deal_status_bare(p_deal.status_detail) ~ '^(OFF|QUEDA|DISTRATO)\M'
      or exists (select 1 from public.deal_status_groups g
                  where g.id = p_deal.status_group_id and g.code in ('OFF', 'DISTRATO'));
$$;

revoke all on function public.negocio_encerrado(public.deals) from public, anon;
grant execute on function public.negocio_encerrado(public.deals) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1. A batida
-- -----------------------------------------------------------------------------
create or replace function public.negocio_do_cpf(p_cpf text)
returns table (
  deal_id   uuid,
  codigo    text,
  cliente   text,
  situacao  text,
  status2   text,
  corretor  text,
  gerente   text
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
         case when public.negocio_encerrado(d) then 'encerrado' else 'ativo' end,
         d.status_detail,
         (select p.full_name from public.deal_participants dp
            join public.profiles p on p.id = dp.profile_id
           where dp.deal_id = d.id and dp.role = 'broker'
           order by dp.ordinal, dp.created_at limit 1),
         (select p.full_name from public.deal_participants dp
            join public.profiles p on p.id = dp.profile_id
           where dp.deal_id = d.id and dp.role = 'manager'
           order by dp.ordinal, dp.created_at limit 1)
    from public.deal_clients c
    join public.deals d on d.id = c.deal_id
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
  'Batida de CPF (0179): o negócio que já tem o CPF, com situação (ativo/encerrado), Status 2, corretor e gerente.';

-- -----------------------------------------------------------------------------
-- 2. Assumir o negócio encerrado
-- -----------------------------------------------------------------------------
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

revoke all on function public.assumir_negocio_do_cpf(uuid, text) from public, anon;
grant execute on function public.assumir_negocio_do_cpf(uuid, text) to authenticated, service_role;
comment on function public.assumir_negocio_do_cpf(uuid, text) is
  'Corretor assume negócio encerrado (OFF/QUEDA/DISTRATO) achado na batida de CPF, com comentário obrigatório (0179).';

-- -----------------------------------------------------------------------------
-- 3. Um CPF, um negócio
-- -----------------------------------------------------------------------------
create or replace function public.deal_clients_cpf_unico()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cpf text := public.cpf_digitos(new.cpf);
begin
  -- `security definer` para enxergar os clientes de TODOS os negócios (o
  -- corretor só lê os dele). Por isso o escape não é `current_user`, que aqui
  -- é sempre o dono: o papel de quem chamou fica em `role`. Só a API do
  -- usuário (`authenticated`/`anon`) é cobrada; importação, seed e servidor
  -- (`postgres`, `service_role`) passam.
  if coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon') then
    return new;
  end if;
  if length(v_cpf) <> 11 then
    return new;
  end if;
  -- O CPF já é deste negócio: regravar não é cadastro novo. Cobre o upsert do
  -- formulário (`insert … on conflict`, cujo BEFORE INSERT dispara antes do
  -- conflito) e os repetidos antigos, que seguem editáveis.
  if exists (
    select 1 from public.deal_clients c
     where c.deal_id = new.deal_id and public.cpf_digitos(c.cpf) = v_cpf
  ) then
    return new;
  end if;
  if exists (
    select 1 from public.deal_clients c
     where public.cpf_digitos(c.cpf) = v_cpf
       and length(public.cpf_digitos(c.cpf)) = 11
       and c.deal_id <> new.deal_id
  ) then
    raise exception 'Este CPF já está cadastrado em outro negócio. Faça a batida de CPF para ver com quem está.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.deal_clients_cpf_unico() from public, anon, authenticated;

drop trigger if exists deal_clients_cpf_unico on public.deal_clients;
create trigger deal_clients_cpf_unico
  before insert or update of cpf, deal_id on public.deal_clients
  for each row execute function public.deal_clients_cpf_unico();
