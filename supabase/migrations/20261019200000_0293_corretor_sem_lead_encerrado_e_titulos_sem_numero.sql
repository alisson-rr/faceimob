-- =============================================================================
-- 0293 · Corretor sem lead encerrado na lista + nomes das colunas sem número
--
-- Pedido de 19/10/2026:
--   1. Lead perdido ou descartado continuava na lista do corretor: `close_lead`
--      tira o dono desde a 0234, mas os encerrados antes dela (e pelas rotinas
--      que perdem por prazo) seguem com `assigned_to` do corretor. Para quem é
--      só corretor, encerrado não aparece mais; liderança, CCA, SDR, marketing
--      e admin continuam vendo, para o histórico. Cópia da 0259 com a condição.
--   2. Os números das colunas da esteira ("16. PENDENTE") eram a ordem da
--      planilha antiga. O nome de exibição perde o número; a ordem é `position`
--      e o vínculo é o Status 2 (o casamento por nome já ignorava o número).
-- =============================================================================

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated
  using (
    (assigned_to in (select public.auth_visible_profiles())
      and ((select public.has_any_role('admin', 'partner', 'director', 'manager', 'cca', 'sdr', 'marketing'))
           or (coalesce(assigned_at, created_at) >= (select public.leads_recomeco())
               and status not in ('lost', 'discarded'))))
    or (assigned_to is null
      and status in ('queued', 'assigned', 'attending', 'in_progress')
      and (select public.has_permission('leads.view_queue'))
      and id not in (select public.sdr_robo_lead_ids())
      and (distribution_group_id in (select public.auth_distribution_group_ids())
        or (distribution_group_id is null
          and (form_id is null or form_id not in (
            select f.form_id from public.distribution_group_forms f
             where f.group_id not in (select public.auth_distribution_group_ids())
          )))))
    or (assigned_to is null
      and status in ('converted', 'lost', 'discarded')
      and (select public.has_any_role('admin', 'partner', 'director', 'manager', 'cca', 'sdr', 'marketing')))
  );

update public.cca_stages
   set name = regexp_replace(name, '^\s*\d+\s*\.\s*', '')
 where name ~ '^\s*\d+\s*\.\s*\S';
