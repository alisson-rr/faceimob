-- =============================================================================
-- 0164 — o Status 2 manda: etapa e Status 1 seguem, e cada função move só o
--        que é dela (pedido do cliente em 29/09/2026)
--
-- "No kanban do pipeline deixe com os mesmos estágios existentes no Status 2.
--  A etapa e o Status 1 acompanham o Status 2; o que iremos mover é somente o
--  Status 2, mantendo as hierarquias. Que eu possa, como adm, editar essas
--  permissões nos Status 2, assim como vincular Status 1 e etapa em cada status."
--
-- O que muda no banco:
--
-- 1. `deal_statuses.stage_id` — a etapa que o Status 2 implica. Trocar o
--    Status 2 leva o negócio para ela (gatilho `deals_ab_status_stage`), e com
--    ela o desfecho (Fechado = ganho, Perdido = perdido), como sempre foi pela
--    etapa. Nulo = o Status 2 não mexe na etapa. O Status 1 já seguia o
--    Status 2 (0149) e continua.
--
-- 2. `deal_status_permissions` — quem COLOCA (`can_enter`) e quem TIRA
--    (`can_exit`) o negócio de cada Status 2, por função. Admin e sócio passam
--    sempre (`is_admin()`), como em todo o módulo. Status 2 sem linha nenhuma é
--    só do admin: um status novo nasce fechado até alguém dizer quem o usa.
--    A semente segue a regra do cliente:
--      · corretor, gerente e diretor respondem o que a CCA devolve (pendências
--        e aprovados) e colocam em Queda; não tiram a CCA dos status dela (em
--        processamento, aguardando agência…);
--      · só a CCA vira negócio e coloca em "Ass. banco";
--      · só admin e sócio colocam em contrato, assinado, RC emitida, distrato e OFF.
--
-- 3. `deal_statuses.requires_note` — o Status 2 exige observação ao entrar.
--    Movimentação com observação passa por `move_deal_status`, que grava a
--    observação no histórico do negócio.
--
-- 4. Voltar para a análise (esteira ágil, retorno à esteira, análise p/ virar
--    negócio) continua sendo o ENVIO AO GERENTE com mensagem obrigatória
--    (`submit_deal_for_manager_review`, 0150) — é ele que reabre a conferência e
--    devolve o caso à CCA. Agora gerente e diretor do negócio também enviam,
--    não só o corretor.
--
-- Negócio que já existe NÃO é realinhado: a etapa só segue o Status 2 a partir
-- da próxima troca. Realinhar tudo mudaria desfecho (venda/perda) de negócio
-- antigo sem ninguém ter mexido nele.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Etapa e observação em cada Status 2
-- -----------------------------------------------------------------------------
alter table public.deal_statuses
  add column if not exists stage_id uuid references public.pipeline_stages(id) on delete set null,
  add column if not exists requires_note boolean not null default false;

comment on column public.deal_statuses.stage_id is
  'Etapa que o Status 2 implica: trocar o Status 2 move o negócio para ela (0164). Nulo = não mexe na etapa.';
comment on column public.deal_statuses.requires_note is
  'Entrar neste Status 2 exige observação, gravada no histórico pelo move_deal_status (0164).';

-- -----------------------------------------------------------------------------
-- 2. Quem coloca e quem tira, por função
-- -----------------------------------------------------------------------------
create table if not exists public.deal_status_permissions (
  status_id  uuid not null references public.deal_statuses(id) on delete cascade,
  role       public.app_role not null,
  can_enter  boolean not null default false,
  can_exit   boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (status_id, role)
);

comment on table public.deal_status_permissions is
  'Quem coloca (can_enter) e quem tira (can_exit) um negócio de cada Status 2, por função. Admin e sócio passam sempre; Status 2 sem linha é só do admin (0164).';

alter table public.deal_status_permissions enable row level security;

drop policy if exists deal_status_permissions_select on public.deal_status_permissions;
create policy deal_status_permissions_select on public.deal_status_permissions
  for select to authenticated using (true);

