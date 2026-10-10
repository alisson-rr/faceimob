-- =============================================================================
-- 0259 · Lead com o robô atendendo fica fora da fila até a entrega
--
-- Pedido de 10/10/2026: os leads de WhatsApp apareciam em "Recebido agora",
-- "sem corretor", enquanto a Ana ou a Luna ainda conversavam com eles — e para
-- quem nem é do grupo que vai recebê-los. A fila (lead sem dono) passa a pular
-- o lead cuja conversa do SDR está `active`; quando o agente entrega
-- (`sdr_handoff`), a conversa sai de `active`, o lead vai para o grupo do
-- agente e só então aparece — para quem é daquele grupo.
--
-- A leitura das conversas é por função `security definer`: a RLS de
-- `sdr_conversations` esconde a tabela do corretor, e a subconsulta da política
-- voltaria vazia para ele (o lead apareceria do mesmo jeito).
-- Admin, SDR e marketing seguem vendo o lead pela `leads_select_sdr` — é ela
-- que dá o nome do lead na aba Conversas; a lista de Leads o esconde na tela.
-- =============================================================================

create or replace function public.sdr_robo_lead_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.lead_id from public.sdr_conversations c
   where c.status = 'active' and c.lead_id is not null;
$$;

revoke all on function public.sdr_robo_lead_ids() from public, anon;
grant execute on function public.sdr_robo_lead_ids() to authenticated, service_role;

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated
  using (
    (assigned_to in (select public.auth_visible_profiles())
      and ((select public.has_any_role('admin', 'partner', 'director', 'manager', 'cca', 'sdr', 'marketing'))
           or coalesce(assigned_at, created_at) >= (select public.leads_recomeco())))
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
