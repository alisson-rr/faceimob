-- =============================================================================
-- 0012 · Correções da auditoria de CRUD
--
-- Seis achados, todos reproduzidos em teste antes da correção:
--
--  1. [segurança] Corretor alterava o próprio bypass_ip_check e derrubava
--     inteira a trava de IP do check-in.
--  2. [segurança] Corretor alterava o próprio status (podia se reativar depois
--     de suspenso pelo gestor).
--  3. [função]    Corretor não conseguia fazer check-out do próprio check-in.
--  4. [função]    Negócio criado manualmente nascia sem participante, ficando
--     invisível e ineditável para quem o criou. Com .select() do supabase-js o
--     INSERT nem passava.
--  5. [segurança] Corretor inseria comentário em lead de outra equipe passando
--     o UUID direto.
--  6. [função]    deal_clients: DELETE era regido pelo USING de leitura, mais
--     permissivo que INSERT/UPDATE.
--
-- Mais três superfícies de CRUD que o frontend usa e não existiam:
-- cca_stages, annual_results e os buckets de storage.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 e 2. Colunas administrativas do perfil
--
-- RLS trabalha por linha, não por coluna: a policy profiles_update_self libera
-- a linha inteira. A restrição por coluna precisa de trigger.
-- -----------------------------------------------------------------------------
create or replace function public.profiles_guard_admin_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  -- Gestor pode desligar/suspender quem gerencia, mas nunca liberar o bypass
  -- de IP: é justamente a trava antifraude do check-in.
  if public.manages_profile(new.id) then
    if new.bypass_ip_check is distinct from old.bypass_ip_check then
      raise exception 'Somente o administrador libera a validação de IP.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- O próprio usuário só edita dados de contato.
  if new.status          is distinct from old.status
  or new.bypass_ip_check is distinct from old.bypass_ip_check
  or new.email           is distinct from old.email
  or new.terminated_at   is distinct from old.terminated_at
  or new.hired_at        is distinct from old.hired_at then
    raise exception 'Campos administrativos do perfil só podem ser alterados pelo administrador.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_admin_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_admin_columns();

-- -----------------------------------------------------------------------------
-- 3. Check-out do próprio turno
--
-- A policy de checkins exigia manages_profile(), que é falso para si mesmo —
-- o corretor conseguia entrar (via RPC) mas nunca sair.
-- Só o encerramento é liberado; abrir check-in continua exclusivo da RPC, que
-- valida IP, turno e bloqueio por atraso.
-- -----------------------------------------------------------------------------
create policy checkins_self_checkout on public.checkins
  for update to authenticated
  using (profile_id = auth.uid() and checked_out_at is null)
  with check (profile_id = auth.uid());

create or replace function public.perform_checkout()
returns public.checkins
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.checkins;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  update public.checkins
     set checked_out_at = now()
   where profile_id = auth.uid()
     and work_date = current_date
     and checked_out_at is null
  returning * into v_row;

  if not found then
    raise exception 'Nenhum check-in aberto hoje.' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

-- Fecha os turnos que passaram do horário. Para rodar por cron.
create or replace function public.auto_checkout_expired()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  with fechados as (
    update public.checkins c
       set checked_out_at = now(), auto_checkout = true
      from public.work_shifts s
     where s.id = c.shift_id
       and c.checked_out_at is null
       and (
         c.work_date < current_date
         or (now() at time zone 'America/Sao_Paulo')::time > s.checkout_time
       )
    returning c.id
  )
  select count(*) into v_count from fechados;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Negócio manual nasce com participante
--
-- Sem isso, can_see_deal()/can_edit_deal() retornam falso para o próprio autor,
-- porque ambos dependem de haver linha em deal_participants.
-- Conversão de lead é ignorada de propósito: convert_lead_to_deal() já insere o
-- dono do lead, que nem sempre é quem está executando.
-- -----------------------------------------------------------------------------
create or replace function public.deals_add_creator_participant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_who uuid := coalesce(new.created_by, auth.uid());
begin
  if new.lead_id is not null then
    return null;   -- veio de convert_lead_to_deal, que cuida do participante
  end if;

  if v_who is null then
    return null;   -- criado por service_role sem contexto de usuário
  end if;

  insert into public.deal_participants (deal_id, profile_id, role)
  values (new.id, v_who, 'broker')
  on conflict (deal_id, profile_id, role) do nothing;

  return null;
end;
$$;

create trigger deals_add_creator_participant
  after insert on public.deals
  for each row execute function public.deals_add_creator_participant();

