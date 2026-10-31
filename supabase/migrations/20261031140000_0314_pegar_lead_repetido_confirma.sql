-- =============================================================================
-- 0314 — pegar o lead que já é seu não dá mais erro.
-- =============================================================================
-- Caso de 31/10/2026 (Daiane Jardim de Cristo): pegou o lead pelo botão do
-- aviso de lead novo às 13:34:04; a ficha abriu com o diálogo "Pegar lead", ela
-- escolheu "Em 3 dias" e recebeu "Lead não está aguardando atendimento." O
-- lead já era dela, mas a tela dizia o contrário e a data escolhida se perdia.
-- Mesma função da 0227, com o desvio do segundo clique.

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
