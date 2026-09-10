-- =============================================================================
-- 0074 · Roleta: teto de voltas, bandeja "sem atendimento", saída legítima do
--        lead e fila que respeita grupo desativado.
--
-- POR QUÊ (quatro defeitos medidos em homologação, todos com dado no banco):
--
--   1. `assign_lead` só olhava o contador de devoluções no ramo da FILA
--      UNITÁRIA. Com dois ou mais corretores na fila o lead circulava sem teto:
--      há 7 leads no catálogo com 23 entregas e 22 prazos vencidos cada. O teto
--      passa a ser TOTAL (`automation_settings.roulette_max_rounds`, 5), contado
--      em `lead_assignments.release_reason = 'timeout'` antes de escolher o
--      alvo — a causa compartilhada, não o ramo que o defeito aparecia.
--
--   2. Estourado o teto, o lead ficava `queued` e NINGUÉM era avisado: só
--      aparecia para quem abrisse o card Saúde da Roleta. Agora ele cai numa
--      bandeja "sem atendimento" (status `queued` + `roulette_misses` no teto),
--      emite `lead_events` e notifica gerente, diretor e administrador. O botão
--      "Distribuir" do gestor (`p_force`) continua sendo a válvula.
--
--   3. Não existia encerrar lead como perdido/descartado: o bloqueio de 20
--      atrasados era contornável por reagendamento infinito e um lead sem saída
--      ficava atrasado para sempre. `close_lead` é a saída legítima, com motivo
--      obrigatório; e o gatilho `leads_keep_next_action` proíbe o caminho
--      desonesto (limpar a próxima ação de um lead ainda em atendimento) no
--      ponto compartilhado — não em cada tela, porque o mesmo NULL passava por
--      `updateLead`, pela aba Dados e por qualquer chamada direta ao PostgREST.
--
--   4. `distribution_queue` juntava `distribution_group_members` sem olhar
--      `distribution_groups.active`: desativar um grupo em Admin não tirava
--      ninguém da fila dele.
--
--   5. Consequência do próprio teto (§6): o lead que sai da roleta é o mais
--      antigo da fila e ficaria travando a janela fixa de 50 de
--      `assign_queued_leads()`. A varredura passa a pular a bandeja.
--
-- Idempotente: `add column if not exists`, `create or replace`, `drop trigger
-- if exists` antes de criar. Asserts em `supabase/tests/74_leads_roleta.sql`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Teto de voltas, configurável — e o contador do lead
-- -----------------------------------------------------------------------------
alter table public.automation_settings
  add column if not exists roulette_max_rounds int not null default 5;

comment on column public.automation_settings.roulette_max_rounds is
  'Quantas vezes o mesmo lead pode voltar à roleta por prazo vencido antes de '
  'cair na bandeja "sem atendimento" do gestor. O botão Distribuir ignora o teto.';

alter table public.leads
  add column if not exists roulette_misses int not null default 0;

comment on column public.leads.roulette_misses is
  'Quantas vezes este lead voltou à fila por prazo de atendimento vencido. '
  'Mantido por `lead_assignments_count_miss`; com o teto atingido e status '
  '`queued`, o lead está na bandeja "sem atendimento".';

-- Uma volta é uma devolução por prazo — quem escreve isso é sempre um UPDATE em
-- `lead_assignments` (o cron, `reassign_lead`, o checkout do turno). Contar no
-- gatilho, e não dentro de `assign_lead`, mantém a coluna certa mesmo quando a
-- reatribuição não acontece (roleta pausada, ninguém na fila).
create or replace function public.lead_assignments_count_miss()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.release_reason = 'timeout'
     and old.release_reason is distinct from 'timeout' then
    update public.leads
       set roulette_misses = roulette_misses + 1
     where id = new.lead_id;
  end if;
  return null;
end;
$$;

drop trigger if exists lead_assignments_count_miss on public.lead_assignments;
create trigger lead_assignments_count_miss
  after update of release_reason on public.lead_assignments
  for each row execute function public.lead_assignments_count_miss();

-- Backfill: sem ele os leads que já circularam 22 vezes nasceriam zerados e o
-- teto só passaria a valer daqui para a frente.
update public.leads l
   set roulette_misses = c.total
  from (
    select la.lead_id, count(*)::int as total
    from public.lead_assignments la
    where la.release_reason = 'timeout'
    group by la.lead_id
  ) c
 where c.lead_id = l.id
   and l.roulette_misses is distinct from c.total;