drop policy if exists deal_status_permissions_admin on public.deal_status_permissions;
create policy deal_status_permissions_admin on public.deal_status_permissions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.deal_status_permissions from anon;
grant select, insert, update, delete on public.deal_status_permissions to authenticated;
grant all on public.deal_status_permissions to service_role;

-- Semente: etapa, quem coloca e quem tira. E = equipe (corretor, gerente,
-- diretor); C = CCA. Casa pelo texto sem prefixo (`deal_status_bare`), como
-- todo o catálogo; status que não estiver aqui fica só do admin.
with semente(bare, stage_code, entra, sai) as (
  values
    -- VENDA
    ('RC EMITIDA',                   'closed',         '',   ''),
    ('ASS. BANCO',                   'closed',         'C',  'C'),
    ('ASSINADO',                     'closed',         '',   ''),
    ('EM CONTRATO',                  'contract',       '',   ''),
    -- PROPOSTA
    ('RP APROVADO',                  'approved',       'C',  'EC'),
    ('ENVIO DE RP',                  'proposal',       'EC', 'C'),
    ('VIROU NEGÓCIO',                'approved',       'C',  'C'),
    ('PENDENTE P/ VIRAR NEGÓCIO',    'under_analysis', 'C',  'EC'),
    ('ANÁLISE P/ VIRAR NEGÓCIO',     'under_analysis', 'C',  'C'),
    ('MUDAR CONSTRUTORA P/ NEGÓCIO', 'under_analysis', 'C',  'EC'),
    ('APROV. TOTAL',                 'approved',       'C',  'EC'),
    ('APROV. COND.',                 'approved',       'C',  'EC'),
    ('APROV. AG. CONT.',             'approved',       'C',  'EC'),
    ('AG. RET. AGENCIA',             'under_analysis', 'C',  'C'),
    ('EM PROCESSAMENTO',             'under_analysis', 'C',  'C'),
    ('ESTEIRA AGIL',                 'under_analysis', 'C',  'C'),
    ('RET. ESTEIRA AGIL',            'under_analysis', 'C',  'C'),
    ('PENDENTE',                     'under_analysis', 'C',  'EC'),
    ('PROPOSTA',                     'proposal',       'EC', 'EC'),
    ('EM ANÁLISE',                   'under_analysis', 'C',  'C'),
    ('VIROU NEGÓCIO COM PENDÊNCIAS', 'approved',       'C',  'EC'),
    ('ANÁLISE CEOPF',                'approved',       'C',  'C'),
    ('INCONFORME CEOPF',             'approved',       'C',  'EC'),
    ('APROVADO/AGUARDANDO AGENDA',   'approved',       'C',  'EC'),
    ('ENTREVISTA AGENDADA',          'approved',       'C',  'C'),
    -- LEGADO
    ('ANÁLISE P/ POTENCIAL',         'under_analysis', 'C',  'C'),
    ('ANÁLISE EXTERNA',              'under_analysis', 'C',  'C'),
    ('APROV. TOT. RESTRIÇÃO',        'approved',       'C',  'EC'),
    ('APROV. COND. RESTRIÇÃO',       'approved',       'C',  'EC'),
    ('APROVADO POTENCIAL',           'approved',       'C',  'EC'),
    ('INTERNALIZADO',                null,             'C',  'C'),
    ('PENDENTE C/ RESTRIÇÃO',        'under_analysis', 'C',  'EC'),
    ('REPROVADO',                    null,             'C',  'C'),
    ('BACEN',                        null,             'C',  'C'),
    ('RESTRIÇÃO',                    null,             'C',  'C'),
    ('INCOMPLETO',                   null,             'EC', 'EC'),
    ('COMPRA ASSISTIDA',             null,             'C',  'C'),
    -- DISTRATO e OFF
    ('DISTRATO',                     'lost',           '',   ''),
    ('QUEDA',                        'lost',           'EC', ''),
    ('OFF',                          'lost',           '',   '')
),
alvo as (
  select s.id as status_id, sm.stage_code, sm.entra, sm.sai
    from semente sm
    join public.deal_statuses s on public.deal_status_bare(s.value) = public.deal_status_bare(sm.bare)
),
etapa as (
  update public.deal_statuses d
     set stage_id = p.id
    from alvo a
    join public.pipeline_stages p on p.code = a.stage_code
   where d.id = a.status_id and d.stage_id is null
  returning d.id
)
insert into public.deal_status_permissions (status_id, role, can_enter, can_exit)
select a.status_id, r.role,
       case when r.role = 'cca' then a.entra like '%C%' else a.entra like '%E%' end,
       case when r.role = 'cca' then a.sai   like '%C%' else a.sai   like '%E%' end
  from alvo a
 cross join (values ('broker'::public.app_role), ('manager'), ('director'), ('cca')) as r(role)
