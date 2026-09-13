-- =============================================================================
-- 0148 · O motor da roleta não depende de quem o acionou
--
-- A 0141 pôs em `distribution_queue` o recorte de alcance ("fila só de roleta ao
-- alcance de quem pergunta"), e `assign_lead` monta a fila chamando essa mesma
-- função. Resultado: quando o motor roda dentro de uma sessão de usuário, ele
-- enxerga só as roletas daquela pessoa. Pego pelo `tests/07_core_fixes.sql`
-- (varredura com a sessão de outro usuário ainda na conexão não atribuiu o lead
-- preso) e real em `sdr_handoff`: o SDR devolve o lead, a roleta do lead não
-- está no alcance dele, a fila volta vazia e o lead espera o cron do minuto
-- seguinte em vez de sair na hora.
--
-- O recorte é de LEITURA (quem pode ver nome e posição na fila), não regra de
-- distribuição. Quem pode mandar um lead para a roleta já é conferido antes, em
-- quem chama (`distribute_queued_lead` exige o lead ao alcance; o cron não tem
-- sessão). Então:
--   · `distribution_queue_interna` é a fila crua, sem sessão no meio, só para
--     funções do banco (sem EXECUTE para authenticated);
--   · `distribution_queue` continua sendo a da tela, com o recorte, e agora só
--     filtra a interna — a regra da fila vive num lugar só;
--   · `assign_lead` (corpo da 0141) passa a usar a interna.
-- =============================================================================

create or replace function public.distribution_queue_interna(p_group_id uuid)
returns table(profile_id uuid, full_name text, queue_position integer,
              last_assigned_at timestamptz, last_turn_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with eligible as (
    select
      c.profile_id,
      p.full_name,
      (
        select max(la.assigned_at)
        from public.lead_assignments la
        where la.profile_id = c.profile_id
      ) as last_assigned_at,
      -- Fim da última vez na roleta: lead perdido no prazo encerra a vez no
      -- released_at, não no assigned_at (0014).
      (
        select max(
          case
            when la.release_reason = 'timeout' then la.released_at
            else la.assigned_at
          end
        )
        from public.lead_assignments la
        where la.profile_id = c.profile_id
      ) as last_turn_at
    from public.checkins c
    join public.profiles p on p.id = c.profile_id
    join public.distribution_group_members m
      on m.profile_id = c.profile_id and m.active
    join public.distribution_groups g
      on g.id = m.group_id and g.active
    join public.work_shifts s on s.id = c.shift_id
    where c.work_date = public.current_work_date()
      and c.checked_out_at is null
      and m.group_id = p_group_id
      and p.status = 'active'
      and (now() at time zone 'America/Sao_Paulo')::time >= s.distribution_start
      and public.overdue_lead_count(c.profile_id)
          < (select s2.overdue_block_threshold from public.automation_settings s2 where s2.id)
  )
  select
    e.profile_id,
    e.full_name,
    row_number() over (order by e.last_turn_at asc nulls first, e.profile_id)::int
      as queue_position,
    e.last_assigned_at,
    e.last_turn_at
  from eligible e;
$$;

comment on function public.distribution_queue_interna(uuid) is
  'Fila da roleta sem recorte de sessão, para o motor (assign_lead). Sem EXECUTE para authenticated: a tela usa distribution_queue, que filtra pelo alcance (0148).';

revoke all on function public.distribution_queue_interna(uuid) from public, anon, authenticated;
grant execute on function public.distribution_queue_interna(uuid) to service_role;

-- A fila da tela: a mesma, recortada. Sem sessão (cron, edge com service role)
-- passa; com sessão, só roleta ao alcance (0141).
create or replace function public.distribution_queue(p_group_id uuid)
returns table(profile_id uuid, full_name text, queue_position integer,
              last_assigned_at timestamptz, last_turn_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select q.profile_id, q.full_name, q.queue_position, q.last_assigned_at, q.last_turn_at
    from public.distribution_queue_interna(p_group_id) q
   where (select auth.uid()) is null
      or p_group_id in (select public.auth_distribution_group_ids());
$$;

-- Corpo da 0141; a diferença é a fila interna nas duas escolhas de corretor.
create or replace function public.assign_lead(p_lead_id uuid, p_force boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_lead        public.leads;
  v_group       uuid;
  v_target      uuid;
  v_timeout     int;
  v_seq         int;
  v_paused      boolean;
  v_last_miss   uuid;
  v_miss_count  int;
  v_total_miss  int;
  v_max_rounds  int;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead % não encontrado.', p_lead_id using errcode = 'P0002';
  end if;

  select s.leads_paused, s.roulette_max_rounds
    into v_paused, v_max_rounds
  from public.automation_settings s where s.id;

  if coalesce(v_paused, false) then
    return null;
  end if;

  if v_lead.status not in ('queued') then
    return v_lead.assigned_to;
  end if;

  v_group := public.lead_distribution_group(p_lead_id);

  if v_group is null then
    return null;
  end if;

  -- TETO TOTAL. Um lead que ninguém atendeu depois de N voltas não é um lead
  -- que precisa girar mais: é um lead que precisa de gente. Ele sai da roleta,
  -- fica na bandeja do gestor e avisa quem responde pela operação.
  select count(*)::int into v_total_miss
  from public.lead_assignments la
  where la.lead_id = p_lead_id
    and la.release_reason = 'timeout';

  if not coalesce(p_force, false) and v_total_miss >= coalesce(v_max_rounds, 5) then
    -- Um aviso por travessia, não um por tentativa do cron (que roda a cada
    -- minuto): o evento só entra quando ainda não existe para esta contagem.
    if not exists (
      select 1 from public.lead_events e
      where e.lead_id = p_lead_id
        and e.kind = 'unattended'
        and (e.detail ->> 'misses')::int = v_total_miss
    ) then
      insert into public.lead_events (lead_id, actor_id, kind, detail)
      values (p_lead_id, null, 'unattended',
              jsonb_build_object('misses', v_total_miss, 'group_id', v_group));

      -- Destinatários: administrador; e gerente/diretor que alcança a roleta —
      -- o critério de auth_distribution_group_ids() visto pelo destinatário, que
      -- não é a sessão (quem chama aqui é o cron). Fila geral é de todos; roleta
      -- específica, de quem está nela ou lidera equipe ativa em que está alguém
      -- dela (membro ou gerente) — as regras de auth_visible_profiles(). Mudou a
      -- hierarquia lá, muda aqui: o teste 99_visibilidade_diretor_fila cobre.
      insert into public.notifications (profile_id, kind, title, body, link, channel)
      select distinct p.id,
             'lead_unattended',
             'Lead sem atendimento: ' || coalesce(v_lead.full_name, 'sem nome'),
             format('Voltou %s vezes para a roleta sem ninguém atender. Ele saiu da '
                    || 'distribuição automática e espera na bandeja "sem atendimento".',
                    v_total_miss),
             '/leads?lead=' || p_lead_id::text,
             'in_app'::public.notification_channel
        from public.user_roles ur
        join public.profiles p on p.id = ur.profile_id and p.status = 'active'
       where ur.role = 'admin'
          or (ur.role in ('manager', 'director')
              and (exists (select 1 from public.distribution_groups g
                            where g.id = v_group and g.kind = 'general')
                   or exists (
                     select 1
                       from public.distribution_group_members m
                      where m.group_id = v_group
                        and m.active
                        and (m.profile_id = p.id
                             or exists (
                               select 1
                                 from public.teams t
                                where t.active
                                  and p.id in (t.manager_id, t.director_id)
                                  and (t.manager_id = m.profile_id
                                       or exists (select 1 from public.team_members tm
                                                   where tm.team_id = t.id
                                                     and tm.profile_id = m.profile_id
                                                     and tm.left_at is null)))))));
    end if;

    return null;
  end if;

  -- Quem deixou ESTE lead vencer na rodada anterior não é o primeiro a recebê-lo
  -- de volta: senão, com um único corretor na fila, o mesmo lead circula nele a
  -- cada prazo vencido e infla o contador de "leads recebidos".
  select la.profile_id into v_last_miss
  from public.lead_assignments la
  where la.lead_id = p_lead_id
    and la.release_reason = 'timeout'
  order by la.released_at desc nulls last
  limit 1;

  -- Fila interna (0148): o motor distribui igual, seja o cron, o gestor ou o SDR
  -- quem o acionou.
  select q.profile_id into v_target
  from public.distribution_queue_interna(v_group) q
  where v_last_miss is null or q.profile_id <> v_last_miss
  order by q.queue_position
  limit 1;

  -- Fila com um corretor só: o lead ainda volta para ele — o cliente aceitou
  -- isso em 30/07 —, mas no máximo 3 vezes por conta do cron. Depois fica
  -- `queued` e aparece no card de saúde da roleta em vez de rodar em laço; o
  -- gestor destrava pelo botão "Distribuir" (`p_force`), que é o único caminho
  -- que ignora o teto.
  if v_target is null and v_last_miss is not null then
    select count(*)::int into v_miss_count
    from public.lead_assignments la
    where la.lead_id = p_lead_id
      and la.profile_id = v_last_miss
      and la.release_reason = 'timeout';

    if coalesce(p_force, false) or v_miss_count < 3 then
      select q.profile_id into v_target
      from public.distribution_queue_interna(v_group) q
      order by q.queue_position
      limit 1;
    end if;
  end if;

  if v_target is null then
    return null;
  end if;

  v_timeout := public.effective_attend_timeout(v_group);

  select coalesce(max(la.sequence), 0) + 1 into v_seq
  from public.lead_assignments la where la.lead_id = p_lead_id;

  insert into public.lead_assignments (lead_id, profile_id, group_id, sequence, deadline)
  values (p_lead_id, v_target, v_group, v_seq, now() + make_interval(secs => v_timeout));

  update public.leads
     set status                = 'assigned',
         assigned_to           = v_target,
         assigned_at           = now(),
         attend_deadline       = now() + make_interval(secs => v_timeout),
         distribution_group_id = v_group,
         last_activity_at      = now()
   where id = p_lead_id;

  -- Dia operacional de São Paulo (`current_work_date`, 0057), não a data do
  -- servidor: o banco está em UTC e o turno da noite acaba depois da virada.
  update public.checkins
     set leads_received = leads_received + 1
   where profile_id = v_target
     and work_date = public.current_work_date()
     and checked_out_at is null;

  insert into public.lead_events (lead_id, actor_id, kind, to_value, detail)
  values (p_lead_id, null, 'assigned', v_target::text,
          jsonb_build_object('group_id', v_group, 'sequence', v_seq,
                             'timeout_seconds', v_timeout, 'misses', v_total_miss));

  return v_target;
end;
$$;
