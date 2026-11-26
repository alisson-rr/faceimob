-- =============================================================================
-- 0367 · "Leads hoje / semana / mês" contam o que a IA da 3C entregou
--
-- 26/11/2026: o Dashboard e o funil (período) passaram a contar a entrega da
-- 3C (lead antigo com visita marcada, "interessado" ou base reativada) na
-- chegada do dia; a régua da tela de Leads (`leads_recebidos`) seguia só com o
-- criado no dia — 33 contra 38. Mesma regra aqui. Índice parcial para a conta
-- não varrer o histórico inteiro de `lead_events`.
-- =============================================================================

create index if not exists lead_events_3c_idx
  on public.lead_events (created_at)
  where kind in ('voice_ai_call', 'visita_3c_pendente', 'interessado_3c_roleta');

create or replace function public.leads_recebidos(p_corretor uuid default null, p_sem_corretor boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lider  boolean := public.is_admin()
                      or public.has_any_role('director', 'manager', 'cca', 'sdr', 'marketing');
  v_hoje   timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
  v_semana timestamptz := (date_trunc('week', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
  v_mes    timestamptz := (date_trunc('month', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
  v_out    jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada.' using errcode = '28000';
  end if;
  if p_corretor is not null and not (public.is_admin() or p_corretor in (select public.auth_visible_profiles())) then
    raise exception 'Corretor fora do seu alcance.' using errcode = '42501';
  end if;
  if p_sem_corretor and not (v_lider or public.has_permission('leads.view_queue')) then
    raise exception 'A fila é da liderança.' using errcode = '42501';
  end if;

  -- 0367: lead que a IA da 3C entregou no período (visita marcada, "interessado"
  -- ou base reativada) conta como chegada, como no Dashboard; o mesmo lead
  -- conta uma vez por janela.
  select jsonb_build_object(
           'hoje',   count(distinct x.id) filter (where x.quando >= v_hoje),
           'semana', count(distinct x.id) filter (where x.quando >= v_semana),
           'mes',    count(distinct x.id) filter (where x.quando >= v_mes),
           'mes_descartados', count(distinct x.id) filter (where x.quando >= v_mes and x.status in ('lost', 'discarded')))
    into v_out
    from (
      select l.id, l.created_at as quando, l.status, coalesce(l.assigned_to, l.ultimo_corretor_id) as dono
        from public.leads l
       where l.created_at >= least(v_mes, v_semana)
         and coalesce(l.external_id, '') not like 'leadfy:%'
      union all
      select l.id, en.primeira, l.status, coalesce(l.assigned_to, l.ultimo_corretor_id)
        from (select ev.lead_id, min(ev.created_at) as primeira
                from public.lead_events ev
               where ev.created_at >= least(v_mes, v_semana)
                 and ev.kind in ('voice_ai_call', 'visita_3c_pendente', 'interessado_3c_roleta')
                 and (ev.kind <> 'voice_ai_call' or ev.detail->>'desfecho' in ('agendado', 'interessado'))
               group by ev.lead_id) en
        join public.leads l on l.id = en.lead_id
    ) x
   where case
           when p_sem_corretor then x.dono is null
           when p_corretor is not null then x.dono = p_corretor
           when v_lider then x.dono is null or x.dono in (select public.auth_visible_profiles())
           else x.dono in (select public.auth_visible_profiles())
         end;
  return v_out;
end;
$$;

revoke all on function public.leads_recebidos(uuid, boolean) from public, anon;
grant execute on function public.leads_recebidos(uuid, boolean) to authenticated;