on conflict (status_id, role) do nothing;

-- -----------------------------------------------------------------------------
-- 3. A regra, num lugar só
-- -----------------------------------------------------------------------------
create or replace function public.deal_status_move_block(p_from text, p_to text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_from public.deal_statuses;
  v_to   public.deal_statuses;
begin
  if public.is_admin() then
    return null;
  end if;

  select * into v_to from public.deal_statuses
   where public.deal_status_bare(value) = public.deal_status_bare(p_to)
   order by active desc limit 1;
  if not found then
    return 'Este Status 2 não está no cadastro.';
  end if;

  select * into v_from from public.deal_statuses
   where public.deal_status_bare(value) = public.deal_status_bare(p_from)
   order by active desc limit 1;

  if v_from.id is not null and v_from.id <> v_to.id and not exists (
    select 1 from public.deal_status_permissions p
     where p.status_id = v_from.id and p.can_exit
       and public.has_any_role(p.role)
  ) then
    return format('Seu perfil não tira o negócio de "%s".', v_from.label);
  end if;

  if not exists (
    select 1 from public.deal_status_permissions p
     where p.status_id = v_to.id and p.can_enter
       and public.has_any_role(p.role)
  ) then
    return format('Seu perfil não coloca o negócio em "%s".', v_to.label);
  end if;

  return null;
end;
$$;

comment on function public.deal_status_move_block(text, text) is
  'Motivo pelo qual quem chama não pode trocar o Status 2 de p_from para p_to, ou nulo. Admin e sócio passam; a matriz é deal_status_permissions (0164).';

revoke all on function public.deal_status_move_block(text, text) from public, anon;
grant execute on function public.deal_status_move_block(text, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. A etapa segue o Status 2
-- -----------------------------------------------------------------------------
create or replace function public.deals_ab_status_stage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stage uuid;
begin
  if tg_op = 'UPDATE'
     and public.deal_status_bare(new.status_detail) is not distinct from public.deal_status_bare(old.status_detail) then
    return new;
  end if;
  if new.status_detail is null then
    return new;
  end if;

  select s.stage_id into v_stage
    from public.deal_statuses s
   where public.deal_status_bare(s.value) = public.deal_status_bare(new.status_detail)
   order by s.active desc
   limit 1;

  if v_stage is not null and v_stage is distinct from new.stage_id then
    new.stage_id := v_stage;
    -- `deals_guard_stage` (que roda depois, pela ordem alfabética) lê isto
    -- para não cobrar a matriz de ETAPA de uma troca que veio do Status 2 —
    -- quem autoriza essa é a matriz do Status 2.
    perform set_config('faceimob.stage_from_status', coalesce(new.id::text, 'novo'), true);
  end if;

  return new;
end;
$$;

revoke all on function public.deals_ab_status_stage() from public, anon, authenticated;

-- `deals_ab_…` para rodar antes de `deals_guard_stage` (BEFORE da mesma tabela
-- dispara em ordem alfabética).
drop trigger if exists deals_ab_status_stage on public.deals;
create trigger deals_ab_status_stage
  before insert or update of status_detail on public.deals
  for each row execute function public.deals_ab_status_stage();

create or replace function public.deals_guard_stage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_block   text;
  v_outcome deal_outcome;
  v_do_status boolean;
begin
  if new.stage_id is distinct from old.stage_id then
    -- Etapa que veio do Status 2 (0164): a troca já passou pela matriz do
    -- Status 2, que é quem manda agora.
    v_do_status := coalesce(current_setting('faceimob.stage_from_status', true), '') = new.id::text;

    if auth.uid() is not null and not v_do_status then
      if not public.can_exit_stage(old.stage_id) then
        raise exception 'Seu papel não pode tirar um negócio deste estágio.'
          using errcode = '42501';
      end if;
      if not public.can_enter_stage(new.stage_id) then
        raise exception 'Seu papel não pode mover um negócio para este estágio.'
          using errcode = '42501';
      end if;
    end if;

    if not v_do_status then
      v_block := public.deal_stage_document_block(
        new.id, new.stage_id, new.document_review_status);
      if v_block is not null then
        raise exception '%', v_block using errcode = 'P0001';
      end if;
    end if;

    select s.outcome into v_outcome
      from public.pipeline_stages s where s.id = new.stage_id;

    new.stage_entered_at := now();
    new.outcome := coalesce(v_outcome, new.outcome);

    if new.outcome <> 'open' and new.closed_at is null then
      new.closed_at := now();
    elsif new.outcome = 'open' then
      new.closed_at := null;
    end if;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Escrita direta do Status 2 também respeita a matriz
-- -----------------------------------------------------------------------------
create or replace function public.deals_guard_status_detail()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_block text;
begin
  if current_user in ('postgres', 'service_role') or public.is_admin() then return new; end if;
  if tg_op = 'UPDATE' and public.deal_status_bare(new.status_detail) is not distinct from public.deal_status_bare(old.status_detail) then
    return new;
  end if;
  if tg_op = 'INSERT' and (new.status_detail is null or public.deal_status_bare(new.status_detail) = 'PROPOSTA') then return new; end if;
  if not public.has_permission('deals.edit_status_detail') then
    raise exception 'Seu perfil não pode alterar o Status 2.' using errcode = '42501',
      hint = 'Permissão Alterar Status 2, em Administração → Permissões → Funcionalidades.';
  end if;

  v_block := public.deal_status_move_block(case when tg_op = 'UPDATE' then old.status_detail end, new.status_detail);
  if v_block is not null then
    raise exception '%', v_block using errcode = '42501';
  end if;

  if exists (select 1 from public.deal_statuses s
              where public.deal_status_bare(s.value) = public.deal_status_bare(new.status_detail)
                and s.requires_note) then
    raise exception 'Este Status 2 pede uma observação: mova o negócio pelo Pipeline.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.deals_guard_status_detail() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Mover o Status 2 (kanban e tabela)
-- -----------------------------------------------------------------------------
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

  update public.deals set status_detail = v_to.value where id = p_deal_id;

  if v_note <> '' then
    insert into public.deal_history (deal_id, actor_id, kind, to_value)
    values (p_deal_id, auth.uid(), 'comment', v_to.label || ': ' || v_note);
  end if;
end;
$$;

comment on function public.move_deal_status(uuid, text, text) is
  'Troca o Status 2 pela matriz deal_status_permissions, com observação obrigatória onde o status pede. A etapa segue pelo gatilho deals_ab_status_stage (0164).';

revoke all on function public.move_deal_status(uuid, text, text) from public, anon;
grant execute on function public.move_deal_status(uuid, text, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Gerente e diretor do negócio também enviam para análise
-- -----------------------------------------------------------------------------
create or replace function public.submit_deal_for_manager_review(
  p_deal_id uuid,
  p_message text,
  p_esteira text default 'agil'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal     public.deals;
  v_previous text;
  v_missing  text;
  v_message  text := btrim(coalesce(p_message, ''));
  v_esteira  text := coalesce(p_esteira, 'agil');
  v_texto    text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if v_esteira not in ('agil', 'virar') then
    raise exception 'Esteira de envio desconhecida: use "agil" ou "virar".' using errcode = 'P0001';
  end if;

  if v_message = '' then
    raise exception 'Escreva a mensagem do envio: ela fica registrada no negócio e avisa a equipe.'
      using errcode = 'P0001';
  end if;

  if length(v_message) > 4000 then
    raise exception 'Mensagem longa demais (máx. 4000 caracteres).' using errcode = 'P0001';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  -- 0164: corretor, gerente ou diretor do negócio (era só o corretor).
  if not public.is_admin() and not exists (
    select 1 from public.deal_participants dp
    where dp.deal_id = p_deal_id
      and dp.profile_id = auth.uid()
      and dp.role in ('broker', 'manager', 'director')
  ) then
    raise exception 'Somente corretor, gerente ou diretor do negócio pode enviar para análise.'
      using errcode = '42501';
  end if;

  if v_deal.document_review_status = 'pending' then
    raise exception 'A documentação já aguarda conferência do gerente.'
      using errcode = 'P0001';
  end if;

  if v_esteira = 'virar' then
    if not exists (
      select 1 from public.cca_cases c
      where c.deal_id = p_deal_id
        and (c.status = 'approved'
             or (c.status = 'pending_documents' and v_deal.review_esteira = 'virar'))
    ) then
      raise exception 'A análise p/ virar negócio é o 2º envio: só vale para negócio com crédito aprovado na CCA.'
        using errcode = 'P0001';
    end if;
  elsif v_deal.document_review_status = 'approved' then
    raise exception 'A documentação deste negócio já foi aprovada.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.deal_participants dp
    where dp.deal_id = p_deal_id and dp.role = 'manager'
  ) then
    raise exception 'Vincule ao menos um gerente ao negócio antes de enviar.'
      using errcode = 'P0001';
  end if;

  if v_deal.developer_id is null then
    raise exception 'Defina a construtora na aba Detalhes antes de enviar ao gerente.'
      using errcode = 'P0001';
  end if;

  select string_agg(dt.label, ', ' order by dt.sort_order) into v_missing
  from public.document_types dt
  where dt.active and dt.required_for_conversion
    and not exists (
      select 1 from public.deal_documents dd
      where dd.deal_id = p_deal_id
        and dd.document_type_id = dt.id
        and dd.superseded_at is null
    );

  if v_missing is not null then
    raise exception 'Faltam documentos obrigatórios: %', v_missing using errcode = 'P0001';
  end if;

  v_previous := v_deal.document_review_status;
  v_texto := case v_esteira
               when 'virar' then 'ENVIO ANÁLISE P/ VIRAR NEGÓCIO: '
               else 'ENVIO ESTEIRA ÁGIL: '
             end || v_message;

  update public.deals
  set document_review_status = 'pending',
      document_review_requested_at = now(),
      document_review_requested_by = auth.uid(),
      document_reviewed_at = null,
      document_reviewed_by = null,
      document_review_reason = null,
      review_esteira = v_esteira
  where id = p_deal_id;

  insert into public.deal_history
    (deal_id, actor_id, kind, from_value, to_value)
  values
    (p_deal_id, auth.uid(), 'document_review_requested', v_previous, 'pending');

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, auth.uid(), 'comment', v_texto);

  insert into public.deal_history (deal_id, actor_id, kind, detail)
  values (p_deal_id, auth.uid(), 'esteira_sent', jsonb_build_object('esteira', v_esteira));

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct dp.profile_id,
         'document_review_requested',
         'Documentos para conferir: ' || v_deal.code,
         left(v_texto, 2000),
         '/pipeline',
         'in_app'::notification_channel
  from public.deal_participants dp
  where dp.deal_id = p_deal_id and dp.role = 'manager';

  return jsonb_build_object('status', 'pending', 'esteira', v_esteira);
end;
$$;

comment on function public.submit_deal_for_manager_review(uuid, text, text) is
  'Corretor, gerente ou diretor do negócio (0164) envia o dossiê ao gerente com mensagem obrigatória, pela esteira agil (1º envio) ou virar (2º envio, só com crédito aprovado na CCA). Grava comentário, evento esteira_sent e avisa os gerentes com a mensagem (0150).';

revoke all on function public.submit_deal_for_manager_review(uuid, text, text) from public, anon;
grant execute on function public.submit_deal_for_manager_review(uuid, text, text)
  to authenticated, service_role;
