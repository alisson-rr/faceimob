-- =============================================================================
-- 0187 — leads antigos somem da tela do corretor; gerente e diretor acham o daily
--
-- Pedido do cliente em 02/10/2026:
--   1. "Não vamos limpar os leads, só oculte dos corretores": o corretor via os
--      leads que caíram para ele durante os testes. A partir de agora existe um
--      recomeço (`automation_settings.leads_recomeco_em`, gravado agora): o
--      corretor só vê lead atribuído a ele DEPOIS do recomeço. Admin, sócio,
--      gerente, diretor, CCA, SDR e marketing continuam vendo tudo o que viam.
--      Nada é apagado. A trava de check-in (`overdue_lead_count`) deixa de
--      contar o lead antigo — o corretor não fica bloqueado por algo que não vê.
--   2. "No checkpoint não encontrei o botão para o gerente e o diretor
--      preencherem o daily": o link do diário só era legível por admin e
--      diretor (`can_manage_public_link`). `meus_links_de_daily()` devolve só o
--      link ativo das equipes que quem pede gerencia ou dirige. O PIN continua
--      sendo pedido na página do diário.
-- =============================================================================

alter table public.automation_settings
  add column if not exists leads_recomeco_em timestamptz;

update public.automation_settings set leads_recomeco_em = now() where leads_recomeco_em is null;

comment on column public.automation_settings.leads_recomeco_em is
  'Recomeço da distribuição (0187): o corretor só vê lead atribuído depois deste instante.';

create or replace function public.leads_recomeco()
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select s.leads_recomeco_em from public.automation_settings s where s.id), '-infinity'::timestamptz);
$$;

revoke all on function public.leads_recomeco() from public, anon;
grant execute on function public.leads_recomeco() to authenticated, service_role;

-- O lead aparece para quem pede? Só o corretor "puro" é recortado pelo recomeço.
create or replace function public.lead_visivel_pelo_recomeco(p_assigned_at timestamptz, p_created_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(p_assigned_at, p_created_at) >= public.leads_recomeco()
      or public.has_any_role('admin', 'partner', 'director', 'manager', 'cca', 'sdr', 'marketing');
$$;

revoke all on function public.lead_visivel_pelo_recomeco(timestamptz, timestamptz) from public, anon;
grant execute on function public.lead_visivel_pelo_recomeco(timestamptz, timestamptz) to authenticated, service_role;

-- Mesma policy de antes; só o ramo do lead atribuído ganha o recorte.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated
  using (
    (assigned_to in (select public.auth_visible_profiles())
       and public.lead_visivel_pelo_recomeco(assigned_at, created_at))
    or (assigned_to is null
        and (select public.has_permission('leads.view_queue'))
        and (distribution_group_id in (select public.auth_distribution_group_ids())
             or (distribution_group_id is null
                 and (form_id is null
                      or form_id not in (
                        select f.form_id
                          from public.distribution_group_forms f
                         where f.group_id not in (select public.auth_distribution_group_ids()))))))
  );

create or replace function public.overdue_lead_count(who uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.leads l
  where l.assigned_to = who
    and l.status in ('assigned','attending','in_progress')
    and l.next_action_at is not null
    and l.next_action_at < now()
    -- Lead de antes do recomeço (0187) não trava o check-in: o corretor não o vê.
    and coalesce(l.assigned_at, l.created_at) >= public.leads_recomeco();
$$;

-- -----------------------------------------------------------------------------
-- Daily de quem lidera a equipe
-- -----------------------------------------------------------------------------
create or replace function public.meus_links_de_daily()
returns table (team_id uuid, equipe text, slug text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id, t.name, l.slug
    from public.public_links l
    join public.teams t on t.id = l.team_id
   where auth.uid() is not null
     and l.kind = 'daily_team'
     and l.active
     and (l.expires_at is null or l.expires_at > now())
     and t.active
     and (t.manager_id = auth.uid() or t.director_id = auth.uid() or public.is_admin())
   order by t.name;
$$;

revoke all on function public.meus_links_de_daily() from public, anon;
grant execute on function public.meus_links_de_daily() to authenticated;
comment on function public.meus_links_de_daily() is
  'Link ativo do diário das equipes que quem pede gerencia ou dirige (admin: todas). O PIN segue na página (0187).';