-- -----------------------------------------------------------------------------
-- 2. `assign_lead` com teto TOTAL de voltas
--
-- O que muda em relação à 0056: `v_total_miss` é contado antes de escolher o
-- alvo e vale para qualquer tamanho de fila. O ramo da fila unitária (teto de 3
-- com um corretor só, decisão de 30/07) continua de pé — ele bate antes do teto
-- global e é mais restritivo de propósito.
-- -----------------------------------------------------------------------------
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
       where ur.role in ('manager', 'director', 'admin');
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

  select q.profile_id into v_target
  from public.distribution_queue(v_group) q
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
      from public.distribution_queue(v_group) q
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

comment on function public.assign_lead(uuid, boolean) is
  'Entrega o lead ao primeiro da fila do grupo. Teto TOTAL de voltas por prazo '
  'vencido (`automation_settings.roulette_max_rounds`): estourado, o lead fica '
  'na bandeja "sem atendimento" e avisa a gestão. `p_force` é o botão do gestor.';

-- -----------------------------------------------------------------------------
-- 3. A fila ignora grupo desativado
--
-- `distribution_groups.active` é o interruptor que Admin oferece; sem este
-- join, desligá-lo não tirava ninguém da fila e o card de saúde da roleta
-- mostrava gente "pronta" num grupo que não distribui mais.
-- -----------------------------------------------------------------------------
create or replace function public.distribution_queue(p_group_id uuid)
returns table(
  profile_id uuid,
  full_name text,
  queue_position integer,
  last_assigned_at timestamp with time zone,
  last_turn_at timestamp with time zone
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
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

comment on function public.distribution_queue(uuid) is
  'Quem está pronto para receber lead no grupo agora: presença aberta, turno já '
  'distribuindo, perfil ativo, GRUPO ATIVO e abaixo do teto de leads atrasados.';

-- -----------------------------------------------------------------------------
-- 4. Encerrar o lead como perdido/descartado, com motivo
--
-- A saída que faltava. Sem ela, "reagendar para sempre" era o único jeito de
-- tirar um lead da conta dos atrasados — a trava dos 20 punia quem é honesto.
-- Quem pode é quem já podia escrever no lead (`can_write_lead`): o corretor
-- responsável, o gestor dele e o administrador.
-- -----------------------------------------------------------------------------
create or replace function public.close_lead(
  p_lead_id uuid,
  p_status public.lead_status,
  p_reason text
)
returns public.leads
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_lead   public.leads;
  v_before public.lead_status;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_status not in ('lost', 'discarded') then
    raise exception 'Encerrar um lead aceita só "perdido" ou "descartado".'
      using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'O motivo é obrigatório para encerrar um lead.'
      using errcode = 'P0001';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  if not public.can_write_lead(p_lead_id) then
    raise exception 'Sem permissão para encerrar este lead.' using errcode = '42501';
  end if;

  if v_lead.converted_deal_id is not null then
    raise exception 'Este lead já virou negócio: encerre o negócio no Pipeline.'
      using errcode = 'P0001';
  end if;

  if v_lead.status in ('lost', 'discarded') then
    raise exception 'Este lead já está encerrado.' using errcode = 'P0001';
  end if;

  v_before := v_lead.status;

  -- A trava de atendimento morre junto: o lead encerrado não pode continuar
  -- correndo contra o relógio de ninguém.
  update public.lead_assignments
     set released_at = now(), release_reason = 'manual'
   where lead_id = p_lead_id and released_at is null;

  update public.leads
     set status           = p_status,
         lost_reason      = v_reason,
         lost_at          = now(),
         attend_deadline  = null,
         -- Sai da conta de `overdue_lead_count` porque o status deixa de ser
         -- de operação; zerar o prazo aqui é o que impede o lead encerrado de
         -- reaparecer como atrasado se algum dia voltar.
         next_action_at   = null,
         last_activity_at = now()
   where id = p_lead_id
  returning * into v_lead;

  -- O gatilho `leads_log_changes` (0005) já grava um `status_changed` sempre que
  -- `leads.status` muda. Repetir o mesmo evento aqui gravava DOIS: a aba
  -- Histórico mostrava a linha duplicada e o relatório "quantos perdemos por
  -- preço" — a razão de a lista de motivos ser fixa — contava em dobro. O que
  -- só existe aqui é o MOTIVO, então ele entra como evento próprio, sem
  -- reescrever o log do gatilho (que é imutável por contrato).
  insert into public.lead_events (lead_id, actor_id, kind, from_value, to_value, detail)
  values (p_lead_id, auth.uid(), 'closed', v_before::text, p_status::text,
          jsonb_build_object('reason', v_reason));

  return v_lead;
end;
$$;

comment on function public.close_lead(uuid, public.lead_status, text) is
  'Encerra o lead como perdido ou descartado com motivo obrigatório. É a saída '
  'legítima da contagem de atrasados que bloqueia o check-in em 20.';

revoke all on function public.close_lead(uuid, public.lead_status, text) from public;
grant execute on function public.close_lead(uuid, public.lead_status, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Ninguém apaga a próxima ação de um lead em atendimento
--
-- `next_action_at` é o que `overdue_lead_count` conta e o que trava o check-in.
-- Limpá-lo tirava o lead da conta sem nenhum registro — e o mesmo NULL entrava
-- por `updateLead`, pela aba Dados do detalhe e por qualquer PATCH direto no
-- PostgREST. A trava fica na tabela, que é o ponto por onde todos passam.
--
-- Encerrar o lead (`close_lead`) continua limpando, porque ali o status deixa
-- de ser de operação: é a saída legítima, não a fuga.
-- -----------------------------------------------------------------------------
create or replace function public.leads_keep_next_action()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.status in ('assigned', 'attending', 'in_progress')
     and old.next_action_at is not null
     and new.next_action_at is null then
    raise exception
      'Este lead está em atendimento e não pode ficar sem próxima ação. '
      'Marque uma nova data ou encerre o lead como perdido/descartado com motivo.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_keep_next_action on public.leads;
create trigger leads_keep_next_action
  before update of next_action_at, status on public.leads
  for each row execute function public.leads_keep_next_action();

comment on function public.leads_keep_next_action is
  'Proíbe limpar `next_action_at` de lead em assigned/attending/in_progress: '
  'era a fuga silenciosa do bloqueio dos 20 atrasados.';

-- -----------------------------------------------------------------------------
-- 6. A varredura da fila não pode ficar presa nos leads que saíram da roleta
--
-- Efeito colateral do teto da §2, corrigido junto porque nasce aqui: o lead que
-- estoura `roulette_max_rounds` fica em `queued` para sempre e `assign_lead`
-- passa a recusá-lo sempre. Como são os MAIS ANTIGOS, eles ocupam
-- permanentemente as primeiras posições da janela fixa de 50 de
-- `assign_queued_leads()` (0020/0022), que o cron `faceimob-assign-queued` roda
-- a cada minuto. Passando de 50 leads na fila, o cron gastaria a janela inteira
-- em leads que nunca serão distribuídos e o lead novo não sairia da fila. Antes
-- do teto eles circulavam — mal, mas circulavam.
--
-- A correção é só no recorte: quem já está na bandeja "sem atendimento" sai da
-- varredura. Ele continua alcançável pelo botão "Distribuir" do gestor, que
-- chama `assign_lead(p_force => true)`. O resto do corpo é o da 0022 (o desvio
-- de SDR continua valendo), replicado porque `create or replace` substitui a
-- função inteira.
-- -----------------------------------------------------------------------------
create or replace function public.assign_queued_leads()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead uuid;
  v_done int := 0;
  v_max_rounds int;
begin
  select coalesce(s.roulette_max_rounds, 5) into v_max_rounds
  from public.automation_settings s where s.id;

  for v_lead in
    select l.id from public.leads l
    where l.status = 'queued'
      and coalesce(l.roulette_misses, 0) < coalesce(v_max_rounds, 5)
      and not exists (
        select 1 from public.sdr_conversations c
        where c.lead_id = l.id and c.status = 'active'
      )
    order by l.created_at
    limit 50
  loop
    if public.assign_lead(v_lead) is not null then
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$$;

comment on function public.assign_queued_leads is
  'Varre a fila e distribui. Ignora lead em conversa ativa de SDR (0022) e lead '
  'que já bateu o teto de voltas (0074): sem isso a janela fixa de 50 ficaria '
  'presa nos mais antigos, que a roleta nunca mais aceita.';
