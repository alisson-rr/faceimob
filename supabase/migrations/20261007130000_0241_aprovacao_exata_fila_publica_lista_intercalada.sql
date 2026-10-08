-- =============================================================================
-- 0241 · Aprovação exata, fila de leads visível e lista intercalada
-- =============================================================================

-- O botão da liderança precisa abrir exatamente os negócios que contou. A
-- função antiga contava todos os meses e devolvia apenas um número; ao abrir o
-- Pipeline (que nasce no mês vigente), o gerente podia cair numa lista vazia.
create or replace function public.minhas_conferencias_pendentes_ids()
returns table (deal_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.id
    from public.deals d
   where auth.uid() is not null
     and d.document_review_status = 'pending'
     and d.month_base = public.month_start(coalesce(public.current_season_month(), current_date))
     and (
       public.is_admin()
       or exists (
         select 1
           from public.deal_participants dp
          where dp.deal_id = d.id
            and dp.profile_id = auth.uid()
            and dp.role in ('manager', 'director')
       )
     )
   order by d.updated_at desc, d.id;
$$;

revoke all on function public.minhas_conferencias_pendentes_ids() from public, anon;
grant execute on function public.minhas_conferencias_pendentes_ids() to authenticated;
comment on function public.minhas_conferencias_pendentes_ids() is
  'IDs das conferências pendentes do mês vigente que o usuário realmente pode aprovar; admin/sócio recebe todas.';

-- Mantém a API numérica compatível com notificações e versões anteriores.
create or replace function public.minhas_conferencias_pendentes()
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from public.minhas_conferencias_pendentes_ids();
$$;

revoke all on function public.minhas_conferencias_pendentes() from public, anon;
grant execute on function public.minhas_conferencias_pendentes() to authenticated;

-- A composição da roleta passa a ser transparente para qualquer colaborador
-- autenticado. A lógica e a ordem da 0220 são preservadas integralmente.
create or replace function public.fila_em_formacao()
returns table (
  group_id       uuid,
  group_name     text,
  profile_id     uuid,
  full_name      text,
  posicao        integer,
  situacao       text,
  checked_in_at  timestamptz,
  abre_as        text,
  last_turn_at   timestamptz,
  atrasados      integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  return query
  with presentes as (
    select
      g.id as g_id,
      g.name as g_name,
      c.profile_id as p_id,
      p.full_name as p_nome,
      c.checked_in_at as entrou,
      s.distribution_start as abre,
      (now() at time zone 'America/Sao_Paulo')::time >= s.distribution_start as aberta,
      public.overdue_lead_count(c.profile_id) as atrasos,
      exists (
        select 1 from public.lead_assignments la
         where la.profile_id = c.profile_id
           and la.released_at is null
           and la.responded_at is null
      ) as com_lead,
      (
        select max(case when la.release_reason = 'timeout' then la.released_at else la.assigned_at end)
          from public.lead_assignments la
         where la.profile_id = c.profile_id
      ) as ultima_vez
    from public.checkins c
    join public.profiles p on p.id = c.profile_id
    join public.distribution_group_members m on m.profile_id = c.profile_id and m.active
    join public.distribution_groups g on g.id = m.group_id and g.active
    join public.work_shifts s on s.id = c.shift_id
    where c.work_date = public.current_work_date()
      and c.checked_out_at is null
      and p.status = 'active'
  ),
  classificados as (
    select pr.*,
           case
             when pr.atrasos >= (select a.overdue_block_threshold from public.automation_settings a where a.id) then 'bloqueado'
             when pr.com_lead then 'com_lead'
             when pr.aberta then 'na_fila'
             else 'aguardando'
           end as sit
      from presentes pr
  )
  select
    k.g_id,
    k.g_name,
    k.p_id,
    k.p_nome,
    case when k.sit in ('bloqueado', 'com_lead') then null
         else (row_number() over (partition by k.g_id, (k.sit in ('bloqueado', 'com_lead'))
                                  order by (k.sit = 'aguardando'), greatest(k.entrou, k.ultima_vez), k.p_id))::int
    end,
    k.sit,
    k.entrou,
    to_char(k.abre, 'HH24:MI'),
    k.ultima_vez,
    k.atrasos::int
  from classificados k
  order by k.g_name, (k.sit = 'bloqueado'), (k.sit = 'com_lead'), (k.sit = 'aguardando'), greatest(k.entrou, k.ultima_vez), k.p_id;
end;
$$;

revoke all on function public.fila_em_formacao() from public, anon;
grant execute on function public.fila_em_formacao() to authenticated;
comment on function public.fila_em_formacao() is
  'Fila de recebimento em formação visível a todo colaborador autenticado, preservando a ordem real do motor.';

-- O banco já devolve as campanhas em rodadas. O cliente repete a intercalação
-- como defesa, mas a origem deixa de produzir blocos contínuos por campanha.
create or replace function public.lista_de_ligacao()
returns table (campanha text, cliente text, telefone text, criado_em timestamptz)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if not public.has_permission('leads.call_list') then
    raise exception 'Seu perfil não extrai a lista de ligação.' using errcode = '42501';
  end if;

  return query
  with base as (
    select l.id,
           coalesce(nullif(btrim(l.campaign_name), ''), nullif(btrim(l.utm_campaign), ''),
                    s.label, 'Sem campanha') as campanha_nome,
           l.full_name as cliente_nome,
           coalesce(nullif(btrim(l.phone), ''), nullif(btrim(l.phone_raw), '')) as telefone_numero,
           l.created_at as criado
      from public.leads l
      left join public.lead_sources s on s.id = l.source_id
     where l.created_at < (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
       and l.converted_deal_id is null
       and l.status <> 'converted'
       and coalesce(nullif(btrim(l.phone), ''), nullif(btrim(l.phone_raw), '')) is not null
  ), rodadas as (
    select b.*,
           row_number() over (
             partition by lower(b.campanha_nome)
             order by md5(b.id::text || current_date::text)
           ) as rodada
      from base b
  )
  select r.campanha_nome, r.cliente_nome, r.telefone_numero, r.criado
    from rodadas r
   order by r.rodada,
            md5(lower(r.campanha_nome) || current_date::text),
            r.criado desc;
end;
$$;

revoke all on function public.lista_de_ligacao() from public, anon;
grant execute on function public.lista_de_ligacao() to authenticated, service_role;

insert into public.role_permissions (role, permission, allowed)
values ('manager', 'leads.call_list', true)
on conflict (role, permission) do update set allowed = excluded.allowed;

comment on function public.lista_de_ligacao() is
  'Lista de ligação visível à liderança conforme RLS, intercalada em rodadas por campanha; gerente autorizado.';
