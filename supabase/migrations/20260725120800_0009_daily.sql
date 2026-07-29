-- =============================================================================
-- 0009 · Diário, checkpoint e links públicos
--
-- O "Diário": o gerente lança manualmente as métricas do dia de cada corretor.
-- "A entrada de dados é manual para garantir que o gerente acompanhe ativamente
--  o progresso e cobre os corretores diariamente."
--
-- O acesso é por link público com PIN, porque hoje os gerentes usam links
-- individualizados. Isso obriga a uma superfície anônima bem estreita: três
-- funções SECURITY DEFINER e nada mais. Nenhuma tabela é legível por anon.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- daily_reports — um relatório por equipe por dia.
-- -----------------------------------------------------------------------------
create table public.daily_reports (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams(id) on delete cascade,
  report_date  date not null default current_date,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (team_id, report_date)
);

create index daily_reports_date_idx on public.daily_reports (report_date desc);

create trigger daily_reports_set_updated_at
  before update on public.daily_reports
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- daily_entries — as 8 métricas por corretor, exatamente as que o time já usa.
-- profile_id sem cascade de remoção: o histórico do mês tem que sobreviver ao
-- desligamento do corretor.
-- -----------------------------------------------------------------------------
create table public.daily_entries (
  id                 uuid primary key default gen_random_uuid(),
  report_id          uuid not null references public.daily_reports(id) on delete cascade,
  profile_id         uuid not null references public.profiles(id) on delete restrict,

  leads              int not null default 0 check (leads              >= 0),
  calls              int not null default 0 check (calls              >= 0),
  doc_collections    int not null default 0 check (doc_collections    >= 0),
  visits_scheduled   int not null default 0 check (visits_scheduled   >= 0),
  visits_done        int not null default 0 check (visits_done        >= 0),
  analyses_sent      int not null default 0 check (analyses_sent      >= 0),
  analyses_approved  int not null default 0 check (analyses_approved  >= 0),
  sales              int not null default 0 check (sales              >= 0),

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (report_id, profile_id)
);

create index daily_entries_profile_idx on public.daily_entries (profile_id);

create trigger daily_entries_set_updated_at
  before update on public.daily_entries
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- funnel_targets — "meta de funil: 10% dos leads virando análise, 40% das
-- análises sendo aprovadas e 50% das aprovações convertendo em vendas".
-- Global por padrão, com sobreposição por equipe ou por diretoria.
-- -----------------------------------------------------------------------------
create table public.funnel_targets (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('global','team','director')),
  team_id     uuid references public.teams(id) on delete cascade,
  director_id uuid references public.profiles(id) on delete cascade,

  lead_to_analysis_pct     numeric(5,2) not null default 10 check (lead_to_analysis_pct between 0 and 100),
  analysis_to_approval_pct numeric(5,2) not null default 40 check (analysis_to_approval_pct between 0 and 100),
  approval_to_sale_pct     numeric(5,2) not null default 50 check (approval_to_sale_pct between 0 and 100),

  effective_from date not null default current_date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint funnel_targets_scope_team     check ((scope = 'team')     = (team_id is not null)),
  constraint funnel_targets_scope_director check ((scope = 'director') = (director_id is not null))
);

create unique index funnel_targets_global_idx
  on public.funnel_targets (effective_from) where scope = 'global';
create unique index funnel_targets_team_idx
  on public.funnel_targets (team_id, effective_from) where scope = 'team';
create unique index funnel_targets_director_idx
  on public.funnel_targets (director_id, effective_from) where scope = 'director';

