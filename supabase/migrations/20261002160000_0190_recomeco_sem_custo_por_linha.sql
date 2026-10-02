-- =============================================================================
-- 0190 — o recorte do recomeço (0187) deixa de custar uma consulta por lead
--
-- Depois da importação da Leadfy (02/10/2026) o Dashboard parou de carregar.
-- Causa: `leads_select` (0187) chamava `lead_visivel_pelo_recomeco()` em cada
-- linha. A função é `security definer`, então o planner não a desdobra, e ela
-- relia `automation_settings` e os papéis de quem pede a cada lead. A contagem
-- de leads do Dashboard (180 mil linhas no ensaio) foi de 0,05 s para 2,9 s;
-- com a base importada, o banco de produção passou do statement_timeout (8 s).
--
-- A regra não muda: o corretor "puro" só vê lead atribuído depois do recomeço,
-- quem tem papel de gestão vê tudo. Os dois valores agora são lidos uma vez
-- por consulta (`(select ...)` vira initPlan), e a comparação com a data fica
-- na própria linha.
-- =============================================================================

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated
  using (
    (assigned_to in (select public.auth_visible_profiles())
       and ((select public.has_any_role('admin', 'partner', 'director', 'manager', 'cca', 'sdr', 'marketing'))
            or coalesce(assigned_at, created_at) >= (select public.leads_recomeco())))
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

-- Mesmo custo por linha na trava de check-in: o recomeço é lido uma vez.
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
    and coalesce(l.assigned_at, l.created_at) >= (select public.leads_recomeco());
$$;
