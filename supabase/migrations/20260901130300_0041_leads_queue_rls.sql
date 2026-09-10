-- =============================================================================
-- 0041 — Lead da fila: quem enxerga, edita, comenta, anexa e lê o histórico
--
-- `leads_select` mostra o lead sem dono (`assigned_to is null`) para quem tem
-- `leads.view_queue` — papel cru na 0005, matriz de permissões a partir da
-- 0044. Nenhuma outra policy de lead acompanhou esse ramo, e o efeito na tela
-- foi sempre silencioso (auditoria de 01/09):
--
--   · `leads_update` exige dono, admin ou `manages_profile(assigned_to)`; com
--     `assigned_to` nulo o `manages_profile` é falso e o UPDATE casa 0 linhas —
--     o PostgREST devolve 204, a tela mostra "Dados salvos" e nada foi gravado;
--   · `lead_events_select` e `lead_comments_select` filtram pelo mesmo
--     `assigned_to in (auth_visible_profiles())`, então o gerente abre o lead
--     que a roleta já atribuiu e devolveu e vê "Sem histórico";
--   · `lead_attachments_insert` só checa `uploaded_by = auth.uid()`: o gerente
--     anexa, o toast diz "Anexo enviado", e o select policy esconde a linha —
--     arquivo órfão no bucket sem ninguém saber.
--
-- Uma regra só: quem enxerga o lead (a própria `leads_select`) lê e escreve o
-- que pende dele. `can_see_lead()` é SECURITY INVOKER de propósito — a consulta
-- a `public.leads` passa pela RLS do usuário corrente, então o predicado de
-- visibilidade continua morando num lugar só; mudar `leads_select` muda tudo.
--
-- O ramo `has_any_role('admin','director','cca')` das policies antigas fica de
-- fora: dentro do EXISTS ele já era avaliado sob a RLS de `leads`, então valia
-- só para admin/diretor na fila (coberto agora) e nunca para o CCA, que não
-- enxerga lead nenhum por `leads_select`.
--
-- O ramo da fila em `leads_update` repete o predicado da `leads_select`
-- (`assigned_to is null and has_permission('leads.view_queue')`), não a lista
-- de papéis: com duas listas, conceder `leads.view_queue` ao SDR em
-- Admin · Permissões faria a tela mostrar o lápis e o banco recusar com 42501,
-- e revogar do marketing deixaria um ramo de escrita morto na policy.
-- `has_permission` já curto-circuita em `is_admin()` (0002), então o admin
-- continua coberto sem linha na matriz.
--
-- Ver não é editar em geral: sócio (partner) enxerga todo mundo por
-- `auth_visible_profiles()` e segue sem escrever — a `leads_update` não virou
-- cópia da `leads_select`, só ganhou o ramo da fila.
-- =============================================================================

create or replace function public.can_see_lead(p_lead_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.leads l where l.id = p_lead_id);
$$;

comment on function public.can_see_lead(uuid) is
  'O usuário corrente enxerga o lead pela leads_select. SECURITY INVOKER: a RLS de leads é a única fonte da regra.';

revoke all on function public.can_see_lead(uuid) from public, anon;
grant execute on function public.can_see_lead(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- leads: UPDATE alcança a fila para quem já a vê
-- -----------------------------------------------------------------------------
drop policy if exists leads_update on public.leads;

create policy leads_update on public.leads
  for update to authenticated
  using (
    assigned_to = auth.uid()
    or public.is_admin()
    or public.manages_profile(assigned_to)
    or (assigned_to is null and public.has_permission('leads.view_queue'))
  )
  with check (
    assigned_to = auth.uid()
    or public.is_admin()
    or public.manages_profile(assigned_to)
    or (assigned_to is null and public.has_permission('leads.view_queue'))
  );

-- -----------------------------------------------------------------------------
-- Histórico, comentários e anexos seguem a visibilidade do lead
-- -----------------------------------------------------------------------------
drop policy if exists lead_events_select on public.lead_events;
create policy lead_events_select on public.lead_events
  for select to authenticated
  using (public.can_see_lead(lead_id));

drop policy if exists lead_comments_select on public.lead_comments;
create policy lead_comments_select on public.lead_comments
  for select to authenticated
  using (public.can_see_lead(lead_id));

drop policy if exists lead_comments_insert on public.lead_comments;
create policy lead_comments_insert on public.lead_comments
  for insert to authenticated
  with check (author_id = auth.uid() and public.can_see_lead(lead_id));

drop policy if exists lead_attachments_select on public.lead_attachments;
create policy lead_attachments_select on public.lead_attachments
  for select to authenticated
  using (public.can_see_lead(lead_id));

drop policy if exists lead_attachments_insert on public.lead_attachments;
create policy lead_attachments_insert on public.lead_attachments
  for insert to authenticated
  with check (uploaded_by = auth.uid() and public.can_see_lead(lead_id));