create trigger funnel_targets_set_updated_at
  before update on public.funnel_targets
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- public_links — o link individualizado de cada gerente/diretor.
--
-- O PIN é guardado como hash bcrypt, nunca em texto. A ata registra a remoção
-- de senhas expostas no banco como requisito; um PIN em claro seria o mesmo
-- problema com outro nome.
-- -----------------------------------------------------------------------------
create table public.public_links (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('daily_team','director_checkpoint')),
  team_id     uuid references public.teams(id) on delete cascade,
  director_id uuid references public.profiles(id) on delete cascade,
  slug        text not null unique,
  pin_hash    text,
  active      boolean not null default true,
  expires_at  timestamptz,
  last_seen_at timestamptz,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint public_links_kind_team
    check ((kind = 'daily_team') = (team_id is not null)),
  constraint public_links_kind_director
    check ((kind = 'director_checkpoint') = (director_id is not null))
);

create trigger public_links_set_updated_at
  before update on public.public_links
  for each row execute function public.set_updated_at();

-- Define ou remove o PIN de um link. Só admin/diretoria; o PIN em claro entra
-- como argumento e sai como hash — nunca é persistido nem retornado.
create or replace function public.set_public_link_pin(p_link_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_any_role('admin','director') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;

  update public.public_links
     set pin_hash = case
       when p_pin is null or btrim(p_pin) = '' then null
       else extensions.crypt(p_pin, extensions.gen_salt('bf', 10))
     end
   where id = p_link_id;
end;
$$;

-- Resolve um slug validando PIN e expiração. Retorna NULL para link inválido,
-- inativo, expirado ou PIN errado — sem distinguir os casos, para não virar
-- oráculo de enumeração de slugs.
create or replace function private.resolve_public_link(p_slug text, p_pin text)
returns public.public_links
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.public_links;
begin
  select * into v_link
  from public.public_links
  where slug = p_slug and active
    and (expires_at is null or expires_at > now());

  if not found then
    return null;
  end if;

  if v_link.pin_hash is not null then
    if p_pin is null or extensions.crypt(p_pin, v_link.pin_hash) <> v_link.pin_hash then
      return null;
    end if;
  end if;

  return v_link;
end;
$$;

-- =============================================================================
-- Superfície pública (anon)
--
-- Estas três funções são o ÚNICO caminho de dados sem autenticação no sistema.
-- Cada uma resolve o link antes de qualquer leitura e devolve só o recorte
-- daquele link.
-- =============================================================================

-- Dados da equipe + escala do dia, para montar a tela de lançamento.
create or replace function public.public_daily_team(p_slug text, p_pin text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.public_links;
  v_out  jsonb;
begin
  v_link := private.resolve_public_link(p_slug, p_pin);
  if v_link.id is null or v_link.kind <> 'daily_team' then
    return null;
  end if;

  select jsonb_build_object(
    'team_id',   t.id,
    'team_name', t.name,
    'has_pin',   v_link.pin_hash is not null,
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
               'profile_id', p.id,
               'full_name',  p.full_name
             ) order by p.full_name)
      from public.team_members tm
      join public.profiles p on p.id = tm.profile_id
      where tm.team_id = t.id and tm.left_at is null and p.status = 'active'
    ), '[]'::jsonb),
    'today', coalesce((
      select jsonb_agg(jsonb_build_object(
               'profile_id',        e.profile_id,
               'leads',             e.leads,
               'calls',             e.calls,
               'doc_collections',   e.doc_collections,
               'visits_scheduled',  e.visits_scheduled,
               'visits_done',       e.visits_done,
               'analyses_sent',     e.analyses_sent,
               'analyses_approved', e.analyses_approved,
               'sales',             e.sales
             ))
      from public.daily_entries e
      join public.daily_reports r on r.id = e.report_id
      where r.team_id = t.id and r.report_date = current_date
    ), '[]'::jsonb)
  )
  into v_out
  from public.teams t
  where t.id = v_link.team_id;

  update public.public_links set last_seen_at = now() where id = v_link.id;

  return v_out;
end;
$$;

