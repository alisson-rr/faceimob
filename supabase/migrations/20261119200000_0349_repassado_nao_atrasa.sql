-- =============================================================================
-- 0349 · Lead repassado não fica atrasado enquanto aguarda
--
-- Pedido de 19/11/2026: o repasse é retrabalho de lead antigo, não lead novo.
-- Enquanto ele espera na coluna "Repassados" (aguardando, sem cronômetro: a
-- mesma regra da coluna no funil), não conta como atrasado e não trava o
-- check-in. Ao ser pego, ganha um próximo contato no futuro (claim_lead) e a
-- partir daí segue a regra normal de atraso.
-- =============================================================================

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
    -- Repassado aguardando (sem cronômetro) não atrasa: ainda não foi pego.
    and not (l.status = 'assigned' and l.attend_deadline is null)
    -- Lead de antes do recomeço (0187) não trava o check-in: o corretor não o vê.
    and coalesce(l.assigned_at, l.created_at) >= (select public.leads_recomeco());
$$;

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
  v_repassado boolean;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  if v_lead.assigned_to is distinct from auth.uid() then
    raise exception 'Este lead não está atribuído a você.' using errcode = '42501';
  end if;

  if p_next_action_at is not null
     and (p_next_action_at < now() - interval '5 minutes' or p_next_action_at > now() + interval '90 days') then
    raise exception 'O próximo contato precisa ser entre agora e os próximos 90 dias.' using errcode = 'P0001';
  end if;

  -- 0314: o segundo "Pegar lead" no lead que JÁ é seu e já está em
  -- atendimento confirma em vez de dar erro. O aviso de lead novo tem o próprio
  -- botão e abre a ficha, onde o diálogo oferece pegar de novo; o toque duplo no
  -- celular faz o mesmo. A data escolhida na segunda vez vence a da primeira.
  if v_lead.status = 'attending' then
    if p_next_action_at is not null then
      update public.leads
         set next_action_at = p_next_action_at, last_activity_at = now()
       where id = p_lead_id
      returning * into v_lead;
      update public.tasks
         set due_at = p_next_action_at
       where ref_type = 'lead' and ref_id = p_lead_id and assigned_to = auth.uid()
         and status = 'open' and title like 'Retornar contato com %';
    end if;
    return v_lead;
  end if;

  if v_lead.status <> 'assigned' then
    raise exception 'Lead não está aguardando atendimento.' using errcode = 'P0001';
  end if;

  -- Repassado = a atribuição atual veio do repasse manual (`reassign_lead`,
  -- 0275), que grava o evento `reassigned` junto com o `assigned_at`. Lead
  -- entregue direto por outra via (ex.: SDR qualificou) mantém a etapa.
  v_repassado := exists (
    select 1 from public.lead_events e
     where e.lead_id = p_lead_id and e.kind = 'reassigned'
       and e.created_at >= coalesce(v_lead.assigned_at, 'infinity'::timestamptz)
  );

  select s.no_response_hours into v_hours from public.automation_settings s where s.id;
  -- A data escolhida ao pegar vence; sem ela, preserva a que o corretor já
  -- tinha marcado e só então cai no padrão.
  -- 0349: data vencida não é preservada — o repassado parado chegava com a
  -- data antiga e virava atrasado no mesmo clique em que foi pego.
  v_next := coalesce(p_next_action_at,
                     case when v_lead.next_action_at > now() then v_lead.next_action_at end,
                     now() + make_interval(hours => coalesce(v_hours, 24)));

  update public.lead_assignments
     set responded_at = now()
   where lead_id = p_lead_id and released_at is null;

  update public.leads
     set status           = 'attending',
         attend_deadline  = null,
         first_contact_at = coalesce(first_contact_at, now()),
         -- Pegar o lead é começar a conversa: sai de "novo" sem regredir quem
         -- já está adiante. 0344: o repassado (sem cronômetro) também vai para
         -- "Conversa iniciada" — no funil ele estava na coluna "Repassados".
         funnel_stage     = case when funnel_stage = 'new' or v_repassado then 'first_contact'::lead_funnel_stage
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
