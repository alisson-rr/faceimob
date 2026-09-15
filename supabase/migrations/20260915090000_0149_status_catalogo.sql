-- =============================================================================
-- 0149 · Status 1 ganha catálogo próprio e acompanha o Status 2
--
-- PEDIDO DO CLIENTE, 14/09/2026. "Status 1" não é a etapa do funil: é uma lista
-- própria (VENDA, PROPOSTA, LEGADO, DISTRATO, OFF), e cada Status 2 pertence a
-- um Status 1. Trocar o Status 2 leva o Status 1 junto ("02. ASS. BANCO" →
-- VENDA), sem trava: o Status 1 pode ser trocado à mão depois. O administrador
-- cadastra, ativa e desativa os dois pela tela.
--
-- O QUE HAVIA ATÉ AQUI. Não existia coluna de Status 1. A tela deduzia um pelo
-- desfecho (`legacyStatus`, src/integrations/supabase/newSchema.ts) e o Status 2
-- era lista fixa no front (src/components/pipeline/statuses.ts). Nenhum dos dois
-- pedidos cabia: não havia onde gravar a troca manual, e status novo exigia
-- deploy.
--
-- O DESENHO:
--   1. `deal_status_groups` (Status 1) e `deal_statuses` (Status 2). `code` e
--      `value` são imutáveis: `value` é o texto que já está em
--      `deals.status_detail` e que `LOSS_REASONS`, `SYSTEM_STATUSES`,
--      `deals_guard_status_columns` e `cca_cases_sync_esteira_label` citam pelo
--      texto. O que a tela mostra é `label`, e esse muda.
--   2. `deals.status_group_id`, preenchido num gatilho BEFORE, que é o único
--      ponto por onde passam a tela, as RPCs e o próprio banco (a esteira grava
--      o Status 2 por `cca_cases_sync_esteira_label`).
--   3. Trocar o Status 1 à mão exige `deals.edit_status_group`; escrever no
--      catálogo exige `deals.manage_statuses`. Os dois nascem com admin e sócio.
--   4. Backfill de todos os negócios sem mexer em `updated_at`, etapa, desfecho
--      ou data de fechamento.
--
-- O QUE NÃO MUDA:
--   · Etapa e desfecho seguem como estão. Status 1 é classificação, não trava
--     de funil.
--   · `status_detail` continua texto, sem FK para o catálogo: rótulo importado
--     fora da lista continua gravável e fica com Status 1 nulo. Não se inventa
--     grupo.
--   · OFF e DISTRATO continuam só de admin e sócio (`deals_guard_status_columns`,
--     0111).
--
-- CONSEQUÊNCIAS ASSUMIDAS:
--   · Mudar um Status 2 de grupo no CATÁLOGO não reclassifica os negócios que já
--     o têm. O Status 1 acompanha o Status 2 no momento da troca; reescrever
--     milhares de negócios por um clique no cadastro apagaria as trocas manuais.
--   · Negócio sem Status 2: perdido sem "distrato" no motivo dá OFF (a tela
--     dizia QUEDA, e "18. QUEDA" é OFF na tabela do cliente); `cancelled` segue
--     `legacyStatus` e dá PROPOSTA.
--   · O backfill gera um evento de Realtime por negócio (7.579 na homologação).
--     O Pipeline agrupa a rajada numa recarga só (`usePipelineRealtime`, 1,5 s).
--
-- Idempotente: `if not exists`, `create or replace`, `on conflict do nothing`
-- (o catálogo semeado não sobrescreve o que o admin mudou pela tela), e o
-- backfill só preenche quem ainda está nulo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Status 1
-- -----------------------------------------------------------------------------
create table if not exists public.deal_status_groups (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (btrim(code) <> '' and char_length(code) <= 40),
  label      text not null check (btrim(label) <> '' and char_length(label) <= 80),
  position   int  not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.deal_status_groups is
  'Status 1 do negócio (VENDA, PROPOSTA, LEGADO, DISTRATO, OFF). code é imutável; label, position e active são da tela de cadastro (0149).';

-- -----------------------------------------------------------------------------
-- 2. Status 2
-- -----------------------------------------------------------------------------
create table if not exists public.deal_statuses (
  id         uuid primary key default gen_random_uuid(),
  value      text not null check (btrim(value) <> '' and char_length(value) <= 80),
  label      text not null check (btrim(label) <> '' and char_length(label) <= 80),
  group_id   uuid not null references public.deal_status_groups(id),
  position   int  not null,
  tone       text not null default 'neutral'
             check (tone in ('info', 'warning', 'success', 'danger', 'highlight', 'neutral')),
  active     boolean not null default true,
  locked     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.deal_statuses is
  'Status 2 do negócio. value é o texto gravado em deals.status_detail (imutável); label é o nome exibido. locked = citado pelo texto em regra do banco ou do front: não desativa (0149).';

-- Um rótulo só por texto normalizado. "RC EMITIDA" e "01. RC EMITIDA" são o
-- mesmo Status 2 para `deal_status_bare` e para `bareStatus` do front; com os
-- dois no catálogo o negócio cairia em um ou outro conforme a ordem da busca.
-- O `replace` do NBSP vem antes porque `btrim` não o apara, e rótulo copiado do
-- Bubble pode trazê-lo.
create unique index if not exists deal_statuses_value_bare_key
  on public.deal_statuses (public.deal_status_bare(replace(value, chr(160), ' ')));

-- -----------------------------------------------------------------------------
-- 3. Guarda do catálogo
-- -----------------------------------------------------------------------------
create or replace function public.deal_status_catalog_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  -- Não é `security definer` pelo motivo da 0101: dentro dela `current_user`
  -- seria o dono, e o escape valeria para todo mundo.
  v_priv boolean := current_user in ('postgres', 'service_role');
  v_bare text;
begin
  if tg_table_name = 'deal_status_groups' then
    if tg_op = 'UPDATE' and new.code is distinct from old.code then
      raise exception 'O código do Status 1 não muda depois de criado. Troque o nome exibido.'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- O negócio guarda o TEXTO, não o id: trocar o value deixaria órfãos todos
    -- os negócios que o usam.
    if new.value is distinct from old.value then
      raise exception 'O texto gravado do Status 2 não muda depois de criado: os negócios guardam esse texto. Troque o nome exibido.'
        using errcode = 'P0001';
    end if;
    if new.locked is distinct from old.locked and not v_priv then
      raise exception 'A trava de um status é do sistema e não muda pela tela.'
        using errcode = '42501';
    end if;
    -- `old.locked`: destravar e desativar no mesmo comando seria o atalho.
    if old.locked and old.active and not new.active then
      raise exception 'O status "%" é usado por regras do sistema e não pode ser desativado.', old.value
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  new.label := coalesce(nullif(btrim(new.label), ''),
                        regexp_replace(btrim(new.value), '^\d+\.\s*', ''));

  if not v_priv then
    if new.locked then
      raise exception 'A trava de um status é do sistema e não muda pela tela.'
        using errcode = '42501';
    end if;

    -- `normalizeStatus`/`isLossStatus` (src/lib/dealStatus.ts) e a trava de OFF
    -- e DISTRATO (0111, `^(OFF|DISTRATO)\M`) leem estes textos como desfecho:
    -- um Status 2 novo chamado "DISTRATO AMIGÁVEL" encerraria negócio e
    -- exigiria admin sem ninguém ter pedido isso.
    v_bare := public.deal_status_bare(replace(new.value, chr(160), ' '));
    if v_bare in ('VENDA', 'PROPOSTA', 'QUEDA') or v_bare ~ '^(OFF|DISTRATO)\M' then
      raise exception 'O texto "%" é reservado: o sistema o trata como desfecho do negócio. Escolha outro nome.', new.value
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.deal_status_catalog_guard() from public, anon, authenticated;

drop trigger if exists deal_status_groups_guard on public.deal_status_groups;
create trigger deal_status_groups_guard
  before insert or update on public.deal_status_groups
  for each row execute function public.deal_status_catalog_guard();

drop trigger if exists deal_status_groups_set_updated_at on public.deal_status_groups;
create trigger deal_status_groups_set_updated_at
  before update on public.deal_status_groups
  for each row execute function public.set_updated_at();

drop trigger if exists deal_statuses_guard on public.deal_statuses;
create trigger deal_statuses_guard
  before insert or update on public.deal_statuses
  for each row execute function public.deal_status_catalog_guard();

drop trigger if exists deal_statuses_set_updated_at on public.deal_statuses;
create trigger deal_statuses_set_updated_at
  before update on public.deal_statuses
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Permissões e RLS
-- -----------------------------------------------------------------------------
insert into public.permissions (code, label, category, description) values
  (
    'deals.manage_statuses',
    'Cadastrar status do negócio',
    'negocios',
    'Criar, renomear, reordenar, ativar e desativar o Status 1 e o Status 2. Não muda o status de nenhum negócio, e os status usados por regras do sistema não se desativam.'
  ),
  (
    'deals.edit_status_group',
    'Trocar o Status 1 à mão',
    'negocios',
    'O Status 1 acompanha o Status 2 sozinho. Com esta permissão dá para trocá-lo à mão num negócio; a troca vale até o Status 2 mudar de novo.'
  )
on conflict (code) do update
  set label = excluded.label,
      category = excluded.category,
      description = excluded.description;

-- Redundantes para a autorização (`has_permission` curto-circuita em
-- `is_admin()`) e necessárias para a tela não mostrar interruptor desligado que
-- funciona. Mesma razão da 0101.
insert into public.role_permissions (role, permission, allowed) values
  ('admin',   'deals.manage_statuses',   true),
  ('partner', 'deals.manage_statuses',   true),
  ('admin',   'deals.edit_status_group', true),
  ('partner', 'deals.edit_status_group', true)
on conflict (role, permission) do nothing;

alter table public.deal_status_groups enable row level security;
alter table public.deal_statuses      enable row level security;

drop policy if exists deal_status_groups_select on public.deal_status_groups;
create policy deal_status_groups_select on public.deal_status_groups
  for select to authenticated
  using (true);

drop policy if exists deal_status_groups_insert on public.deal_status_groups;
create policy deal_status_groups_insert on public.deal_status_groups
  for insert to authenticated
  with check (public.has_permission('deals.manage_statuses'));

drop policy if exists deal_status_groups_update on public.deal_status_groups;
create policy deal_status_groups_update on public.deal_status_groups
  for update to authenticated
  using (public.has_permission('deals.manage_statuses'))
  with check (public.has_permission('deals.manage_statuses'));

drop policy if exists deal_statuses_select on public.deal_statuses;
create policy deal_statuses_select on public.deal_statuses
  for select to authenticated
  using (true);

drop policy if exists deal_statuses_insert on public.deal_statuses;
create policy deal_statuses_insert on public.deal_statuses
  for insert to authenticated
  with check (public.has_permission('deals.manage_statuses'));

drop policy if exists deal_statuses_update on public.deal_statuses;
create policy deal_statuses_update on public.deal_statuses
  for update to authenticated
  using (public.has_permission('deals.manage_statuses'))
  with check (public.has_permission('deals.manage_statuses'));

-- Sem exclusão: um status que algum negócio usa não pode sumir, e desativar
-- cobre o pedido. A 0023 concede DML a `anon` e DELETE a `authenticated` em
-- toda tabela nova; aqui nenhum dos dois faz sentido.
revoke all on public.deal_status_groups, public.deal_statuses from anon;
revoke delete on public.deal_status_groups, public.deal_statuses from authenticated;
grant select, insert, update on public.deal_status_groups, public.deal_statuses to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Semente, na ordem e com os grupos da tabela do cliente
-- -----------------------------------------------------------------------------
insert into public.deal_status_groups (code, label, position) values
  ('VENDA',    'VENDA',    1),
  ('PROPOSTA', 'PROPOSTA', 2),
  ('LEGADO',   'LEGADO',   3),
  ('DISTRATO', 'DISTRATO', 4),
  ('OFF',      'OFF',      5)
on conflict (code) do nothing;

-- Tons de src/components/pipeline/statuses.ts. "01. RC EMITIDA" herda o tom de
-- "PROPOSTA", que ocupava o lugar dele lá. Fora da tabela do cliente:
--   · 'OFF' (grupo OFF, ativo): é o desfecho que só admin marca, e 4.409
--     negócios da homologação o têm;
--   · 'PROPOSTA' (grupo PROPOSTA, inativo): é o rótulo que a tela mostra para
--     negócio sem Status 2 e não se escolhe.
-- `locked` marca quem é citado pelo texto em regra: os dois rótulos do sistema
-- (0037/0059), "15. ANÁLISE P/ VIRAR NEGÓCIO" (rótulo de sistema na 0150), os
-- que `cca_cases_sync_esteira_label` grava e os desfechos.
insert into public.deal_statuses (value, group_id, position, tone, active, locked)
select s.value, g.id, s.position, s.tone, s.active, s.locked
  from (values
    ('VENDA',    '01. RC EMITIDA',                 1, 'info',      true,  false),
    ('VENDA',    '02. ASS. BANCO',                 2, 'info',      true,  false),
    ('VENDA',    '03. ASSINADO',                   3, 'success',   true,  false),
    ('VENDA',    '04. EM CONTRATO',                4, 'info',      true,  false),

    ('PROPOSTA', '05. RP APROVADO',                1, 'success',   true,  false),
    ('PROPOSTA', '06. ENVIO DE RP',                2, 'info',      true,  false),
    ('PROPOSTA', '08. VIROU NEGÓCIO',              3, 'highlight', true,  false),
    ('PROPOSTA', '14. PENDENTE P/ VIRAR NEGÓCIO',  4, 'warning',   true,  false),
    ('PROPOSTA', '15. ANÁLISE P/ VIRAR NEGÓCIO',   5, 'warning',   true,  true),
    ('PROPOSTA', 'MUDAR CONSTRUTORA P/ NEGÓCIO',   6, 'warning',   true,  false),
    ('PROPOSTA', '09. APROV. TOTAL',               7, 'success',   true,  true),
    ('PROPOSTA', '10. APROV. COND.',               8, 'warning',   true,  false),
    ('PROPOSTA', '07. APROV. AG. CONT.',           9, 'warning',   true,  false),
    ('PROPOSTA', '11. AG. RET. AGENCIA',          10, 'warning',   true,  false),
    ('PROPOSTA', '12. EM PROCESSAMENTO',          11, 'info',      true,  false),
    ('PROPOSTA', '13. ESTEIRA AGIL',              12, 'success',   true,  true),
    ('PROPOSTA', 'RET. ESTEIRA AGIL',             13, 'success',   true,  true),
    ('PROPOSTA', '16. PENDENTE',                  14, 'warning',   true,  false),
    ('PROPOSTA', 'PROPOSTA',                      15, 'info',      false, true),

    ('LEGADO',   'ANÁLISE P/ POTENCIAL',           1, 'info',      true,  false),
    ('LEGADO',   'ANÁLISE EXTERNA',                2, 'info',      true,  true),
    ('LEGADO',   'APROV. TOT. RESTRIÇÃO',          3, 'danger',    true,  false),
    ('LEGADO',   'APROV. COND. RESTRIÇÃO',         4, 'danger',    true,  false),
    ('LEGADO',   'APROVADO POTENCIAL',             5, 'success',   true,  false),
    ('LEGADO',   '15. INTERNALIZADO',              6, 'info',      true,  false),
    ('LEGADO',   'PENDENTE C/ RESTRIÇÃO',          7, 'warning',   true,  false),
    ('LEGADO',   '19. REPROVADO',                  8, 'danger',    true,  true),
    ('LEGADO',   '20. BACEN',                      9, 'warning',   true,  false),
    ('LEGADO',   '21. RESTRIÇÃO',                 10, 'warning',   true,  false),
    ('LEGADO',   'INCOMPLETO',                    11, 'danger',    true,  false),
    ('LEGADO',   'COMPRA ASSISTIDA',              12, 'success',   true,  false),

    ('DISTRATO', '17. DISTRATO',                   1, 'danger',    true,  true),

    ('OFF',      '18. QUEDA',                      1, 'danger',    true,  true),
    ('OFF',      'OFF',                            2, 'neutral',   true,  true)
  ) as s(group_code, value, position, tone, active, locked)
  join public.deal_status_groups g on g.code = s.group_code
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 6. Status 1 no negócio
-- -----------------------------------------------------------------------------
alter table public.deals
  add column if not exists status_group_id uuid references public.deal_status_groups(id);

create index if not exists deals_status_group_id_idx on public.deals (status_group_id);

comment on column public.deals.status_group_id is
  'Status 1. Acompanha o Status 2 (status_detail) pelo catálogo deal_statuses; troca manual exige deals.edit_status_group e vale até o Status 2 mudar (0149).';

-- `security definer`: a resposta não pode depender de quem pergunta (mesma ideia
-- da 0148). Uma policy de leitura mais apertada no catálogo faria o mesmo
-- Status 2 dar grupo para um usuário e nulo para outro.
create or replace function public.deal_status_group_for(
  p_status_detail text,
  p_outcome       public.deal_outcome,
  p_lost_reason   text
)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    -- Sem Status 2: a mesma dedução de `legacyStatus`, com QUEDA → OFF porque é
    -- onde "18. QUEDA" está na tabela do cliente. Texto em branco conta como
    -- nulo, como no `status_detail || legacyStatus(...)` do front.
    when nullif(btrim(replace(coalesce(p_status_detail, ''), chr(160), ' ')), '') is null then
      (select g.id
         from public.deal_status_groups g
        where g.code = case p_outcome
                         when 'won'  then 'VENDA'
                         when 'lost' then case when coalesce(p_lost_reason, '') ~* 'distrato'
                                               then 'DISTRATO' else 'OFF' end
                         else 'PROPOSTA'
                       end)
    -- Com Status 2: o grupo do catálogo, comparando sem prefixo numerado. Fora
    -- do catálogo, nulo.
    else
      (select s.group_id
         from public.deal_statuses s
        where public.deal_status_bare(replace(s.value, chr(160), ' '))
            = public.deal_status_bare(replace(p_status_detail, chr(160), ' ')))
  end;
$$;

-- `authenticated` precisa de EXECUTE: o gatilho abaixo roda como o usuário.
revoke all on function public.deal_status_group_for(text, public.deal_outcome, text) from public, anon;
grant execute on function public.deal_status_group_for(text, public.deal_outcome, text) to authenticated, service_role;

comment on function public.deal_status_group_for(text, public.deal_outcome, text) is
  'Status 1 de um negócio: pelo catálogo deal_statuses quando há Status 2 (sem prefixo numerado, NBSP normalizado; fora do catálogo = nulo); sem Status 2, won→VENDA, lost→DISTRATO se o motivo cita distrato senão OFF, resto→PROPOSTA (0149).';

create or replace function public.deals_sync_status_group()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_manual boolean;
begin
  -- Não é `security definer`: o escape abaixo depende de `current_user` (0101).
  if tg_op = 'INSERT' then
    if new.status_group_id is null then
      new.status_group_id := public.deal_status_group_for(new.status_detail, new.outcome, new.lost_reason);
      return new;
    end if;
    v_manual := new.status_group_id is distinct from
                public.deal_status_group_for(new.status_detail, new.outcome, new.lost_reason);

  elsif new.status_group_id is distinct from old.status_group_id then
    -- Trocado no mesmo comando: vale o que veio. Mandar o mesmo grupo que a
    -- derivação daria não é troca manual.
    v_manual := new.status_group_id is distinct from
                public.deal_status_group_for(new.status_detail, new.outcome, new.lost_reason);

  else
    -- Só deriva quando o Status 2 muda de fato. Reenviar o mesmo valor é o que
    -- `legacyDealFields` faz em todo salvamento, e não pode apagar a troca
    -- manual. Sem Status 2 a dedução vem do desfecho e do motivo.
    if new.status_detail is distinct from old.status_detail
       or (nullif(btrim(new.status_detail), '') is null
           and (new.outcome is distinct from old.outcome
                or new.lost_reason is distinct from old.lost_reason)) then
      new.status_group_id := public.deal_status_group_for(new.status_detail, new.outcome, new.lost_reason);
    end if;
    return new;
  end if;

  if v_manual
     and current_user not in ('postgres', 'service_role')
     and not public.has_permission('deals.edit_status_group') then
    raise exception 'Só administrador e sócio trocam o Status 1 à mão. Troque o Status 2 e o Status 1 acompanha.'
      using errcode = '42501',
            hint = 'Permissão deals.edit_status_group, em Admin · Permissões.';
  end if;

  return new;
end;
$$;

revoke all on function public.deals_sync_status_group() from public, anon, authenticated;

-- O NOME importa: BEFORE dispara em ordem alfabética, e este precisa ver o
-- `outcome` que `deals_guard_stage` (UPDATE) e `deals_guard_status_columns`
-- (INSERT) acabaram de derivar da etapa. `stage_id` está na lista porque
-- `UPDATE OF` olha as colunas do SET, não as que um gatilho anterior mudou:
-- mover de etapa troca o desfecho sem citar `outcome`.
drop trigger if exists deals_sync_status_group on public.deals;
create trigger deals_sync_status_group
  before insert or update of status_detail, status_group_id, outcome, lost_reason, stage_id
  on public.deals
  for each row execute function public.deals_sync_status_group();

comment on function public.deals_sync_status_group() is
  'Status 1 acompanha o Status 2: deriva no INSERT sem grupo e no UPDATE que muda status_detail (ou desfecho/motivo sem Status 2) sem mudar status_group_id; troca manual diferente da derivação exige deals.edit_status_group. postgres e service_role passam (0149).';

-- -----------------------------------------------------------------------------
-- 7. Backfill
-- -----------------------------------------------------------------------------
-- Gatilhos de `deals` conferidos por pg_trigger na homologação em 15/09/2026,
-- para um UPDATE que só muda `status_detail`/`status_group_id` rodando como
-- postgres:
--   · `deals_set_updated_at` carimbaria os 7.579 negócios como editados agora:
--     DESLIGADO durante o backfill.
--   · `deals_guard_closed_month` recusa quem não é `is_admin()`, e a migration
--     não tem `auth.uid()`: um mês fechado derrubaria o backfill. DESLIGADO
--     durante o backfill. Hoje a homologação não tem mês fechado.
--   · `deals_guard_stage`, `deals_guard_value`, `deals_log_changes`: só agem
--     quando etapa ou valor mudam.
--   · `deals_guard_document_review`, `deals_guard_status_columns`,
--     `deals_guard_esteira_label`: `postgres` passa.
--   · `deals_award_points`: sai antes de tudo quando o desfecho não muda. Sem
--     pontos e sem notificação.
-- Tudo num `do` só: se qualquer passo falhar, o comando inteiro volta, e os
-- gatilhos voltam ligados junto. O `alter table` segura `deals` pelos poucos
-- segundos do update.
do $$
begin
  alter table public.deals disable trigger deals_set_updated_at;
  alter table public.deals disable trigger deals_guard_closed_month;

  -- O único rótulo do Bubble sem número (1 negócio na homologação).
  update public.deals
     set status_detail = '01. RC EMITIDA'
   where public.deal_status_bare(replace(status_detail, chr(160), ' ')) = 'RC EMITIDA'
     and status_detail is distinct from '01. RC EMITIDA';

  update public.deals
     set status_group_id = public.deal_status_group_for(status_detail, outcome, lost_reason)
   where status_group_id is null
     and public.deal_status_group_for(status_detail, outcome, lost_reason) is not null;

  alter table public.deals enable trigger deals_set_updated_at;
  alter table public.deals enable trigger deals_guard_closed_month;
end
$$;
