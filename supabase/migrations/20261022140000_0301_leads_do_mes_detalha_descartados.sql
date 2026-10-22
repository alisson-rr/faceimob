-- =============================================================================
-- 0301 · "Leads · Este mês" detalha descartados e em atendimento
--
-- Pedido de 22/10/2026: abaixo do total do mês, em letra pequena, "Leads
-- descartados" (em vermelho) e "Leads em atendimento" (o resto). Descartado
-- aqui é o lead encerrado sem negócio — status perdido ou descartado —, os
-- mesmos que a 0299 voltou a contar pelo último corretor. A RPC devolve
-- `mes_descartados`; o resto do contrato não muda.
-- =============================================================================

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

  select jsonb_build_object(
           'hoje',   count(*) filter (where x.created_at >= v_hoje),
           'semana', count(*) filter (where x.created_at >= v_semana),
           'mes',    count(*) filter (where x.created_at >= v_mes),
           'mes_descartados', count(*) filter (where x.created_at >= v_mes and x.status in ('lost', 'discarded')))
    into v_out
    from (
      select l.created_at, l.status, coalesce(l.assigned_to, l.ultimo_corretor_id) as dono
        from public.leads l
       where l.created_at >= least(v_mes, v_semana)
         and coalesce(l.external_id, '') not like 'leadfy:%'
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
comment on function public.leads_recebidos(uuid, boolean) is
  'Leads recebidos hoje, na semana e no mês (fuso de São Paulo), com perdidos e descartados pelo último corretor (0299) e quantos do mês foram descartados (0301).';