-- Lançamento das métricas do dia. Upsert: o gerente corrige ao longo do dia.
create or replace function public.public_daily_submit(
  p_slug    text,
  p_pin     text,
  p_entries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link      public.public_links;
  v_report_id uuid;
  v_entry     jsonb;
  v_count     int := 0;
begin
  v_link := private.resolve_public_link(p_slug, p_pin);
  if v_link.id is null or v_link.kind <> 'daily_team' then
    raise exception 'Link inválido ou PIN incorreto.' using errcode = '42501';
  end if;

  insert into public.daily_reports (team_id, report_date, submitted_at)
  values (v_link.team_id, current_date, now())
  on conflict (team_id, report_date) do update set submitted_at = now()
  returning id into v_report_id;

  for v_entry in select * from jsonb_array_elements(p_entries)
  loop
    -- Só aceita corretor que realmente pertence à equipe deste link.
    if not exists (
      select 1 from public.team_members tm
      where tm.team_id = v_link.team_id
        and tm.profile_id = (v_entry ->> 'profile_id')::uuid
        and tm.left_at is null
    ) then
      continue;
    end if;

    insert into public.daily_entries (
      report_id, profile_id, leads, calls, doc_collections,
      visits_scheduled, visits_done, analyses_sent, analyses_approved, sales
    )
    values (
      v_report_id,
      (v_entry ->> 'profile_id')::uuid,
      coalesce((v_entry ->> 'leads')::int, 0),
      coalesce((v_entry ->> 'calls')::int, 0),
      coalesce((v_entry ->> 'doc_collections')::int, 0),
      coalesce((v_entry ->> 'visits_scheduled')::int, 0),
      coalesce((v_entry ->> 'visits_done')::int, 0),
      coalesce((v_entry ->> 'analyses_sent')::int, 0),
      coalesce((v_entry ->> 'analyses_approved')::int, 0),
      coalesce((v_entry ->> 'sales')::int, 0)
    )
    on conflict (report_id, profile_id) do update set
      leads             = excluded.leads,
      calls             = excluded.calls,
      doc_collections   = excluded.doc_collections,
      visits_scheduled  = excluded.visits_scheduled,
      visits_done       = excluded.visits_done,
      analyses_sent     = excluded.analyses_sent,
      analyses_approved = excluded.analyses_approved,
      sales             = excluded.sales;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('report_id', v_report_id, 'saved', v_count);
end;
$$;

-- Checkpoint semanal da diretoria: funil agregado por equipe e os dias sem
-- preenchimento. "Identifica datas em que houve falha no preenchimento de dados,
-- facilitando o controle e a cobrança nas reuniões de segunda-feira."
create or replace function public.public_director_checkpoint(
  p_slug       text,
  p_week_start date default null,
  p_pin        text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_link  public.public_links;
  v_start date;
  v_end   date;
  v_out   jsonb;
begin
  v_link := private.resolve_public_link(p_slug, p_pin);
  if v_link.id is null or v_link.kind <> 'director_checkpoint' then
    return null;
  end if;

  -- Semana de segunda a domingo.
  v_start := coalesce(p_week_start, (date_trunc('week', current_date))::date);
  v_end   := v_start + 6;

  select jsonb_build_object(
    'director',   (select p.full_name from public.profiles p where p.id = v_link.director_id),
    'week_start', v_start,
    'week_end',   v_end,
    'targets', (
      select jsonb_build_object(
        'lead_to_analysis_pct',     ft.lead_to_analysis_pct,
        'analysis_to_approval_pct', ft.analysis_to_approval_pct,
        'approval_to_sale_pct',     ft.approval_to_sale_pct
      )
      from public.funnel_targets ft
      where (ft.scope = 'director' and ft.director_id = v_link.director_id)
         or ft.scope = 'global'
      order by (ft.scope = 'director') desc, ft.effective_from desc
      limit 1
    ),
    'teams', coalesce((
      select jsonb_agg(team_block order by team_name)
      from (
        select
          t.name as team_name,
          jsonb_build_object(
            'team_id',   t.id,
            'team_name', t.name,
            'totals', jsonb_build_object(
              'leads',             coalesce(sum(e.leads), 0),
              'calls',             coalesce(sum(e.calls), 0),
              'doc_collections',   coalesce(sum(e.doc_collections), 0),
              'visits_scheduled',  coalesce(sum(e.visits_scheduled), 0),
              'visits_done',       coalesce(sum(e.visits_done), 0),
              'analyses_sent',     coalesce(sum(e.analyses_sent), 0),
              'analyses_approved', coalesce(sum(e.analyses_approved), 0),
              'sales',             coalesce(sum(e.sales), 0)
            ),
            'missing_days', (
              select coalesce(jsonb_agg(d::date order by d), '[]'::jsonb)
              from generate_series(v_start, least(v_end, current_date), interval '1 day') d
              where not exists (
                select 1 from public.daily_reports r2
                where r2.team_id = t.id and r2.report_date = d::date
              )
            )
          ) as team_block
        from public.teams t
        left join public.daily_reports r
          on r.team_id = t.id and r.report_date between v_start and v_end
        left join public.daily_entries e on e.report_id = r.id
        where t.director_id = v_link.director_id and t.active
        group by t.id, t.name
      ) s
    ), '[]'::jsonb)
  ) into v_out;

  update public.public_links set last_seen_at = now() where id = v_link.id;

  return v_out;
end;
$$;

-- =============================================================================
-- RLS + grants
-- =============================================================================

alter table public.daily_reports  enable row level security;
alter table public.daily_entries  enable row level security;
alter table public.funnel_targets enable row level security;
alter table public.public_links   enable row level security;

create policy daily_reports_select on public.daily_reports
  for select to authenticated
  using (
    public.can_read_all()
    or team_id in (select public.auth_led_team_ids())
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = daily_reports.team_id
        and tm.profile_id = auth.uid() and tm.left_at is null
    )
  );

create policy daily_reports_write on public.daily_reports
  for all to authenticated
  using (public.is_admin() or team_id in (select public.auth_led_team_ids()))
  with check (public.is_admin() or team_id in (select public.auth_led_team_ids()));

create policy daily_entries_select on public.daily_entries
  for select to authenticated
  using (
    profile_id in (select public.auth_visible_profiles())
    or exists (
      select 1 from public.daily_reports r
      where r.id = daily_entries.report_id
        and (public.can_read_all() or r.team_id in (select public.auth_led_team_ids()))
    )
  );

create policy daily_entries_write on public.daily_entries
  for all to authenticated
  using (
    exists (
      select 1 from public.daily_reports r
      where r.id = daily_entries.report_id
        and (public.is_admin() or r.team_id in (select public.auth_led_team_ids()))
    )
  )
  with check (
    exists (
      select 1 from public.daily_reports r
      where r.id = daily_entries.report_id
        and (public.is_admin() or r.team_id in (select public.auth_led_team_ids()))
    )
  );

create policy funnel_targets_select on public.funnel_targets
  for select to authenticated using (true);
create policy funnel_targets_write on public.funnel_targets
  for all to authenticated
  using (public.has_any_role('admin','director'))
  with check (public.has_any_role('admin','director'));

-- pin_hash mora aqui: nem gerente lê a tabela, só admin/diretoria.
create policy public_links_select on public.public_links
  for select to authenticated
  using (public.has_any_role('admin','director'));
create policy public_links_write on public.public_links
  for all to authenticated
  using (public.has_any_role('admin','director'))
  with check (public.has_any_role('admin','director'));

-- A superfície anônima: exatamente estas três funções, nada mais.
grant execute on function public.public_daily_team(text, text)                  to anon, authenticated;
grant execute on function public.public_daily_submit(text, text, jsonb)         to anon, authenticated;
grant execute on function public.public_director_checkpoint(text, date, text)   to anon, authenticated;

-- O resolvedor de link fica em `private`: inacessível pelo PostgREST.
revoke all on function private.resolve_public_link(text, text) from public, anon, authenticated;

revoke all on function public.set_public_link_pin(uuid, text) from public, anon;
grant execute on function public.set_public_link_pin(uuid, text) to authenticated;
