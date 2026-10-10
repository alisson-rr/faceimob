-- =============================================================================
-- 0264 · Candidatos: fora da roleta de leads, coletados pelos gestores
--
-- Reclamação de 10/10/2026 (Victor, grupo Candidatos): "leads corretor tá
-- floodando minha timeline", "não dá pra diferenciar o que é lead do que é
-- corretor", "30 pop-ups em 10 minutos". Decisão do cliente: candidato não é
-- lead. Quem a Luna aprova vira um CANDIDATO, sem roleta, grupo nem aviso;
-- gerentes e diretores veem todos os disponíveis (por zona) e pegam o que
-- quiserem, por iniciativa própria. Depois de pego, só quem pegou (e admin/
-- sócio) vê, com o andamento Em entrevista → Selecionado | Descartado.
--
--  * `candidatos`: um por conversa da Luna. Zona = resposta "Unidade".
--  * `sdr_handoff`: agente que não é de compra (0263, Luna) cria o candidato
--    em vez de devolver o lead à roleta. O lead fica descartado ("Candidato
--    (RH)"), fora das telas e relatórios de leads.
--  * Escrita só por RPC: `candidato_pegar` (atômico — dois gestores no mesmo
--    candidato, um ganha), `candidato_mudar_status`, `candidato_devolver`
--    (admin/sócio). `candidatos_painel` para admin/sócio.
--  * Os candidatos que já tinham virado lead no grupo Candidatos passam para
--    cá: quem já tinha clicado em Atender fica com ele "Em entrevista"; os
--    outros ficam disponíveis.
-- =============================================================================

create table if not exists public.candidatos (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid unique references public.sdr_conversations(id) on delete set null,
  lead_id         uuid references public.leads(id) on delete set null,
  nome            text not null,
  telefone        text,
  zona            text not null default 'outra' check (zona in ('norte', 'sul', 'outra')),
  respostas       jsonb not null default '{}'::jsonb,
  resumo          text,
  score           int check (score is null or score between 0 and 100),
  status          text not null default 'disponivel'
                  check (status in ('disponivel', 'em_entrevista', 'selecionado', 'descartado')),
  responsavel_id  uuid references public.profiles(id) on delete set null,
  pego_em         timestamptz,
  status_em       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint candidatos_dono_coerente check ((status = 'disponivel') = (responsavel_id is null))
);

create index if not exists candidatos_status_idx on public.candidatos (status, zona, created_at desc);
create index if not exists candidatos_responsavel_idx on public.candidatos (responsavel_id) where responsavel_id is not null;

drop trigger if exists candidatos_set_updated_at on public.candidatos;
create trigger candidatos_set_updated_at
  before update on public.candidatos
  for each row execute function public.set_updated_at();

comment on table public.candidatos is
  'Candidatos a corretor aprovados pela Luna (0264). Fora da roleta de leads; gestor pega na tela Candidatos.';

alter table public.candidatos enable row level security;

-- Gestor vê os disponíveis (para escolher) e os que pegou; admin/sócio, todos.
drop policy if exists candidatos_select on public.candidatos;
create policy candidatos_select on public.candidatos
  for select to authenticated
  using (
    public.is_admin()
    or (public.has_any_role('manager', 'director')
        and (status = 'disponivel' or responsavel_id = auth.uid()))
  );

revoke all on public.candidatos from anon;
grant select on public.candidatos to authenticated;

-- -----------------------------------------------------------------------------
-- Menu
-- -----------------------------------------------------------------------------
insert into public.permissions (code, label, category, description)
values ('menu.candidatos', 'Candidatos', 'menu',
        'Candidatos a corretor aprovados pela Luna: gerentes e diretores pegam; admin e sócio veem o painel.')
on conflict (code) do update
  set label = excluded.label, category = excluded.category, description = excluded.description;

insert into public.role_permissions (role, permission, allowed)
select r.role::public.app_role, 'menu.candidatos', true
  from (values ('partner'), ('director'), ('manager')) as r(role)
on conflict (role, permission) do nothing;

-- -----------------------------------------------------------------------------
-- Zona pela resposta "Unidade" da Luna.
-- -----------------------------------------------------------------------------
create or replace function public.candidato_zona(p_respostas jsonb)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when v ilike '%norte%' then 'norte'
    when v ilike '%sul%' then 'sul'
    else 'outra' end
  from (
    select coalesce((select e.value from jsonb_each_text(coalesce(p_respostas, '{}'::jsonb)) e
                      where lower(e.key) in ('unidade', 'zona') limit 1), '') as v
  ) x;
$$;
revoke all on function public.candidato_zona(jsonb) from public, anon;
grant execute on function public.candidato_zona(jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Conversa da Luna → candidato; o lead sai das telas de leads.
-- -----------------------------------------------------------------------------
create or replace function public.sdr_virar_candidato(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv public.sdr_conversations;
  v_lead public.leads;
  v_id uuid;
begin
  select * into v_conv from public.sdr_conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  select * into v_lead from public.leads where id = v_conv.lead_id;

  insert into public.candidatos (conversation_id, lead_id, nome, telefone, zona, respostas, resumo, score)
  values (v_conv.id, v_conv.lead_id,
          coalesce(nullif(btrim(v_conv.collected ->> 'Nome'), ''), nullif(btrim(v_lead.full_name), ''), 'Candidato'),
          coalesce(v_lead.phone, v_lead.phone_raw),
          public.candidato_zona(v_conv.collected),
          coalesce(v_conv.collected, '{}'::jsonb), v_conv.summary, v_conv.score)
  on conflict (conversation_id) do nothing
  returning id into v_id;

  update public.lead_assignments
     set released_at = now(), release_reason = 'sdr_handoff'
   where lead_id = v_conv.lead_id and released_at is null;

  update public.leads
     set status = 'discarded', lost_reason = 'Candidato (RH)', lost_at = null,
         assigned_to = null, assigned_at = null, attend_deadline = null
   where id = v_conv.lead_id and status <> 'converted';

  update public.sdr_conversations
     set status = 'handed_off',
         qualified_at = coalesce(qualified_at, now()),
         handed_off_at = coalesce(handed_off_at, now()),
         handed_off_to = null
   where id = p_conversation_id;

  return v_id;
end;
$$;
revoke all on function public.sdr_virar_candidato(uuid) from public, anon, authenticated;
grant execute on function public.sdr_virar_candidato(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- sdr_handoff (0260): agente que não é de compra vira candidato. Resto igual.
-- -----------------------------------------------------------------------------
create or replace function public.sdr_handoff(
  p_conversation_id uuid,
  p_reason text default 'qualified'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv   public.sdr_conversations;
  v_group  uuid;
  v_broker uuid;
  v_compra boolean;
begin
  if p_reason not in ('qualified', 'exhausted', 'sem_resposta') then
    raise exception 'Motivo de handoff desconhecido: %', p_reason using errcode = 'P0001';
  end if;

  if auth.uid() is not null and not public.has_any_role('admin','sdr','marketing') then
    raise exception 'Sem permissão para devolver a conversa do SDR à roleta.'
      using errcode = '42501';
  end if;

  select * into v_conv from public.sdr_conversations
  where id = p_conversation_id for update;
  if not found then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;

  if v_conv.status = 'handed_off' then
    return v_conv.handed_off_to;
  end if;

  -- Candidato (0264): não entra na roleta de leads.
  select coalesce(a.lead_de_compra, true) into v_compra
    from public.sdr_agents a where a.id = v_conv.agent_id;
  if v_compra is false then
    perform public.sdr_virar_candidato(p_conversation_id);
    return null;
  end if;

  select coalesce(a.handoff_group_id,
                  (select g.id from public.distribution_groups g
                   where g.kind = 'general' and g.active limit 1))
    into v_group
  from public.sdr_agents a where a.id = v_conv.agent_id;

  if v_group is null then
    select g.id into v_group from public.distribution_groups g
    where g.kind = 'general' and g.active limit 1;
  end if;

  update public.leads
     set distribution_group_id = coalesce(v_group, distribution_group_id),
         status                = 'queued',
         assigned_to           = null,
         assigned_at           = null,
         attend_deadline       = null,
         sdr_qualified_at      = case when p_reason = 'qualified' then now() else sdr_qualified_at end,
         funnel_stage          = case when p_reason = 'qualified' then 'qualified'::lead_funnel_stage else funnel_stage end,
         last_activity_at      = now()
   where id = v_conv.lead_id;

  insert into public.lead_events (lead_id, actor_id, kind, detail)
  values (v_conv.lead_id, null, 'sdr_qualified',
          jsonb_build_object('conversation_id', p_conversation_id,
                             'reason', p_reason,
                             'score', v_conv.score,
                             'group_id', v_group));

  v_broker := public.assign_lead(v_conv.lead_id);

  update public.sdr_conversations
     set status        = 'handed_off',
         qualified_at  = case when p_reason = 'qualified' then coalesce(qualified_at, now()) else qualified_at end,
         handed_off_at = now(),
         handed_off_to = v_broker
   where id = p_conversation_id;

  return v_broker;
end;
$$;

revoke all on function public.sdr_handoff(uuid, text) from public, anon;
grant execute on function public.sdr_handoff(uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Ações do gestor
-- -----------------------------------------------------------------------------
create or replace function public.candidato_pegar(p_id uuid)
returns public.candidatos
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.candidatos;
begin
  if auth.uid() is null or not (public.is_admin() or public.has_any_role('manager', 'director')) then
    raise exception 'Só gerentes, diretores, sócios e administradores pegam candidatos.' using errcode = '42501';
  end if;
  update public.candidatos
     set status = 'em_entrevista', responsavel_id = auth.uid(), pego_em = now(), status_em = now()
   where id = p_id and status = 'disponivel'
  returning * into v;
  if not found then
    raise exception 'Outro gestor já pegou este candidato.' using errcode = 'P0001';
  end if;
  return v;
end;
$$;
revoke all on function public.candidato_pegar(uuid) from public, anon;
grant execute on function public.candidato_pegar(uuid) to authenticated;

create or replace function public.candidato_mudar_status(p_id uuid, p_status text)
returns public.candidatos
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.candidatos;
begin
  if p_status is null or p_status not in ('em_entrevista', 'selecionado', 'descartado') then
    raise exception 'Status inválido: use Em entrevista, Selecionado ou Descartado.' using errcode = '22023';
  end if;
  update public.candidatos
     set status = p_status, status_em = now()
   where id = p_id and status <> 'disponivel'
     and (responsavel_id = auth.uid() or public.is_admin())
  returning * into v;
  if not found then
    raise exception 'Candidato não encontrado ou não é seu.' using errcode = '42501';
  end if;
  return v;
end;
$$;
revoke all on function public.candidato_mudar_status(uuid, text) from public, anon;
grant execute on function public.candidato_mudar_status(uuid, text) to authenticated;

create or replace function public.candidato_devolver(p_id uuid)
returns public.candidatos
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.candidatos;
begin
  if not public.is_admin() then
    raise exception 'Só administrador e sócio devolvem candidato para os disponíveis.' using errcode = '42501';
  end if;
  update public.candidatos
     set status = 'disponivel', responsavel_id = null, pego_em = null, status_em = now()
   where id = p_id
  returning * into v;
  if not found then
    raise exception 'Candidato não encontrado.' using errcode = 'P0002';
  end if;
  return v;
end;
$$;
revoke all on function public.candidato_devolver(uuid) from public, anon;
grant execute on function public.candidato_devolver(uuid) to authenticated;

-- Painel de admin/sócio: chegadas por período e situação atual, por gestor.
create or replace function public.candidatos_painel()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.is_admin() then
    raise exception 'Painel de candidatos é do administrador e do sócio.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'hoje',   (select count(*) from public.candidatos where (created_at at time zone 'America/Sao_Paulo')::date = v_hoje),
    'semana', (select count(*) from public.candidatos where (created_at at time zone 'America/Sao_Paulo')::date >= date_trunc('week', v_hoje)::date),
    'mes',    (select count(*) from public.candidatos where (created_at at time zone 'America/Sao_Paulo')::date >= date_trunc('month', v_hoje)::date),
    'por_status', coalesce((select jsonb_object_agg(status, n) from (
                    select status, count(*) n from public.candidatos group by status) s), '{}'::jsonb),
    'por_gestor', coalesce((select jsonb_agg(jsonb_build_object(
                    'nome', p.full_name, 'em_entrevista', g.em_entrevista,
                    'selecionado', g.selecionado, 'descartado', g.descartado) order by p.full_name)
                  from (
                    select responsavel_id,
                           count(*) filter (where status = 'em_entrevista') em_entrevista,
                           count(*) filter (where status = 'selecionado') selecionado,
                           count(*) filter (where status = 'descartado') descartado
                      from public.candidatos where responsavel_id is not null
                     group by responsavel_id) g
                  join public.profiles p on p.id = g.responsavel_id), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.candidatos_painel() from public, anon;
grant execute on function public.candidatos_painel() to authenticated;

-- -----------------------------------------------------------------------------
-- Os candidatos que já viraram lead passam para cá.
-- -----------------------------------------------------------------------------
do $do$
declare
  r record;
  v_id uuid;
begin
  for r in
    select c.id as conv_id, l.assigned_to, l.status as lead_status,
           exists (select 1 from public.lead_assignments la
                    where la.lead_id = l.id and la.responded_at is not null) as atendido
      from public.sdr_conversations c
      join public.sdr_agents a on a.id = c.agent_id and a.lead_de_compra = false
      join public.leads l on l.id = c.lead_id
     where c.status = 'handed_off'
       and l.status not in ('discarded', 'lost', 'converted')
       and not exists (select 1 from public.candidatos k where k.conversation_id = c.id)
  loop
    v_id := public.sdr_virar_candidato(r.conv_id);
    -- Quem já atendeu fica com o candidato, em entrevista.
    if v_id is not null and r.atendido and r.assigned_to is not null then
      update public.candidatos
         set status = 'em_entrevista', responsavel_id = r.assigned_to, pego_em = now(), status_em = now()
       where id = v_id;
    end if;
  end loop;
end
$do$;
