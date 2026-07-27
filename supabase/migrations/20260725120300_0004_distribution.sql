-- =============================================================================
-- 0004 · Turnos, check-in e configuração da roleta
--
-- Só a configuração e o estado de presença. A roleta em si (atribuição,
-- trava de 5 minutos, devolução à fila) vive em 0005, junto de leads, porque
-- depende das duas coisas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- work_shifts — "A distribuição de leads seguirá três turnos diários, com
-- janelas de atendimento configuráveis."
--
-- checkin_start        a partir de quando o corretor pode se marcar presente
-- distribution_start   a partir de quando a roleta passa a distribuir
-- checkout_time        horário do checkout automático
-- -----------------------------------------------------------------------------
create table public.work_shifts (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  label              text not null,
  checkin_start      time not null,
  distribution_start time not null,
  checkout_time      time not null,
  position           int  not null default 0,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint work_shifts_window_order
    check (checkin_start <= distribution_start and distribution_start < checkout_time)
);

create trigger work_shifts_set_updated_at
  before update on public.work_shifts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- allowed_ips — "o check-in permanece restrito por IP para prevenir fraudes",
-- garantindo que o corretor esteja fisicamente na unidade.
--
-- cidr em vez de text: /32 cobre IP fixo e /24 cobre a faixa da loja, e o
-- operador << do Postgres resolve a contenção sem parsing na aplicação.
-- -----------------------------------------------------------------------------
create table public.allowed_ips (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  ip_range   cidr not null,
  team_id    uuid references public.teams(id) on delete cascade,
  active     boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index allowed_ips_active_idx on public.allowed_ips (ip_range) where active;

create trigger allowed_ips_set_updated_at
  before update on public.allowed_ips
  for each row execute function public.set_updated_at();

comment on column public.allowed_ips.team_id is
  'Restringe a faixa a uma equipe. NULL = vale para qualquer usuário.';

-- Verifica se um endereço pode fazer check-in. Considera o bypass individual
-- (perfis com IP dinâmico liberados pelo admin).
create or replace function public.ip_is_allowed(candidate inet, who uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce((select p.bypass_ip_check from public.profiles p where p.id = who), false)
    or exists (
      select 1
      from public.allowed_ips a
      where a.active
        and candidate << a.ip_range
        and (
          a.team_id is null
          or a.team_id in (
            select tm.team_id from public.team_members tm
            where tm.profile_id = who and tm.left_at is null
          )
        )
    );
$$;

-- -----------------------------------------------------------------------------
-- checkins — presença do corretor num turno. Entrar na fila da roleta exige
-- um check-in aberto no turno corrente.
-- -----------------------------------------------------------------------------
create table public.checkins (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  shift_id        uuid not null references public.work_shifts(id) on delete restrict,
  work_date       date not null default current_date,
  checked_in_at   timestamptz not null default now(),
  checked_out_at  timestamptz,
  auto_checkout   boolean not null default false,
  ip_address      inet,
  leads_received  int not null default 0 check (leads_received >= 0),
  created_at      timestamptz not null default now(),

  unique (profile_id, work_date, shift_id),
  constraint checkins_period check (checked_out_at is null or checked_out_at >= checked_in_at)
);

-- A roleta consulta isto a cada lead que chega: quem está presente agora.
create index checkins_open_idx
  on public.checkins (work_date, shift_id)
  where checked_out_at is null;

-- -----------------------------------------------------------------------------
-- distribution_groups — "criação de grupos de corretores vinculados a
-- formulários específicos, garantindo que certos leads caiam apenas em roletas
-- de grupos autorizados".
--
-- Um corretor pode estar na fila geral e numa específica ao mesmo tempo.
-- -----------------------------------------------------------------------------
create table public.distribution_groups (
  id     uuid primary key default gen_random_uuid(),
  name   text not null,
  slug   text not null unique,
  kind   text not null default 'specific'
         check (kind in ('general','specific','sdr')),
  -- Trava de atendimento deste grupo. Sobrepõe o padrão global.
  attend_timeout_seconds int check (attend_timeout_seconds is null or attend_timeout_seconds > 0),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger distribution_groups_set_updated_at
  before update on public.distribution_groups
  for each row execute function public.set_updated_at();

create or replace function public.distribution_groups_ensure_slug()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_slug text;
  candidate text;
  n int := 1;
begin
  if new.slug is not null and new.slug <> '' then
    return new;
  end if;
  base_slug := coalesce(nullif(public.slugify(new.name), ''), 'grupo');
  candidate := base_slug;
  while exists (
    select 1 from public.distribution_groups g
    where g.slug = candidate and g.id is distinct from new.id
  ) loop
    n := n + 1;
    candidate := base_slug || '-' || n;
  end loop;
  new.slug := candidate;
  return new;
end;
$$;

create trigger distribution_groups_ensure_slug
  before insert on public.distribution_groups
  for each row execute function public.distribution_groups_ensure_slug();

create table public.distribution_group_members (
  group_id   uuid not null references public.distribution_groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (group_id, profile_id)
);

create index distribution_group_members_profile_idx
  on public.distribution_group_members (profile_id) where active;

-- Formulários da Meta que alimentam este grupo. Um lead que chega com form_id
-- conhecido cai na roleta do grupo correspondente; sem match, vai para a geral.
create table public.distribution_group_forms (
  group_id   uuid not null references public.distribution_groups(id) on delete cascade,
  form_id    text not null,
  form_name  text,
  created_at timestamptz not null default now(),
  primary key (group_id, form_id)
);

-- Um formulário pertence a um único grupo — caso contrário a roleta teria dois
-- destinos válidos para o mesmo lead e a escolha viraria não determinística.
create unique index distribution_group_forms_unique_form
  on public.distribution_group_forms (form_id);

-- -----------------------------------------------------------------------------
-- automation_settings — singleton com os parâmetros globais da automação.
-- O check(id) com default true garante que só existe a linha 'true'.
-- -----------------------------------------------------------------------------
create table public.automation_settings (
  id                      boolean primary key default true check (id),
  -- Trava padrão de atendimento: 5 minutos, conforme definido em reunião.
  attend_timeout_seconds  int not null default 300 check (attend_timeout_seconds > 0),
  -- Bloqueio de check-in por acúmulo de leads vencidos.
  overdue_block_threshold int not null default 20 check (overdue_block_threshold > 0),
  no_response_hours       int not null default 24,
  inactivity_alert_hours  int not null default 48,
  auto_first_contact      boolean not null default false,
  -- Pausa geral da distribuição, para manutenção ou fora de expediente.
  leads_paused            boolean not null default false,
  notify_on_assign        boolean not null default true,
  notify_on_timeout       boolean not null default true,
  updated_by              uuid references public.profiles(id) on delete set null,
  updated_at              timestamptz not null default now()
);

insert into public.automation_settings (id) values (true);

create trigger automation_settings_set_updated_at
  before update on public.automation_settings
  for each row execute function public.set_updated_at();

-- Timeout efetivo de um grupo: o do grupo quando definido, senão o global.
create or replace function public.effective_attend_timeout(group_id uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select g.attend_timeout_seconds from public.distribution_groups g where g.id = group_id),
    (select s.attend_timeout_seconds from public.automation_settings s where s.id),
    300
  );
$$;

-- =============================================================================
-- RLS
-- =============================================================================

alter table public.work_shifts                enable row level security;
alter table public.allowed_ips                enable row level security;
alter table public.checkins                   enable row level security;
alter table public.distribution_groups        enable row level security;
alter table public.distribution_group_members enable row level security;
alter table public.distribution_group_forms   enable row level security;
alter table public.automation_settings        enable row level security;

-- Turnos: todos leem (a tela de check-in precisa), admin escreve.
create policy work_shifts_select on public.work_shifts
  for select to authenticated using (true);
create policy work_shifts_write on public.work_shifts
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- IPs liberados são informação de segurança: só admin enxerga a lista.
-- O corretor nunca precisa vê-la — a validação acontece no servidor.
create policy allowed_ips_admin on public.allowed_ips
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Check-in: cada um vê o seu; gestor vê o da equipe.
create policy checkins_select on public.checkins
  for select to authenticated
  using (profile_id in (select public.auth_visible_profiles()));

-- Inserção é feita pela RPC perform_checkin (0005), que valida IP e bloqueios.
-- A policy direta existe para o caso de correção manual pelo gestor.
create policy checkins_manage on public.checkins
  for all to authenticated
  using (public.is_admin() or public.manages_profile(profile_id))
  with check (public.is_admin() or public.manages_profile(profile_id));

create policy distribution_groups_select on public.distribution_groups
  for select to authenticated using (true);
create policy distribution_groups_write on public.distribution_groups
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy distribution_group_members_select on public.distribution_group_members
  for select to authenticated using (true);
create policy distribution_group_members_write on public.distribution_group_members
  for all to authenticated
  using (public.has_any_role('admin','director')) with check (public.has_any_role('admin','director'));

create policy distribution_group_forms_select on public.distribution_group_forms
  for select to authenticated using (true);
create policy distribution_group_forms_write on public.distribution_group_forms
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy automation_settings_select on public.automation_settings
  for select to authenticated using (true);
create policy automation_settings_write on public.automation_settings
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
