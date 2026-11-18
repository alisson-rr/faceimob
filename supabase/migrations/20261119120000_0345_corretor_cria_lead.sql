-- =============================================================================
-- 0345 · Corretor cadastra o próprio lead
--
-- Pedido de 19/11/2026: incluir a opção de o corretor criar lead. Criar lead
-- era de admin, diretor, gerente, marketing e SDR (policy `leads_insert`, 0005)
-- e o lead ia para a roleta. O lead que o corretor capta é dele: nasce em
-- atendimento, com ele, sem cronômetro e sem contar na fila (como o repasse,
-- 0275). Telefone que já está em atendimento com outro corretor é recusado —
-- mesma chave da afinidade por telefone (`telefone_chave`, 0306).
-- =============================================================================

create or replace function public.corretor_criar_lead(
  p_nome text,
  p_telefone text,
  p_email text default null,
  p_documento text default null,
  p_origem uuid default null,
  p_observacao text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_eu    uuid := auth.uid();
  v_nome  text := btrim(coalesce(p_nome, ''));
  v_chave text := public.telefone_chave(p_telefone);
  v_dono  text;
  v_hours int;
  v_id    uuid;
begin
  if v_eu is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if not public.has_role('broker') then
    raise exception 'Só corretor cadastra lead para si.' using errcode = '42501';
  end if;
  if v_nome = '' or length(v_nome) > 200 then
    raise exception 'Informe o nome do cliente.' using errcode = '22023';
  end if;
  if length(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g')) < 10 then
    raise exception 'Informe o telefone com DDD.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('lead-telefone:' || v_chave));
  select p.full_name into v_dono
    from public.leads l
    join public.profiles p on p.id = l.assigned_to
   where public.telefone_chave(l.phone) = v_chave
     and l.status in ('assigned', 'attending', 'in_progress')
   limit 1;
  if v_dono is not null then
    raise exception 'Este telefone já está em atendimento com %.', v_dono using errcode = 'P0001';
  end if;

  select s.no_response_hours into v_hours from public.automation_settings s where s.id;

  insert into public.leads
    (full_name, phone, email, document, source_id, notes,
     status, assigned_to, assigned_at, attend_deadline, funnel_stage,
     next_action_at, last_activity_at)
  values
    (v_nome, btrim(p_telefone), nullif(btrim(coalesce(p_email, '')), ''),
     nullif(btrim(coalesce(p_documento, '')), ''), p_origem,
     nullif(left(btrim(coalesce(p_observacao, '')), 4000), ''),
     'attending', v_eu, now(), null, 'new',
     now() + make_interval(hours => coalesce(v_hours, 24)), now())
  returning id into v_id;

  insert into public.lead_assignments
    (lead_id, profile_id, group_id, sequence, deadline, responded_at, counts_for_queue)
  values (v_id, v_eu, null, 1, now(), now(), false);

  insert into public.lead_events (lead_id, actor_id, kind, to_value, detail)
  values (v_id, v_eu, 'created', v_eu::text,
          jsonb_build_object('proprio', true, 'actor_name', public.profile_display_name(v_eu)));

  return v_id;
end;
$$;
comment on function public.corretor_criar_lead(text, text, text, text, uuid, text) is
  'Corretor cadastra lead para si (0345): nasce em atendimento com ele, sem cronômetro e fora da fila; recusa telefone já em atendimento com outro corretor.';
revoke all on function public.corretor_criar_lead(text, text, text, text, uuid, text) from public, anon;
grant execute on function public.corretor_criar_lead(text, text, text, text, uuid, text) to authenticated;