-- created_by passa a ser preenchido sozinho: sem ele o trigger acima não tem
-- em quem se apoiar quando o INSERT vem do client sem o campo.
alter table public.deals
  alter column created_by set default auth.uid();

-- O trigger acima resolve o rateio, mas não a visibilidade do INSERT:
-- em `INSERT ... RETURNING` o Postgres avalia a policy de SELECT contra a linha
-- nova ANTES de disparar os triggers AFTER, então deal_participants ainda está
-- vazio nesse instante. A autoria tem que ser lida da própria linha.
drop policy deals_select on public.deals;
drop policy deals_update on public.deals;

create policy deals_select on public.deals
  for select to authenticated
  using (
    created_by = auth.uid()
    or public.can_see_deal(id)
    or public.has_role('cca')
  );

create policy deals_update on public.deals
  for update to authenticated
  using (created_by = auth.uid() or public.can_edit_deal(id))
  with check (created_by = auth.uid() or public.can_edit_deal(id));

-- -----------------------------------------------------------------------------
-- 5. Comentário só em lead visível
--
-- O WITH CHECK antigo validava apenas a autoria, então bastava conhecer o UUID
-- do lead para injetar comentário no histórico de outra equipe.
-- -----------------------------------------------------------------------------
drop policy lead_comments_insert on public.lead_comments;

create policy lead_comments_insert on public.lead_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.leads l
      where l.id = lead_comments.lead_id
        and (
          l.assigned_to in (select public.auth_visible_profiles())
          or public.has_any_role('admin','director','cca')
        )
    )
  );

-- -----------------------------------------------------------------------------
-- 6. deal_clients: leitura e escrita com regras distintas
--
-- A policy única FOR ALL usava can_see_deal no USING, o que tornava o DELETE
-- mais permissivo que o INSERT.
-- -----------------------------------------------------------------------------
drop policy deal_clients_all on public.deal_clients;

create policy deal_clients_select on public.deal_clients
  for select to authenticated
  using (public.can_see_deal(deal_id) or public.has_role('cca'));

-- Incluir e corrigir: vale para quem edita o negócio, CCA incluído — corrigir
-- um CPF errado faz parte da análise de crédito.
create policy deal_clients_insert on public.deal_clients
  for insert to authenticated
  with check (public.can_edit_deal(deal_id));

create policy deal_clients_update on public.deal_clients
  for update to authenticated
  using (public.can_edit_deal(deal_id))
  with check (public.can_edit_deal(deal_id));

-- Excluir o comprador é ato do comercial, não da análise: o CCA fica de fora.
create policy deal_clients_delete on public.deal_clients
  for delete to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.deal_participants dp
      where dp.deal_id = deal_clients.deal_id
        and (dp.profile_id = auth.uid() or public.manages_profile(dp.profile_id))
    )
  );

-- =============================================================================
-- Superfícies de CRUD que faltavam
-- =============================================================================

-- -----------------------------------------------------------------------------
-- cca_stages — a tela do CCA cria, renomeia, recolore e exclui estágios.
-- O enum cca_status continua existindo para o desfecho macro (o que relatório
-- e automação consultam); a coluna de estágio é que passa a ser configurável.
-- Mesmo padrão já usado em pipeline_stages + deal_outcome.
-- -----------------------------------------------------------------------------
create table public.cca_stages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text not null default '#94a3b8',
  position   int  not null default 0,
  -- Para onde este estágio mapeia no ciclo fixo.
  status     cca_status not null default 'under_review',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cca_stages_position_idx on public.cca_stages (position) where active;

create trigger cca_stages_set_updated_at
  before update on public.cca_stages
  for each row execute function public.set_updated_at();

alter table public.cca_cases
  add column stage_id uuid references public.cca_stages(id) on delete set null;

create index cca_cases_stage_idx on public.cca_cases (stage_id);

alter table public.cca_stages enable row level security;

create policy cca_stages_select on public.cca_stages
  for select to authenticated using (true);
create policy cca_stages_write on public.cca_stages
  for all to authenticated
  using (public.has_any_role('admin','cca'))
  with check (public.has_any_role('admin','cca'));

-- -----------------------------------------------------------------------------
-- annual_results — consolidado anual editado à mão, por ano/mês.
--
-- "Ajustar a lógica de soma dos relatórios anuais para corrigir discrepâncias
--  de dados encontradas no sistema anterior."
-- Fica como lançamento manual auditável em vez de agregação implícita: é o que
-- a tela de Resultados já faz (upsert em year,month).
-- -----------------------------------------------------------------------------
create table public.annual_results (
  id          uuid primary key default gen_random_uuid(),
  year        int not null check (year between 2000 and 2100),
  month       int not null check (month between 1 and 12),
  sales_count int not null default 0 check (sales_count >= 0),
  vgv         numeric(14,2) not null default 0 check (vgv >= 0),
  notes       text,
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (year, month)
);

