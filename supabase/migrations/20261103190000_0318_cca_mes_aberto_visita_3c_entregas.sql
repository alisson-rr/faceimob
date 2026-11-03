-- =============================================================================
-- 0318 — fila do CCA no mês aberto, aviso de visita da 3C e entregas do turno.
-- =============================================================================
-- Pedidos de 03/11/2026:
--   1. "A fila de análise sumiu do pipe": a fila do CCA contava só envios
--      DENTRO do mês do game. Com outubro aberto e o relógio em novembro, todo
--      envio de novembro ficou fora. Agora vale do mês aberto em diante, até
--      fecharem o mês.
--   2. Visita agendada pela 3C na agenda do dono do lead: o aviso não abria o
--      lead (ver abaixo).
--   3. "Quantos leads foram entregues no turno": `fila_entregas_do_turno`.
-- =============================================================================

create or replace function public.my_cca_queue_position()
returns table(deal_id uuid, deal_code text, client_name text,
              queue_position integer, submitted_at timestamptz, fila text)
language sql stable security definer set search_path = public, pg_temp
as $$
select r.deal_id, d.code,
       coalesce(dc.full_name, d.code, 'Cliente não informado'),
       r.position::integer, r.submitted_at, r.fila
from (
  select c.deal_id, c.submitted_at, f.fila,
         row_number() over (partition by f.fila order by c.submitted_at asc nulls last, c.id) as position
    from public.cca_cases c
    join public.deals d on d.id = c.deal_id
    cross join lateral (
      select case public.cca_stage_name_key(d.status_detail)
               when 'ESTEIRA AGIL' then 'agil'
               when 'ANALISE P/ VIRAR NEGOCIO' then 'virar'
             end as fila
    ) f
   where c.status not in ('approved', 'rejected', 'cancelled')
     and f.fila is not null
     and c.submitted_at >= (
       public.month_start(coalesce(public.current_season_month(), current_date))::timestamp
       at time zone 'America/Sao_Paulo'
     )
) r
join public.deals d on d.id = r.deal_id
left join public.deal_clients dc on dc.deal_id = d.id and dc.ordinal = 1
where exists (
  select 1
    from public.deal_participants dp
   where dp.deal_id = r.deal_id
     and dp.role = 'broker'
     and dp.profile_id in (select public.auth_visible_profiles())
)
order by r.fila, r.position;
$$;



create or replace function public.notify_visit_scheduled()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ator      uuid := auth.uid();
  v_ator_nome text;
  v_lead      public.leads;
begin
  -- Visita registrada já realizada é histórico, não agenda.
  if v_ator is null or new.result <> 'scheduled' then
    return null;
  end if;

  -- 0318: a integração 3C não "enxerga" o corretor, o lead vinha nulo e o
  -- aviso caía num link genérico do Pipeline ("nem clicando na notificação").
  -- Vale também a visita marcada NA AGENDA DO DONO do lead (é o que a 3C faz).
  -- A trava da 0143 continua: quem não enxerga o lead não o usa para avisar
  -- outra pessoa.
  if new.lead_id is not null then
    select l.* into v_lead from public.leads l
     where l.id = new.lead_id
       and (l.assigned_to = new.broker_id
            or l.assigned_to in (select public.auth_visible_profiles()));
  end if;
  select full_name into v_ator_nome from public.profiles where id = v_ator;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select dest.profile_id,
         'visit_scheduled',
         case when dest.profile_id = new.broker_id
              then 'Visita agendada para você'
              else 'Visita no seu lead'
         end || case when dest.profile_id = v_lead.assigned_to
                     then ': ' || coalesce(v_lead.full_name, 'sem nome') else '' end,
         format('%s agendou para %s.',
                coalesce(v_ator_nome, 'Alguém'),
                to_char(new.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI')),
         case when v_lead.id is not null then '/leads?lead=' || v_lead.id::text else '/pipeline' end,
         'in_app'
    from (select distinct unnest(array[new.broker_id, v_lead.assigned_to]) as profile_id) dest
    join public.profiles p on p.id = dest.profile_id and p.status = 'active'
   where dest.profile_id <> v_ator;

  return null;
end;
$$;


-- Leads entregues pela roleta em cada grupo do corretor, desde a abertura da
-- distribuição do turno vigente. Só os grupos de quem pergunta (0310).
create or replace function public.fila_entregas_do_turno()
returns table (group_id uuid, entregues int, desde timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with turno as (
    select (public.current_work_date()::timestamp + s.distribution_start) at time zone 'America/Sao_Paulo' as inicio
      from public.work_shifts s
     where s.id = public.current_shift()
  )
  select g.id, count(la.id)::int, t.inicio
    from turno t
    cross join public.distribution_groups g
    left join public.lead_assignments la
      on la.group_id = g.id and la.counts_for_queue and la.assigned_at >= t.inicio
   where g.id in (select public.auth_distribution_group_ids())
   group by g.id, t.inicio;
$$;
revoke all on function public.fila_entregas_do_turno() from public, anon;
grant execute on function public.fila_entregas_do_turno() to authenticated;
comment on function public.fila_entregas_do_turno() is
  'Leads entregues pela roleta em cada grupo do corretor desde o início da distribuição do turno vigente (0318).';
