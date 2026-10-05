-- =============================================================================
-- 0227 — pegar lead com próximo contato e atividade; legados saem do mês
--        fechado; leads de outubro voltam ao corretor; leads 2026 da Leadfy
--        vão ao corretor de origem
--
-- Pedido do cliente em 05/10/2026:
--   1. "Pegar o lead está confuso": `claim_lead` passa a receber a data do
--      próximo contato escolhida na tela (antes ignorada se o lead já tinha uma,
--      e ficava tudo em 24 h), sempre evolui o lead de "novo" para "conversa
--      iniciada" e cria a atividade "Retornar contato" com esse prazo.
--   2. "Os legados que não ficaram OFF devem migrar ao mês seguinte": negócio
--      aberto, que não é venda nem perda, parado num mês fechado vai para o
--      primeiro mês aberto depois dele — a mesma regra que
--      `close_month_and_season` (0182) aplica ao fechar.
--   3. "Do dia 1 e alguns do dia 2 não foram somados": o recomeço da 0187 foi
--      gravado em 02/10 e escondia do corretor os leads de 01/10 e do começo de
--      02/10. Passa a ser o início de outubro (horário de Brasília).
--   4. "Os leads ativos de 2026 importados não foram distribuídos": os da
--      Leadfy criados em 2026, "Novo" ou "Em negociação", que entraram como
--      perdidos por não acharem o corretor, vão para o corretor de origem
--      quando ele existe hoje no CRM (decisão do cliente). Sem dono, ficam.
-- =============================================================================

-- 1. Pegar lead -----------------------------------------------------------------
drop function if exists public.claim_lead(uuid);

create or replace function public.claim_lead(p_lead_id uuid, p_next_action_at timestamptz default null)
returns public.leads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead  public.leads;
  v_hours int;
  v_next  timestamptz;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  if v_lead.assigned_to is distinct from auth.uid() then
    raise exception 'Este lead não está atribuído a você.' using errcode = '42501';
  end if;

  if v_lead.status <> 'assigned' then
    raise exception 'Lead não está aguardando atendimento.' using errcode = 'P0001';
  end if;

  if p_next_action_at is not null
     and (p_next_action_at < now() - interval '5 minutes' or p_next_action_at > now() + interval '90 days') then
    raise exception 'O próximo contato precisa ser entre agora e os próximos 90 dias.' using errcode = 'P0001';
  end if;

  select s.no_response_hours into v_hours from public.automation_settings s where s.id;
  -- A data escolhida ao pegar vence; sem ela, preserva a que o corretor já
  -- tinha marcado e só então cai no padrão.
  v_next := coalesce(p_next_action_at, v_lead.next_action_at,
                     now() + make_interval(hours => coalesce(v_hours, 24)));

  update public.lead_assignments
     set responded_at = now()
   where lead_id = p_lead_id and released_at is null;

  update public.leads
     set status           = 'attending',
         attend_deadline  = null,
         first_contact_at = coalesce(first_contact_at, now()),
         -- Pegar o lead é começar a conversa: sai de "novo" sem regredir quem
         -- já está adiante.
         funnel_stage     = case when funnel_stage = 'new' then 'first_contact'::lead_funnel_stage
                                 else funnel_stage end,
         next_action_at   = v_next,
         last_activity_at = now()
   where id = p_lead_id
  returning * into v_lead;

  insert into public.lead_events (lead_id, actor_id, kind)
  values (p_lead_id, auth.uid(), 'claimed');

  insert into public.tasks (title, assigned_to, created_by, due_at, ref_type, ref_id)
  values (left('Retornar contato com ' || coalesce(nullif(btrim(v_lead.full_name), ''), 'o lead'), 200),
          auth.uid(), auth.uid(), v_next, 'lead', p_lead_id);

  select * into v_lead from public.leads where id = p_lead_id;
  return v_lead;
end;
$$;

revoke all on function public.claim_lead(uuid, timestamptz) from public, anon;
grant execute on function public.claim_lead(uuid, timestamptz) to authenticated;

comment on function public.claim_lead(uuid, timestamptz) is
  'Pega o lead: trava com o corretor, evolui de novo para conversa iniciada, grava o próximo contato escolhido (ou now() + no_response_hours) e cria a atividade "Retornar contato" com esse prazo (0227).';

-- 2. Legados fora do mês fechado ---------------------------------------------------
update public.deals d
   set month_base = (
         select min(m)::date
           from generate_series(d.month_base + interval '1 month', d.month_base + interval '24 months', interval '1 month') m
          where not exists (select 1 from public.closed_months cm where cm.period = m::date))
 where d.outcome = 'open'
   and exists (select 1 from public.closed_months cm where cm.period = d.month_base)
   and not public.deal_counts_as_game_sale(d.outcome, d.status_group_id)
   and public.deal_status_bare(d.status_detail) not in ('OFF', 'DISTRATO', 'QUEDA', 'REPROVADO');

-- 3. Recomeço no início de outubro -------------------------------------------------
update public.automation_settings
   set leads_recomeco_em = timestamptz '2026-10-01 00:00:00-03'
 where leads_recomeco_em > timestamptz '2026-10-01 00:00:00-03';

-- 4. Leads de 2026 da Leadfy ao corretor de origem ---------------------------------
with alvo as (
  select l.id, public.perfil_pelo_nome_leadfy(l.raw_payload -> 'leadfy' ->> 'corretor') as corretor
    from public.leads l
   where l.external_id like 'leadfy:%'
     and l.status = 'lost'
     and l.converted_deal_id is null
     and l.created_at >= timestamptz '2026-01-01 00:00:00-03'
     and l.raw_payload -> 'leadfy' ->> 'status' in ('Novo', 'Em negociação')
     and nullif(btrim(l.raw_payload -> 'leadfy' ->> 'corretor'), '') is not null
)
update public.leads l
   set status           = 'attending',
       funnel_stage     = case when l.funnel_stage = 'new' then 'first_contact'::lead_funnel_stage else l.funnel_stage end,
       assigned_to      = a.corretor,
       assigned_at      = now(),
       first_contact_at = coalesce(l.first_contact_at, l.created_at),
       lost_reason      = null,
       lost_at          = null
  from alvo a
 where l.id = a.id and a.corretor is not null;