create trigger annual_results_set_updated_at
  before update on public.annual_results
  for each row execute function public.set_updated_at();

alter table public.annual_results enable row level security;

create policy annual_results_select on public.annual_results
  for select to authenticated
  using (public.has_any_role('admin','director','partner','manager','marketing'));

create policy annual_results_write on public.annual_results
  for all to authenticated
  using (public.has_any_role('admin','director'))
  with check (public.has_any_role('admin','director'));

-- -----------------------------------------------------------------------------
-- notifications: faltava INSERT. Sem ele o admin não consegue disparar aviso
-- manual — só os triggers escreviam.
-- -----------------------------------------------------------------------------
create policy notifications_insert on public.notifications
  for insert to authenticated
  with check (public.has_any_role('admin','director','manager'));

-- O usuário pode dispensar o próprio aviso.
create policy notifications_delete on public.notifications
  for delete to authenticated
  using (profile_id = auth.uid());

-- =============================================================================
-- Storage
--
-- Três buckets privados. O frontend já usa "avatars" e "lead-attachments" com
-- URL assinada; "deal-documents" é o destino dos documentos do negócio.
--
-- Em projeto Supabase real, storage.objects já vem com RLS habilitada e é de
-- supabase_storage_admin; aqui só inserimos os buckets e criamos as policies.
-- O bloco tolera ambiente sem o schema completo (harness local).
-- =============================================================================
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'schema storage ausente - buckets ignorados (ambiente de teste)';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values
    ('avatars',          'avatars',          false),
    ('lead-attachments', 'lead-attachments', false),
    ('deal-documents',   'deal-documents',   false)
  on conflict (id) do nothing;
end
$$;

-- Policies de storage. Separadas num bloco próprio porque dependem de colunas
-- (owner, bucket_id) que só existem no storage real.
do $$
begin
  -- storage.foldername só existe no storage real do Supabase; sua ausência
  -- indica o harness local, onde não há o que politizar.
  if to_regclass('storage.objects') is null
     or to_regprocedure('storage.foldername(text)') is null then
    raise notice 'storage do Supabase ausente - policies de bucket ignoradas (ambiente de teste)';
    return;
  end if;

  -- Avatar: qualquer autenticado lê (aparece nas listagens de equipe);
  -- só o dono ou o admin escreve, e sempre dentro da própria pasta.
  execute 'drop policy if exists avatars_read on storage.objects';
  execute $p$
    create policy avatars_read on storage.objects
      for select to authenticated
      using (bucket_id = 'avatars')
  $p$;

  execute 'drop policy if exists avatars_write on storage.objects';
  execute $p$
    create policy avatars_write on storage.objects
      for all to authenticated
      using (
        bucket_id = 'avatars'
        and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
      )
      with check (
        bucket_id = 'avatars'
        and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
      )
  $p$;

  -- Anexos: a autorização real está na linha de lead_attachments /
  -- deal_documents. O bucket só confirma que existe registro correspondente
  -- que o usuário enxerga.
  execute 'drop policy if exists lead_attachments_storage on storage.objects';
  execute $p$
    create policy lead_attachments_storage on storage.objects
      for all to authenticated
      using (
        bucket_id = 'lead-attachments'
        and exists (
          select 1 from public.lead_attachments a
          where a.storage_path = storage.objects.name
        )
      )
      with check (bucket_id = 'lead-attachments')
  $p$;

  execute 'drop policy if exists deal_documents_storage on storage.objects';
  execute $p$
    create policy deal_documents_storage on storage.objects
      for all to authenticated
      using (
        bucket_id = 'deal-documents'
        and exists (
          select 1 from public.deal_documents d
          where d.storage_path = storage.objects.name
            and public.can_see_deal(d.deal_id)
        )
      )
      with check (bucket_id = 'deal-documents')
  $p$;
exception
  when insufficient_privilege then
    raise notice 'sem privilégio para criar policies em storage.objects - aplicar pelo painel do Supabase';
end
$$;

-- Grants das novas RPCs.
revoke all on function public.perform_checkout()      from public, anon;
revoke all on function public.auto_checkout_expired() from public, anon;
grant execute on function public.perform_checkout()      to authenticated;
grant execute on function public.auto_checkout_expired() to service_role;
